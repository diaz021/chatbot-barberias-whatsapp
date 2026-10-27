-- ═══════════════════════════════════════════════════════════════════════
--  SEMILLA DE DEMOSTRACIÓN — "Barbería Demo"
--
--  Todos los datos son FICTICIOS: nombres, teléfonos e identificadores de
--  Meta. Sirven para correr el sistema y las pruebas sin datos de nadie.
--
--  Los tres barberos tienen horarios distintos a propósito, porque cada uno
--  ejercita un camino diferente del bot:
--    · Andrés   — turnos cada 40 min, 12 al día: caben en una lista
--    · Camilo   — sábado y domingo con jornada distinta
--    · Santiago — turnos cada 30 min, 20 al día: obligan a la pantalla de
--                 jornadas (mañana / tarde / tarde-noche), el caso más difícil
--
--  Para entrar al panel, después de migrar:
--    npm run clave -- --admin "573001234567" "una-clave"
--    npm run clave -- "Andrés" "otra-clave"
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO barberias (
  nombre, phone_number_id, zona_horaria, direccion, ciudad,
  latitud, longitud, telefono_contacto, whatsapp_publico, firma, color, activa
)
SELECT 'Barbería Demo', 'DEMO-0000000001', 'America/Bogota',
       'Calle 1 # 2-3', 'Bogotá', 4.711000, -74.072100,
       '300 000 0000', '573000000000', E'💈 BARBERÍA DEMO 💈', '#9A4DEF', TRUE
WHERE NOT EXISTS (SELECT 1 FROM barberias WHERE nombre = 'Barbería Demo');

WITH b AS (SELECT id FROM barberias WHERE nombre = 'Barbería Demo')
INSERT INTO barberos (barberia_id, nombre, telefono, orden, activo)
SELECT b.id, v.nombre, v.telefono, v.orden, TRUE
  FROM b, (VALUES
    ('Andrés',   '573000000001', 1),
    ('Camilo',   '573000000002', 2),
    ('Santiago', '573000000003', 3)
  ) AS v(nombre, telefono, orden)
 WHERE NOT EXISTS (
   SELECT 1 FROM barberos x WHERE x.barberia_id = b.id AND x.orden = v.orden
 );

-- Andrés: Lun-Sáb 9:00-18:00, domingo 9:00-13:00, cada 40 min.
WITH b AS (SELECT bb.id FROM barberos bb JOIN barberias ba ON ba.id = bb.barberia_id
            WHERE ba.nombre = 'Barbería Demo' AND bb.orden = 1)
INSERT INTO horarios (barbero_id, dia_semana, turnos)
SELECT b.id, d.dia,
  CASE WHEN d.dia = 0
    THEN ARRAY['09:00','09:40','10:20','11:00','11:40','12:20']::TIME[]
    ELSE ARRAY['09:00','09:40','10:20','11:00','11:40',
               '13:20','14:00','14:40','15:20','16:00','16:40','17:20']::TIME[]
  END
FROM b, generate_series(0, 6) AS d(dia)
ON CONFLICT (barbero_id, dia_semana) DO UPDATE SET turnos = EXCLUDED.turnos;

-- Camilo: entre semana hasta las 7:40pm, sábado distinto, domingo corrido.
WITH b AS (SELECT bb.id FROM barberos bb JOIN barberias ba ON ba.id = bb.barberia_id
            WHERE ba.nombre = 'Barbería Demo' AND bb.orden = 2)
INSERT INTO horarios (barbero_id, dia_semana, turnos)
SELECT b.id, d.dia,
  CASE
    WHEN d.dia = 0 THEN ARRAY['09:30','10:10','10:50','11:30','12:10','12:50','13:30','14:10']::TIME[]
    WHEN d.dia = 6 THEN ARRAY['09:30','10:10','10:50','11:30','13:30','14:10','14:50',
                              '15:30','16:10','16:50','17:30','18:10','18:50']::TIME[]
    ELSE                ARRAY['09:30','10:10','10:50','11:30','13:00','13:40','14:20',
                              '15:00','15:40','16:20','17:00','17:40','18:20','19:00']::TIME[]
  END
FROM b, generate_series(0, 6) AS d(dia)
ON CONFLICT (barbero_id, dia_semana) DO UPDATE SET turnos = EXCLUDED.turnos;

-- Santiago: cada 30 min, almuerzo de 1 a 2. 20 turnos entre semana.
WITH b AS (SELECT bb.id FROM barberos bb JOIN barberias ba ON ba.id = bb.barberia_id
            WHERE ba.nombre = 'Barbería Demo' AND bb.orden = 3)
INSERT INTO horarios (barbero_id, dia_semana, turnos)
SELECT b.id, d.dia,
  CASE WHEN d.dia = 0
    THEN ARRAY['09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30',
               '14:00','14:30','15:00','15:30']::TIME[]
    ELSE ARRAY['10:00','10:30','11:00','11:30','12:00','12:30',
               '14:00','14:30','15:00','15:30','16:00','16:30',
               '17:00','17:30','18:00','18:30','19:00','19:30','20:00','20:30']::TIME[]
  END
FROM b, generate_series(0, 6) AS d(dia)
ON CONFLICT (barbero_id, dia_semana) DO UPDATE SET turnos = EXCLUDED.turnos;

-- Administrador global (sin contraseña: se pone con `npm run clave -- --admin`).
INSERT INTO admins (barberia_id, barbero_id, telefono, nombre)
VALUES (NULL, NULL, '573001234567', 'Administrador')
ON CONFLICT DO NOTHING;

-- Cada barbero ve solo su agenda en el panel web.
INSERT INTO admins (barberia_id, barbero_id, telefono, nombre)
SELECT bb.barberia_id, bb.id, bb.telefono, bb.nombre
  FROM barberos bb JOIN barberias ba ON ba.id = bb.barberia_id
 WHERE ba.nombre = 'Barbería Demo'
ON CONFLICT (telefono, barberia_id) DO NOTHING;
