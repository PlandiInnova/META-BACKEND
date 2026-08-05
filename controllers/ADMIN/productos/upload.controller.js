/**
 * Subida de archivos pesados por chunks (reanudable) para los productos del admin.
 *
 * Flujo desde el front:
 *   1. POST   /productos/:id/upload/init      -> devuelve upload_id
 *   2. POST   /productos/:id/upload/chunk?upload_id=..&index=N   (una vez por trozo)
 *   3. POST   /productos/:id/upload/complete  -> ensambla y deja el archivo en la carpeta
 *
 * Si la red se corta, el front consulta GET /upload/status con el mismo upload_id
 * y reenvía únicamente los índices faltantes. Nada de esto modifica el registro
 * de MET_PRODUCTOS: el archivo simplemente aparece en la carpeta de PRO_FILES.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const {
    UPLOADS_TMP_ABS,
    ENSAMBLANDO_SUFFIX,
    MAX_FILE_SIZE,
    MAX_CHUNK_SIZE,
    sanitizarNombreArchivo,
    sanitizarRutaRelativa,
    resolverDentro,
    carpetaProductoAbs,
    formatearTamano
} = require('./productos.paths');

const { obtenerProducto, incrementarVersion } = require('./productos.controller');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const META_FILENAME = 'meta.json';

// Evita que dos peticiones ensamblen el mismo upload a la vez
const ensamblando = new Set();

// ---------------------------------------------------------------------------
// Agrupación de versiones por tanda
//
// Cuando el usuario suelta varios archivos de golpe, el front les pone a todos
// el mismo identificador de tanda ("lote"). El primer archivo que termina sube
// la versión del producto y los demás de esa misma tanda se cuelgan de ella,
// así arrastrar 5 archivos cuenta como un solo cambio y no como cinco.
//
// No se usa una ventana de tiempo a propósito: la tanda se cierra por su
// identificador, sin importar cuánto tarde ni en qué orden acaben los archivos.
// ---------------------------------------------------------------------------

const LOTE_FORMATO = /^[A-Za-z0-9_-]{1,100}$/;
const LOTE_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Tandas ya versionadas: 'proId:lote' -> { marca, promesa }.
 *
 * Se guarda la promesa del incremento, no el número: los archivos que llegan
 * después esperan esa misma promesa y así todos reportan la versión definitiva.
 * Si guardáramos el número, los que terminan mientras el incremento va en vuelo
 * leerían la versión anterior.
 */
const lotesVersionados = new Map();

/** Descarta las tandas que ya cumplieron su tiempo de vida. */
function purgarLotesViejos() {
    const ahora = Date.now();
    for (const [clave, datos] of lotesVersionados) {
        if (ahora - datos.marca > LOTE_TTL_MS) lotesVersionados.delete(clave);
    }
}

/**
 * Versiona el producto tras subir un archivo, agrupando por tanda si viene el lote.
 * El primer archivo de la tanda sube la versión y el resto se cuelga de ese mismo
 * incremento, sin importar en qué orden terminen.
 *
 * @param {object} db
 * @param {number} proId
 * @param {string|undefined} lote
 * @returns {Promise<{version: number|null, agrupada: boolean}>}
 */
async function versionarSubida(db, proId, lote) {
    const loteValido = typeof lote === 'string' && LOTE_FORMATO.test(lote) ? lote : null;

    // Sin lote (o con uno inválido) cada archivo cuenta como un cambio propio
    if (!loteValido) {
        return { version: await incrementarVersion(db, proId), agrupada: false };
    }

    purgarLotesViejos();

    const clave = `${proId}:${loteValido}`;
    const existente = lotesVersionados.get(clave);

    if (existente) {
        return { version: await existente.promesa, agrupada: true };
    }

    // La promesa se registra antes de esperarla, para que los archivos que
    // lleguen mientras corre el UPDATE se enganchen a ella en lugar de sumar otra vez
    const promesa = incrementarVersion(db, proId);
    lotesVersionados.set(clave, { marca: Date.now(), promesa });

    return { version: await promesa, agrupada: false };
}

/**
 * Carpeta temporal donde se acumulan los chunks de un upload.
 * @param {string} uploadId
 * @returns {string|null}
 */
function carpetaUploadAbs(uploadId) {
    if (!uploadId || !UUID_REGEX.test(uploadId)) return null;
    return resolverDentro(UPLOADS_TMP_ABS, uploadId);
}

/**
 * Lee el meta.json de un upload en curso.
 * @param {string} uploadId
 * @returns {Promise<object|null>}
 */
async function leerMeta(uploadId) {
    const carpeta = carpetaUploadAbs(uploadId);
    if (!carpeta) return null;

    try {
        const contenido = await fsp.readFile(path.join(carpeta, META_FILENAME), 'utf8');
        return JSON.parse(contenido);
    } catch (error) {
        return null;
    }
}

/**
 * Devuelve los índices de chunk ya recibidos y su tamaño acumulado.
 * @param {string} carpetaUpload
 * @returns {Promise<{recibidos: number[], bytes: number}>}
 */
async function chunksRecibidos(carpetaUpload) {
    let entradas;
    try {
        entradas = await fsp.readdir(carpetaUpload, { withFileTypes: true });
    } catch (error) {
        return { recibidos: [], bytes: 0 };
    }

    const recibidos = [];
    let bytes = 0;

    for (const entrada of entradas) {
        if (!entrada.isFile()) continue;
        const match = entrada.name.match(/^(\d+)\.part$/);
        if (!match) continue;

        try {
            const stat = await fsp.stat(path.join(carpetaUpload, entrada.name));
            recibidos.push(Number(match[1]));
            bytes += stat.size;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }

    recibidos.sort((a, b) => a - b);
    return { recibidos, bytes };
}

/**
 * POST /mapa/v1/admin/productos/:id/upload/init
 * Body: { nombre, size, total_chunks, ruta_relativa?, sobrescribir? }
 */
exports.initUpload = async (req, res) => {
    try {
        const proId = Number(req.params.id);
        if (!Number.isInteger(proId) || proId <= 0) {
            return res.status(400).json({ success: false, message: 'ID de producto inválido' });
        }

        const producto = await obtenerProducto(req.db, proId);
        if (!producto) {
            return res.status(404).json({ success: false, message: 'Producto no encontrado' });
        }

        const carpetaProducto = carpetaProductoAbs(producto.PRO_FILES);
        if (!carpetaProducto) {
            return res.status(500).json({
                success: false,
                message: 'La carpeta registrada para este producto no es válida',
                detalle: `PRO_FILES = ${producto.PRO_FILES}`
            });
        }

        const nombreCrudo = req.body.nombre || req.body.filename;
        if (!nombreCrudo) {
            return res.status(400).json({
                success: false,
                message: 'Falta el nombre del archivo',
                detalle: 'Envía "nombre" con el nombre original del archivo'
            });
        }

        // El archivo puede ir en una subcarpeta del producto ('data/assets/a.pak')
        const destinoRel = req.body.ruta_relativa
            ? sanitizarRutaRelativa(String(req.body.ruta_relativa))
            : sanitizarNombreArchivo(String(nombreCrudo));

        if (!destinoRel) {
            return res.status(400).json({
                success: false,
                message: 'El nombre o la ruta del archivo no es válida',
                detalle: String(nombreCrudo)
            });
        }

        const destinoAbs = resolverDentro(carpetaProducto, destinoRel);
        if (!destinoAbs) {
            return res.status(400).json({
                success: false,
                message: 'La ruta del archivo queda fuera de la carpeta del producto'
            });
        }

        const size = Number(req.body.size);
        if (!Number.isFinite(size) || size <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Falta el tamaño del archivo',
                detalle: 'Envía "size" en bytes'
            });
        }

        if (size > MAX_FILE_SIZE) {
            return res.status(413).json({
                success: false,
                message: `El archivo supera el límite permitido de ${formatearTamano(MAX_FILE_SIZE)}`,
                detalle: `Tamaño recibido: ${formatearTamano(size)}. Ajusta PRODUCTOS_MAX_FILE_SIZE si necesitas más.`
            });
        }

        const totalChunks = Number(req.body.total_chunks);
        if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Falta el número total de chunks',
                detalle: 'Envía "total_chunks" con la cantidad de trozos en que partiste el archivo'
            });
        }

        const sobrescribir = req.body.sobrescribir === true || req.body.sobrescribir === 'true';
        if (!sobrescribir && fs.existsSync(destinoAbs)) {
            return res.status(409).json({
                success: false,
                message: 'Ya existe un archivo con ese nombre en el producto',
                detalle: 'Elimínalo primero o envía sobrescribir=true',
                data: { ruta_relativa: destinoRel }
            });
        }

        const uploadId = crypto.randomUUID();
        const carpetaUpload = resolverDentro(UPLOADS_TMP_ABS, uploadId);
        if (!carpetaUpload) {
            return res.status(500).json({ success: false, message: 'No se pudo preparar la carpeta temporal' });
        }

        await fsp.mkdir(carpetaUpload, { recursive: true });

        // El lote agrupa los archivos soltados juntos para que compartan un solo
        // incremento de versión. Se guarda en el meta para que sobreviva a una
        // reanudación: el front no tiene que reenviarlo al completar.
        const loteCrudo = req.body.lote || req.body.batch_id;
        const lote = typeof loteCrudo === 'string' && LOTE_FORMATO.test(loteCrudo) ? loteCrudo : null;

        const meta = {
            upload_id: uploadId,
            pro_id: proId,
            pro_files: producto.PRO_FILES,
            nombre_original: String(nombreCrudo),
            destino_rel: destinoRel,
            size,
            total_chunks: totalChunks,
            sobrescribir,
            lote,
            creado: new Date().toISOString()
        };

        await fsp.writeFile(path.join(carpetaUpload, META_FILENAME), JSON.stringify(meta, null, 2), 'utf8');

        console.log(`[PRODUCTOS] Upload iniciado ${uploadId} -> ${producto.PRO_FILES}/${destinoRel} (${formatearTamano(size)}, ${totalChunks} chunks)`);

        res.status(201).json({
            success: true,
            message: 'Subida iniciada',
            data: {
                upload_id: uploadId,
                PRO_ID: proId,
                destino: `${producto.PRO_FILES}/${destinoRel}`,
                ruta_relativa: destinoRel,
                size,
                total_chunks: totalChunks,
                max_chunk_size: MAX_CHUNK_SIZE,
                max_chunk_size_texto: formatearTamano(MAX_CHUNK_SIZE)
            }
        });
    } catch (error) {
        console.error('[PRODUCTOS] Error en initUpload:', error);
        res.status(500).json({
            success: false,
            message: 'Error al iniciar la subida',
            detalle: error.message
        });
    }
};

/**
 * Multer para un chunk suelto: se escribe directo a disco como <index>.part
 * dentro de la carpeta temporal del upload.
 */
const chunkStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            const uploadId = req.query.upload_id || req.query.uploadId;
            const carpeta = carpetaUploadAbs(uploadId);
            if (!carpeta) return cb(new Error('upload_id inválido'));

            const meta = await leerMeta(uploadId);
            if (!meta) return cb(new Error('La subida no existe o ya fue finalizada'));

            if (Number(meta.pro_id) !== Number(req.params.id)) {
                return cb(new Error('El upload_id no corresponde a este producto'));
            }

            const index = Number(req.query.index);
            if (!Number.isInteger(index) || index < 0 || index >= meta.total_chunks) {
                return cb(new Error(`index debe ser un entero entre 0 y ${meta.total_chunks - 1}`));
            }

            req.uploadMeta = meta;
            req.chunkIndex = index;
            cb(null, carpeta);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        cb(null, `${req.chunkIndex}.part`);
    }
});

const subirChunk = multer({
    storage: chunkStorage,
    limits: { fileSize: MAX_CHUNK_SIZE, files: 1 }
}).single('chunk');

/**
 * Middleware que ejecuta multer para el chunk y traduce sus errores a JSON.
 */
exports.uploadChunkMiddleware = (req, res, next) => {
    subirChunk(req, res, (error) => {
        if (!error) return next();

        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                success: false,
                message: `Cada chunk debe pesar máximo ${formatearTamano(MAX_CHUNK_SIZE)}`,
                detalle: 'Reduce el tamaño de chunk en el front o sube PRODUCTOS_MAX_CHUNK_SIZE'
            });
        }

        return res.status(400).json({
            success: false,
            message: 'Error al recibir el chunk',
            detalle: error.message
        });
    });
};

/**
 * POST /mapa/v1/admin/productos/:id/upload/chunk?upload_id=..&index=N
 * Campo multipart: "chunk"
 */
exports.uploadChunk = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No se recibió el chunk',
                detalle: 'Envía el trozo en el campo "chunk" como multipart/form-data'
            });
        }

        const meta = req.uploadMeta;
        const carpeta = carpetaUploadAbs(meta.upload_id);
        const { recibidos, bytes } = await chunksRecibidos(carpeta);

        res.status(200).json({
            success: true,
            data: {
                upload_id: meta.upload_id,
                index: req.chunkIndex,
                size: req.file.size,
                chunks_recibidos: recibidos.length,
                total_chunks: meta.total_chunks,
                bytes_recibidos: bytes,
                completo: recibidos.length === meta.total_chunks,
                progreso: Math.round((recibidos.length / meta.total_chunks) * 100)
            }
        });
    } catch (error) {
        console.error('[PRODUCTOS] Error en uploadChunk:', error);
        res.status(500).json({
            success: false,
            message: 'Error al guardar el chunk',
            detalle: error.message
        });
    }
};

/**
 * GET /mapa/v1/admin/productos/:id/upload/status?upload_id=..
 * Devuelve qué chunks faltan, para reanudar tras una caída de red.
 */
exports.statusUpload = async (req, res) => {
    try {
        const uploadId = req.query.upload_id || req.query.uploadId;
        const meta = await leerMeta(uploadId);

        if (!meta) {
            return res.status(404).json({
                success: false,
                message: 'La subida no existe o ya fue finalizada'
            });
        }

        if (Number(meta.pro_id) !== Number(req.params.id)) {
            return res.status(400).json({ success: false, message: 'El upload_id no corresponde a este producto' });
        }

        const carpeta = carpetaUploadAbs(uploadId);
        const { recibidos, bytes } = await chunksRecibidos(carpeta);

        const faltantes = [];
        for (let i = 0; i < meta.total_chunks; i += 1) {
            if (!recibidos.includes(i)) faltantes.push(i);
        }

        res.status(200).json({
            success: true,
            data: {
                upload_id: meta.upload_id,
                PRO_ID: meta.pro_id,
                ruta_relativa: meta.destino_rel,
                size: meta.size,
                total_chunks: meta.total_chunks,
                chunks_recibidos: recibidos,
                chunks_faltantes: faltantes,
                bytes_recibidos: bytes,
                completo: faltantes.length === 0,
                progreso: Math.round((recibidos.length / meta.total_chunks) * 100),
                creado: meta.creado
            }
        });
    } catch (error) {
        console.error('[PRODUCTOS] Error en statusUpload:', error);
        res.status(500).json({
            success: false,
            message: 'Error al consultar el estado de la subida',
            detalle: error.message
        });
    }
};

/**
 * Une los chunks en un solo archivo usando streams, sin cargar nada en memoria.
 * @param {string} carpetaUpload
 * @param {number} totalChunks
 * @param {string} destinoTmp
 */
async function ensamblarChunks(carpetaUpload, totalChunks, destinoTmp) {
    const salida = fs.createWriteStream(destinoTmp);

    try {
        for (let i = 0; i < totalChunks; i += 1) {
            const partePath = path.join(carpetaUpload, `${i}.part`);

            await new Promise((resolve, reject) => {
                const entrada = fs.createReadStream(partePath);
                entrada.on('error', reject);
                salida.on('error', reject);
                entrada.on('end', resolve);
                entrada.pipe(salida, { end: false });
            });
        }
    } catch (error) {
        salida.destroy();
        throw error;
    }

    await new Promise((resolve, reject) => {
        salida.on('error', reject);
        salida.end(resolve);
    });
}

/**
 * POST /mapa/v1/admin/productos/:id/upload/complete
 * Body: { upload_id }
 */
exports.completeUpload = async (req, res) => {
    const uploadId = req.body.upload_id || req.body.uploadId || req.query.upload_id;
    let destinoTmp = null;

    try {
        const meta = await leerMeta(uploadId);
        if (!meta) {
            return res.status(404).json({
                success: false,
                message: 'La subida no existe o ya fue finalizada'
            });
        }

        if (Number(meta.pro_id) !== Number(req.params.id)) {
            return res.status(400).json({ success: false, message: 'El upload_id no corresponde a este producto' });
        }

        if (ensamblando.has(uploadId)) {
            return res.status(409).json({
                success: false,
                message: 'Esta subida ya se está ensamblando, espera a que termine'
            });
        }

        const carpetaUpload = carpetaUploadAbs(uploadId);
        const { recibidos, bytes } = await chunksRecibidos(carpetaUpload);

        const faltantes = [];
        for (let i = 0; i < meta.total_chunks; i += 1) {
            if (!recibidos.includes(i)) faltantes.push(i);
        }

        if (faltantes.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Faltan chunks por subir',
                data: {
                    upload_id: uploadId,
                    chunks_faltantes: faltantes,
                    total_chunks: meta.total_chunks
                }
            });
        }

        const producto = await obtenerProducto(req.db, meta.pro_id);
        if (!producto) {
            return res.status(404).json({ success: false, message: 'El producto ya no existe' });
        }

        const carpetaProducto = carpetaProductoAbs(producto.PRO_FILES);
        if (!carpetaProducto) {
            return res.status(500).json({
                success: false,
                message: 'La carpeta registrada para este producto no es válida'
            });
        }

        const destinoAbs = resolverDentro(carpetaProducto, meta.destino_rel);
        if (!destinoAbs) {
            return res.status(400).json({
                success: false,
                message: 'La ruta del archivo queda fuera de la carpeta del producto'
            });
        }

        ensamblando.add(uploadId);

        await fsp.mkdir(path.dirname(destinoAbs), { recursive: true });

        // Se ensambla a un temporal en la misma carpeta y luego se renombra:
        // así el archivo final nunca aparece a medias en los listados
        destinoTmp = `${destinoAbs}${ENSAMBLANDO_SUFFIX}`;
        await ensamblarChunks(carpetaUpload, meta.total_chunks, destinoTmp);

        const statFinal = await fsp.stat(destinoTmp);

        if (statFinal.size !== meta.size) {
            await fsp.unlink(destinoTmp).catch(() => {});
            ensamblando.delete(uploadId);

            return res.status(422).json({
                success: false,
                message: 'El archivo ensamblado no coincide con el tamaño declarado',
                detalle: `Esperado ${meta.size} bytes, obtenido ${statFinal.size} bytes. Reinicia la subida.`,
                data: { bytes_recibidos: bytes }
            });
        }

        await fsp.rename(destinoTmp, destinoAbs);
        destinoTmp = null;

        await fsp.rm(carpetaUpload, { recursive: true, force: true });
        ensamblando.delete(uploadId);

        const rutaWeb = `${producto.PRO_FILES}/${meta.destino_rel}`;
        console.log(`[PRODUCTOS] Upload completado ${uploadId} -> ${rutaWeb} (${formatearTamano(statFinal.size)})`);

        // Agregar un archivo cambia el producto: sube la versión.
        // Si el archivo venía en una tanda, toda la tanda comparte un solo incremento.
        const { version: versionNueva, agrupada } = await versionarSubida(
            req.db,
            producto.PRO_ID,
            meta.lote || req.body.lote
        );

        res.status(201).json({
            success: true,
            message: agrupada
                ? `Archivo subido correctamente. Se mantiene la versión ${versionNueva} de esta tanda`
                : `Archivo subido correctamente. Versión ${versionNueva}`,
            PRO_VERSION: versionNueva,
            version_agrupada: agrupada,
            data: {
                PRO_ID: producto.PRO_ID,
                nombre: path.basename(meta.destino_rel),
                ruta_relativa: meta.destino_rel,
                ruta_web: rutaWeb,
                size: statFinal.size,
                size_texto: formatearTamano(statFinal.size),
                es_ejecutable: producto.PRO_EXE === meta.destino_rel,
                PRO_VERSION: versionNueva,
                version_agrupada: agrupada,
                lote: meta.lote || null
            }
        });

        if (req.io) {
            req.io.to('global-room').emit('productos-update', {
                operation: 'new-file',
                PRO_ID: producto.PRO_ID,
                ruta_relativa: meta.destino_rel,
                size: statFinal.size
            });
        }
    } catch (error) {
        if (uploadId) ensamblando.delete(uploadId);

        if (destinoTmp) {
            await fsp.unlink(destinoTmp).catch(() => {});
        }

        console.error('[PRODUCTOS] Error en completeUpload:', error);
        res.status(500).json({
            success: false,
            message: 'Error al ensamblar el archivo',
            detalle: error.message
        });
    }
};

/**
 * DELETE /mapa/v1/admin/productos/:id/upload?upload_id=..
 * Cancela una subida y borra sus chunks temporales.
 */
exports.abortUpload = async (req, res) => {
    try {
        const uploadId = req.query.upload_id || req.query.uploadId;
        const meta = await leerMeta(uploadId);

        if (!meta) {
            return res.status(404).json({
                success: false,
                message: 'La subida no existe o ya fue finalizada'
            });
        }

        if (Number(meta.pro_id) !== Number(req.params.id)) {
            return res.status(400).json({ success: false, message: 'El upload_id no corresponde a este producto' });
        }

        if (ensamblando.has(uploadId)) {
            return res.status(409).json({
                success: false,
                message: 'La subida se está ensamblando, no se puede cancelar en este momento'
            });
        }

        const carpetaUpload = carpetaUploadAbs(uploadId);
        await fsp.rm(carpetaUpload, { recursive: true, force: true });

        res.status(200).json({
            success: true,
            message: 'Subida cancelada y temporales eliminados',
            data: { upload_id: uploadId, ruta_relativa: meta.destino_rel }
        });
    } catch (error) {
        console.error('[PRODUCTOS] Error en abortUpload:', error);
        res.status(500).json({
            success: false,
            message: 'Error al cancelar la subida',
            detalle: error.message
        });
    }
};

/**
 * GET /mapa/v1/admin/productos/uploads
 * Lista las subidas a medias que quedaron en el servidor (ocupan disco).
 */
exports.listarUploadsPendientes = async (req, res) => {
    try {
        let entradas;
        try {
            entradas = await fsp.readdir(UPLOADS_TMP_ABS, { withFileTypes: true });
        } catch (error) {
            if (error.code === 'ENOENT') {
                return res.status(200).json({ success: true, data: { total: 0, peso_total: 0, uploads: [] } });
            }
            throw error;
        }

        const uploads = [];

        for (const entrada of entradas) {
            if (!entrada.isDirectory() || !UUID_REGEX.test(entrada.name)) continue;

            const meta = await leerMeta(entrada.name);
            if (!meta) continue;

            const carpeta = carpetaUploadAbs(entrada.name);
            const { recibidos, bytes } = await chunksRecibidos(carpeta);

            uploads.push({
                upload_id: entrada.name,
                PRO_ID: meta.pro_id,
                ruta_relativa: meta.destino_rel,
                size: meta.size,
                total_chunks: meta.total_chunks,
                chunks_recibidos: recibidos.length,
                bytes_en_disco: bytes,
                bytes_en_disco_texto: formatearTamano(bytes),
                progreso: Math.round((recibidos.length / meta.total_chunks) * 100),
                creado: meta.creado
            });
        }

        const pesoTotal = uploads.reduce((acc, item) => acc + item.bytes_en_disco, 0);
        uploads.sort((a, b) => String(a.creado).localeCompare(String(b.creado)));

        res.status(200).json({
            success: true,
            data: {
                total: uploads.length,
                peso_total: pesoTotal,
                peso_total_texto: formatearTamano(pesoTotal),
                uploads
            }
        });
    } catch (error) {
        console.error('[PRODUCTOS] Error en listarUploadsPendientes:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar las subidas pendientes',
            detalle: error.message
        });
    }
};

/**
 * DELETE /mapa/v1/admin/productos/uploads?horas=24
 * Borra los temporales de subidas abandonadas para liberar disco.
 */
exports.limpiarUploads = async (req, res) => {
    try {
        const horas = req.query.horas === undefined ? 24 : Number(req.query.horas);
        if (!Number.isFinite(horas) || horas < 0) {
            return res.status(400).json({ success: false, message: 'Parámetro horas inválido' });
        }

        const limite = Date.now() - horas * 60 * 60 * 1000;

        let entradas;
        try {
            entradas = await fsp.readdir(UPLOADS_TMP_ABS, { withFileTypes: true });
        } catch (error) {
            if (error.code === 'ENOENT') {
                return res.status(200).json({
                    success: true,
                    message: 'No hay subidas pendientes',
                    data: { eliminadas: 0, bytes_liberados: 0 }
                });
            }
            throw error;
        }

        let eliminadas = 0;
        let bytesLiberados = 0;
        const detalle = [];

        for (const entrada of entradas) {
            if (!entrada.isDirectory() || !UUID_REGEX.test(entrada.name)) continue;
            if (ensamblando.has(entrada.name)) continue;

            const carpeta = carpetaUploadAbs(entrada.name);
            if (!carpeta) continue;

            const meta = await leerMeta(entrada.name);
            const creado = meta && meta.creado ? new Date(meta.creado).getTime() : null;

            let referencia = creado;
            if (!Number.isFinite(referencia)) {
                const stat = await fsp.stat(carpeta);
                referencia = stat.mtimeMs;
            }

            if (referencia > limite) continue;

            const { bytes } = await chunksRecibidos(carpeta);
            await fsp.rm(carpeta, { recursive: true, force: true });

            eliminadas += 1;
            bytesLiberados += bytes;
            detalle.push({
                upload_id: entrada.name,
                ruta_relativa: meta ? meta.destino_rel : null,
                bytes_liberados: bytes
            });
        }

        res.status(200).json({
            success: true,
            message: `Se eliminaron ${eliminadas} subida(s) abandonada(s)`,
            data: {
                eliminadas,
                bytes_liberados: bytesLiberados,
                bytes_liberados_texto: formatearTamano(bytesLiberados),
                detalle
            }
        });
    } catch (error) {
        console.error('[PRODUCTOS] Error en limpiarUploads:', error);
        res.status(500).json({
            success: false,
            message: 'Error al limpiar las subidas pendientes',
            detalle: error.message
        });
    }
};
