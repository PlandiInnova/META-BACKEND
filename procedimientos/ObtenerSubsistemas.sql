-- Procedimiento almacenado para obtener todos los subsistemas
-- Uso: CALL ObtenerSubsistemas()
-- Retorna: Todos los registros de la tabla MET_SUBSISTEMA

DELIMITER $$

DROP PROCEDURE IF EXISTS ObtenerSubsistemas$$

CREATE PROCEDURE ObtenerSubsistemas()
BEGIN
    SELECT * FROM MET_SUBSISTEMA;
END$$

DELIMITER ;

-- Ejemplo de uso:
-- CALL ObtenerSubsistemas();
