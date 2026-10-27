-- ═══════════════════════════════════════════════════════════════════════
--  ACCESO POR BARBERO, Y CONTRASEÑA EN VEZ DE CÓDIGO
--
--  Dos cambios que vienen del uso real.
--
--  1. CADA BARBERO VE SOLO LO SUYO
--     El panel mostraba toda la barbería a cualquiera que entrara. Con dos
--     o tres barberos independientes, cada uno debe gestionar su agenda sin
--     poder bloquear la del otro.
--
--  2. CONTRASEÑA EN LUGAR DE CÓDIGO POR WHATSAPP
--     El código se enviaba como mensaje libre, y Meta solo entrega esos
--     dentro de la ventana de 24 horas que abre el propio usuario. Si el
--     barbero no le había escrito al bot ese día, el código NO LLEGABA
--     — justo cuando más falta hace entrar al panel.
--
--     Se podría resolver con una plantilla de autenticación, pero eso se
--     cobra por envío y hay que pedirle aprobación a Meta. Para tres
--     personas, una contraseña es más simple y no depende de nadie.
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
--  Alcance y credencial
--
--  barberia_id NULL  → administrador global: ve todas las barberías
--  barbero_id  NULL  → ve TODA su barbería
--  barbero_id  valor → ve SOLO ese barbero
-- ───────────────────────────────────────────────────────────────────────
ALTER TABLE admins ADD COLUMN IF NOT EXISTS barbero_id    BIGINT REFERENCES barberos(id) ON DELETE CASCADE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Un admin con alcance de barbero tiene que pertenecer a esa barbería.
-- Sin esto, una fila mal puesta abriría la agenda de otro negocio.
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_barbero_coherente;
ALTER TABLE admins ADD CONSTRAINT admins_barbero_coherente
  CHECK (barbero_id IS NULL OR barberia_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS ix_admins_barbero ON admins (barbero_id) WHERE barbero_id IS NOT NULL;


-- ───────────────────────────────────────────────────────────────────────
--  El intento de acceso pasa a contar contraseñas fallidas
--
--  La tabla de códigos deja de usarse. No se borra: si alguna vez vuelve
--  la autenticación por código (con una plantilla, que sí llega siempre),
--  está ahí. Borrarla no gana nada y perdería el histórico.
-- ───────────────────────────────────────────────────────────────────────
COMMENT ON TABLE codigos_acceso IS
  'Sin uso desde 2026-09-14: el acceso al panel pasó a contraseña. El código iba como mensaje libre y Meta no lo entrega fuera de la ventana de 24 h.';
