-- Procedimiento almacenado para eliminar un registro de multimedia
-- Uso: CALL EliminarMultimedia(?)
-- Parámetros:
--   p_mul_id: INT - ID del registro de multimedia a eliminar

DELIMITER $$

DROP PROCEDURE IF EXISTS EliminarMultimedia$$

CREATE PROCEDURE EliminarMultimedia(
    IN p_mul_id INT
)
BEGIN
    -- Validar que el ID no sea nulo
    IF p_mul_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El ID de multimedia no puede ser nulo';
    END IF;

    -- Eliminar el registro
    DELETE FROM MET_MULTIMEDIA WHERE MUL_ID = p_mul_id;

    -- Verificar si se eliminó algún registro
    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No se encontró ningún registro con el ID especificado';
    END IF;

END$$

DELIMITER ;

-- Ejemplo de uso:
-- CALL EliminarMultimedia(123);
