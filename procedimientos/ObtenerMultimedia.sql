CREATE DEFINER=`root`@`%` PROCEDURE `ObtenerMultimedia`(IN p_sbt_id INT)
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
        MA.MAT_NOMBRE,       
        M.MUL_STATUS,
        U.USU_USUARIO    
    FROM 
        MET_MULTIMEDIA M
    INNER JOIN 
        MET_MATERIA MA ON M.MUL_MAT_ID = MA.MAT_ID
    INNER JOIN 
        MET_USUARIO_ADMIN U ON M.MUL_USU_ID = U.USU_ID
    WHERE 
        M.MUL_SBT_ID = p_sbt_id;
END