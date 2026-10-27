-- ═══════════════════════════════════════════════════════════════════════
--  COLOR DE LA BARBERÍA
--
--  El panel es multi-tenant: lo usan todas las barberías. Fijar el morado
--  de la barbería piloto en el código haría que la barbería 2 entrara a un panel con
--  los colores de otro negocio.
--
--  El acento se guarda por barbería y el panel lo aplica al entrar.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE barberias ADD COLUMN IF NOT EXISTS color TEXT;

UPDATE barberias
   SET color = '#9A4DEF'          -- morado de la marca
 WHERE nombre = 'Barbería Demo'
   AND color IS NULL;
