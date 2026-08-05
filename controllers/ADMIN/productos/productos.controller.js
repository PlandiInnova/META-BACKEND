/**
 * Controlador de PRODUCTOS (admin).
 *
 * Un producto es un registro de MET_PRODUCTOS más una carpeta en disco donde
 * viven sus archivos pesados. La carpeta queda guardada en PRO_FILES y los
 * archivos se administran contra el disco (ver archivos.controller.js y
 * upload.controller.js) sin volver a tocar el registro.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const {
    PRODUCTOS_ROOT_ABS,
    slugify,
    sanitizarNombreArchivo,
    carpetaProductoAbs,
    rutaWebProducto,
    slugDisponible,
    resolverDentro,
    listarArchivos,
    formatearTamano
} = require('./productos.paths');

// El formato de PAQ_PRODUCTOS lo define el módulo comercial
const { parsearProductosPaquete } = require('../comercial/comercial.controller');

// Longitudes reales de las columnas de MET_PRODUCTOS
const LIMITES = {
    PRO_NOMBRE: 100,
    PRO_NOMBRE_DETALLADO: 100,
    PRO_EXE: 50,
    PRO_TIPO: 45
};

/**
 * Tipos de producto admitidos. Es un catálogo cerrado: el formulario ofrece
 * estos dos y aquí se vuelve a validar para que no entre nada más por la API.
 */
const TIPOS_PRODUCTO = ['Recurso', 'Plataforma'];

/**
 * Ejecuta una consulta devolviendo una promesa, manteniendo el pool de req.db.
 * @param {object} db
 * @param {string} sql
 * @param {Array} params
 * @returns {Promise<any>}
 */
function query(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (error, results) => {
            if (error) reject(error);
            else resolve(results);
        });
    });
}

const SELECT_PRODUCTO = `
    SELECT
        p.PRO_ID,
        p.PRO_NOMBRE,
        p.PRO_NOMBRE_DETALLADO,
        p.PRO_DESCRIPCION,
        p.PRO_SEM_ID,
        p.PRO_EXE,
        p.PRO_IMAGEN,
        p.PRO_TIPO,
        p.PRO_FILES,
        p.PRO_VERSION,
        sem.SEM_NUMERO,
        sem.SEM_NOMBRE,
        sub.SUB_ID,
        sub.SUB_NOMBRE
    FROM MET_PRODUCTOS p
    LEFT JOIN MET_SEMESTRE sem ON sem.SEM_ID = p.PRO_SEM_ID
    LEFT JOIN MET_SUBSISTEMA sub ON sub.SUB_ID = sem.SEM_SUB_ID
`;

/**
 * Obtiene un producto por id. Devuelve null si no existe.
 * @param {object} db
 * @param {number} proId
 * @returns {Promise<object|null>}
 */
async function obtenerProducto(db, proId) {
    const results = await query(db, `${SELECT_PRODUCTO} WHERE p.PRO_ID = ?`, [proId]);
    return (results && results[0]) || null;
}

/**
 * Cuántas licencias cuelgan de cada producto.
 *
 * No hay relación directa: la cadena es producto -> paquete -> licencia.
 * Un paquete guarda sus productos en PAQ_PRODUCTOS (JSON con los ids) y las
 * licencias apuntan al paquete con LIC_PAQ_ID. Así que un producto "tiene
 * licencias" si está en algún paquete que ya generó licencias.
 *
 * Se resuelve con dos consultas para toda la lista en vez de una por producto.
 *
 * @param {object} db
 * @returns {Promise<Map<number, {licencias: number, paquetes: string[]}>>}
 */
async function licenciasPorProducto(db) {
    const mapa = new Map();

    const paquetes = await query(db, 'SELECT PAQ_ID, PAQ_NOMBRE, PAQ_PRODUCTOS FROM MET_PAQUETE');
    if (!paquetes || paquetes.length === 0) return mapa;

    // Licencias agrupadas por paquete
    const porPaquete = await query(
        db,
        'SELECT LIC_PAQ_ID, COUNT(*) AS n FROM MET_LICENCIA WHERE LIC_PAQ_ID IS NOT NULL GROUP BY LIC_PAQ_ID'
    );
    const conteoPaquete = new Map((porPaquete || []).map((f) => [f.LIC_PAQ_ID, Number(f.n)]));

    for (const paquete of paquetes) {
        const licencias = conteoPaquete.get(paquete.PAQ_ID) || 0;
        if (licencias === 0) continue;

        const { ids } = parsearProductosPaquete(paquete.PAQ_PRODUCTOS);

        for (const proId of ids) {
            const actual = mapa.get(proId) || { licencias: 0, paquetes: [] };
            actual.licencias += licencias;
            if (!actual.paquetes.includes(paquete.PAQ_NOMBRE)) {
                actual.paquetes.push(paquete.PAQ_NOMBRE);
            }
            mapa.set(proId, actual);
        }
    }

    return mapa;
}

/**
 * Lo mismo pero para un solo producto, para validar antes de eliminar.
 * @param {object} db
 * @param {number} proId
 * @returns {Promise<{licencias: number, paquetes: string[]}>}
 */
async function licenciasDeProducto(db, proId) {
    const mapa = await licenciasPorProducto(db);
    return mapa.get(proId) || { licencias: 0, paquetes: [] };
}

/**
 * Sube en uno la versión del producto. Cualquier cambio la incrementa: editar un
 * campo, subir un archivo, eliminarlo o cambiar la portada.
 *
 * El incremento se hace dentro del propio UPDATE para que dos cambios
 * simultáneos no se pisen la versión.
 *
 * @param {object} db
 * @param {number} proId
 * @returns {Promise<number|null>} la versión nueva, o null si no se pudo leer
 */
async function incrementarVersion(db, proId) {
    try {
        await query(
            db,
            'UPDATE MET_PRODUCTOS SET PRO_VERSION = COALESCE(PRO_VERSION, 0) + 1 WHERE PRO_ID = ?',
            [proId]
        );

        const filas = await query(db, 'SELECT PRO_VERSION FROM MET_PRODUCTOS WHERE PRO_ID = ?', [proId]);
        return filas && filas[0] ? filas[0].PRO_VERSION : null;
    } catch (error) {
        // Un fallo al versionar no debe tumbar la operación que ya se completó
        console.error('[PRODUCTOS] No se pudo incrementar la versión:', error.message);
        return null;
    }
}

/**
 * Valida y normaliza los campos del cuerpo de la petición.
 * @param {object} body
 * @param {boolean} esCreacion
 * @returns {{errores: string[], datos: object}}
 */
function validarCampos(body, esCreacion) {
    const errores = [];
    const datos = {};

    const texto = (valor) => (valor === undefined || valor === null ? undefined : String(valor).trim());

    const nombre = texto(body.PRO_NOMBRE);
    if (esCreacion && !nombre) {
        errores.push('PRO_NOMBRE es obligatorio');
    } else if (nombre !== undefined) {
        if (!nombre) errores.push('PRO_NOMBRE no puede quedar vacío');
        else if (nombre.length > LIMITES.PRO_NOMBRE) {
            errores.push(`PRO_NOMBRE excede ${LIMITES.PRO_NOMBRE} caracteres (recibidos ${nombre.length})`);
        } else {
            datos.PRO_NOMBRE = nombre;
        }
    }

    const detallado = texto(body.PRO_NOMBRE_DETALLADO);
    if (detallado !== undefined) {
        if (detallado.length > LIMITES.PRO_NOMBRE_DETALLADO) {
            errores.push(`PRO_NOMBRE_DETALLADO excede ${LIMITES.PRO_NOMBRE_DETALLADO} caracteres (recibidos ${detallado.length})`);
        } else {
            datos.PRO_NOMBRE_DETALLADO = detallado;
        }
    }

    const descripcion = texto(body.PRO_DESCRIPCION);
    if (descripcion !== undefined) datos.PRO_DESCRIPCION = descripcion;

    // El semestre es obligatorio al crear; al editar no puede vaciarse
    if (body.PRO_SEM_ID !== undefined && body.PRO_SEM_ID !== null && body.PRO_SEM_ID !== '') {
        const semId = Number(body.PRO_SEM_ID);
        if (!Number.isInteger(semId) || semId <= 0) errores.push('PRO_SEM_ID debe ser un entero positivo');
        else datos.PRO_SEM_ID = semId;
    } else if (esCreacion) {
        errores.push('El semestre es obligatorio');
    } else if (body.PRO_SEM_ID === null || body.PRO_SEM_ID === '') {
        errores.push('El semestre no puede quedar vacío');
    }

    // El nombre del ejecutable es obligatorio al crear
    const exe = texto(body.PRO_EXE);
    if (exe !== undefined && exe !== '') {
        const exeLimpio = sanitizarNombreArchivo(exe);
        if (!exeLimpio) {
            errores.push('PRO_EXE no es un nombre de archivo válido');
        } else if (exeLimpio.length > LIMITES.PRO_EXE) {
            errores.push(`PRO_EXE excede ${LIMITES.PRO_EXE} caracteres (recibidos ${exeLimpio.length}). Usa un nombre de ejecutable más corto.`);
        } else {
            datos.PRO_EXE = exeLimpio;
        }
    } else if (esCreacion) {
        errores.push('El archivo ejecutable es obligatorio');
    } else if (exe === '') {
        errores.push('El archivo ejecutable no puede quedar vacío');
    }

    // El tipo es obligatorio y solo admite los valores del catálogo
    const tipo = texto(body.PRO_TIPO);
    if (tipo !== undefined && tipo !== '') {
        if (!TIPOS_PRODUCTO.includes(tipo)) {
            errores.push(`PRO_TIPO debe ser uno de: ${TIPOS_PRODUCTO.join(', ')} (recibido "${tipo}")`);
        } else {
            datos.PRO_TIPO = tipo;
        }
    } else if (esCreacion) {
        errores.push('El tipo de producto es obligatorio');
    } else if (tipo === '') {
        errores.push('El tipo de producto no puede quedar vacío');
    }

    if (body.PRO_VERSION !== undefined && body.PRO_VERSION !== null && body.PRO_VERSION !== '') {
        const version = Number(body.PRO_VERSION);
        if (!Number.isInteger(version) || version < 0) errores.push('PRO_VERSION debe ser un entero mayor o igual a 0');
        else datos.PRO_VERSION = version;
    }

    return { errores, datos };
}

/**
 * GET /mapa/v1/admin/productos
 * Lista los productos con su semestre y subsistema.
 * Query opcional: ?semestre=  ?subsistema=  ?tipo=  ?buscar=  ?con_disco=true
 */
exports.getProductos = async (req, res) => {
    try {
        const condiciones = [];
        const params = [];

        if (req.query.semestre) {
            const semestre = Number(req.query.semestre);
            if (!Number.isInteger(semestre)) {
                return res.status(400).json({ success: false, message: 'Parámetro semestre inválido' });
            }
            condiciones.push('p.PRO_SEM_ID = ?');
            params.push(semestre);
        }

        if (req.query.subsistema) {
            const subsistema = Number(req.query.subsistema);
            if (!Number.isInteger(subsistema)) {
                return res.status(400).json({ success: false, message: 'Parámetro subsistema inválido' });
            }
            condiciones.push('sub.SUB_ID = ?');
            params.push(subsistema);
        }

        if (req.query.tipo) {
            condiciones.push('p.PRO_TIPO = ?');
            params.push(String(req.query.tipo).trim());
        }

        if (req.query.buscar) {
            const buscar = `%${String(req.query.buscar).trim()}%`;
            condiciones.push('(p.PRO_NOMBRE LIKE ? OR p.PRO_NOMBRE_DETALLADO LIKE ?)');
            params.push(buscar, buscar);
        }

        const where = condiciones.length ? ` WHERE ${condiciones.join(' AND ')}` : '';
        const orden = ' ORDER BY sub.SUB_NOMBRE ASC, sem.SEM_NUMERO ASC, p.PRO_NOMBRE ASC';

        const productos = await query(req.db, `${SELECT_PRODUCTO}${where}${orden}`, params);
        let data = productos || [];

        // Con esto la interfaz sabe cuáles no se pueden eliminar
        const licenciasMapa = await licenciasPorProducto(req.db);
        data = data.map((producto) => {
            const info = licenciasMapa.get(producto.PRO_ID) || { licencias: 0, paquetes: [] };
            return {
                ...producto,
                total_licencias: info.licencias,
                paquetes_con_licencias: info.paquetes
            };
        });

        // El listado no toca disco por defecto: con archivos de varios GB recorrer
        // todas las carpetas es costoso. Se pide explícitamente con ?con_disco=true
        if (req.query.con_disco === 'true') {
            data = await Promise.all(data.map(async (producto) => {
                const carpetaAbs = carpetaProductoAbs(producto.PRO_FILES);
                if (!carpetaAbs || !fs.existsSync(carpetaAbs)) {
                    return { ...producto, carpeta_existe: false, total_archivos: 0, peso_total: 0, peso_total_texto: '0 B' };
                }

                const archivos = await listarArchivos(carpetaAbs, producto.PRO_FILES);
                const peso = archivos.reduce((acc, archivo) => acc + archivo.size, 0);

                return {
                    ...producto,
                    carpeta_existe: true,
                    total_archivos: archivos.length,
                    peso_total: peso,
                    peso_total_texto: formatearTamano(peso)
                };
            }));
        }

        res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('[PRODUCTOS] Error en getProductos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar productos',
            detalle: error.message
        });
    }
};

/**
 * GET /mapa/v1/admin/productos/:id
 * Detalle del producto con el contenido real de su carpeta.
 */
exports.getProducto = async (req, res) => {
    try {
        const proId = Number(req.params.id);
        if (!Number.isInteger(proId) || proId <= 0) {
            return res.status(400).json({ success: false, message: 'ID de producto inválido' });
        }

        const producto = await obtenerProducto(req.db, proId);
        if (!producto) {
            return res.status(404).json({ success: false, message: 'Producto no encontrado' });
        }

        const carpetaAbs = carpetaProductoAbs(producto.PRO_FILES);
        const carpetaExiste = !!carpetaAbs && fs.existsSync(carpetaAbs);
        const archivos = carpetaExiste ? await listarArchivos(carpetaAbs, producto.PRO_FILES) : [];
        const peso = archivos.reduce((acc, archivo) => acc + archivo.size, 0);

        const { licencias, paquetes } = await licenciasDeProducto(req.db, proId);

        // PRO_EXE es solo el nombre de referencia del ejecutable: no se comprueba
        // que el archivo esté en la carpeta porque no se sube al servidor.
        res.status(200).json({
            success: true,
            data: {
                ...producto,
                carpeta_existe: carpetaExiste,
                total_licencias: licencias,
                paquetes_con_licencias: paquetes,
                total_archivos: archivos.length,
                peso_total: peso,
                peso_total_texto: formatearTamano(peso),
                archivos
            }
        });
    } catch (error) {
        console.error('[PRODUCTOS] Error en getProducto:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener el producto',
            detalle: error.message
        });
    }
};

/**
 * POST /mapa/v1/admin/productos
 * Crea el registro y su carpeta vacía en disco. Los archivos se suben después
 * por chunks a /productos/:id/upload/*.
 */
exports.createProducto = async (req, res) => {
    let carpetaCreada = null;

    try {
        const { errores, datos } = validarCampos(req.body, true);
        if (errores.length > 0) {
            return res.status(400).json({ success: false, message: 'Datos inválidos', errores });
        }

        if (datos.PRO_SEM_ID) {
            const semestre = await query(req.db, 'SELECT SEM_ID FROM MET_SEMESTRE WHERE SEM_ID = ?', [datos.PRO_SEM_ID]);
            if (!semestre || semestre.length === 0) {
                return res.status(400).json({ success: false, message: `El semestre ${datos.PRO_SEM_ID} no existe` });
            }
        }

        // La carpeta se nombra a partir de PRO_NOMBRE, o de la carpeta indicada explícitamente
        const slugBase = slugify(req.body.carpeta || datos.PRO_NOMBRE);
        if (!slugBase) {
            return res.status(400).json({
                success: false,
                message: 'No se pudo generar un nombre de carpeta a partir de PRO_NOMBRE. Envía "carpeta" con un nombre válido.'
            });
        }

        const slug = await slugDisponible(slugBase);
        const carpetaAbs = resolverDentro(PRODUCTOS_ROOT_ABS, slug);
        if (!carpetaAbs) {
            return res.status(400).json({ success: false, message: 'Nombre de carpeta inválido' });
        }

        await fsp.mkdir(carpetaAbs, { recursive: true });
        carpetaCreada = carpetaAbs;

        const proFiles = rutaWebProducto(slug);

        const insertQuery = `
            INSERT INTO MET_PRODUCTOS
                (PRO_NOMBRE, PRO_NOMBRE_DETALLADO, PRO_DESCRIPCION, PRO_SEM_ID,
                 PRO_EXE, PRO_IMAGEN, PRO_TIPO, PRO_FILES, PRO_VERSION)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const valores = [
            datos.PRO_NOMBRE,
            datos.PRO_NOMBRE_DETALLADO || null,
            datos.PRO_DESCRIPCION || null,
            datos.PRO_SEM_ID ?? null,
            datos.PRO_EXE || null,
            null, // PRO_IMAGEN se define al subir la portada
            datos.PRO_TIPO || null,
            proFiles,
            datos.PRO_VERSION ?? 0
        ];

        const result = await query(req.db, insertQuery, valores);

        const creado = await obtenerProducto(req.db, result.insertId);

        res.status(201).json({
            success: true,
            message: 'Producto creado correctamente',
            data: { ...creado, carpeta_existe: true, total_archivos: 0, archivos: [] }
        });

        if (req.io) {
            req.io.to('global-room').emit('productos-update', { operation: 'insert', PRO_ID: result.insertId });
        }
    } catch (error) {
        // Si el INSERT falló después de crear la carpeta, la quitamos para no dejar basura
        if (carpetaCreada) {
            try {
                const entradas = await fsp.readdir(carpetaCreada);
                if (entradas.length === 0) await fsp.rmdir(carpetaCreada);
            } catch (limpiezaError) {
                console.error('[PRODUCTOS] No se pudo limpiar la carpeta tras el fallo:', limpiezaError.message);
            }
        }

        console.error('[PRODUCTOS] Error en createProducto:', error);
        res.status(500).json({
            success: false,
            message: 'Error al crear el producto',
            detalle: error.message
        });
    }
};

/**
 * PUT /mapa/v1/admin/productos/:id
 * Actualiza los campos del registro. La carpeta NO se renombra salvo que se
 * envíe renombrar_carpeta=true, para no mover gigabytes por un cambio de título.
 */
exports.updateProducto = async (req, res) => {
    try {
        const proId = Number(req.params.id);
        if (!Number.isInteger(proId) || proId <= 0) {
            return res.status(400).json({ success: false, message: 'ID de producto inválido' });
        }

        const producto = await obtenerProducto(req.db, proId);
        if (!producto) {
            return res.status(404).json({ success: false, message: 'Producto no encontrado' });
        }

        const { errores, datos } = validarCampos(req.body, false);
        if (errores.length > 0) {
            return res.status(400).json({ success: false, message: 'Datos inválidos', errores });
        }

        if (datos.PRO_SEM_ID) {
            const semestre = await query(req.db, 'SELECT SEM_ID FROM MET_SEMESTRE WHERE SEM_ID = ?', [datos.PRO_SEM_ID]);
            if (!semestre || semestre.length === 0) {
                return res.status(400).json({ success: false, message: `El semestre ${datos.PRO_SEM_ID} no existe` });
            }
        }

        const renombrar = req.body.renombrar_carpeta === true || req.body.renombrar_carpeta === 'true';
        let proFilesNuevo = producto.PRO_FILES;
        let proImagenNuevo;

        if (renombrar) {
            const nombreParaSlug = req.body.carpeta || datos.PRO_NOMBRE || producto.PRO_NOMBRE;
            const slugBase = slugify(nombreParaSlug);
            if (!slugBase) {
                return res.status(400).json({ success: false, message: 'No se pudo generar un nombre de carpeta válido' });
            }

            const carpetaActualAbs = carpetaProductoAbs(producto.PRO_FILES);
            const slugActual = carpetaActualAbs ? path.basename(carpetaActualAbs) : null;

            if (slugBase !== slugActual) {
                const slug = await slugDisponible(slugBase);
                const destinoAbs = resolverDentro(PRODUCTOS_ROOT_ABS, slug);
                if (!destinoAbs) {
                    return res.status(400).json({ success: false, message: 'Nombre de carpeta inválido' });
                }

                if (carpetaActualAbs && fs.existsSync(carpetaActualAbs)) {
                    await fsp.rename(carpetaActualAbs, destinoAbs);
                } else {
                    await fsp.mkdir(destinoAbs, { recursive: true });
                }

                proFilesNuevo = rutaWebProducto(slug);

                // La portada vive dentro de la carpeta: actualizamos su prefijo
                if (producto.PRO_IMAGEN && producto.PRO_IMAGEN.startsWith(`${producto.PRO_FILES}/`)) {
                    proImagenNuevo = producto.PRO_IMAGEN.replace(producto.PRO_FILES, proFilesNuevo);
                }
            }
        }

        const campos = [];
        const params = [];
        const cambiados = [];

        // Solo se escribe (y se versiona) lo que de verdad cambió: abrir el
        // formulario y guardar sin tocar nada no debe subir la versión.
        const asignarSiCambia = (columna, valorNuevo, valorActual) => {
            const iguales = (valorNuevo ?? '') === (valorActual ?? '');
            if (iguales) return;

            campos.push(`${columna} = ?`);
            params.push(valorNuevo);
            cambiados.push(columna);
        };

        if ('PRO_NOMBRE' in datos) asignarSiCambia('PRO_NOMBRE', datos.PRO_NOMBRE, producto.PRO_NOMBRE);
        if ('PRO_NOMBRE_DETALLADO' in datos) asignarSiCambia('PRO_NOMBRE_DETALLADO', datos.PRO_NOMBRE_DETALLADO || null, producto.PRO_NOMBRE_DETALLADO);
        if ('PRO_DESCRIPCION' in datos) asignarSiCambia('PRO_DESCRIPCION', datos.PRO_DESCRIPCION || null, producto.PRO_DESCRIPCION);
        if ('PRO_SEM_ID' in datos) asignarSiCambia('PRO_SEM_ID', datos.PRO_SEM_ID ?? null, producto.PRO_SEM_ID);
        if ('PRO_EXE' in datos) asignarSiCambia('PRO_EXE', datos.PRO_EXE || null, producto.PRO_EXE);
        if ('PRO_TIPO' in datos) asignarSiCambia('PRO_TIPO', datos.PRO_TIPO || null, producto.PRO_TIPO);
        if (proFilesNuevo !== producto.PRO_FILES) asignarSiCambia('PRO_FILES', proFilesNuevo, producto.PRO_FILES);
        if (proImagenNuevo !== undefined) asignarSiCambia('PRO_IMAGEN', proImagenNuevo, producto.PRO_IMAGEN);

        // PRO_VERSION la maneja el servidor: se ignora lo que mande el cliente
        // y se suma uno por cada edición con cambios reales.
        if (cambiados.length === 0) {
            return res.status(200).json({
                success: true,
                sin_cambios: true,
                message: 'No hubo cambios que guardar, la versión se mantiene',
                data: producto
            });
        }

        campos.push('PRO_VERSION = COALESCE(PRO_VERSION, 0) + 1');

        await query(req.db, `UPDATE MET_PRODUCTOS SET ${campos.join(', ')} WHERE PRO_ID = ?`, [...params, proId]);

        const actualizado = await obtenerProducto(req.db, proId);

        res.status(200).json({
            success: true,
            sin_cambios: false,
            message: `Producto actualizado correctamente. Versión ${actualizado.PRO_VERSION}`,
            campos_cambiados: cambiados,
            PRO_VERSION: actualizado.PRO_VERSION,
            data: actualizado
        });

        if (req.io) {
            req.io.to('global-room').emit('productos-update', { operation: 'update', PRO_ID: proId });
        }
    } catch (error) {
        console.error('[PRODUCTOS] Error en updateProducto:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar el producto',
            detalle: error.message
        });
    }
};

/**
 * DELETE /mapa/v1/admin/productos/:id
 * Elimina el registro. La carpeta con los archivos se borra solo si se envía
 * ?borrar_archivos=true, porque son datos pesados e irrecuperables.
 */
exports.deleteProducto = async (req, res) => {
    try {
        const proId = Number(req.params.id);
        if (!Number.isInteger(proId) || proId <= 0) {
            return res.status(400).json({ success: false, message: 'ID de producto inválido' });
        }

        const producto = await obtenerProducto(req.db, proId);
        if (!producto) {
            return res.status(404).json({ success: false, message: 'Producto no encontrado' });
        }

        // Un producto con licencias emitidas no se elimina: esas licencias ya
        // salieron al mundo dando acceso a este producto y borrarlo dejaría a los
        // usuarios con una licencia que apunta a algo que ya no existe.
        // Editarlo sí se permite: cambiar su nombre o sus archivos no rompe nada.
        const { licencias, paquetes } = await licenciasDeProducto(req.db, proId);

        if (licencias > 0) {
            return res.status(409).json({
                success: false,
                bloqueado: true,
                message:
                    `No se puede eliminar: el producto tiene ${licencias} licencia${licencias !== 1 ? 's' : ''} ` +
                    `asociada${licencias !== 1 ? 's' : ''} a través ${paquetes.length === 1 ? 'del paquete' : 'de los paquetes'} ` +
                    paquetes.map((p) => `«${p}»`).join(', '),
                data: {
                    PRO_ID: proId,
                    total_licencias: licencias,
                    paquetes
                }
            });
        }

        const borrarArchivos = req.query.borrar_archivos === 'true';
        const carpetaAbs = carpetaProductoAbs(producto.PRO_FILES);
        let carpetaEliminada = false;

        if (borrarArchivos) {
            if (!carpetaAbs) {
                return res.status(400).json({
                    success: false,
                    message: 'La ruta de la carpeta del producto no es válida, no se eliminó nada',
                    detalle: `PRO_FILES = ${producto.PRO_FILES}`
                });
            }

            if (fs.existsSync(carpetaAbs)) {
                await fsp.rm(carpetaAbs, { recursive: true, force: true });
                carpetaEliminada = true;
            }
        }

        await query(req.db, 'DELETE FROM MET_PRODUCTOS WHERE PRO_ID = ?', [proId]);

        res.status(200).json({
            success: true,
            message: borrarArchivos
                ? 'Producto y archivos eliminados correctamente'
                : 'Producto eliminado. La carpeta con los archivos se conservó en el servidor.',
            data: {
                PRO_ID: proId,
                carpeta: producto.PRO_FILES,
                carpeta_eliminada: carpetaEliminada
            }
        });

        if (req.io) {
            req.io.to('global-room').emit('productos-update', { operation: 'delete', PRO_ID: proId });
        }
    } catch (error) {
        console.error('[PRODUCTOS] Error en deleteProducto:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar el producto',
            detalle: error.message
        });
    }
};

/**
 * GET /mapa/v1/admin/productos/catalogos/tipos
 * Tipos de producto válidos, para que el formulario no los tenga codificados.
 */
exports.getTiposProducto = (req, res) => {
    res.status(200).json({ success: true, data: TIPOS_PRODUCTO });
};

exports.obtenerProducto = obtenerProducto;
exports.incrementarVersion = incrementarVersion;
exports.TIPOS_PRODUCTO = TIPOS_PRODUCTO;
exports.query = query;
