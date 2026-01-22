const express = require('express');
const router = express.Router();

const filtros = require('../controllers/ADMIN/multimedia/filtros.controller');
const uploadController = require('../controllers/ADMIN/multimedia/multimedia.controller');
const viewController = require('../controllers/ADMIN/multimedia/viewMultimedia.controller');

module.exports = () => {

    router.get('/filter-subsistemas', filtros.getSubsystemFilter);
    router.get('/filter-semestres', filtros.getSemesterFilter);
    router.get('/filter-materias', filtros.getMateriaFilter);
    router.get('/multimedia', viewController.getMultimedia);

    router.get('/update-status', viewController.statusMultimedia);
    router.get('/info-multimedia', viewController.infoMultimedia);

    router.delete('/delete-multimedia', uploadController.handleDelete)


    router.post('/upload',
        (req, res, next) => {
            const tipo = req.query.type;

            if (!tipo) {
                return res.status(400).json({
                    error: 'Tipo de contenido requerido',
                    detalle: 'Debes especificar el tipo de contenido en el query parameter ?type='
                });
            }

            const tipoStr = tipo.toString();
            console.log('📤 Tipo de contenido recibido:', tipoStr);

            if (['Audios', 'AR'].includes(tipoStr)) {
                uploadController.uploadFile(req, res, (err) => {
                    if (err) {
                        return res.status(400).json({
                            error: err.message || 'Error al procesar el archivo',
                            detalle: err.message
                        });
                    }
                    next();
                });
            } else {
                uploadController.handleFormData(req, res, (err) => {
                    if (err) {
                        return res.status(400).json({
                            error: err.message || 'Error al procesar el formulario',
                            detalle: err.message
                        });
                    }
                    next();
                });
            }
        },
        uploadController.handleUpload
    );

    return router;
}