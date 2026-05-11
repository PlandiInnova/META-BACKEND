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
                sub.SUB_STATUS,
                l.LIC_LICENCIA AS LICENCIA
            FROM MET_MATERIA m
            INNER JOIN MET_SEMESTRE sem ON sem.SEM_ID = m.MAT_SEM_ID
            INNER JOIN MET_SUBSISTEMA sub ON sub.SUB_ID = sem.SEM_SUB_ID
            LEFT JOIN MET_LICENCIA l ON l.LIC_MAT_ID = m.MAT_ID AND l.LIC_STATUS = 1
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

exports.vincularLicencia = async (req, res) => {
    try {
        const { MAT_ID, LIC_LICENCIA } = req.body;

        if (!MAT_ID || !LIC_LICENCIA) {
            return res.status(400).json({
                success: false,
                message: 'MAT_ID y LIC_LICENCIA son obligatorios'
            });
        }

        // Primero verificamos que la materia no tenga ya una licencia vinculada
        const checkMateriaQuery = `SELECT * FROM MET_LICENCIA WHERE LIC_MAT_ID = ?`;
        
        req.db.query(checkMateriaQuery, [MAT_ID], (errMateria, resMateria) => {
            if (errMateria) {
                console.error('[LICENCIA] Error al verificar la materia:', errMateria);
                return res.status(500).json({ success: false, message: 'Error en la base de datos al verificar materia' });
            }

            if (resMateria.length > 0 && resMateria[0].LIC_LICENCIA !== LIC_LICENCIA) {
                return res.status(400).json({ success: false, message: 'Esta materia ya tiene una licencia vinculada. Solo se permite una licencia por materia.' });
            }

            // Ahora verificamos si la licencia que se quiere ingresar existe
            const checkQuery = `SELECT * FROM MET_LICENCIA WHERE LIC_LICENCIA = ?`;
            
            req.db.query(checkQuery, [LIC_LICENCIA], (error, results) => {
                if (error) {
                    console.error('[LICENCIA] Error al buscar licencia:', error);
                    return res.status(500).json({ success: false, message: 'Error en la base de datos' });
                }

                if (results.length === 0) {
                    return res.status(404).json({ success: false, message: 'La licencia ingresada no existe' });
                }

                const licencia = results[0];

                if (licencia.LIC_MAT_ID && licencia.LIC_MAT_ID !== MAT_ID) {
                    return res.status(400).json({ success: false, message: 'La licencia ya está vinculada a otra materia' });
                }

                // Actualizamos la licencia vinculándola a la materia
                const updateQuery = `UPDATE MET_LICENCIA SET LIC_MAT_ID = ? WHERE LIC_LICENCIA = ?`;
                
                req.db.query(updateQuery, [MAT_ID, LIC_LICENCIA], (updateError, updateResult) => {
                    if (updateError) {
                        console.error('[LICENCIA] Error al vincular licencia:', updateError);
                        return res.status(500).json({ success: false, message: 'Error al actualizar la licencia' });
                    }

                    res.status(200).json({
                        success: true,
                        message: 'Licencia vinculada correctamente'
                    });
                });
            });
        });
    } catch (error) {
        console.error('[LICENCIA] Error en vincularLicencia:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno al vincular licencia',
            detalle: error.message
        });
    }
};

exports.desvincularLicencia = async (req, res) => {
    try {
        const { MAT_ID } = req.body;

        if (!MAT_ID) {
            return res.status(400).json({
                success: false,
                message: 'MAT_ID es obligatorio'
            });
        }

        const updateQuery = `UPDATE MET_LICENCIA SET LIC_MAT_ID = NULL WHERE LIC_MAT_ID = ?`;
        
        req.db.query(updateQuery, [MAT_ID], (error, result) => {
            if (error) {
                console.error('[LICENCIA] Error al desvincular licencia:', error);
                return res.status(500).json({ success: false, message: 'Error en la base de datos al desvincular' });
            }

            res.status(200).json({
                success: true,
                message: 'Licencia desvinculada correctamente'
            });
        });

    } catch (error) {
        console.error('[LICENCIA] Error en desvincularLicencia:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno al desvincular licencia',
            detalle: error.message
        });
    }
};
