-- Procedimiento almacenado para obtener materias por semestre
-- Uso: CALL ObtenerMateriasPorSemestre(?)
-- Parámetros:
--   p_mat_sem_id: INT - ID del semestre
-- Retorna: Todos los registros de MET_MATERIA que pertenecen al semestre especificado

DELIMITER $$

DROP PROCEDURE IF EXISTS ObtenerMateriasPorSemestre$$

CREATE PROCEDURE ObtenerMateriasPorSemestre(
    IN p_mat_sem_id INT
)
BEGIN
    -- Validar que el ID del semestre no sea nulo
    IF p_mat_sem_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El ID del semestre no puede ser nulo';
    END IF;

    -- Obtener las materias del semestre
    SELECT * FROM MET_MATERIA WHERE MAT_SEM_ID = p_mat_sem_id;
END$$

DELIMITER ;

-- Ejemplo de uso:
-- CALL ObtenerMateriasPorSemestre(1);
