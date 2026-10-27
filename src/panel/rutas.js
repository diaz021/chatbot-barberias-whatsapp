/**
 * PANEL WEB — rutas y API
 *
 * ⚠️ LA REGLA QUE NO SE PUEDE ROMPER EN MULTI-TENANT:
 *
 * Cada petición que nombra un barbero, un turno o una barbería tiene que
 * comprobar que la sesión TENGA DERECHO a ese recurso. No basta con exigir
 * sesión: si el dueño de la barbería A cambia un número en la petición y ve
 * la agenda de la B, da igual lo buena que sea la pantalla de acceso.
 *
 * Por eso `barberoDeLaSesion()` y `turnoDeLaSesion()` existen y se usan en
 * TODAS las rutas que tocan datos. Nunca se confía en el id que llega.
 */

import { Router } from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { consultar, consultarUna } from '../db/pool.js';
import * as acceso from '../servicios/acceso.js';
import * as sesionPanel from '../servicios/sesionPanel.js';
import { armarSemana, lunesDeLaSemana } from '../servicios/agendaSemana.js';
import { limpiarCache } from '../servicios/barberias.js';
import { instanteDe, hoyEn, horaNormal } from '../config/fechas.js';
import { MAX_POR_LISTA } from '../servicios/horarios.js';

const AQUI = dirname(fileURLToPath(import.meta.url));

export const rutasPanel = Router();

// ═══════════════════════════════════════════════════════════════════
//  La página
// ═══════════════════════════════════════════════════════════════════

/**
 * ⚠️ El HTML del panel vive en src/panel/, NO en una carpeta pública. En el
 * sistema anterior esta distinción importaba: cualquier cosa servida como
 * estática se abre sin pasar por el login.
 */
rutasPanel.get(['/panel', '/panel/'], (_req, res) => {
  res.sendFile(join(AQUI, 'panel.html'));
});

/**
 * El logo del panel. Es una imagen pública (no hay nada sensible en ella),
 * así que se puede servir sin sesión; lo que NO se sirve como estático es el
 * HTML, que se saltaría el login.
 *
 * ⚠️ HOY ES EL LOGO DE UNA SOLA BARBERÍA, FIJO. El panel es multi-tenant y esto no
 * lo es: cuando entre la segunda barbería verá este mismo logo. El color y
 * la firma ya se resuelven por barbería (columnas `color` y `firma`); el
 * logo tendría que seguir el mismo camino. Se deja así a propósito mientras
 * solo exista una barbería — y el login, además, se muestra antes de saber qué
 * barbería es, así que ahí el logo por-barbería exige repensar el acceso.
 */
rutasPanel.get('/panel/logo.png', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('image/png').sendFile(join(AQUI, 'logo.png'));
});

/** El favicon: el poste del logo recortado, 64×64. Mismo criterio que el logo. */
rutasPanel.get('/panel/favicon.png', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('image/png').sendFile(join(AQUI, 'favicon.png'));
});

// ═══════════════════════════════════════════════════════════════════
//  Acceso
// ═══════════════════════════════════════════════════════════════════

/** Huella del dispositivo para el freno. No identifica a nadie: agrupa. */
function huella(req) {
  const ip = (req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
  return `${ip}|${(req.headers['user-agent'] ?? '').slice(0, 60)}`;
}

rutasPanel.post('/panel/api/entrar', async (req, res) => {
  const { ok, frenado, admin } = await acceso.entrar(
    req.body?.telefono, req.body?.contrasena, huella(req)
  );

  if (frenado) {
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Espera ${acceso.VENTANA_MINUTOS} minutos.`,
    });
  }

  // ⚠️ El mismo mensaje si el número no existe y si la contraseña está mal.
  // Distinguirlos convertiría esta pantalla en un directorio de quién tiene
  // acceso: bastaría probar números para saber cuáles son administradores.
  if (!ok) {
    return res.status(401).json({ error: 'Número o contraseña incorrectos.' });
  }

  const cookie = sesionPanel.crear(admin);
  res.setHeader('Set-Cookie', sesionPanel.cabecera(cookie));
  res.json({ ok: true, nombre: admin.nombre });
});

rutasPanel.post('/panel/api/salir', (_req, res) => {
  res.setHeader('Set-Cookie', sesionPanel.cabecera('', { borrar: true }));
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════
//  A partir de aquí, todo exige sesión
// ═══════════════════════════════════════════════════════════════════

rutasPanel.use('/panel/api', sesionPanel.requiereSesion);

/** Las barberías que esta sesión puede ver. Global = todas. */
async function barberiasDeLaSesion(sesion) {
  return consultar(
    sesion.barberiaId
      ? `SELECT id, nombre, zona_horaria, color FROM barberias WHERE id = $1 AND activa`
      : `SELECT id, nombre, zona_horaria, color FROM barberias WHERE activa ORDER BY nombre`,
    sesion.barberiaId ? [sesion.barberiaId] : []
  );
}

/**
 * El barbero, SOLO si la sesión tiene derecho a él. null si no.
 * Esta comprobación es la que impide leer la agenda de otra barbería.
 */
async function barberoDeLaSesion(sesion, barberoId) {
  return consultarUna(
    `SELECT b.id, b.nombre, b.barberia_id, ba.zona_horaria, ba.nombre AS barberia
       FROM barberos b
       JOIN barberias ba ON ba.id = b.barberia_id
      WHERE b.id = $1 AND b.activo
        AND ($2::bigint IS NULL OR b.barberia_id = $2)
        AND ($3::bigint IS NULL OR b.id = $3)`,
    [barberoId, sesion.barberiaId ?? null, sesion.barberoId ?? null]
  );
}

/** El turno, solo si la sesión tiene derecho a él. */
async function turnoDeLaSesion(sesion, turnoId) {
  return consultarUna(
    `SELECT t.id, t.barberia_id, t.barbero_id, t.fecha, t.hora, t.tipo
       FROM turnos t
      WHERE t.id = $1 AND t.estado = 'Confirmado'
        AND ($2::bigint IS NULL OR t.barberia_id = $2)
        AND ($3::bigint IS NULL OR t.barbero_id = $3)`,
    [turnoId, sesion.barberiaId ?? null, sesion.barberoId ?? null]
  );
}

rutasPanel.get('/panel/api/yo', async (req, res) => {
  const barberias = await barberiasDeLaSesion(req.sesion);

  const barberos = await consultar(
    `SELECT b.id, b.nombre, b.barberia_id
       FROM barberos b
      WHERE b.activo
        AND ($1::bigint IS NULL OR b.barberia_id = $1)
        AND ($2::bigint IS NULL OR b.id = $2)
      ORDER BY b.barberia_id, b.orden`,
    [req.sesion.barberiaId ?? null, req.sesion.barberoId ?? null]
  );

  res.json({
    nombre: req.sesion.nombre,
    global: !req.sesion.barberiaId,
    // Un barbero con alcance propio no necesita el selector: solo se ve a él.
    soloUnBarbero: Boolean(req.sesion.barberoId),
    barberias,
    barberos,
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Agenda
// ═══════════════════════════════════════════════════════════════════

rutasPanel.get('/panel/api/semana', async (req, res) => {
  const barbero = await barberoDeLaSesion(req.sesion, Number(req.query.barbero));
  if (!barbero) return res.status(404).json({ error: 'barbero no encontrado' });

  const hoy = hoyEn(barbero.zona_horaria);
  const lunes = /^\d{4}-\d{2}-\d{2}$/.test(req.query.lunes ?? '')
    ? lunesDeLaSemana(req.query.lunes)
    : lunesDeLaSemana(hoy);

  const semana = await armarSemana(barbero.id, lunes, barbero.zona_horaria);
  res.json({ barbero: { id: barbero.id, nombre: barbero.nombre }, hoy, ...semana });
});

/** Bloquear una hora: vacaciones, descanso, lo que sea. */
rutasPanel.post('/panel/api/bloquear', async (req, res) => {
  const barbero = await barberoDeLaSesion(req.sesion, Number(req.body?.barbero));
  if (!barbero) return res.status(404).json({ error: 'barbero no encontrado' });

  const { fecha, hora } = req.body ?? {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha ?? '')) {
    return res.status(400).json({ error: 'fecha inválida' });
  }

  try {
    const filas = await consultar(
      `INSERT INTO turnos
         (barberia_id, barbero_id, fecha, hora, tipo, estado,
          cliente_nombre, inicio_en, recordatorio_enviado)
       VALUES ($1, $2, $3, $4, 'bloqueo', 'Confirmado', 'Descanso', $5, TRUE)
       RETURNING id`,
      [barbero.barberia_id, barbero.id, fecha, horaNormal(hora),
       instanteDe(fecha, horaNormal(hora), barbero.zona_horaria)]
    );
    res.json({ ok: true, turnoId: filas[0].id });
  } catch (error) {
    // 23505 = la restricción de unicidad. Alguien agendó ahí mientras tanto.
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ese horario ya está ocupado.' });
    }
    throw error;
  }
});

/**
 * Liberar un bloqueo. SOLO un bloqueo.
 *
 * ⚠️ DESDE EL PANEL NO SE CANCELA EL TURNO DE UN CLIENTE. Antes sí se podía,
 * y no estaba en los planes: un toque de más sobre la celda equivocada borra
 * la cita de alguien que ya la tiene confirmada por WhatsApp, y el cliente no
 * se entera de nada — el aviso de cancelación solo sale cuando cancela él.
 *
 * La comprobación va AQUÍ y no solo en la página. Quitar el botón del HTML no
 * protege nada: cualquiera puede mandar este POST a mano con el id de una
 * cita. Cancelar una cita es cosa del cliente, desde el bot.
 */
rutasPanel.post('/panel/api/liberar', async (req, res) => {
  const turno = await turnoDeLaSesion(req.sesion, Number(req.body?.turno));
  if (!turno) return res.status(404).json({ error: 'turno no encontrado' });

  if (turno.tipo !== 'bloqueo') {
    return res.status(403).json({
      error: 'El turno de un cliente no se cancela desde el panel. Solo el cliente puede cancelarlo.',
    });
  }

  await consultar(
    `UPDATE turnos SET estado = 'Cancelado', cancelado_en = now() WHERE id = $1`,
    [turno.id]
  );

  res.json({ ok: true, era: turno.tipo });
});

// ═══════════════════════════════════════════════════════════════════
//  Horarios
// ═══════════════════════════════════════════════════════════════════

rutasPanel.get('/panel/api/horarios', async (req, res) => {
  const barbero = await barberoDeLaSesion(req.sesion, Number(req.query.barbero));
  if (!barbero) return res.status(404).json({ error: 'barbero no encontrado' });

  const filas = await consultar(
    `SELECT dia_semana, turnos FROM horarios WHERE barbero_id = $1 ORDER BY dia_semana`,
    [barbero.id]
  );

  const porDia = Array.from({ length: 7 }, (_, d) =>
    (filas.find(f => f.dia_semana === d)?.turnos ?? []).map(h => h.slice(0, 5))
  );

  res.json({ barbero: { id: barbero.id, nombre: barbero.nombre }, dias: porDia });
});

rutasPanel.post('/panel/api/horarios', async (req, res) => {
  const barbero = await barberoDeLaSesion(req.sesion, Number(req.body?.barbero));
  if (!barbero) return res.status(404).json({ error: 'barbero no encontrado' });

  const dias = req.body?.dias;
  if (!Array.isArray(dias) || dias.length !== 7) {
    return res.status(400).json({ error: 'hacen falta los 7 días' });
  }

  // ⚠️ Se valida ANTES de escribir nada. Guardar la mitad y fallar deja al
  // barbero con una semana a medias, peor que no haber guardado.
  const errores = [];
  const limpios = [];

  for (let d = 0; d < 7; d++) {
    const horas = [];
    for (const crudo of dias[d] ?? []) {
      const m = String(crudo).trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!m) { errores.push(`"${crudo}" no es una hora válida (usa HH:MM)`); continue; }
      const [, h, mi] = m;
      if (Number(h) > 23 || Number(mi) > 59) { errores.push(`"${crudo}" no existe`); continue; }
      horas.push(horaNormal(`${h}:${mi}`));
    }

    const unicas = [...new Set(horas)].sort();

    // El tope de 10 filas de WhatsApp: una jornada con más turnos de los que
    // caben en una lista deja al cliente sin poder elegir. Ver construir.js.
    const manana = unicas.filter(h => Number(h.slice(0, 2)) < 12).length;
    const tarde = unicas.length - manana;
    if (manana > MAX_POR_LISTA || tarde > MAX_POR_LISTA * 2) {
      errores.push(`El ${['domingo','lunes','martes','miércoles','jueves','viernes','sábado'][d]} tiene demasiados turnos para una lista de WhatsApp`);
    }

    limpios.push(unicas);
  }

  if (errores.length) return res.status(400).json({ error: errores.join('. ') });

  for (let d = 0; d < 7; d++) {
    await consultar(
      `INSERT INTO horarios (barbero_id, dia_semana, turnos)
       VALUES ($1, $2, $3::time[])
       ON CONFLICT (barbero_id, dia_semana) DO UPDATE SET turnos = EXCLUDED.turnos`,
      [barbero.id, d, limpios[d]]
    );
  }

  // El bot cachea la configuración: sin esto el cambio "no se ve" durante
  // minutos y parece que no se guardó. Era una confusión habitual del
  // sistema anterior.
  limpiarCache();

  res.json({ ok: true, total: limpios.reduce((n, d) => n + d.length, 0) });
});
