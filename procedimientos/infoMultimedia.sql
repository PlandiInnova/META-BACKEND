CREATE DEFINER=`root`@`%` PROCEDURE `infoMultimedia`(
    IN p_mul_id INT
)
BEGIN
    SELECT 
        m.MUL_ID,
        m.MUL_TITULO,
        m.MUL_DESCRIPCION,
        m.MUL_UNIDAD,
        m.MUL_PROGRESION,
        m.MUL_IMAGEN,
        m.MUL_ENLACE,
        m.MUL_SBT_ID,
        m.MUL_MAT_ID,
        m.MUL_STATUS,
        m.MUL_FECHA_CREACION,
        m.MUL_USU_ID,
        -- Información de la materia
        mat.MAT_ID,
        mat.MAT_NOMBRE,
        mat.MAT_SEM_ID,
        mat.MAT_STATUS AS MAT_STATUS,
        -- Información del semestre
        sem.SEM_ID,
        sem.SEM_NUMERO,
        sem.SEM_NOMBRE,
        sem.SEM_SUB_ID,
        sem.SEM_STATUS AS SEM_STATUS,
        -- Información del subsistema
        sub.SUB_ID,
        sub.SUB_NOMBRE,
        sub.SUB_PERIODO,
        sub.SUB_ESTADO,
        sub.SUB_STATUS AS SUB_STATUS
    FROM MET_MULTIMEDIA m
    LEFT JOIN MET_MATERIA mat ON m.MUL_MAT_ID = mat.MAT_ID
    LEFT JOIN MET_SEMESTRE sem ON mat.MAT_SEM_ID = sem.SEM_ID
    LEFT JOIN MET_SUBSISTEMA sub ON sem.SEM_SUB_ID = sub.SUB_ID
    WHERE m.MUL_ID = p_mul_id
    LIMIT 1;
END