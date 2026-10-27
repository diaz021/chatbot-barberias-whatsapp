-- ═══════════════════════════════════════════════════════════════════════
--  VIGILANCIA DEL WEBHOOK
--
--  El fallo más caro del sistema anterior fue SILENCIOSO: el 10 de agosto de
--  2026 el bot pasó horas sin recibir un solo mensaje. El servicio respondía,
--  la web se veía, los logs se veían normales — y simplemente no llegaba
--  nada. Nadie se enteró hasta que un cliente reclamó.
--
--  Un monitor de disponibilidad corriente NO detecta eso: el servidor
--  contesta 200 perfectamente. Lo único que delata la falla es que dejen de
--  ENTRAR mensajes.
-- ═══════════════════════════════════════════════════════════════════════

-- Cuándo entró el último mensaje de un cliente, por barbería.
ALTER TABLE barberias ADD COLUMN IF NOT EXISTS ultimo_entrante_en TIMESTAMPTZ;

-- Cuándo se avisó por última vez, para no repetir la alerta cada 10 minutos
-- mientras dura la avería.
ALTER TABLE barberias ADD COLUMN IF NOT EXISTS alertada_en TIMESTAMPTZ;
