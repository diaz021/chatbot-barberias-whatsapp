/**
 * SERVIDOR — chatbot multi-barbería
 *
 * Un solo proceso atiende el webhook de todas las barberías. Por eso el
 * orden de abajo importa: las rutas del webhook se registran PRIMERO, y
 * cualquier error se atrapa. Un fallo aquí deja sin bot a todas a la vez.
 */

import express from 'express';
import { env, revisarEntorno, tareasDeFondo } from './config/env.js';
import { verificarConexion, cerrarPool, limpiar } from './db/pool.js';
import { rutasWebhook } from './webhook/rutas.js';
import { rutasPanel } from './panel/rutas.js';
import { purgar } from './webhook/defensas.js';
import { purgar as purgarAcceso } from './servicios/acceso.js';
import { todas } from './servicios/barberias.js';
import * as recordatorios from './servicios/recordatorios.js';
import * as vigilancia from './servicios/vigilancia.js';

const app = express();

app.disable('x-powered-by');

/**
 * ⚠️ El `verify` guarda el cuerpo CRUDO antes de que Express lo convierta
 * en objeto. La firma de Meta se calcula sobre esos bytes exactos: volver a
 * serializar el JSON cambia espacios y orden de claves, y la firma no
 * coincide jamás. Sin esta línea, la defensa 4 no puede funcionar.
 */
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buffer) => { req.rawBody = buffer; },
}));

// El webhook va primero, antes que cualquier otra ruta: es lo que atiende
// a los clientes, y un fallo en el panel no puede estorbarle.
app.use(rutasWebhook);
app.use(rutasPanel);

/**
 * Chequeo de salud. Lo va a consultar el monitor externo.
 *
 * Reporta cuántas barberías están conectadas, no solo "estoy vivo": el fallo
 * más peligroso del sistema anterior era silencioso — el servicio respondía,
 * la web se veía, los logs se veían normales, y simplemente no llegaba ni un
 * mensaje. Un 200 a secas no habría delatado nada.
 */
app.get('/salud', async (_req, res) => {
  try {
    const lista = await todas();
    const conectadas = lista.filter(b => b.phone_number_id && b.activa);

    // El webhook es lo que de verdad importa: el servidor puede estar
    // perfecto y no llegar ni un mensaje. Un monitor externo debe mirar
    // `webhook.estado`, no solo que esto responda 200.
    const webhook = await vigilancia.revisarUrl();
    const enSilencio = await vigilancia.enSilencio();

    // Número desconectado o app desuscrita: el bot responde 200 a todo y aun
    // así no le llega ni un mensaje. Solo lo ve quien pregunte a Meta.
    const conexion = await vigilancia.revisarConexion();
    const numerosMal = conexion.detalle.filter(d => d.estado === 'mal');

    // Un despliegue con las tareas de fondo apagadas está roto aunque
    // responda a todo: no salen recordatorios. Se reporta como avería para
    // que el monitor externo lo cace, igual que el webhook mal configurado.
    const fondo = tareasDeFondo();

    const averiado = webhook.estado === 'mal' || numerosMal.length > 0 || !fondo.activas;

    res.status(averiado ? 503 : 200).json({
      estado: webhook.estado === 'mal' ? 'webhook mal configurado'
            : numerosMal.length        ? `número sin conexión — ${numerosMal[0].barberia.nombre}`
            : !fondo.activas          ? `tareas de fondo apagadas — ${fondo.motivo}`
            : 'ok',
      webhook,
      conexion: conexion.detalle.map(d => ({
        barberia: d.barberia.nombre, estado: d.estado, ...(d.motivo ? { detalle: d.motivo } : {}),
      })),
      tareasDeFondo: fondo.activas,
      barberias: { total: lista.length, conectadas: conectadas.length },
      sinMensajes: enSilencio.map(b => ({ nombre: b.nombre, horas: Math.floor(b.horas) })),
      firmaActiva: Boolean(env.META_APP_SECRET),
      hora: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({ estado: 'sin base de datos', detalle: limpiar(error.message) });
  }
});

app.use((_req, res) => res.sendStatus(404));

// Express 5 pasa por aquí también los rechazos de promesas en los handlers.
app.use((error, _req, res, _next) => {
  console.error('✗ Error no controlado:', limpiar(error.message));
  if (!res.headersSent) res.sendStatus(500);
});

// ═══════════════════════════════════════════════════════════════════
//  Arranque
// ═══════════════════════════════════════════════════════════════════

async function arrancar() {
  revisarEntorno();

  try {
    const db = await verificarConexion();
    console.log(`● Base de datos "${db}" conectada`);
  } catch (error) {
    console.error('✗ No se pudo conectar a la base:', limpiar(error.message));
    process.exit(1);
  }

  const lista = await todas();
  const conectadas = lista.filter(b => b.phone_number_id);

  console.log(`● ${lista.length} barbería(s) registrada(s), ${conectadas.length} conectada(s) a WhatsApp`);
  lista.forEach(b => {
    console.log(`   ${b.phone_number_id ? '✓' : '○'} ${b.nombre}${b.phone_number_id ? '' : '  (sin número aún)'}`);
  });

  const servidor = app.listen(env.PORT, () => {
    console.log(`● Escuchando en el puerto ${env.PORT}\n`);
  });

  // Limpieza de mensajes vistos y sesiones vencidas. Cada 10 minutos basta:
  // los umbrales son de 30 y 10 minutos.
  const limpieza = setInterval(() => {
    purgarAcceso().catch(() => {});
    purgar()
      .then(({ mensajes, sesiones }) => {
        if (mensajes || sesiones) {
          console.log(`○ Purga: ${mensajes} mensaje(s), ${sesiones} sesión(es)`);
        }
      })
      .catch(error => console.error('✗ Fallo en la purga:', limpiar(error.message)));
  }, 10 * 60 * 1000);

  limpieza.unref();

  /**
   * Recordatorios (1 hora antes) y vigilancia del webhook.
   *
   * ⚠️ Solo las corre UN proceso. Ver `tareasDeFondo()` en config/env.js: el
   * barrido no es de solo lectura —marca los turnos como recordados— así que
   * dos procesos contra la misma base se pisan, y en modo simulado uno de
   * ellos deja a clientes reales sin su recordatorio.
   *
   * Se dice en voz alta en los logs de las dos maneras. Un "no salen
   * recordatorios" callado es justo el fallo que este sistema evita.
   */
  const fondo = tareasDeFondo();
  let detenerRecordatorios = () => {};
  let detenerVigilancia = () => {};

  if (fondo.activas) {
    detenerRecordatorios = recordatorios.programar();
    detenerVigilancia = vigilancia.programar();
  } else {
    console.warn(`\n⚠ TAREAS DE FONDO APAGADAS — ${fondo.motivo}`);
    console.warn('   Desde este proceso NO salen recordatorios ni alertas de vigilancia.');
    console.warn('   Es lo correcto en local: el que las corre es el despliegue.\n');
  }

  // Railway manda SIGTERM al redesplegar. Sin esto, las conexiones quedan
  // colgando en el pooler de Supabase y consumen cupo hasta que expiran.
  const apagar = async (senal) => {
    console.log(`\n● ${senal} recibido, cerrando…`);
    clearInterval(limpieza);
    detenerRecordatorios();
    detenerVigilancia();
    servidor.close();
    await cerrarPool().catch(() => {});
    process.exit(0);
  };

  process.on('SIGTERM', () => apagar('SIGTERM'));
  process.on('SIGINT',  () => apagar('SIGINT'));
}

arrancar().catch(error => {
  console.error('✗ No se pudo arrancar:', limpiar(error.message));
  process.exit(1);
});
