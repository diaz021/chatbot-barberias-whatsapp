/**
 * Comprobación de extremo a extremo del webhook.
 * Necesita el servidor corriendo en el puerto 3100 con META_APP_SECRET puesto.
 */
import crypto from 'node:crypto';
import pg from 'pg';
import 'dotenv/config';

const BASE = 'http://127.0.0.1:3100';
const SECRETO = 'secreto-e2e';
const VERIFY = 'token-e2e';
const PNI = '999888777666555';   // phone_number_id ficticio para la prueba

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '') ? false : { rejectUnauthorized: false } });
await db.connect();

let ok = 0, fallo = 0;
const chequear = (nombre, condicion, detalle = '') => {
  if (condicion) { console.log(`  ✓ ${nombre}`); ok++; }
  else { console.log(`  ✗ ${nombre} ${detalle}`); fallo++; }
};

const enviar = async (cuerpo, { firmar = true } = {}) => {
  const crudo = JSON.stringify(cuerpo);
  const cabeceras = { 'content-type': 'application/json' };
  if (firmar) {
    cabeceras['x-hub-signature-256'] =
      'sha256=' + crypto.createHmac('sha256', SECRETO).update(crudo).digest('hex');
  }
  const r = await fetch(`${BASE}/webhook`, { method: 'POST', headers: cabeceras, body: crudo });
  return r.status;
};

const carga = (id, texto, ts = Math.floor(Date.now() / 1000), pni = PNI) => ({
  entry: [{ changes: [{ value: {
    metadata: { phone_number_id: pni },
    contacts: [{ profile: { name: 'Cliente Prueba' } }],
    messages: [{ id, from: '573001234567', timestamp: String(ts), type: 'text', text: { body: texto } }],
  } }] }],
});

// Se conecta la barbería ANTES de mandarle nada. El servidor cachea las
// búsquedas por phone_number_id, así que consultar un número y registrarlo
// después deja el `null` viejo en memoria — y la prueba fallaría por el
// orden de sus propios pasos, no por un defecto del código.
await db.query('UPDATE barberias SET phone_number_id=$1 WHERE nombre=$2', [PNI, 'Barbería Demo']);

console.log('\n── VERIFICACIÓN (GET) ──');
{
  const bien = await fetch(`${BASE}/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`);
  chequear('token correcto devuelve el challenge en texto plano',
    bien.status === 200 && (await bien.text()) === '12345');

  const mal = await fetch(`${BASE}/webhook?hub.mode=subscribe&hub.verify_token=INCORRECTO&hub.challenge=12345`);
  chequear('token incorrecto devuelve 403', mal.status === 403);
}

console.log('\n── DEFENSA 4: firma ──');
{
  chequear('sin firma → 403', await enviar(carga('sin-firma', 'hola'), { firmar: false }) === 403);
  chequear('con firma válida → 200', await enviar(carga('e2e-firma-ok', 'hola')) === 200);
}

console.log('\n── ENRUTAMIENTO multi-tenant ──');
{
  const id = 'e2e-sin-registrar-' + Date.now();
  const st = await enviar(carga(id, 'hola', undefined, '000000000000'));
  await new Promise(r => setTimeout(r, 400));
  const { rows } = await db.query('SELECT 1 FROM mensajes_vistos WHERE message_id=$1', [id]);

  // Se responde 200 igual —a Meta siempre se le responde 200— pero el mensaje
  // no se procesa: no llega ni a registrarse como visto.
  chequear('número no registrado → 200', st === 200);
  chequear('número no registrado → no se procesa', rows.length === 0);
}

console.log('\n── DEFENSA 2: deduplicación ──');
{
  const id = 'e2e-dup-' + Date.now();
  await enviar(carga(id, 'primera vez'));
  await new Promise(r => setTimeout(r, 400));
  const { rows: r1 } = await db.query('SELECT 1 FROM mensajes_vistos WHERE message_id=$1', [id]);
  chequear('el primer mensaje queda registrado', r1.length === 1);

  await enviar(carga(id, 'segunda vez'));
  await new Promise(r => setTimeout(r, 400));
  const { rows: r2 } = await db.query('SELECT COUNT(*)::int n FROM mensajes_vistos WHERE message_id=$1', [id]);
  chequear('el repetido no duplica la fila', r2[0].n === 1);
}

console.log('\n── DEFENSA 3: mensajes viejos ──');
{
  const id = 'e2e-viejo-' + Date.now();
  const hace20min = Math.floor(Date.now() / 1000) - 20 * 60;
  await enviar(carga(id, 'llego tarde', hace20min));
  await new Promise(r => setTimeout(r, 400));
  const { rows } = await db.query('SELECT 1 FROM mensajes_vistos WHERE message_id=$1', [id]);
  chequear('descartado antes de registrarse', rows.length === 0);
}

console.log('\n── /salud ──');
{
  const r = await fetch(`${BASE}/salud`);
  const j = await r.json();
  // No se mira `estado === 'ok'`: un servidor local corre con las tareas de
  // fondo apagadas y eso ya lo reporta como avería, a propósito. Lo que hay
  // que comprobar aquí es el webhook.
  chequear('el webhook apunta aquí', j.webhook.estado === 'bien', JSON.stringify(j.webhook));
  chequear('cuenta 1 barbería conectada', j.barberias.conectadas === 1, JSON.stringify(j.barberias));
  chequear('reporta la firma activa', j.firmaActiva === true);
  chequear('dice si corre las tareas de fondo', typeof j.tareasDeFondo === 'boolean');
}

// Limpieza: dejar la base como estaba.
await db.query('UPDATE barberias SET phone_number_id=NULL WHERE nombre=$1', ['Barbería Demo']);
await db.query("DELETE FROM mensajes_vistos WHERE message_id LIKE 'e2e-%'");
await db.end();

console.log(`\n${fallo === 0 ? '●' : '✗'} ${ok} bien, ${fallo} mal\n`);
process.exit(fallo === 0 ? 0 : 1);
