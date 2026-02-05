-- Procedimiento almacenado para validar credenciales de usuario admin (login)
-- Uso: CALL ValidarUsuarioAdmin(?, ?)
-- Parámetros:
--   p_usu_usuario: VARCHAR - Usuario
--   p_usu_password: VARCHAR - Contraseña
-- Retorna: Una fila con USU_ID, USU_USUARIO, USU_STATUS si las credenciales son válidas y el usuario está activo (USU_STATUS = 1). Vacío si no coincide.

DELIMITER $$

DROP PROCEDURE IF EXISTS ValidarUsuarioAdmin$$

CREATE PROCEDURE ValidarUsuarioAdmin(
    IN p_usu_usuario VARCHAR(255),
    IN p_usu_password VARCHAR(255)
)
BEGIN
    SELECT USU_ID, USU_USUARIO, USU_STATUS
    FROM MET_USUARIO_ADMIN
    WHERE USU_USUARIO = p_usu_usuario
      AND USU_PASSWORD = p_usu_password
      AND USU_STATUS = 1;
END$$

DELIMITER ;

-- Ejemplo de uso:
-- CALL ValidarUsuarioAdmin('admin', 'mi_password');
