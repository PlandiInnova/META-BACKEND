/**
 * Administración de los archivos que viven dentro de la carpeta de un producto.
 *
 * Todo se resuelve contra el disco usando PRO_FILES: se puede borrar un archivo
 * y subir otro sin modificar el registro de MET_PRODUCTOS. La única excepción es
 * la portada, que sí se guarda en PRO_IMAGEN porque el front la necesita directa.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');

const {
    MAX_IMAGEN_SIZE,
    sanitizarNombreArchivo,
    sanitizarRutaRelativa,
    resolverDentro,
    carpetaProductoAbs,
    listarArchivos,
    limpiarCarpetasVacias,
    formatearTamano
} = require('./productos.paths');

const { obtenerProducto, query, incrementarVersion } = require('./productos.controller');

/**
 * Resuelve el producto y su carpeta en disco, respondiendo el error adecuado si algo falla.
 * @returns {Promise<{producto: object, carpetaAbs: string}|null>} null si ya se respondió
 */
async function resolverProductoYCarpeta(req, res, { crearSiFalta = false } = {}) {
    const proId = Number(req.params.id);
    if (!Number.isInteger(proId) || proId <= 0) {
        res.status(400).json({ success: false, message: 'ID de producto inválido' });
        return null;
    }

    const producto = await obtenerProducto(req.db, proId);
    if (!producto) {
        res.status(404).json({ success: false, message: 'Producto no encontrado' });
        return null;
    }

    const carpetaAbs = carpetaProductoAbs(producto.PRO_FILES);
    if (!carpetaAbs) {
        res.status(500).json({
            success: false,
            message: 'La carpeta registrada para este producto no es válida',
            detalle: `PRO_FILES = ${producto.PRO_FILES}`
        });
        return null;
    }

    if (!fs.existsSync(carpetaAbs)) {
        if (!crearSiFalta) {
            res.status(404).json({
                success: false,
                message: 'La carpeta del producto no existe en el servidor',
                detalle: producto.PRO_FILES
            });
            return null;
        }
        await fsp.mkdir(carpetaAbs, { recursive: true });
    }

    return { producto, carpetaAbs };
}

/**
 * GET /mapa/v1/admin/productos/:id/archivos
 * Lista lo que hay realmente en la carpeta del producto.
 */
exports.getArchivos = async (req, res) => {
    try {
        const contexto = await resolverProductoYCarpeta(req, res, { crearSiFalta: true });
        if (!contexto) return;

        const { producto, carpetaAbs } = contexto;
        const archivos = await listarArchivos(carpetaAbs, producto.PRO_FILES);
        const peso = archivos.reduce((acc, archivo) => acc + archivo.size, 0);

        res.status(200).json({
            success: true,
            data: {
                PRO_ID: producto.PRO_ID,
                carpeta: producto.PRO_FILES,
                total_archivos: archivos.length,
                peso_total: peso,
                peso_total_texto: formatearTamano(peso),
                archivos
            }
        });
    } catch (error) {
        console.error('[PRODUCTOS] Error en getArchivos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar los archivos del producto',
            detalle: error.message
        });
    }
};

/**
 * DELETE /mapa/v1/admin/productos/:id/archivos?ruta=data/assets/a.pak
 * Elimina un archivo de la carpeta sin modificar el registro.
 * Si el archivo borrado era PRO_IMAGEN o PRO_EXE se avisa en la respuesta.
 */
exports.deleteArchivo = async (req, res) => {
    try {
        const contexto = await resolverProductoYCarpeta(req, res);
        if (!contexto) return;

        const { producto, carpetaAbs } = contexto;

        const rutaSolicitada = req.query.ruta || req.query.archivo;
        if (!rutaSolicitada) {
            return res.status(400).json({
                success: false,
                message: 'Debes indicar la ruta del archivo a eliminar',
                detalle: 'Ejemplo: ?ruta=data/assets/a.pak'
            });
        }

        const rutaRelativa = sanitizarRutaRelativa(String(rutaSolicitada));
        if (!rutaRelativa) {
            return res.status(400).json({ success: false, message: 'Ruta de archivo inválida' });
        }

        const archivoAbs = resolverDentro(carpetaAbs, rutaRelativa);
        if (!archivoAbs) {
            return res.status(400).json({
                success: false,
                message: 'La ruta indicada queda fuera de la carpeta del producto'
            });
        }

        let stat;
        try {
            stat = await fsp.stat(archivoAbs);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return res.status(404).json({ success: false, message: 'El archivo no existe', detalle: rutaRelativa });
            }
            throw error;
        }

        if (stat.isDirectory()) {
            // Borrar una subcarpeta completa se permite solo si se pide explícitamente
            if (req.query.recursivo !== 'true') {
                return res.status(400).json({
                    success: false,
                    message: 'La ruta es una carpeta. Envía ?recursivo=true para eliminarla con todo su contenido.'
                });
            }
            await fsp.rm(archivoAbs, { recursive: true, force: true });
        } else {
            await fsp.unlink(archivoAbs);
            await limpiarCarpetasVacias(path.dirname(archivoAbs), carpetaAbs);
        }

        const rutaWeb = `${producto.PRO_FILES}/${rutaRelativa}`;
        const eraImagen = producto.PRO_IMAGEN === rutaWeb;
        const eraExe = producto.PRO_EXE === rutaRelativa;

        // La portada sí se referencia en la base: si se borró, dejamos el campo limpio
        if (eraImagen) {
            await query(req.db, 'UPDATE MET_PRODUCTOS SET PRO_IMAGEN = NULL WHERE PRO_ID = ?', [producto.PRO_ID]);
        }

        // Quitar un archivo también cambia el producto: sube la versión
        const versionNueva = await incrementarVersion(req.db, producto.PRO_ID);

        res.status(200).json({
            success: true,
            message: `Archivo eliminado correctamente. Versión ${versionNueva}`,
            PRO_VERSION: versionNueva,
            data: {
                PRO_ID: producto.PRO_ID,
                ruta_relativa: rutaRelativa,
                size_liberado: stat.isDirectory() ? null : stat.size,
                era_portada: eraImagen,
                era_ejecutable: eraExe,
                PRO_VERSION: versionNueva,
                // PRO_EXE es solo el nombre de referencia del ejecutable, no un
                // archivo que deba estar subido, así que no se pide reemplazarlo
                aviso: eraExe
                    ? 'El archivo que eliminaste coincide con el nombre declarado en PRO_EXE.'
                    : null
            }
        });

        if (req.io) {
            req.io.to('global-room').emit('productos-update', {
                operation: 'delete-file',
                PRO_ID: producto.PRO_ID,
                ruta_relativa: rutaRelativa
            });
        }
    } catch (error) {
        console.error('[PRODUCTOS] Error en deleteArchivo:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar el archivo',
            detalle: error.message
        });
    }
};

/**
 * Multer para la portada del producto. Es un archivo chico, va en una sola petición
 * directo a la carpeta del producto (los pesados van por chunks).
 */
const imagenStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            const proId = Number(req.params.id);
            if (!Number.isInteger(proId) || proId <= 0) {
                return cb(new Error('ID de producto inválido'));
            }

            const producto = await obtenerProducto(req.db, proId);
            if (!producto) return cb(new Error('Producto no encontrado'));

            const carpetaAbs = carpetaProductoAbs(producto.PRO_FILES);
            if (!carpetaAbs) return cb(new Error('La carpeta registrada del producto no es válida'));

            await fsp.mkdir(carpetaAbs, { recursive: true });

            // Se guarda para reutilizarlo en el handler sin volver a consultar
            req.productoDestino = producto;
            cb(null, carpetaAbs);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.png';
        const nombre = sanitizarNombreArchivo(`icon${ext}`);
        cb(null, nombre || 'icon.png');
    }
});

const subirImagen = multer({
    storage: imagenStorage,
    limits: { fileSize: MAX_IMAGEN_SIZE },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype || !file.mimetype.startsWith('image/')) {
            return cb(new Error('La portada debe ser un archivo de imagen'), false);
        }
        cb(null, true);
    }
}).single('imagen');

/**
 * Middleware que ejecuta multer y traduce sus errores a JSON.
 */
exports.uploadImagenMiddleware = (req, res, next) => {
    subirImagen(req, res, (error) => {
        if (error) {
            const esLimite = error.code === 'LIMIT_FILE_SIZE';
            return res.status(esLimite ? 413 : 400).json({
                success: false,
                message: esLimite
                    ? `La imagen supera el límite de ${formatearTamano(MAX_IMAGEN_SIZE)}`
                    : 'Error al procesar la imagen',
                detalle: error.message
            });
        }
        next();
    });
};

/**
 * POST /mapa/v1/admin/productos/:id/imagen
 * Sube o reemplaza la portada y actualiza PRO_IMAGEN.
 */
exports.uploadImagen = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No se recibió ninguna imagen',
                detalle: 'Envía el archivo en el campo "imagen" como multipart/form-data'
            });
        }

        const producto = req.productoDestino;
        const rutaWeb = `${producto.PRO_FILES}/${req.file.filename}`;

        // Si la portada anterior tenía otra extensión, queda huérfana: la quitamos
        if (producto.PRO_IMAGEN && producto.PRO_IMAGEN !== rutaWeb) {
            const carpetaAbs = carpetaProductoAbs(producto.PRO_FILES);
            const anteriorRelativa = producto.PRO_IMAGEN.startsWith(`${producto.PRO_FILES}/`)
                ? producto.PRO_IMAGEN.slice(producto.PRO_FILES.length + 1)
                : null;

            if (carpetaAbs && anteriorRelativa) {
                const sanitizada = sanitizarRutaRelativa(anteriorRelativa);
                const anteriorAbs = sanitizada ? resolverDentro(carpetaAbs, sanitizada) : null;
                if (anteriorAbs && fs.existsSync(anteriorAbs)) {
                    try {
                        await fsp.unlink(anteriorAbs);
                    } catch (error) {
                        console.error('[PRODUCTOS] No se pudo eliminar la portada anterior:', error.message);
                    }
                }
            }
        }

        await query(req.db, 'UPDATE MET_PRODUCTOS SET PRO_IMAGEN = ? WHERE PRO_ID = ?', [rutaWeb, producto.PRO_ID]);

        // Cambiar la portada es un cambio del producto: sube la versión
        const versionNueva = await incrementarVersion(req.db, producto.PRO_ID);

        res.status(200).json({
            success: true,
            message: `Portada actualizada correctamente. Versión ${versionNueva}`,
            PRO_VERSION: versionNueva,
            data: {
                PRO_ID: producto.PRO_ID,
                PRO_IMAGEN: rutaWeb,
                size: req.file.size,
                size_texto: formatearTamano(req.file.size),
                PRO_VERSION: versionNueva
            }
        });

        if (req.io) {
            req.io.to('global-room').emit('productos-update', {
                operation: 'update-imagen',
                PRO_ID: producto.PRO_ID,
                PRO_IMAGEN: rutaWeb
            });
        }
    } catch (error) {
        console.error('[PRODUCTOS] Error en uploadImagen:', error);
        res.status(500).json({
            success: false,
            message: 'Error al guardar la portada',
            detalle: error.message
        });
    }
};

exports.resolverProductoYCarpeta = resolverProductoYCarpeta;
