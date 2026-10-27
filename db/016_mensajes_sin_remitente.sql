-- ═══════════════════════════════════════════════════════════════════════
--  MENSAJES QUE LLEGAN SIN REMITENTE (18/09/2026)
--
--  EL PROBLEMA QUE LA MOTIVA. En los registros de un solo día, 12 de 134
--  mensajes (el 9 %) llegaron de Meta SIN el número de quien escribía:
--
--    → [Barbería Demo] undefined · texto · "Si tiene turnito para hoy?"
--    ✗ Meta devolvió 400: "The parameter to is required."
--
--  El bot los leía, preparaba la respuesta y la mandaba sin destinatario.
--  Nueve clientes reales quedaron sin contestación y NADIE se enteró: el
--  fallo solo aparecía enterrado en los registros de Railway, que rotan.
--
--  Esta tabla guarda el sobre completo cuando eso pasa, para poder ver qué
--  manda Meta exactamente y cerrar el caso de raíz. Sin ella, el diagnóstico
--  dependía de que alguien preguntara por una persona concreta.
--
--  ⚠️ Es una tabla de DIAGNÓSTICO, no de negocio. Guarda el JSON crudo del
--  webhook, así que conviene vaciarla cuando el caso esté resuelto.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mensajes_sin_remitente (
  id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recibido_en     TIMESTAMPTZ NOT NULL DEFAULT now(),

  barberia_id     BIGINT      REFERENCES barberias(id) ON DELETE SET NULL,
  phone_number_id TEXT,

  -- Lo poco que sí se entendió del mensaje, para reconocerlo de un vistazo.
  message_id      TEXT,
  tipo            TEXT,
  texto           TEXT,

  -- El sobre entero, tal como lo mandó Meta. Es lo único que permite
  -- averiguar POR QUÉ faltaba el remitente.
  cuerpo          JSONB       NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_sin_remitente_fecha
  ON mensajes_sin_remitente (recibido_en DESC);

-- ⚠️ Obligatorio en este proyecto: Supabase publica una API sobre todo el
-- esquema public y una tabla nueva nace abierta. Ver db/014.
ALTER TABLE mensajes_sin_remitente ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON mensajes_sin_remitente FROM %I', r);
    END IF;
  END LOOP;
END $$;
