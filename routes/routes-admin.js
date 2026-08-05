const express = require('express');
const router = express.Router();

const filtros = require('../controllers/ADMIN/multimedia/filtros.controller');
const uploadController = require('../controllers/ADMIN/multimedia/multimedia.controller');
const viewController = require('../controllers/ADMIN/multimedia/viewMultimedia.controller');
const tabsController = require('../controllers/ADMIN/multimedia/tabs.controller');
const materiasController = require('../controllers/ADMIN/multimedia/materias.controller');

const productosController = require('../controllers/ADMIN/productos/productos.controller');
const productosArchivos = require('../controllers/ADMIN/productos/archivos.controller');
const productosUpload = require('../controllers/ADMIN/productos/upload.controller');
const comercialController = require('../controllers/ADMIN/comercial/comercial.controller');
const licenciasController = require('../controllers/ADMIN/comercial/licencias.controller');

module.exports = () => {
    router.get('/countabs', tabsController.getTabs);
    router.get('/filter-subsistemas', filtros.getSubsystemFilter);
    router.get('/filter-semestres', filtros.getSemesterFilter);
    router.get('/filter-materias', filtros.getMateriaFilter);
    router.get('/materias', materiasController.getMaterias);
    router.post('/materias', materiasController.createMateria);
    router.post('/materias/vincular-licencia', materiasController.vincularLicencia);
    router.post('/materias/desvincular-licencia', materiasController.desvincularLicencia);
    router.get('/filter-subtipos', filtros.getSubtiposFilter);
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

            if (['Audios', 'AR', 'Recursos Pedagogicos'].includes(tipoStr)) {
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

    // ==================== PRODUCTOS ====================
    // Un producto = registro en MET_PRODUCTOS + carpeta en disco (PRO_FILES).
    // Los archivos pesados se suben por chunks y se administran contra la carpeta,
    // sin volver a tocar el registro.

    // Mantenimiento de subidas a medias. Va antes de '/productos/:id'
    // para que 'uploads' no sea interpretado como un id.
    router.get('/productos/uploads', productosUpload.listarUploadsPendientes);
    router.delete('/productos/uploads', productosUpload.limpiarUploads);

    // Catálogo de tipos de producto (va antes de '/productos/:id')
    router.get('/productos/catalogos/tipos', productosController.getTiposProducto);

    // CRUD del registro
    router.get('/productos', productosController.getProductos);
    router.post('/productos', productosController.createProducto);
    router.get('/productos/:id', productosController.getProducto);
    router.put('/productos/:id', productosController.updateProducto);
    router.delete('/productos/:id', productosController.deleteProducto);

    // Archivos dentro de la carpeta del producto
    router.get('/productos/:id/archivos', productosArchivos.getArchivos);
    router.delete('/productos/:id/archivos', productosArchivos.deleteArchivo);
    router.post('/productos/:id/imagen',
        productosArchivos.uploadImagenMiddleware,
        productosArchivos.uploadImagen
    );

    // Subida por chunks (reanudable) de archivos pesados
    router.post('/productos/:id/upload/init', productosUpload.initUpload);
    router.post('/productos/:id/upload/chunk',
        productosUpload.uploadChunkMiddleware,
        productosUpload.uploadChunk
    );
    router.get('/productos/:id/upload/status', productosUpload.statusUpload);
    router.post('/productos/:id/upload/complete', productosUpload.completeUpload);
    router.delete('/productos/:id/upload', productosUpload.abortUpload);

    // ==================== COMERCIAL (solo lectura) ====================
    // Tablas de la sección Comercial del admin. No escriben: las altas se
    // definirán cuando se acuerden las reglas de ventas y paquetes.
    router.get('/comercial/conteos', comercialController.getConteos);
    router.get('/comercial/ventas', comercialController.getVentas);
    router.post('/comercial/ventas', comercialController.createVenta);
    // Editar y eliminar solo mientras la venta no tenga licencias ni concentrado
    router.put('/comercial/ventas/:id', comercialController.updateVenta);
    router.delete('/comercial/ventas/:id', comercialController.deleteVenta);
    router.get('/comercial/paquetes', comercialController.getPaquetes);
    router.post('/comercial/paquetes', comercialController.createPaquete);
    // Editar y eliminar solo mientras el paquete no tenga licencias
    router.put('/comercial/paquetes/:id', comercialController.updatePaquete);
    router.delete('/comercial/paquetes/:id', comercialController.deletePaquete);
    // Catálogo para elegir qué productos entran al paquete
    router.get('/comercial/productos-disponibles', comercialController.getProductosDisponibles);
    router.get('/comercial/licencias', comercialController.getLicencias);

    // Generador: crea el pedido, las licencias y el concentrado en una transacción
    router.get('/comercial/licencias/catalogos', licenciasController.getCatalogosLicencia);
    router.post('/comercial/licencias/generar', licenciasController.generarLicencias);
    router.get('/comercial/pedidos', comercialController.getPedidos);
    // Descarga de las licencias de un pedido (se envía por tandas)
    router.get('/comercial/pedidos/:id/licencias.csv', licenciasController.descargarLicenciasCsv);
    router.get('/comercial/concentrado', comercialController.getConcentrado);

    return router;
}