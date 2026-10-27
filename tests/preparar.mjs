/**
 * PREPARACIÓN DE LAS PRUEBAS
 *
 * Se carga con `node --test --import ./tests/preparar.mjs`, antes que
 * cualquier archivo de prueba. Aplica a todas, incluidas las que se
 * escriban en el futuro sin acordarse de esto.
 *
 * ⚠️ Obliga al modo simulado. Ninguna prueba puede enviar un WhatsApp real,
 * exista o no un API_TOKEN configurado. Una prueba que puede escribirle a
 * una persona no es una prueba.
 */

process.env.MODO_SIMULADO = '1';
