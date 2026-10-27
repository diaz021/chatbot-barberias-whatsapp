-- ═══════════════════════════════════════════════════════════════════════
--  ESQUEMA — chatbot multi-barbería
--  Postgres 15+ (Supabase)
--
--  Una sola base para todas las barberías. La barbería es una FILA,
--  no una instalación.
--
--  Se ejecuta una vez, entero, en Supabase → SQL Editor.
--  Es idempotente: volver a correrlo no rompe nada.
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
--  1. BARBERIAS
--
--  `phone_number_id` es la LLAVE DEL MULTI-TENANT. Meta lo manda dentro de
--  cada mensaje (metadata.phone_number_id) y con eso el webhook sabe de qué
--  barbería se trata, sin configuración extra por cliente.
--
--  Puede quedar en NULL mientras la barbería no tenga número conectado:
--  Postgres permite varios NULL en una columna UNIQUE. Una barbería con
--  phone_number_id NULL existe en la base pero todavía no recibe mensajes,
--  que es exactamente lo que queremos durante el desarrollo.
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS barberias (
  id                BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre            TEXT        NOT NULL,
  phone_number_id   TEXT        UNIQUE,
  waba_id           TEXT,

  -- Toda fecha y hora se calcula en la zona del NEGOCIO, nunca en la del
  -- servidor. Railway corre en UTC: entre las 7pm y medianoche eso
  -- significa un día de diferencia.
  zona_horaria      TEXT        NOT NULL DEFAULT 'America/Bogota',

  direccion         TEXT,
  ciudad            TEXT,
  latitud           NUMERIC(9,6),
  longitud          NUMERIC(9,6),
  telefono_contacto TEXT,

  -- El teléfono real para enlaces wa.me (57 + 10 dígitos, sin +).
  -- NO es el phone_number_id: confundirlos hace que el enlace no abra nada.
  whatsapp_publico  TEXT,

  activa            BOOLEAN     NOT NULL DEFAULT TRUE,
  creada_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ───────────────────────────────────────────────────────────────────────
--  2. BARBEROS
--
--  El `id` es la clave, NO el nombre. En el sistema viejo el nombre visible
--  era la llave con que se guardaban y buscaban los turnos, así que
--  renombrar a alguien obligaba a corregir el histórico. Aquí el nombre es
--  solo lo que se muestra: cambiarlo no toca ni un turno.
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS barberos (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  barberia_id    BIGINT      NOT NULL REFERENCES barberias(id) ON DELETE CASCADE,
  nombre         TEXT        NOT NULL,
  telefono       TEXT,                       -- recibe el aviso de turno nuevo
  password_hash  TEXT,                       -- panel por WhatsApp. NUNCA en claro
  orden          SMALLINT    NOT NULL DEFAULT 0,   -- en qué orden se le muestra al cliente
  activo         BOOLEAN     NOT NULL DEFAULT TRUE,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_barberos_barberia ON barberos(barberia_id) WHERE activo;


-- ───────────────────────────────────────────────────────────────────────
--  3. HORARIOS
--
--  Una fila por barbero y día. `turnos` vacío = ese día NO trabaja.
--  Es la única forma de decirlo, igual que en el sistema viejo.
--
--  dia_semana: 0=Domingo, 1=Lunes … 6=Sábado (igual que Date.getDay()).
--
--  Los turnos son TIME de verdad, no texto. En Google Sheets una celda de
--  hora podía convertirse sola a otro formato y hacer que un turno ocupado
--  apareciera libre — el error más caro del sistema anterior. Con TIME eso
--  no puede pasar: el formato "9am" / "1:30pm" se arma al mostrarlo.
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS horarios (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  barbero_id   BIGINT   NOT NULL REFERENCES barberos(id) ON DELETE CASCADE,
  dia_semana   SMALLINT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  turnos       TIME[]   NOT NULL DEFAULT '{}',

  UNIQUE (barbero_id, dia_semana)
);


-- ───────────────────────────────────────────────────────────────────────
--  4. TURNOS
--
--  Nunca se borran filas: cancelar es cambiar el estado.
--
--  `tipo` reemplaza el truco viejo de escribir el nombre "Descanso" para
--  marcar un bloqueo. Un nombre mágico dentro de un campo de texto libre es
--  frágil; una columna es explícita.
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS turnos (
  id                   BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  barberia_id          BIGINT      NOT NULL REFERENCES barberias(id) ON DELETE CASCADE,
  barbero_id           BIGINT      NOT NULL REFERENCES barberos(id)  ON DELETE CASCADE,

  fecha                DATE        NOT NULL,
  hora                 TIME        NOT NULL,

  tipo                 TEXT        NOT NULL DEFAULT 'cita'
                                   CHECK (tipo IN ('cita', 'bloqueo')),
  estado               TEXT        NOT NULL DEFAULT 'Confirmado'
                                   CHECK (estado IN ('Confirmado', 'Cancelado')),

  cliente_nombre       TEXT,
  cliente_telefono     TEXT,       -- con código de país, sin '+'. NULL en bloqueos

  -- Instante exacto del turno, ya resuelto a la zona del negocio.
  -- Lo usa el recordatorio para no tener que recalcular zonas cada 5 minutos.
  inicio_en            TIMESTAMPTZ NOT NULL,
  recordatorio_enviado BOOLEAN     NOT NULL DEFAULT FALSE,

  creado_en            TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelado_en         TIMESTAMPTZ,

  -- Un bloqueo no tiene cliente; una cita confirmada sí.
  CHECK (tipo = 'bloqueo' OR estado = 'Cancelado' OR cliente_telefono IS NOT NULL)
);

-- ⚠️ ESTA ES LA LÍNEA MÁS IMPORTANTE DEL ARCHIVO ⚠️
--
-- Mata la doble reserva (punto 9 de MEJORAS.md, abierto desde el principio).
-- En el sistema viejo se leía "¿está libre?" y se escribía segundos después;
-- dos clientes podían pasar ambos la validación y quedar a la misma hora.
--
-- Esto no acorta esa ventana: la elimina. La base FÍSICAMENTE no puede
-- guardar dos turnos confirmados del mismo barbero a la misma fecha y hora.
-- El segundo INSERT falla con error 23505 y el bot le dice al cliente
-- "ese horario ya fue tomado". Sin releer nada, sin condiciones de carrera.
CREATE UNIQUE INDEX IF NOT EXISTS ux_turno_ocupado
  ON turnos (barbero_id, fecha, hora)
  WHERE estado = 'Confirmado';

-- Buscar los turnos de un cliente para cancelar.
CREATE INDEX IF NOT EXISTS ix_turnos_cliente
  ON turnos (cliente_telefono, inicio_en)
  WHERE estado = 'Confirmado' AND tipo = 'cita';

-- Agenda del día de un barbero (panel y bot).
CREATE INDEX IF NOT EXISTS ix_turnos_agenda
  ON turnos (barbero_id, fecha)
  WHERE estado = 'Confirmado';

-- El barrido de recordatorios cada 5 minutos.
--
-- Filtra por tipo='cita' Y teléfono no nulo. Eso mata de raíz una trampa del
-- sistema viejo: si a un bloqueo se le olvidaba marcar la columna de
-- recordatorio, el cron intentaba mandarle WhatsApp a un teléfono vacío cada
-- 5 minutos, para siempre. Aquí un bloqueo ni siquiera entra en la consulta.
CREATE INDEX IF NOT EXISTS ix_turnos_recordatorio
  ON turnos (inicio_en)
  WHERE estado = 'Confirmado'
    AND tipo = 'cita'
    AND recordatorio_enviado = FALSE
    AND cliente_telefono IS NOT NULL;


-- ───────────────────────────────────────────────────────────────────────
--  5. SESIONES
--
--  Dónde va el cliente en la conversación. Cierra el punto 5 de MEJORAS.md.
--
--  En el sistema viejo esto vivía en RAM: cada despliegue le borraba el
--  progreso a quien estuviera agendando, y era imposible correr más de una
--  réplica porque dos mensajes del mismo cliente podían caer en procesos
--  distintos con ideas distintas de en qué paso iba.
--
--  Clave compuesta por teléfono + barbería: la misma persona puede tener
--  conversaciones independientes con dos barberías distintas.
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sesiones (
  telefono       TEXT        NOT NULL,
  barberia_id    BIGINT      NOT NULL REFERENCES barberias(id) ON DELETE CASCADE,

  paso           TEXT        NOT NULL,
  datos          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  errores        SMALLINT    NOT NULL DEFAULT 0,   -- al tercero seguido, se reinicia
  actualizada_en TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (telefono, barberia_id)
);

-- Para barrer las que pasaron de 10 minutos de inactividad.
CREATE INDEX IF NOT EXISTS ix_sesiones_vencidas ON sesiones (actualizada_en);


-- ───────────────────────────────────────────────────────────────────────
--  6. MENSAJES_VISTOS
--
--  Deduplicación por message.id. Meta reenvía cuando cree que la entrega
--  falló, y sin esto el cliente recibe respuestas duplicadas que nunca pidió.
--  Se limpia sola: nada más viejo de ~30 minutos hace falta.
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mensajes_vistos (
  message_id TEXT        PRIMARY KEY,
  visto_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_mensajes_vistos_purga ON mensajes_vistos (visto_en);


-- ───────────────────────────────────────────────────────────────────────
--  7. ADMINS
--
--  Quién entra al panel web y qué alcanza a ver.
--
--  barberia_id NULL = administrador GLOBAL (tú): ve todas las barberías.
--  barberia_id con valor = dueño de esa barbería: ve solo la suya.
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  barberia_id BIGINT      REFERENCES barberias(id) ON DELETE CASCADE,
  telefono    TEXT        NOT NULL,
  nombre      TEXT        NOT NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (telefono, barberia_id)
);

CREATE INDEX IF NOT EXISTS ix_admins_telefono ON admins (telefono);

-- El UNIQUE de arriba no cubre a los administradores globales: en Postgres
-- dos NULL se consideran distintos, así que el mismo teléfono podría entrar
-- dos veces como admin global. Este índice parcial lo impide.
CREATE UNIQUE INDEX IF NOT EXISTS ux_admin_global
  ON admins (telefono)
  WHERE barberia_id IS NULL;
