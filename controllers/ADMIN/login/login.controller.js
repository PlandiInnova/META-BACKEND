const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                status: 'BAD_REQUEST',
                message: "Username y password son requeridos"
            });
        }

        req.db.query(
            'CALL ValidarUsuarioAdmin(?, ?)',
            [username, password],
            (error, results) => {
                if (error) {
                    console.error("Error en la consulta:", error);
                    return res.status(500).json({
                        success: false,
                        status: 'ERROR',
                        message: "Error en el servidor"
                    });
                }

                const rows = results[0];
                if (!rows || rows.length === 0) {
                    return res.status(401).json({
                        success: false,
                        status: 'NOT_FOUND',
                        message: "Usuario inactivo o credenciales inválidas"
                    });
                }

                const userData = rows[0];
                const usernameFromDb = userData.USU_USUARIO;

                const JWT_SECRET = process.env.JWT_SECRET || 'tu-secret-key-cambiar-en-produccion';
                const token = jwt.sign(
                    {
                        userId: userData.USU_ID,
                        username: usernameFromDb,
                        userType: 'admin'
                    },
                    JWT_SECRET,
                    { expiresIn: '24h' }
                );

                res.status(200).json({
                    token: token,
                    username: usernameFromDb,
                    userType: 'admin'
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