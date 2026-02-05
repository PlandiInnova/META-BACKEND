-- Procedimiento almacenado para obtener la imagen (miniatura) de un multimedia
-- Uso: CALL ObtenerImagenMultimedia(?)
-- Parámetros:
--   p_mul_id: INT - ID del registro de multimedia
-- Retorna: Una fila con MUL_IMAGEN (o vacío si no existe)

DELIMITER $$

DROP PROCEDURE IF EXISTS ObtenerImagenMultimedia$$

CREATE PROCEDURE ObtenerImagenMultimedia(
    IN p_mul_id INT
)
BEGIN
    -- Validar que el ID no sea nulo
    IF p_mul_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El ID de multimedia no puede ser nulo';
    END IF;

    SELECT MUL_IMAGEN 
    FROM MET_MULTIMEDIA 
    WHERE MUL_ID = p_mul_id;
END$$

DELIMITER ;

-- Ejemplo de uso:
-- CALL ObtenerImagenMultimedia(123);
