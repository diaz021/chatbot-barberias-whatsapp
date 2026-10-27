-- ═══════════════════════════════════════════════════════════════════════
--  CERRAR EL ACCESO PÚBLICO A LAS TABLAS (aviso de Supabase, 15/09/2026)
--
--  Supabase avisó: "Table publicly accessible — rls_disabled_in_public".
--
--  QUÉ PASABA. Supabase publica automáticamente una API REST sobre TODAS
--  las tablas del esquema `public`, y le concede permisos a dos roles que
--  existen para esa API: `anon` (sin identificarse) y `authenticated`.
--  Estaban con DELETE, INSERT, SELECT, UPDATE y TRUNCATE sobre las 10
--  tablas, y ninguna tenía Row Level Security. Es decir: quien consiguiera
--  la clave pública del proyecto podía LEER los teléfonos y nombres de los
--  clientes, los turnos y los hashes de contraseñas — y también BORRARLOS.
--
--  Nosotros nunca usamos esa API (el bot se conecta por Postgres con
--  DATABASE_URL), así que era una puerta abierta que ni siquiera usábamos.
--
--  POR QUÉ ESTO NO ROMPE EL BOT. El bot entra como el rol `postgres`, que
--  tiene BYPASSRLS y además es dueño de las tablas: RLS no se le aplica.
--  Comprobado antes de escribir esta migración.
--
--  Se hacen las DOS cosas, a propósito:
--    1. ENABLE ROW LEVEL SECURITY sin políticas → aunque alguien tenga
--       permisos, no ve ni una fila por la API.
--    2. REVOKE de los permisos → aunque alguien apague el RLS por error,
--       tampoco puede. Defensa en profundidad.
--
--  ⚠️ SI ALGÚN DÍA SE CREA UNA TABLA NUEVA, hay que volver a hacerle
--  ENABLE ROW LEVEL SECURITY. Supabase la expondría igual que a estas.
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
--  1. RLS en todas las tablas del esquema public
--
--  Se recorren en bucle en vez de listarlas: el objetivo es que NINGUNA
--  quede fuera, y una lista escrita a mano se desactualiza sola.
-- ───────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;


-- ───────────────────────────────────────────────────────────────────────
--  2. Quitarle los permisos a los roles de la API pública
--
--  No se toca `service_role` ni `postgres`: el primero es el rol de
--  servidor de Supabase y el segundo es con el que entra el bot.
-- ───────────────────────────────────────────────────────────────────────
-- Esos roles solo existen en Supabase. En otro Postgres (Docker, local) no
-- hay API pública que cerrar, y nombrarlos daría "role does not exist".
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      -- Y que las tablas que se creen a futuro tampoco nazcan abiertas.
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
    END IF;
  END LOOP;
END $$;
