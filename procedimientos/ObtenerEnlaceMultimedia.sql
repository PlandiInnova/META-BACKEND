-- Procedimiento almacenado para obtener el enlace de un multimedia
-- Uso: CALL ObtenerEnlaceMultimedia(?)
-- Parámetros:
--   p_mul_id: INT - ID del registro de multimedia
-- Retorna: Una fila con MUL_ENLACE (o vacío si no existe)

DELIMITER $$

DROP PROCEDURE IF EXISTS ObtenerEnlaceMultimedia$$

CREATE PROCEDURE ObtenerEnlaceMultimedia(
    IN p_mul_id INT
)
BEGIN
    -- Validar que el ID no sea nulo
    IF p_mul_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El ID de multimedia no puede ser nulo';
    END IF;

    SELECT MUL_ENLACE 
    FROM MET_MULTIMEDIA 
    WHERE MUL_ID = p_mul_id;
END$$

DELIMITER ;

-- Ejemplo de uso:
-- CALL ObtenerEnlaceMultimedia(123);
