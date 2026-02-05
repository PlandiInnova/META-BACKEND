-- Procedimiento almacenado para actualizar un registro en MET_MULTIMEDIA
-- Uso: CALL ActualizarMultimedia(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
-- Parámetros (en orden):
--   p_mul_titulo, p_mul_unidad, p_mul_progresion, p_mul_descripcion,
--   p_mul_sbt_id, p_mul_imagen, p_mul_enlace, p_mul_fecha_creacion,
--   p_mul_mat_id, p_mul_status, p_mul_usu_id, p_mul_id
-- Retorna: Nada (solo actualiza; lanza error si no se encontró el registro)

DELIMITER $$

DROP PROCEDURE IF EXISTS ActualizarMultimedia$$

CREATE PROCEDURE ActualizarMultimedia(
    IN p_mul_titulo VARCHAR(255),
    IN p_mul_unidad INT,
    IN p_mul_progresion VARCHAR(255),
    IN p_mul_descripcion TEXT,
    IN p_mul_sbt_id INT,
    IN p_mul_imagen VARCHAR(500),
    IN p_mul_enlace TEXT,
    IN p_mul_fecha_creacion DATETIME,
    IN p_mul_mat_id INT,
    IN p_mul_status INT,
    IN p_mul_usu_id INT,
    IN p_mul_id INT
)
BEGIN
    -- Validar que el ID no sea nulo
    IF p_mul_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El ID de multimedia no puede ser nulo';
    END IF;

    UPDATE MET_MULTIMEDIA SET
        MUL_TITULO = p_mul_titulo,
        MUL_UNIDAD = p_mul_unidad,
        MUL_PROGRESION = p_mul_progresion,
        MUL_DESCRIPCION = p_mul_descripcion,
        MUL_SBT_ID = p_mul_sbt_id,
        MUL_IMAGEN = p_mul_imagen,
        MUL_ENLACE = p_mul_enlace,
        MUL_FECHA_CREACION = p_mul_fecha_creacion,
        MUL_MAT_ID = p_mul_mat_id,
        MUL_STATUS = p_mul_status,
        MUL_USU_ID = p_mul_usu_id
    WHERE MUL_ID = p_mul_id;

    -- Verificar si se actualizó algún registro
    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No se encontró ningún registro con el ID especificado';
    END IF;

END$$

DELIMITER ;

-- Ejemplo de uso:
-- CALL ActualizarMultimedia('Título', 1, 'Progresión', 'Descripción', 1, '/ruta/icon.png', '/ruta/enlace', NOW(), 1, 1, 1, 123);
