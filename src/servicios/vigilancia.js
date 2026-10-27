/**
 * VIGILANCIA — detectar el fallo silencioso
 *
 * El 10 de agosto de 2026 el bot anterior pasó horas sin recibir un solo
 * mensaje. El servicio respondía, la web se veía, los logs se veían
 * normales. Nadie se enteró hasta que un cliente reclamó.
 *
 * ⚠️ Un monitor de disponibilidad corriente NO habría detectado eso: el
 * servidor contestaba 200 perfectamente. El problema no era que el servidor
 * estuviera caído, sino que Meta había dejado de entregarle mensajes.
 *
 * Tres comprobaciones. Las dos primeras AVISAN; la tercera solo anota:
 *
 *   1. LA URL REGISTRADA EN META  — ¿a dónde manda Meta los webhooks? Detecta
 *      exactamente la falla del 10 de agosto.
 *
 *   2. LA CONEXIÓN DE CADA NÚMERO — ¿el número sigue CONNECTED y la app sigue
 *      suscrita a su cuenta de WhatsApp? Son las otras dos formas de que "no
 *      llegue nada", preguntadas directamente en vez de adivinadas.
 *
 *   3. EL SILENCIO DE ENTRADA     — horas sin mensajes. SOLO VA AL REGISTRO.
 *
 * ⚠️ POR QUÉ EL SILENCIO YA NO AVISA POR WHATSAPP (22/09/2026). Era la
 * alarma para "número desconectado / app desuscrita", pero en una barbería
 * el silencio largo es NORMAL: en los registros de 19–22/09 hubo un domingo
 * entero sin un mensaje, y lunes y martes con 11 y 12 horas seguidas de
 * silencio en horario abierto. Los clientes escriben en ráfagas (una reserva
 * son ~7 mensajes seguidos) y después nada. Esa alarma habría sonado casi
 * todos los días, y una alarma que suena a diario deja de mirarse. Las dos
 * causas reales se comprueban ahora en el punto 2, sin falsos positivos.
 *
 * ⚠️ Y UN FALLO REAL QUE TENÍA: la consulta del silencio no traía el
 * `phone_number_id`, así que la alerta nunca se podía enviar; y como no se
 * enviaba, tampoco se marcaba como avisada y se reintentaba cada 15 minutos.
 * 85 intentos fallidos en cuatro días. Ahora toda alerta se da por avisada
 * al INTENTARLA, salga o no — si no sale, queda en el registro.
 */

import { consultar, consultarUna, limpiar } from '../db/pool.js';
import { env } from '../config/env.js';
import { enviar } from './whatsapp.js';
import { hoyEn, ahoraEnMinutos, horaEnMinutos } from '../config/fechas.js';
import { diaDeHorario } from '../config/festivos.js';

/** Horas de silencio en horario abierto antes de avisar. */
export const SILENCIO_HORAS = 5;

/** No se repite la alerta antes de esto, para no acosar durante la avería. */
const ESPERA_ENTRE_ALERTAS_HORAS = 6;

/** Cada cuánto se revisa. */
export const CADA_MINUTOS = 15;

/**
 * Freno en memoria para las alertas que no tienen columna propia en la base
 * (webhook caído, número desconectado). Sin él se repetían cada 15 minutos
 * mientras durara la avería. Reiniciar el proceso lo vacía: en el peor caso
 * llega una alerta de más tras un despliegue, que es aceptable.
 */
const ultimaAlerta = new Map();

export function tocaAvisar(clave, ahora = Date.now()) {
  const antes = ultimaAlerta.get(clave);
  if (antes && ahora - antes < ESPERA_ENTRE_ALERTAS_HORAS * 3600_000) return false;
  ultimaAlerta.set(clave, ahora);
  return true;
}

/** Solo para las pruebas. */
export function olvidarAlertas() { ultimaAlerta.clear(); }

// ═══════════════════════════════════════════════════════════════════
//  Registro de entrada
// ═══════════════════════════════════════════════════════════════════

/**
 * Marca que llegó un mensaje. Lo llama el webhook en cada entrante.
 *
 * Es un UPDATE por mensaje, que suena caro pero no lo es: son unos pocos
 * cientos al mes por barbería. Y sin este dato no hay forma de distinguir
 * "nadie ha escrito" de "no nos está llegando nada".
 */
export async function registrarEntrante(barberiaId) {
  await consultar(
    `UPDATE barberias
        SET ultimo_entrante_en = now(), alertada_en = NULL
      WHERE id = $1`,
    [barberiaId]
  );
}

// ═══════════════════════════════════════════════════════════════════
//  1. La URL registrada en Meta
// ═══════════════════════════════════════════════════════════════════

/**
 * Le pregunta a Meta a dónde está mandando los webhooks de esta app.
 *
 * Usa un token de aplicación (`app_id|app_secret`), que no caduca y no hace
 * falta generar: se arma con dos valores que ya tenemos.
 *
 * Devuelve { ok, url, suscritoAMensajes, motivo }.
 */
export async function urlRegistradaEnMeta() {
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    return { ok: false, motivo: 'faltan META_APP_ID o META_APP_SECRET' };
  }

  const token = `${env.META_APP_ID}|${env.META_APP_SECRET}`;
  const url = `https://graph.facebook.com/${env.API_VERSION}/${env.META_APP_ID}/subscriptions` +
              `?access_token=${encodeURIComponent(token)}`;

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const j = await r.json();

    if (!r.ok) {
      return { ok: false, motivo: j.error?.message ?? `HTTP ${r.status}` };
    }

    const wa = (j.data ?? []).find(s => s.object === 'whatsapp_business_account');
    if (!wa) {
      return { ok: true, url: null, suscritoAMensajes: false, motivo: 'la app no tiene webhook de WhatsApp' };
    }

    return {
      ok: true,
      url: wa.callback_url ?? null,
      suscritoAMensajes: (wa.fields ?? []).some(f => f.name === 'messages'),
    };
  } catch (error) {
    return { ok: false, motivo: limpiar(error.message) };
  }
}

/**
 * ¿Meta está apuntando a donde creemos?
 *
 * Sin URL_PUBLICA configurada no se puede comparar, y se dice claramente en
 * vez de dar por bueno lo que no se comprobó.
 */
export async function revisarUrl({ consultarMeta = urlRegistradaEnMeta, urlPublica = env.URL_PUBLICA } = {}) {
  const registrada = await consultarMeta();

  if (!registrada.ok) {
    return { estado: 'sin_comprobar', detalle: registrada.motivo };
  }

  if (!registrada.suscritoAMensajes) {
    return {
      estado: 'mal',
      detalle: 'La app NO está suscrita al campo "messages": Meta no enviará ningún mensaje.',
    };
  }

  if (!urlPublica) {
    return { estado: 'sin_comprobar', detalle: 'falta URL_PUBLICA para comparar', url: registrada.url };
  }

  const esperada = `${urlPublica.replace(/\/+$/, '')}/webhook`;

  if (registrada.url !== esperada) {
    return {
      estado: 'mal',
      detalle: `Meta envía a "${registrada.url}" y este sistema escucha en "${esperada}".`,
      url: registrada.url,
    };
  }

  return { estado: 'bien', url: registrada.url };
}

// ═══════════════════════════════════════════════════════════════════
//  2. La conexión de cada número
// ═══════════════════════════════════════════════════════════════════

/**
 * Le pregunta a Meta por un número: su estado y si nuestra app sigue
 * suscrita a la cuenta de WhatsApp (WABA) a la que pertenece.
 *
 * Devuelve { ok, estado, suscrita, motivo }. `suscrita` es null cuando no se
 * pudo comprobar (por ejemplo, la barbería no tiene waba_id en la base).
 */
export async function conexionEnMeta(barberia) {
  const pedir = (ruta) => fetch(`https://graph.facebook.com/${env.API_VERSION}/${ruta}`, {
    headers: { Authorization: `Bearer ${env.API_TOKEN}` },
    signal: AbortSignal.timeout(15_000),
  }).then(async r => ({ ok: r.ok, d: await r.json() }));

  if (!env.API_TOKEN) return { ok: false, motivo: 'falta API_TOKEN' };

  try {
    const numero = await pedir(`${barberia.phone_number_id}?fields=status`);
    if (!numero.ok) return { ok: false, motivo: numero.d.error?.message ?? 'Meta no respondió' };

    let suscrita = null;
    if (barberia.waba_id && env.META_APP_ID) {
      const apps = await pedir(`${barberia.waba_id}/subscribed_apps`);
      if (apps.ok) {
        suscrita = (apps.d.data ?? []).some(a => a.whatsapp_business_api_data?.id === env.META_APP_ID);
      }
    }

    return { ok: true, estado: numero.d.status ?? null, suscrita };
  } catch (error) {
    return { ok: false, motivo: limpiar(error.message) };
  }
}

/**
 * ¿Los números de las barberías siguen conectados y entregándonos mensajes?
 *
 * Sin falsos positivos: si Meta no contesta, se dice "sin comprobar" en vez
 * de dar la alarma — mejor no avisar que avisar de algo que no se sabe.
 *
 * `consultarMeta` y `barberias` se pueden inyectar: así las pruebas no tocan
 * la red ni la base real.
 */
export async function revisarConexion({ consultarMeta = conexionEnMeta, barberias = null } = {}) {
  const lista = barberias ?? await consultar(
    `SELECT id, nombre, phone_number_id, waba_id FROM barberias
      WHERE activa AND phone_number_id IS NOT NULL`
  );

  const detalle = [];
  for (const b of lista) {
    const r = await consultarMeta(b);

    if (!r.ok) {
      detalle.push({ barberia: b, estado: 'sin_comprobar', motivo: r.motivo });
    } else if (r.estado !== 'CONNECTED') {
      detalle.push({ barberia: b, estado: 'mal',
        motivo: `El número está "${r.estado ?? 'desconocido'}", no CONNECTED: no recibe ni envía mensajes.` });
    } else if (r.suscrita === false) {
      detalle.push({ barberia: b, estado: 'mal',
        motivo: 'La app ya no está suscrita a la cuenta de WhatsApp: Meta no nos entrega sus mensajes.' });
    } else {
      detalle.push({ barberia: b, estado: 'bien' });
    }
  }

  const estado = detalle.some(d => d.estado === 'mal') ? 'mal'
               : detalle.some(d => d.estado === 'sin_comprobar') ? 'sin_comprobar'
               : 'bien';
  return { estado, detalle };
}

// ═══════════════════════════════════════════════════════════════════
//  3. El silencio de entrada — solo al registro
// ═══════════════════════════════════════════════════════════════════

/**
 * ¿La barbería está en horario de atención ahora mismo?
 *
 * Se mira el primer y el último turno configurado hoy entre TODOS sus
 * barberos. Fuera de esa franja el silencio es normal y no se avisa: un
 * aviso a las 3 de la mañana porque nadie escribe es ruido, y el ruido hace
 * que se dejen de mirar las alertas de verdad.
 */
async function franjaDeHoy(barberia) {
  const fila = await consultarUna(
    `SELECT MIN(t) AS primero, MAX(t) AS ultimo
       FROM barberos b
       JOIN horarios h ON h.barbero_id = b.id
       CROSS JOIN LATERAL unnest(h.turnos) AS t
      WHERE b.barberia_id = $1 AND b.activo AND h.dia_semana = $2`,
    // diaDeHorario y no diaSemana: un festivo se atiende con el horario del
    // domingo, y la vigilancia tiene que saberlo igual que el bot.
    [barberia.id, diaDeHorario(hoyEn(barberia.zona_horaria))]
  );

  if (!fila?.primero) return null;   // hoy no trabaja nadie
  return { apertura: horaEnMinutos(fila.primero), cierre: horaEnMinutos(fila.ultimo) + 60 };
}

/**
 * Horas de silencio CONTADAS SOLO DENTRO DEL HORARIO DE HOY, o null si ahora
 * está cerrada. Pura: se prueba sin base ni reloj.
 *
 * ⚠️ Antes se contaban las horas desde el último mensaje, noche incluida. Si
 * el último llegó a las 10 p.m., a las 9 a.m. ya "llevaba 11 horas" sin que
 * hubiera abierto la puerta: la alarma saltaba cada mañana antes del primer
 * cliente. El silencio de la noche no cuenta.
 */
export function silencioEnHorario({ horasDesdeUltimo, apertura, cierre, ahora }) {
  if (ahora < apertura || ahora > cierre) return null;
  return Math.min(horasDesdeUltimo, (ahora - apertura) / 60);
}

/**
 * Las barberías conectadas que llevan demasiadas horas de horario abierto sin
 * recibir nada. Solo informa: ver la nota del principio del archivo.
 */
export async function enSilencio() {
  const candidatas = await consultar(
    `SELECT id, nombre, zona_horaria, phone_number_id, ultimo_entrante_en, alertada_en,
            EXTRACT(EPOCH FROM (now() - ultimo_entrante_en)) / 3600 AS horas
       FROM barberias
      WHERE activa
        AND phone_number_id IS NOT NULL
        AND ultimo_entrante_en IS NOT NULL
        AND ultimo_entrante_en < now() - ($1 || ' hours')::interval
        AND (alertada_en IS NULL OR alertada_en < now() - ($2 || ' hours')::interval)`,
    [SILENCIO_HORAS, ESPERA_ENTRE_ALERTAS_HORAS]
  );

  const resultado = [];
  for (const b of candidatas) {
    const franja = await franjaDeHoy(b);
    if (!franja) continue;

    const horas = silencioEnHorario({
      horasDesdeUltimo: Number(b.horas),
      ...franja,
      ahora: ahoraEnMinutos(b.zona_horaria),
    });
    if (horas !== null && horas >= SILENCIO_HORAS) resultado.push({ ...b, horas });
  }
  return resultado;
}

// ═══════════════════════════════════════════════════════════════════
//  Avisar
// ═══════════════════════════════════════════════════════════════════

/** Los administradores globales, que son quienes pueden arreglarlo. */
async function administradores() {
  return consultar(
    `SELECT telefono, nombre FROM admins WHERE barberia_id IS NULL`
  );
}

async function avisar(cuerpo, barberia) {
  const destinos = await administradores();

  if (destinos.length === 0) {
    console.error('✗ ALERTA SIN DESTINO — no hay administradores globales en la tabla `admins`');
    console.error('  ' + cuerpo.replace(/\n/g, '\n  '));
    return false;
  }

  let alguno = false;
  for (const admin of destinos) {
    const ok = await enviar({
      messaging_product: 'whatsapp',
      to: admin.telefono,
      type: 'text',
      text: { body: cuerpo, preview_url: false },
    }, barberia);
    if (ok) alguno = true;
  }
  return alguno;
}

/**
 * Una ronda completa de vigilancia.
 *
 * ⚠️ La alerta sale por WhatsApp desde el mismo sistema que está fallando.
 * Si lo que se rompió es el ENVÍO, la alerta tampoco sale. Por eso siempre
 * se escribe también en el log, y por eso hace falta ADEMÁS un monitor
 * externo que vigile `/salud` — ahí es donde esto se vuelve a prueba de
 * fallos. Un sistema no puede ser su único vigilante.
 */
export async function revisar({ conexion = revisarConexion } = {}) {
  const informe = { url: null, conexion: null, silencio: [], avisos: 0 };

  // ── 1. La URL ──
  informe.url = await revisarUrl();

  if (informe.url.estado === 'mal') {
    console.error(`✗ WEBHOOK MAL CONFIGURADO: ${informe.url.detalle}`);

    const barberia = await consultarUna(
      `SELECT id, nombre, phone_number_id FROM barberias
        WHERE activa AND phone_number_id IS NOT NULL LIMIT 1`
    );

    if (barberia && tocaAvisar('webhook')) {
      const aviso =
        `🔴 *WEBHOOK CAÍDO*\n\n` +
        `${informe.url.detalle}\n\n` +
        `El bot NO está recibiendo mensajes. ` +
        `Revise la URL en Meta → WhatsApp → Configuración.`;
      if (await avisar(aviso, barberia)) informe.avisos++;
    }
  }

  // ── 2. La conexión de cada número ──
  informe.conexion = await conexion();

  for (const d of informe.conexion.detalle.filter(x => x.estado === 'mal')) {
    console.error(`✗ [${d.barberia.nombre}] ${d.motivo}`);

    // ⚠️ Si el número está desconectado, esta alerta sale por ese mismo
    // número y tampoco llegará. Por eso el fallo también sale en /salud:
    // ahí lo caza el monitor externo, que no depende de WhatsApp.
    if (tocaAvisar(`conexion:${d.barberia.id}`)) {
      const aviso =
        `🔴 *${d.barberia.nombre.toUpperCase()} NO RECIBE MENSAJES*\n\n` +
        `${d.motivo}\n\n` +
        `Los clientes escriben y el bot no les contesta. Revise en Meta → ` +
        `WhatsApp Manager.`;
      if (await avisar(aviso, d.barberia)) informe.avisos++;
    }
  }

  // ── 3. El silencio: solo al registro, una vez cada 6 h ──
  informe.silencio = await enSilencio();

  for (const b of informe.silencio) {
    console.warn(
      `⚠ [${b.nombre}] ${Math.floor(b.horas)} h de horario abierto sin mensajes ` +
      `(puede ser un día flojo; la conexión se revisa aparte)`
    );
    await consultar('UPDATE barberias SET alertada_en = now() WHERE id = $1', [b.id]);
  }

  return informe;
}

/** Arranca la vigilancia periódica. Devuelve una función para detenerla. */
export function programar() {
  const correr = () => {
    revisar().catch(e => console.error('✗ Fallo en la vigilancia:', limpiar(e.message)));
  };

  // Una revisión al arrancar: si el despliegue rompió el webhook, se sabe ya.
  setTimeout(correr, 20_000).unref();

  const temporizador = setInterval(correr, CADA_MINUTOS * 60 * 1000);
  temporizador.unref();

  console.log(`● Vigilancia cada ${CADA_MINUTOS} min (silencio: ${SILENCIO_HORAS} h)`);

  return () => clearInterval(temporizador);
}
