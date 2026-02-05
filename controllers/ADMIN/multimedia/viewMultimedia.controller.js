exports.getMultimedia = async (req, res) => {
    try {
        const tipo = parseInt(req.query.tipo);

        if (isNaN(tipo)) {
            return res.status(400).json({ error: 'Parámetro tipo inválido' });
        }

        const subsistema = req.query.subsistema ? parseInt(req.query.subsistema) : null;
        const semestre = req.query.semestre ? parseInt(req.query.semestre) : null;
        const materia = req.query.materia ? parseInt(req.query.materia) : null;

        if (req.query.subsistema && isNaN(subsistema)) {
            return res.status(400).json({ error: 'Parámetro subsistema inválido' });
        }
        if (req.query.semestre && isNaN(semestre)) {
            return res.status(400).json({ error: 'Parámetro semestre inválido' });
        }
        if (req.query.materia && isNaN(materia)) {
            return res.status(400).json({ error: 'Parámetro materia inválido' });
        }

        if (subsistema !== null || semestre !== null || materia !== null) {

            req.db.query(
                'CALL ObtenerMultimediaFiltrado(?, ?, ?, ?)',
                [tipo, subsistema, semestre, materia],
                (error, results) => {
                    if (error) {
                        console.error('Error en la consulta filtrada:', error);
                        return res.status(500).json({ error: 'Error en la base de datos' });
                    }
                    res.json(results[0]);
                }
            );
        } else {

            req.db.query(
                'CALL ObtenerMultimedia(?)',
                [tipo],
                (error, results) => {
                    if (error) {
                        console.error('Error en la consulta:', error);
                        return res.status(500).json({ error: 'Error en la base de datos' });
                    }
                    res.json(results[0]);
                }
            );
        }

    } catch (error) {
        console.error('Error en getMultimedia:', error);
        res.status(500).json({
            error: 'Error al obtener multimedia',
            detalle: error.message
        });
    }
};

exports.statusMultimedia = async (req, res) => {
    try {
        const id_multimedia = parseInt(req.query.id);
        const status = parseInt(req.query.status);

        if (isNaN(id_multimedia) || isNaN(status)) {
            return res.status(400).json({ error: 'Parámetros inválidos' });
        }

        req.db.query(
            'CALL ActualizarStatusMultimedia(?, ?)',
            [status, id_multimedia],
            (error) => {
                if (error) {
                    console.error('Error en la consulta:', error);
                    return res.status(500).json({ error: 'Error en la base de datos', detalle: error.message });
                }
                res.json({ success: true, message: 'Estado actualizado correctamente' });
            }
        );

    } catch (error) {
        console.error('Error en getMultimedia:', error);
        res.status(500).json({
            error: 'Error al obtener multimedia',
            detalle: error.message
        });
    }
};

exports.infoMultimedia = async (req, res) => {
    try {
        const id_multimedia = parseInt(req.query.id);

        if (isNaN(id_multimedia)) {
            return res.status(400).json({ error: 'Parámetro id inválido' });
        }

        req.db.query(
            'CALL infoMultimedia(?)',
            [id_multimedia],
            (error, results) => {
                if (error) {
                    console.error('Error en la consulta:', error);
                    return res.status(500).json({ error: 'Error en la base de datos', detalle: error.message });
                }
                res.json(results[0]);
            }
        );
    }
    catch (error) {
        console.error('Error en infoMultimedia:', error);
        res.status(500).json({
            error: 'Error al obtener información de multimedia',
            detalle: error.message
        });
    }
}

