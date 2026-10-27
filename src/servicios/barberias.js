/**
 * RESOLVER LA BARBERÍA — el corazón del multi-tenant
 *
 * Meta manda `metadata.phone_number_id` dentro de cada mensaje: es el
 * identificador del número por el que entró. Ese campo es la llave que dice
 * a qué barbería pertenece el mensaje.
 *
 * Una sola dirección de webhook atiende a todas. Sin configuración por
 * cliente, sin subdominios, sin rutas distintas.
 *
 * Se cachea en memoria porque esto se consulta en CADA mensaje y la
 * configuración de una barbería cambia una vez cada varios meses.
 */

import { consultarUna, consultar } from '../db/pool.js';

const CACHE_MS = 5 * 60 * 1000;        // barbería encontrada
const CACHE_NULL_MS = 30 * 1000;       // número desconocido

const cache = new Map();               // phone_number_id -> { barberia, expira }

/**
 * Devuelve la barbería dueña de ese número, o null.
 *
 * null significa una de dos cosas, y las dos son "ignorar el mensaje":
 * el número no está registrado en la base, o la barbería está desactivada.
 * Nunca se responde a un número desconocido: sería contestarle a alguien
 * que no es cliente de nadie.
 */
export async function porPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return null;

  const guardada = cache.get(phoneNumberId);
  if (guardada && guardada.expira > Date.now()) {
    return guardada.barberia;
  }

  const barberia = await consultarUna(
    `SELECT id, nombre, phone_number_id, zona_horaria,
            direccion, ciudad, latitud, longitud,
            telefono_contacto, whatsapp_publico, firma
       FROM barberias
      WHERE phone_number_id = $1
        AND activa`,
    [phoneNumberId]
  );

  // El null también se cachea, para que mensajes a un número inexistente no
  // golpeen la base cada vez. Pero con una vida MUCHO más corta: conectar una
  // barbería es un UPDATE de `phone_number_id`, y con 5 minutos de caché ese
  // cambio parecería no haber funcionado. 30 segundos frena el ruido sin que
  // nadie se quede mirando la pantalla preguntándose si guardó.
  cache.set(phoneNumberId, {
    barberia,
    expira: Date.now() + (barberia ? CACHE_MS : CACHE_NULL_MS),
  });

  return barberia;
}

export async function porId(id) {
  return consultarUna(
    `SELECT id, nombre, phone_number_id, zona_horaria,
            direccion, ciudad, latitud, longitud,
            telefono_contacto, whatsapp_publico, firma
       FROM barberias
      WHERE id = $1`,
    [id]
  );
}

/** Todas las activas. Para el panel global y para los diagnósticos. */
export async function todas() {
  return consultar(
    `SELECT id, nombre, phone_number_id, ciudad, zona_horaria, activa
       FROM barberias
      ORDER BY nombre`
  );
}

/**
 * Vacía el caché. Hay que llamarlo al cambiar la configuración de una
 * barbería desde el panel; si no, el cambio "no se ve" hasta 5 minutos
 * después y parece que no se guardó. Era una de las confusiones habituales
 * del sistema anterior con la caché de horarios.
 */
export function limpiarCache(phoneNumberId = null) {
  if (phoneNumberId) cache.delete(phoneNumberId);
  else cache.clear();
}
