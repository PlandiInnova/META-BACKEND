-- Procedimiento almacenado para obtener enlace e imagen de un multimedia
-- Uso: CALL ObtenerEnlaceEImagenMultimedia(?)
-- Parámetros:
--   p_mul_id: INT - ID del registro de multimedia
-- Retorna: MUL_ENLACE, MUL_IMAGEN del registro (una fila o vacío)

DELIMITER $$

DROP PROCEDURE IF EXISTS ObtenerEnlaceEImagenMultimedia$$

CREATE PROCEDURE ObtenerEnlaceEImagenMultimedia(
    IN p_mul_id INT
)
BEGIN
    -- Validar que el ID no sea nulo
    IF p_mul_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El ID de multimedia no puede ser nulo';
    END IF;

    SELECT MUL_ENLACE, MUL_IMAGEN 
    FROM MET_MULTIMEDIA 
    WHERE MUL_ID = p_mul_id;
END$$

DELIMITER ;

-- Ejemplo de uso:
-- CALL ObtenerEnlaceEImagenMultimedia(123);
