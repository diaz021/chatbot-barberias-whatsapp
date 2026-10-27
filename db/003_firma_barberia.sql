-- ═══════════════════════════════════════════════════════════════════════
--  FIRMA DE LA BARBERÍA
--
--  La línea con la que el bot cierra sus mensajes importantes.
--
--  Su logo escribe "B A R B E R S H O P" con las letras separadas: es la
--  única decisión tipográfica que sobrevive en WhatsApp, donde no hay
--  fuentes ni colores. Se replica en texto plano.
--
--  Va como columna y no en el código porque cada barbería tendrá la suya, y
--  espaciar el nombre automáticamente da resultados feos con nombres largos.
--  Si queda NULL, se genera espaciando el nombre.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE barberias ADD COLUMN IF NOT EXISTS firma TEXT;

UPDATE barberias
   SET firma = 'A L T A   G A M A'
 WHERE nombre = 'Barbería Demo'
   AND firma IS NULL;
