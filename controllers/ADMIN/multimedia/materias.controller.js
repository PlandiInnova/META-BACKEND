exports.getMaterias = async (req, res) => {
    try {
        const query = `
            SELECT
                m.MAT_ID,
                m.MAT_NOMBRE,
                m.MAT_DESCRIPCION,
                m.MAT_SEM_ID,
                m.MAT_STATUS,
                sem.SEM_ID,
                sem.SEM_NUMERO,
                sem.SEM_NOMBRE,
                sem.SEM_SUB_ID,
                sub.SUB_ID,
                sub.SUB_NOMBRE,
                sub.SUB_PERIODO,
                sub.SUB_ESTADO,
                sub.SUB_STATUS
            FROM MET_MATERIA m
            INNER JOIN MET_SEMESTRE sem ON sem.SEM_ID = m.MAT_SEM_ID
            INNER JOIN MET_SUBSISTEMA sub ON sub.SUB_ID = sem.SEM_SUB_ID
            ORDER BY sub.SUB_NOMBRE ASC, sem.SEM_NUMERO ASC, m.MAT_NOMBRE ASC
        `;

        req.db.query(query, (error, results) => {
            if (error) {
                console.error('[MATERIAS] Error al listar materias:', error);
                return res.status(500).json({
                    success: false,
                    message: 'Error al listar materias',
                    detalle: error.message
                });
            }

            res.status(200).json({
                success: true,
                data: results || []
            });
        });
    } catch (error) {
        console.error('[MATERIAS] Error en getMaterias:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno al obtener materias',
            detalle: error.message
        });
    }
};

exports.createMateria = async (req, res) => {
    try {
        const { MAT_NOMBRE, MAT_DESCRIPCION, MAT_SEM_ID, MAT_STATUS } = req.body;

        if (!MAT_NOMBRE || !MAT_SEM_ID) {
            return res.status(400).json({
                success: false,
                message: 'MAT_NOMBRE y MAT_SEM_ID son obligatorios'
            });
        }

        const insertQuery = `
            INSERT INTO MET_MATERIA (MAT_NOMBRE, MAT_DESCRIPCION, MAT_SEM_ID, MAT_STATUS)
            VALUES (?, ?, ?, ?)
        `;

        req.db.query(
            insertQuery,
            [
                MAT_NOMBRE,
                MAT_DESCRIPCION || '',
                Number(MAT_SEM_ID),
                MAT_STATUS === undefined || MAT_STATUS === null ? 1 : Number(MAT_STATUS)
            ],
            (error, result) => {
                if (error) {
                    console.error('[MATERIAS] Error al crear materia:', error);
                    return res.status(500).json({
                        success: false,
                        message: 'Error al crear materia',
                        detalle: error.message
                    });
                }

                res.status(201).json({
                    success: true,
                    message: 'Materia creada correctamente',
                    data: {
                        MAT_ID: result.insertId,
                        MAT_NOMBRE,
                        MAT_DESCRIPCION: MAT_DESCRIPCION || '',
                        MAT_SEM_ID: Number(MAT_SEM_ID),
                        MAT_STATUS: MAT_STATUS === undefined || MAT_STATUS === null ? 1 : Number(MAT_STATUS)
                    }
                });

                if (req.io) {
                    req.io.to('global-room').emit('new-materia', {
                        operation: 'insert',
                        MAT_ID: result.insertId,
                        MAT_NOMBRE,
                        MAT_DESCRIPCION: MAT_DESCRIPCION || '',
                        MAT_SEM_ID: Number(MAT_SEM_ID),
                        MAT_STATUS: MAT_STATUS === undefined || MAT_STATUS === null ? 1 : Number(MAT_STATUS)
                    });
                }
            }
        );
    } catch (error) {
        console.error('[MATERIAS] Error en createMateria:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno al crear materia',
            detalle: error.message
        });
    }
};
