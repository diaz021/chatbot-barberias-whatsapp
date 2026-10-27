/**
 * IDENTIDAD DEL CLIENTE — teléfono o ID de usuario de WhatsApp
 *
 * ⚠️ NO TODO CLIENTE TRAE TELÉFONO. Desde 2026 WhatsApp permite tener un
 * NOMBRE DE USUARIO (@algo) y ocultar el número. A esos clientes Meta no nos
 * manda el teléfono: manda un "Business-Scoped User ID" (BSUID), un
 * identificador propio de esa persona para esta cuenta, con esta forma:
 *
 *     CO.10000000000000001        ← país + punto + dígitos/letras
 *
 * Se descubrió porque un cliente real —"Buenos días", "Necesito agendar un
 * turno para hoy en la tarde", "3 o 4 de las tarde"— escribió tres veces el
 * 19/09/2026 y no recibió respuesta: su mensaje no traía `from` ni `wa_id`,
 * solo `from_user_id`. El sobre quedó guardado en `mensajes_sin_remitente`
 * y así se pudo ver.
 *
 * CÓMO SE USA EN EL SISTEMA. El BSUID se trata como el "teléfono" del
 * cliente en todas partes (sesiones, turnos, límite diario, cancelación):
 * es estable por persona y por cuenta, así que todo cuadra. Solo cambian dos
 * cosas, y las dos viven aquí:
 *
 *   1. AL ENVIAR: Meta exige el campo `recipient`, NO `to`. Pasar un BSUID
 *      en `to` falla. Lo resuelve `paraMeta()`, que llama whatsapp.js.
 *   2. AL MOSTRAR: no es un número que un barbero pueda marcar. Lo resuelve
 *      `telefonoVisible()`.
 *
 * Docs: developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids
 * Enviar a un BSUID está soportado por la API desde julio de 2026.
 */

/** ¿Es un BSUID (y no un teléfono)? "CO.1000…" sí; "573001234567" no. */
export function esBsuid(id) {
  return /^[A-Z]{2}\.[A-Za-z0-9]+$/.test(String(id ?? ''));
}

/**
 * El mensaje listo para Meta. Si el destinatario es un BSUID, lo pasa de
 * `to` a `recipient`, que es lo que Meta exige para esos clientes. Con un
 * teléfono devuelve el mensaje intacto.
 *
 * No muta el original: el que llama puede seguir usándolo.
 */
export function paraMeta(mensaje) {
  if (!mensaje || !esBsuid(mensaje.to)) return mensaje;

  const { to, ...resto } = mensaje;
  return { ...resto, recipient_type: 'individual', recipient: to };
}

/**
 * Cómo se le muestra el contacto del cliente a un barbero.
 * Teléfono → sin el 57 (como lo marca el barbero). BSUID → aviso legible.
 */
export function telefonoVisible(id) {
  if (!id) return '';
  if (esBsuid(id)) return 'sin número (usuario de WhatsApp)';
  const t = String(id);
  return t.startsWith('57') && t.length > 10 ? t.slice(2) : t;
}
