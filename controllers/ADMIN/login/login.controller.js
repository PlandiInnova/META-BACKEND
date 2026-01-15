exports.login = async (req, res) => {
    try {
        const { user, password } = req.body;

        req.db.query('CALL AT_APP_LoginCorreo(?, ?)', [user, password],
            (error, results) => {
                if (error) {
                    return res.status(401).json({
                        success: false,
                        status: 'NOT_FOUND',
                        message: "Usuario inactivo o credenciales inválidas"
                    });
                }
                const user = results[0][0];
                res.status(200).json({
                    success: true,
                    message: "Login exitoso",
                    status: 'OK',
                    userId: user.USU_NOMBRE,
                });
            }
        );
    } catch (error) {
        console.error("Error en el servidor:", error);
        res.status(500).json({
            success: false,
            status: 'ERROR',
            message: "Error en el servidor"
        });
    }
};