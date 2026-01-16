exports.getSubsystemFilter = async (req, res) => {
    try {
        req.db.query('SELECT * FROM MET_SUBSISTEMA',
            (error, results) => {
                if (error) {
                    console.error('Error en la consulta:', error);
                    return res.status(500).json({ error: 'Error en la base de datos' });
                }
                res.json(results);
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

        req.db.query('SELECT * FROM MET_SEMESTRE WHERE SEM_SUB_ID = ?;', [id_subsistema],
            (error, results) => {
                if (error) {
                    console.error('Error en la consulta:', error);
                    return res.status(500).json({ error: 'Error en la base de datos' });
                }
                res.json(results);
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

        req.db.query('SELECT * FROM MET_MATERIA WHERE MAT_SEM_ID = ?;', [id_semestre],
            (error, results) => {
                if (error) {
                    console.error('Error en la consulta:', error);
                    return res.status(500).json({ error: 'Error en la base de datos' });
                }
                res.json(results);
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