/**
 * RECORDATORIOS AUTOMÁTICOS
 *
 * Cada 5 minutos se buscan los turnos que empiezan dentro de 55 a 65 minutos
 * y se le manda un recordatorio al cliente.
 *
 * ⚠️ LA FRECUENCIA Y LA VENTANA ESTÁN ATADAS. La ventana es de 10 minutos
 * (55–65), así que el barrido debe correr AL MENOS cada 10 minutos o habrá
 * turnos que nunca caigan dentro de ella y se queden sin recordatorio.
 * Si cambias una, revisa la otra.
 *
 * Corre cada 5 y no cada 10 para tener margen: si un barrido falla o se
 * retrasa, el siguiente todavía alcanza a esos turnos.
 */

import { consultar } from '../db/pool.js';
import { recordatorio } from './avisos.js';
import { porId as barberiaPorId } from './barberias.js';
import { limpiar } from '../db/pool.js';

export const CADA_MINUTOS = 5;
export const VENTANA_DESDE = 55;
export const VENTANA_HASTA = 65;

/**
 * Los turnos que toca recordar ahora.
 *
 * Los filtros de tipo y teléfono no son redundantes: un BLOQUEO no tiene
 * cliente, y sin ese filtro el sistema intentaría mandarle un WhatsApp a un
 * teléfono vacío cada 5 minutos, para siempre. Era una trampa real del
 * sistema anterior, donde había que acordarse de marcar una columna a mano.
 */
export async function pendientes() {
  return consultar(
    `SELECT t.id, t.barberia_id, t.fecha, t.hora,
            t.cliente_nombre, t.cliente_telefono,
            b.nombre AS barbero
       FROM turnos t
       JOIN barberos b ON b.id = t.barbero_id
      WHERE t.estado = 'Confirmado'
        AND t.tipo = 'cita'
        AND t.recordatorio_enviado = FALSE
        AND t.cliente_telefono IS NOT NULL
        AND t.inicio_en BETWEEN now() + ($1 || ' minutes')::interval
                            AND now() + ($2 || ' minutes')::interval
      ORDER BY t.inicio_en
      LIMIT 100`,
    [VENTANA_DESDE, VENTANA_HASTA]
  );
}

/**
 * Un barrido completo.
 *
 * ⚠️ Se marca `recordatorio_enviado` SOLO si el envío salió bien. Marcarlo
 * antes convertiría un fallo pasajero de red en un cliente que nunca recibe
 * su recordatorio; y como el turno seguirá dentro de la ventana en el
 * siguiente barrido, se reintenta solo.
 */
export async function barrer() {
  const turnos = await pendientes();
  if (turnos.length === 0) return { encontrados: 0, enviados: 0, fallidos: 0 };

  // Se agrupan por barbería para no releer la misma configuración N veces.
  const cache = new Map();
  let enviados = 0, fallidos = 0;

  for (const turno of turnos) {
    try {
      if (!cache.has(turno.barberia_id)) {
        cache.set(turno.barberia_id, await barberiaPorId(turno.barberia_id));
      }
      const barberia = cache.get(turno.barberia_id);
      if (!barberia) { fallidos++; continue; }

      if (await recordatorio(barberia, turno)) {
        await consultar(
          'UPDATE turnos SET recordatorio_enviado = TRUE WHERE id = $1',
          [turno.id]
        );
        enviados++;
      } else {
        fallidos++;
      }
    } catch (error) {
      // Un turno que falla no puede llevarse por delante a los demás.
      console.error(`✗ Recordatorio del turno ${turno.id}:`, limpiar(error.message));
      fallidos++;
    }
  }

  return { encontrados: turnos.length, enviados, fallidos };
}

/** Arranca el barrido periódico. Devuelve una función para detenerlo. */
export function programar() {
  const correr = () => {
    barrer()
      .then(({ encontrados, enviados, fallidos }) => {
        if (encontrados > 0) {
          console.log(`○ Recordatorios: ${enviados} enviados, ${fallidos} fallidos de ${encontrados}`);
        }
      })
      .catch(error => console.error('✗ Fallo en el barrido:', limpiar(error.message)));
  };

  const temporizador = setInterval(correr, CADA_MINUTOS * 60 * 1000);
  temporizador.unref();

  console.log(`● Recordatorios cada ${CADA_MINUTOS} min (ventana ${VENTANA_DESDE}–${VENTANA_HASTA})`);

  return () => clearInterval(temporizador);
}
