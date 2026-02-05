exports.getSubsystemFilter = async (req, res) => {
    try {
        req.db.query('CALL ObtenerSubsistemas()',
            (error, results) => {
                if (error) {
                    console.error('Error en la consulta:', error);
                    return res.status(500).json({ error: 'Error en la base de datos', detalle: error.message });
                }
                res.json(results[0]);
            }
        );
    } catch (error) {
        console.error('Error en getSubsystemFilter:', error);
        res.status(500).json({
            error: 'Error al obtener getSubsystemFilter',
            detalle: error.message
        });
    }
};

exports.getSemesterFilter = async (req, res) => {
    try {
        const id_subsistema = req.query.subsistema;

        if (!id_subsistema) {
            return res.status(400).json({ error: 'Parámetro subsistema requerido' });
        }

        req.db.query('CALL ObtenerSemestresPorSubsistema(?)', [id_subsistema],
            (error, results) => {
                if (error) {
                    console.error('Error en la consulta:', error);
                    return res.status(500).json({ error: 'Error en la base de datos', detalle: error.message });
                }
                res.json(results[0]);
            }
        );

    } catch (error) {
        console.error('Error en getSemesterFilter:', error);
        res.status(500).json({
            error: 'Error al obtener getSemesterFilter',
            detalle: error.message
        });
    }
};

exports.getMateriaFilter = async (req, res) => {
    try {
        const id_semestre = req.query.semestre;

        if (!id_semestre) {
            return res.status(400).json({ error: 'Parámetro semestre requerido' });
        }

        req.db.query('CALL ObtenerMateriasPorSemestre(?)', [id_semestre],
            (error, results) => {
                if (error) {
                    console.error('Error en la consulta:', error);
                    return res.status(500).json({ error: 'Error en la base de datos', detalle: error.message });
                }
                res.json(results[0]);
            }
        );

    } catch (error) {
        console.error('Error en getMateriaFilter:', error);
        res.status(500).json({
            error: 'Error al obtener getMateriaFilter',
            detalle: error.message
        });
    }
};