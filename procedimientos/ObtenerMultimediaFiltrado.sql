CREATE DEFINER=`root`@`%` PROCEDURE `ObtenerMultimediaFiltrado`(
    IN p_sbt_id INT,
    IN p_sub_id INT,
    IN p_sem_id INT,
    IN p_mat_id INT
)
BEGIN
    SELECT 
        M.MUL_ID,
        M.MUL_TITULO,
        M.MUL_UNIDAD,
        M.MUL_PROGRESION,
        M.MUL_DESCRIPCION,
        M.MUL_SBT_ID,
        M.MUL_IMAGEN,
        M.MUL_ENLACE,
        M.MUL_FECHA_CREACION,
        M.MUL_MAT_ID,
        MA.MAT_NOMBRE,
        MA.MAT_SEM_ID,
        SE.SEM_ID,
        SE.SEM_NUMERO,
        SE.SEM_NOMBRE,
        SE.SEM_SUB_ID,
        SU.SUB_ID,
        SU.SUB_NOMBRE,
        M.MUL_STATUS,
        U.USU_USUARIO    
    FROM 
        MET_MULTIMEDIA M
    INNER JOIN 
        MET_MATERIA MA ON M.MUL_MAT_ID = MA.MAT_ID
    INNER JOIN 
        MET_SEMESTRE SE ON MA.MAT_SEM_ID = SE.SEM_ID
    INNER JOIN 
        MET_SUBSISTEMA SU ON SE.SEM_SUB_ID = SU.SUB_ID
    INNER JOIN 
        MET_USUARIO_ADMIN U ON M.MUL_USU_ID = U.USU_ID
    WHERE 
        M.MUL_SBT_ID = p_sbt_id
        AND (p_sub_id IS NULL OR SU.SUB_ID = p_sub_id)
        AND (p_sem_id IS NULL OR SE.SEM_ID = p_sem_id)
        AND (p_mat_id IS NULL OR MA.MAT_ID = p_mat_id)
        AND M.MUL_STATUS = 1
    ORDER BY 
        M.MUL_FECHA_CREACION DESC;
END