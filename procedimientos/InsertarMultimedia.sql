-- Procedimiento almacenado para insertar un registro en MET_MULTIMEDIA
-- Uso: CALL InsertarMultimedia(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
-- Parámetros (en orden):
--   p_mul_titulo, p_mul_unidad, p_mul_progresion, p_mul_descripcion,
--   p_mul_sbt_id, p_mul_imagen, p_mul_enlace, p_mul_fecha_creacion,
--   p_mul_mat_id, p_mul_status, p_mul_usu_id
-- Retorna: Una fila con insertId (LAST_INSERT_ID())

DELIMITER $$

DROP PROCEDURE IF EXISTS InsertarMultimedia$$

CREATE PROCEDURE InsertarMultimedia(
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
    IN p_mul_usu_id INT
)
BEGIN
    INSERT INTO MET_MULTIMEDIA (
        MUL_TITULO,
        MUL_UNIDAD,
        MUL_PROGRESION,
        MUL_DESCRIPCION,
        MUL_SBT_ID,
        MUL_IMAGEN,
        MUL_ENLACE,
        MUL_FECHA_CREACION,
        MUL_MAT_ID,
        MUL_STATUS,
        MUL_USU_ID
    ) VALUES (
        p_mul_titulo,
        p_mul_unidad,
        p_mul_progresion,
        p_mul_descripcion,
        p_mul_sbt_id,
        p_mul_imagen,
        p_mul_enlace,
        p_mul_fecha_creacion,
        p_mul_mat_id,
        p_mul_status,
        p_mul_usu_id
    );

    SELECT LAST_INSERT_ID() AS insertId;
END$$

DELIMITER ;

-- Ejemplo de uso:
-- CALL InsertarMultimedia('Título', 1, 'Progresión', 'Descripción', 1, '/ruta/icon.png', '/ruta/enlace', NOW(), 1, 1, 1);
