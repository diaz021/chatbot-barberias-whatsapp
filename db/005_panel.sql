-- ═══════════════════════════════════════════════════════════════════════
--  PANEL WEB — acceso sin contraseña
--
--  El administrador escribe su número, le llega un código de 6 dígitos por
--  WhatsApp y entra. No hay contraseña que recordar ni que perder.
--
--  ⚠️ Una pantalla que pide un número y dice "te mandamos el código" es un
--  directorio de administradores: probando números uno por uno se averigua
--  cuáles están habilitados. Por eso el freno de intentos se aplica ANTES
--  de mirar si el número existe, y la respuesta es idéntica en los dos casos.
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
--  Códigos enviados
--
--  El código se guarda HASHEADO. Si alguien llegara a leer la tabla en los
--  5 minutos de vida del código, no le sirve de nada.
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS codigos_acceso (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telefono    TEXT        NOT NULL,
  codigo_hash TEXT        NOT NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_en   TIMESTAMPTZ NOT NULL,
  usado_en    TIMESTAMPTZ,
  intentos    SMALLINT    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ix_codigos_vivos
  ON codigos_acceso (telefono, creado_en DESC)
  WHERE usado_en IS NULL;


-- ───────────────────────────────────────────────────────────────────────
--  Freno de solicitudes
--
--  Una fila por cada vez que alguien pide un código. `clave` es el número
--  ('tel:57...') o una huella del dispositivo ('disp:...'), porque frenar
--  solo por número deja que alguien recorra la lista de números desde el
--  mismo navegador, y frenar solo por dispositivo deja que lo hagan desde
--  varios. Hacen falta los dos.
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solicitudes_codigo (
  id        BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clave     TEXT        NOT NULL,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_solicitudes_recientes
  ON solicitudes_codigo (clave, creada_en DESC);
