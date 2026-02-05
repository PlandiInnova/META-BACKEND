-- Procedimiento almacenado para actualizar el estado de multimedia
-- Uso: CALL ActualizarStatusMultimedia(?, ?)
-- Parámetros:
--   p_mul_status: INT - Nuevo estado a asignar
--   p_mul_id: INT - ID del registro de multimedia a actualizar

DELIMITER $$

DROP PROCEDURE IF EXISTS ActualizarStatusMultimedia$$

CREATE PROCEDURE ActualizarStatusMultimedia(
    IN p_mul_status INT,
    IN p_mul_id INT
)
BEGIN
    -- Validar que el ID no sea nulo
    IF p_mul_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El ID de multimedia no puede ser nulo';
    END IF;

    -- Validar que el status no sea nulo
    IF p_mul_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El estado no puede ser nulo';
    END IF;

    -- Actualizar el estado
    UPDATE MET_MULTIMEDIA 
    SET MUL_STATUS = p_mul_status 
    WHERE MUL_ID = p_mul_id;

    -- Verificar si se actualizó algún registro
    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No se encontró ningún registro con el ID especificado';
    END IF;

END$$

DELIMITER ;

-- Ejemplo de uso:
-- CALL ActualizarStatusMultimedia(1, 123);
