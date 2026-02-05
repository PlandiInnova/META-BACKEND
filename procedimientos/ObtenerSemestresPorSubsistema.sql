-- Procedimiento almacenado para obtener semestres por subsistema
-- Uso: CALL ObtenerSemestresPorSubsistema(?)
-- Parámetros:
--   p_sem_sub_id: INT - ID del subsistema
-- Retorna: Todos los registros de MET_SEMESTRE que pertenecen al subsistema especificado

DELIMITER $$

DROP PROCEDURE IF EXISTS ObtenerSemestresPorSubsistema$$

CREATE PROCEDURE ObtenerSemestresPorSubsistema(
    IN p_sem_sub_id INT
)
BEGIN
    -- Validar que el ID del subsistema no sea nulo
    IF p_sem_sub_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El ID del subsistema no puede ser nulo';
    END IF;

    -- Obtener los semestres del subsistema
    SELECT * FROM MET_SEMESTRE WHERE SEM_SUB_ID = p_sem_sub_id;
END$$

DELIMITER ;

-- Ejemplo de uso:
-- CALL ObtenerSemestresPorSubsistema(1);
