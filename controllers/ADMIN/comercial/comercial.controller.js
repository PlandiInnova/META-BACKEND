/**
 * Controlador de la sección COMERCIAL del admin (solo lectura).
 *
 * Expone las tablas de ventas, paquetes, licencias, pedidos y concentrado tal
 * como están en la base, con los datos relacionados ya resueltos (quién lo creó,
 * a qué materia pertenece la licencia, etc.) para que el front solo pinte.
 *
 * Ninguno de estos endpoints escribe: las altas se definirán cuando se acuerden
 * las reglas de negocio de ventas y paquetes.
 */

/**
 * Ejecuta una consulta devolviendo una promesa, usando el pool de req.db.
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

/**
 * Responde una consulta de listado con el formato estándar del módulo.
 * @param {object} req
 * @param {object} res
 * @param {string} etiqueta - nombre para los logs
 * @param {string} sql
 */
async function responderListado(req, res, etiqueta, sql) {
    try {
        const filas = await query(req.db, sql);
        res.status(200).json({
            success: true,
            total: Array.isArray(filas) ? filas.length : 0,
            data: filas || []
        });
    } catch (error) {
        console.error(`[COMERCIAL] Error al listar ${etiqueta}:`, error);
        res.status(500).json({
            success: false,
            message: `Error al listar ${etiqueta}`,
            detalle: error.message
        });
    }
}

/**
 * GET /mapa/v1/admin/comercial/ventas
 * MET_VENTA con el usuario que la registró y cuántas licencias tiene ligadas.
 */
exports.getVentas = (req, res) => responderListado(req, res, 'ventas', `
    SELECT
        v.VEN_ID,
        v.VEN_TIPO,
        v.VEN_FECHA_REGISTRO,
        v.VEN_UAD_ID,
        ua.USU_USUARIO AS CREADO_POR,
        (SELECT COUNT(*) FROM MET_LICENCIA l WHERE l.LIC_VEN_ID = v.VEN_ID) AS TOTAL_LICENCIAS
    FROM MET_VENTA v
    LEFT JOIN MET_USUARIO_ADMIN ua ON ua.USU_ID = v.VEN_UAD_ID
    ORDER BY v.VEN_FECHA_REGISTRO DESC, v.VEN_ID DESC
`);

/**
 * POST /mapa/v1/admin/comercial/ventas
 * Registra una venta. Solo se captura el tipo: la fecha la pone el servidor al
 * momento de crearla y el usuario sale de quien está en sesión.
 *
 * Body: { VEN_TIPO, usuario_id? }
 */
exports.createVenta = async (req, res) => {
    try {
        const tipoCrudo = req.body.VEN_TIPO ?? req.body.tipo;
        const tipo = tipoCrudo === undefined || tipoCrudo === null ? '' : String(tipoCrudo).trim();

        if (!tipo) {
            return res.status(400).json({
                success: false,
                message: 'El tipo de venta es obligatorio'
            });
        }

        if (tipo.length > 100) {
            return res.status(400).json({
                success: false,
                message: `El tipo de venta excede 100 caracteres (recibidos ${tipo.length})`
            });
        }

        // El usuario que registra es opcional: si no llega o no existe, queda en null
        let usuarioId = null;
        const usuarioCrudo = req.body.usuario_id ?? req.body.VEN_UAD_ID;

        if (usuarioCrudo !== undefined && usuarioCrudo !== null && usuarioCrudo !== '') {
            const candidato = Number(usuarioCrudo);
            if (!Number.isInteger(candidato) || candidato <= 0) {
                return res.status(400).json({ success: false, message: 'usuario_id inválido' });
            }

            const existe = await query(req.db, 'SELECT USU_ID FROM MET_USUARIO_ADMIN WHERE USU_ID = ?', [candidato]);
            if (existe && existe.length > 0) usuarioId = candidato;
        }

        // VEN_FECHA_REGISTRO es DATE: se sella con la fecha del servidor
        const result = await query(
            req.db,
            'INSERT INTO MET_VENTA (VEN_TIPO, VEN_FECHA_REGISTRO, VEN_UAD_ID) VALUES (?, CURDATE(), ?)',
            [tipo, usuarioId]
        );

        const creada = await query(req.db, `
            SELECT
                v.VEN_ID,
                v.VEN_TIPO,
                v.VEN_FECHA_REGISTRO,
                v.VEN_UAD_ID,
                ua.USU_USUARIO AS CREADO_POR,
                0 AS TOTAL_LICENCIAS
            FROM MET_VENTA v
            LEFT JOIN MET_USUARIO_ADMIN ua ON ua.USU_ID = v.VEN_UAD_ID
            WHERE v.VEN_ID = ?
        `, [result.insertId]);

        console.log(`[COMERCIAL] Venta registrada ${result.insertId}: ${tipo}`);

        res.status(201).json({
            success: true,
            message: 'Venta registrada correctamente',
            data: (creada && creada[0]) || { VEN_ID: result.insertId, VEN_TIPO: tipo }
        });

        if (req.io) {
            req.io.to('global-room').emit('comercial-update', {
                operation: 'insert',
                seccion: 'ventas',
                VEN_ID: result.insertId
            });
        }
    } catch (error) {
        console.error('[COMERCIAL] Error al registrar la venta:', error);
        res.status(500).json({
            success: false,
            message: 'Error al registrar la venta',
            detalle: error.message
        });
    }
};

/**
 * Cuenta qué cuelga de una venta. Con licencias emitidas la venta ya no se puede
 * eliminar, aunque sí editar.
 *
 * También se revisa el concentrado: aunque la regla de negocio habla de
 * licencias, MET_CONCENTRADO tiene una llave foránea a la venta y un borrado
 * fallaría a nivel de base con un error poco claro.
 *
 * @param {object} db
 * @param {number} venId
 * @returns {Promise<{licencias: number, concentrado: number}>}
 */
async function referenciasDeVenta(db, venId) {
    const filas = await query(db, `
        SELECT
            (SELECT COUNT(*) FROM MET_LICENCIA WHERE LIC_VEN_ID = ?)    AS licencias,
            (SELECT COUNT(*) FROM MET_CONCENTRADO WHERE CON_VEN_ID = ?) AS concentrado
    `, [venId, venId]);

    const fila = (filas && filas[0]) || {};
    return {
        licencias: Number(fila.licencias) || 0,
        concentrado: Number(fila.concentrado) || 0
    };
}

/**
 * Busca la venta y comprueba que exista. No mira lo que cuelga de ella: editar
 * está permitido siempre, incluso con licencias emitidas, porque corregir el
 * tipo de una venta no invalida nada de lo ya generado.
 *
 * @param {object} req
 * @param {object} res
 * @returns {Promise<{venId: number, venta: object}|null>} null si ya se respondió
 */
async function obtenerVentaEditable(req, res) {
    const venId = Number(req.params.id);
    if (!Number.isInteger(venId) || venId <= 0) {
        res.status(400).json({ success: false, message: 'ID de venta inválido' });
        return null;
    }

    const filas = await query(req.db, 'SELECT * FROM MET_VENTA WHERE VEN_ID = ?', [venId]);
    const venta = filas && filas[0];

    if (!venta) {
        res.status(404).json({ success: false, message: 'La venta no existe' });
        return null;
    }

    return { venId, venta };
}

/**
 * Lo mismo, pero además exige que nada cuelgue de la venta.
 * Eliminarla sí es destructivo: las licencias emitidas quedarían apuntando a una
 * venta que ya no existe, y el concentrado tiene una llave foránea que lo impide.
 *
 * @param {object} req
 * @param {object} res
 * @returns {Promise<{venId: number, venta: object}|null>} null si ya se respondió
 */
async function obtenerVentaEliminable(req, res) {
    const contexto = await obtenerVentaEditable(req, res);
    if (!contexto) return null;

    const refs = await referenciasDeVenta(req.db, contexto.venId);

    if (refs.licencias > 0) {
        res.status(409).json({
            success: false,
            bloqueada: true,
            message: `No se puede eliminar: la venta ya tiene ${refs.licencias} licencia${refs.licencias !== 1 ? 's' : ''} asociada${refs.licencias !== 1 ? 's' : ''}. Sí puedes editarla.`,
            data: { VEN_ID: contexto.venId, total_licencias: refs.licencias }
        });
        return null;
    }

    if (refs.concentrado > 0) {
        res.status(409).json({
            success: false,
            bloqueada: true,
            message: 'No se puede eliminar: la venta está incluida en el concentrado. Sí puedes editarla.',
            data: { VEN_ID: contexto.venId, total_concentrado: refs.concentrado }
        });
        return null;
    }

    return contexto;
}

/**
 * PUT /mapa/v1/admin/comercial/ventas/:id
 * Cambia el tipo de una venta que todavía no tiene licencias.
 * La fecha y el usuario del registro original no se tocan.
 */
exports.updateVenta = async (req, res) => {
    try {
        const contexto = await obtenerVentaEditable(req, res);
        if (!contexto) return;

        const tipoCrudo = req.body.VEN_TIPO ?? req.body.tipo;
        const tipo = tipoCrudo === undefined || tipoCrudo === null ? '' : String(tipoCrudo).trim();

        if (!tipo) {
            return res.status(400).json({ success: false, message: 'El tipo de venta es obligatorio' });
        }

        if (tipo.length > 100) {
            return res.status(400).json({
                success: false,
                message: `El tipo de venta excede 100 caracteres (recibidos ${tipo.length})`
            });
        }

        if (tipo === contexto.venta.VEN_TIPO) {
            return res.status(200).json({
                success: true,
                sin_cambios: true,
                message: 'No hubo cambios que guardar',
                data: contexto.venta
            });
        }

        await query(req.db, 'UPDATE MET_VENTA SET VEN_TIPO = ? WHERE VEN_ID = ?', [tipo, contexto.venId]);

        const actualizada = await query(req.db, `
            SELECT
                v.VEN_ID, v.VEN_TIPO, v.VEN_FECHA_REGISTRO, v.VEN_UAD_ID,
                ua.USU_USUARIO AS CREADO_POR,
                0 AS TOTAL_LICENCIAS
            FROM MET_VENTA v
            LEFT JOIN MET_USUARIO_ADMIN ua ON ua.USU_ID = v.VEN_UAD_ID
            WHERE v.VEN_ID = ?
        `, [contexto.venId]);

        console.log(`[COMERCIAL] Venta ${contexto.venId} actualizada: ${tipo}`);

        res.status(200).json({
            success: true,
            sin_cambios: false,
            message: 'Venta actualizada correctamente',
            data: (actualizada && actualizada[0]) || null
        });

        if (req.io) {
            req.io.to('global-room').emit('comercial-update', {
                operation: 'update',
                seccion: 'ventas',
                VEN_ID: contexto.venId
            });
        }
    } catch (error) {
        console.error('[COMERCIAL] Error al actualizar la venta:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar la venta',
            detalle: error.message
        });
    }
};

/**
 * DELETE /mapa/v1/admin/comercial/ventas/:id
 * Elimina una venta que todavía no tiene licencias ni concentrado.
 */
exports.deleteVenta = async (req, res) => {
    try {
        const contexto = await obtenerVentaEliminable(req, res);
        if (!contexto) return;

        await query(req.db, 'DELETE FROM MET_VENTA WHERE VEN_ID = ?', [contexto.venId]);

        console.log(`[COMERCIAL] Venta ${contexto.venId} eliminada`);

        res.status(200).json({
            success: true,
            message: 'Venta eliminada correctamente',
            data: { VEN_ID: contexto.venId, VEN_TIPO: contexto.venta.VEN_TIPO }
        });

        if (req.io) {
            req.io.to('global-room').emit('comercial-update', {
                operation: 'delete',
                seccion: 'ventas',
                VEN_ID: contexto.venId
            });
        }
    } catch (error) {
        console.error('[COMERCIAL] Error al eliminar la venta:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar la venta',
            detalle: error.message
        });
    }
};

// ==========================================================================
// PAQUETES
//
// Un paquete agrupa varios productos. La lista de productos vive en
// PAQ_PRODUCTOS (longtext) como un arreglo JSON de PRO_ID, por ejemplo [5,27].
// Se guardan solo los ids, no los nombres: así el paquete nunca queda con un
// nombre viejo si el producto se renombra. Los nombres se resuelven al leer.
// ==========================================================================

/**
 * Interpreta el contenido de PAQ_PRODUCTOS.
 * Tolera valores que no sean JSON para no romper con datos capturados a mano.
 *
 * @param {string} valor
 * @returns {{ids: number[], crudo: string|null}}
 */
function parsearProductosPaquete(valor) {
    if (valor === null || valor === undefined || String(valor).trim() === '') {
        return { ids: [], crudo: null };
    }

    try {
        const parsed = JSON.parse(valor);
        if (Array.isArray(parsed)) {
            const ids = parsed
                .map((x) => Number(typeof x === 'object' && x !== null ? x.PRO_ID ?? x.id : x))
                .filter((n) => Number.isInteger(n) && n > 0);
            return { ids, crudo: null };
        }
    } catch (error) {
        // No era JSON: se conserva el texto tal cual para no perder información
    }

    return { ids: [], crudo: String(valor) };
}

/**
 * GET /mapa/v1/admin/comercial/paquetes
 * MET_PAQUETE con su creador, las licencias que lo referencian y los productos
 * que agrupa, ya resueltos a nombre.
 */
exports.getPaquetes = async (req, res) => {
    try {
        const paquetes = await query(req.db, `
            SELECT
                p.PAQ_ID,
                p.PAQ_NOMBRE,
                p.PAQ_DESCRIPCION,
                p.PAQ_PRODUCTOS,
                p.PAQ_FECHA_REGISTRO,
                p.PAQ_UAD_ID,
                ua.USU_USUARIO AS CREADO_POR,
                (SELECT COUNT(*) FROM MET_LICENCIA l WHERE l.LIC_PAQ_ID = p.PAQ_ID) AS TOTAL_LICENCIAS
            FROM MET_PAQUETE p
            LEFT JOIN MET_USUARIO_ADMIN ua ON ua.USU_ID = p.PAQ_UAD_ID
            ORDER BY p.PAQ_FECHA_REGISTRO DESC, p.PAQ_ID DESC
        `);

        const lista = paquetes || [];
        const desglose = lista.map((p) => parsearProductosPaquete(p.PAQ_PRODUCTOS));

        // Una sola consulta para todos los productos de todos los paquetes
        const todosLosIds = [...new Set(desglose.flatMap((d) => d.ids))];
        let porId = new Map();

        if (todosLosIds.length > 0) {
            const productos = await query(
                req.db,
                `SELECT PRO_ID, PRO_NOMBRE, PRO_TIPO, PRO_VERSION FROM MET_PRODUCTOS WHERE PRO_ID IN (${todosLosIds.map(() => '?').join(',')})`,
                todosLosIds
            );
            porId = new Map((productos || []).map((x) => [x.PRO_ID, x]));
        }

        const data = lista.map((paquete, i) => {
            const { ids, crudo } = desglose[i];

            const productos = ids.map((id) => {
                const encontrado = porId.get(id);
                return encontrado
                    ? {
                        PRO_ID: id,
                        PRO_NOMBRE: encontrado.PRO_NOMBRE,
                        PRO_TIPO: encontrado.PRO_TIPO,
                        PRO_VERSION: encontrado.PRO_VERSION,
                        existe: true
                    }
                    // El producto fue eliminado después de armar el paquete
                    : { PRO_ID: id, PRO_NOMBRE: `Producto ${id} (eliminado)`, PRO_TIPO: null, PRO_VERSION: null, existe: false };
            });

            return {
                ...paquete,
                productos,
                productos_ids: ids,
                total_productos: productos.length,
                productos_faltantes: productos.filter((x) => !x.existe).length,
                // Solo se llena si el contenido no era una lista JSON
                productos_texto: crudo
            };
        });

        res.status(200).json({ success: true, total: data.length, data });
    } catch (error) {
        console.error('[COMERCIAL] Error al listar paquetes:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar paquetes',
            detalle: error.message
        });
    }
};

/**
 * Valida y normaliza los campos de un paquete.
 * @param {object} body
 * @param {boolean} esCreacion
 * @returns {{errores: string[], datos: object}}
 */
function validarPaquete(body, esCreacion) {
    const errores = [];
    const datos = {};

    const nombre = body.PAQ_NOMBRE === undefined || body.PAQ_NOMBRE === null ? undefined : String(body.PAQ_NOMBRE).trim();

    if (esCreacion && !nombre) {
        errores.push('El nombre del paquete es obligatorio');
    } else if (nombre !== undefined) {
        if (!nombre) errores.push('El nombre del paquete no puede quedar vacío');
        else if (nombre.length > 100) errores.push(`El nombre excede 100 caracteres (recibidos ${nombre.length})`);
        else datos.PAQ_NOMBRE = nombre;
    }

    if (body.PAQ_DESCRIPCION !== undefined) {
        const descripcion = body.PAQ_DESCRIPCION === null ? '' : String(body.PAQ_DESCRIPCION).trim();
        // La columna es varchar(100): se avisa en vez de truncar en silencio
        if (descripcion.length > 100) errores.push(`La descripción excede 100 caracteres (recibidos ${descripcion.length})`);
        else datos.PAQ_DESCRIPCION = descripcion || null;
    }

    if (body.productos !== undefined || body.PAQ_PRODUCTOS !== undefined) {
        const crudo = body.productos ?? body.PAQ_PRODUCTOS;

        if (!Array.isArray(crudo)) {
            errores.push('productos debe ser una lista de ids de producto');
        } else {
            const ids = [];
            for (const item of crudo) {
                const id = Number(typeof item === 'object' && item !== null ? item.PRO_ID ?? item.id : item);
                if (!Number.isInteger(id) || id <= 0) {
                    errores.push(`Id de producto inválido: ${JSON.stringify(item)}`);
                    break;
                }
                if (!ids.includes(id)) ids.push(id);
            }
            datos.productos = ids;
        }
    }

    return { errores, datos };
}

/**
 * Comprueba que todos los productos existan.
 * @returns {Promise<number[]>} ids que no existen
 */
async function productosInexistentes(db, ids) {
    if (!ids || ids.length === 0) return [];

    const filas = await query(
        db,
        `SELECT PRO_ID FROM MET_PRODUCTOS WHERE PRO_ID IN (${ids.map(() => '?').join(',')})`,
        ids
    );

    const existentes = new Set((filas || []).map((f) => f.PRO_ID));
    return ids.filter((id) => !existentes.has(id));
}

/**
 * Devuelve un paquete ya enriquecido, reutilizando la lógica del listado.
 */
async function obtenerPaquete(db, paqId) {
    const filas = await query(db, `
        SELECT
            p.PAQ_ID, p.PAQ_NOMBRE, p.PAQ_DESCRIPCION, p.PAQ_PRODUCTOS,
            p.PAQ_FECHA_REGISTRO, p.PAQ_UAD_ID,
            ua.USU_USUARIO AS CREADO_POR,
            (SELECT COUNT(*) FROM MET_LICENCIA l WHERE l.LIC_PAQ_ID = p.PAQ_ID) AS TOTAL_LICENCIAS
        FROM MET_PAQUETE p
        LEFT JOIN MET_USUARIO_ADMIN ua ON ua.USU_ID = p.PAQ_UAD_ID
        WHERE p.PAQ_ID = ?
    `, [paqId]);

    const paquete = filas && filas[0];
    if (!paquete) return null;

    const { ids } = parsearProductosPaquete(paquete.PAQ_PRODUCTOS);
    let productos = [];

    if (ids.length > 0) {
        const encontrados = await query(
            db,
            `SELECT PRO_ID, PRO_NOMBRE, PRO_TIPO, PRO_VERSION FROM MET_PRODUCTOS WHERE PRO_ID IN (${ids.map(() => '?').join(',')})`,
            ids
        );
        const porId = new Map((encontrados || []).map((x) => [x.PRO_ID, x]));
        productos = ids.map((id) => {
            const p = porId.get(id);
            return p
                ? { PRO_ID: id, PRO_NOMBRE: p.PRO_NOMBRE, PRO_TIPO: p.PRO_TIPO, PRO_VERSION: p.PRO_VERSION, existe: true }
                : { PRO_ID: id, PRO_NOMBRE: `Producto ${id} (eliminado)`, PRO_TIPO: null, PRO_VERSION: null, existe: false };
        });
    }

    return { ...paquete, productos, productos_ids: ids, total_productos: productos.length };
}

/**
 * POST /mapa/v1/admin/comercial/paquetes
 * Body: { PAQ_NOMBRE, PAQ_DESCRIPCION?, productos: [PRO_ID...], usuario_id? }
 * La fecha la sella el servidor al crear.
 */
exports.createPaquete = async (req, res) => {
    try {
        const { errores, datos } = validarPaquete(req.body, true);
        if (errores.length > 0) {
            return res.status(400).json({ success: false, message: 'Datos inválidos', errores });
        }

        const ids = datos.productos || [];
        const faltantes = await productosInexistentes(req.db, ids);
        if (faltantes.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Estos productos no existen: ${faltantes.join(', ')}`
            });
        }

        let usuarioId = null;
        const usuarioCrudo = req.body.usuario_id ?? req.body.PAQ_UAD_ID;
        if (usuarioCrudo !== undefined && usuarioCrudo !== null && usuarioCrudo !== '') {
            const candidato = Number(usuarioCrudo);
            if (!Number.isInteger(candidato) || candidato <= 0) {
                return res.status(400).json({ success: false, message: 'usuario_id inválido' });
            }
            const existe = await query(req.db, 'SELECT USU_ID FROM MET_USUARIO_ADMIN WHERE USU_ID = ?', [candidato]);
            if (existe && existe.length > 0) usuarioId = candidato;
        }

        const result = await query(
            req.db,
            `INSERT INTO MET_PAQUETE (PAQ_NOMBRE, PAQ_DESCRIPCION, PAQ_PRODUCTOS, PAQ_FECHA_REGISTRO, PAQ_UAD_ID)
             VALUES (?, ?, ?, CURDATE(), ?)`,
            [datos.PAQ_NOMBRE, datos.PAQ_DESCRIPCION || null, JSON.stringify(ids), usuarioId]
        );

        const creado = await obtenerPaquete(req.db, result.insertId);
        console.log(`[COMERCIAL] Paquete registrado ${result.insertId}: ${datos.PAQ_NOMBRE} (${ids.length} producto(s))`);

        res.status(201).json({
            success: true,
            message: 'Paquete registrado correctamente',
            data: creado
        });

        if (req.io) {
            req.io.to('global-room').emit('comercial-update', {
                operation: 'insert',
                seccion: 'paquetes',
                PAQ_ID: result.insertId
            });
        }
    } catch (error) {
        console.error('[COMERCIAL] Error al registrar el paquete:', error);
        res.status(500).json({
            success: false,
            message: 'Error al registrar el paquete',
            detalle: error.message
        });
    }
};

/**
 * Busca el paquete y comprueba que exista. Editar está permitido siempre, misma
 * regla que las ventas y los productos.
 *
 * @returns {Promise<{paqId: number, paquete: object}|null>} null si ya se respondió
 */
async function obtenerPaqueteEditable(req, res) {
    const paqId = Number(req.params.id);
    if (!Number.isInteger(paqId) || paqId <= 0) {
        res.status(400).json({ success: false, message: 'ID de paquete inválido' });
        return null;
    }

    const filas = await query(req.db, 'SELECT * FROM MET_PAQUETE WHERE PAQ_ID = ?', [paqId]);
    const paquete = filas && filas[0];

    if (!paquete) {
        res.status(404).json({ success: false, message: 'El paquete no existe' });
        return null;
    }

    return { paqId, paquete };
}

/**
 * Lo mismo, pero además exige que no tenga licencias emitidas: esas licencias dan
 * acceso a los productos del paquete y borrarlo las dejaría apuntando al vacío.
 *
 * @returns {Promise<{paqId: number, paquete: object}|null>} null si ya se respondió
 */
async function obtenerPaqueteEliminable(req, res) {
    const contexto = await obtenerPaqueteEditable(req, res);
    if (!contexto) return null;

    const conteo = await query(
        req.db,
        'SELECT COUNT(*) AS n FROM MET_LICENCIA WHERE LIC_PAQ_ID = ?',
        [contexto.paqId]
    );
    const licencias = Number(conteo && conteo[0] ? conteo[0].n : 0);

    if (licencias > 0) {
        res.status(409).json({
            success: false,
            bloqueado: true,
            message: `No se puede eliminar: el paquete ya tiene ${licencias} licencia${licencias !== 1 ? 's' : ''} asociada${licencias !== 1 ? 's' : ''}. Sí puedes editarlo.`,
            data: { PAQ_ID: contexto.paqId, total_licencias: licencias }
        });
        return null;
    }

    return contexto;
}

/**
 * PUT /mapa/v1/admin/comercial/paquetes/:id
 * Cambia nombre, descripción o productos de un paquete sin licencias.
 */
exports.updatePaquete = async (req, res) => {
    try {
        const contexto = await obtenerPaqueteEditable(req, res);
        if (!contexto) return;

        const { errores, datos } = validarPaquete(req.body, false);
        if (errores.length > 0) {
            return res.status(400).json({ success: false, message: 'Datos inválidos', errores });
        }

        if (datos.productos) {
            const faltantes = await productosInexistentes(req.db, datos.productos);
            if (faltantes.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Estos productos no existen: ${faltantes.join(', ')}`
                });
            }
        }

        const campos = [];
        const params = [];

        if ('PAQ_NOMBRE' in datos && datos.PAQ_NOMBRE !== contexto.paquete.PAQ_NOMBRE) {
            campos.push('PAQ_NOMBRE = ?');
            params.push(datos.PAQ_NOMBRE);
        }

        if ('PAQ_DESCRIPCION' in datos && (datos.PAQ_DESCRIPCION ?? '') !== (contexto.paquete.PAQ_DESCRIPCION ?? '')) {
            campos.push('PAQ_DESCRIPCION = ?');
            params.push(datos.PAQ_DESCRIPCION);
        }

        if (datos.productos) {
            const actuales = parsearProductosPaquete(contexto.paquete.PAQ_PRODUCTOS).ids;
            const cambiaron = actuales.length !== datos.productos.length
                || actuales.some((id, i) => id !== datos.productos[i]);

            if (cambiaron) {
                campos.push('PAQ_PRODUCTOS = ?');
                params.push(JSON.stringify(datos.productos));
            }
        }

        if (campos.length === 0) {
            const sinCambios = await obtenerPaquete(req.db, contexto.paqId);
            return res.status(200).json({
                success: true,
                sin_cambios: true,
                message: 'No hubo cambios que guardar',
                data: sinCambios
            });
        }

        await query(req.db, `UPDATE MET_PAQUETE SET ${campos.join(', ')} WHERE PAQ_ID = ?`, [...params, contexto.paqId]);

        const actualizado = await obtenerPaquete(req.db, contexto.paqId);
        console.log(`[COMERCIAL] Paquete ${contexto.paqId} actualizado`);

        res.status(200).json({
            success: true,
            sin_cambios: false,
            message: 'Paquete actualizado correctamente',
            data: actualizado
        });

        if (req.io) {
            req.io.to('global-room').emit('comercial-update', {
                operation: 'update',
                seccion: 'paquetes',
                PAQ_ID: contexto.paqId
            });
        }
    } catch (error) {
        console.error('[COMERCIAL] Error al actualizar el paquete:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar el paquete',
            detalle: error.message
        });
    }
};

/**
 * DELETE /mapa/v1/admin/comercial/paquetes/:id
 * Elimina un paquete que todavía no tiene licencias.
 */
exports.deletePaquete = async (req, res) => {
    try {
        const contexto = await obtenerPaqueteEliminable(req, res);
        if (!contexto) return;

        await query(req.db, 'DELETE FROM MET_PAQUETE WHERE PAQ_ID = ?', [contexto.paqId]);
        console.log(`[COMERCIAL] Paquete ${contexto.paqId} eliminado`);

        res.status(200).json({
            success: true,
            message: 'Paquete eliminado correctamente',
            data: { PAQ_ID: contexto.paqId, PAQ_NOMBRE: contexto.paquete.PAQ_NOMBRE }
        });

        if (req.io) {
            req.io.to('global-room').emit('comercial-update', {
                operation: 'delete',
                seccion: 'paquetes',
                PAQ_ID: contexto.paqId
            });
        }
    } catch (error) {
        console.error('[COMERCIAL] Error al eliminar el paquete:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar el paquete',
            detalle: error.message
        });
    }
};

/**
 * GET /mapa/v1/admin/comercial/productos-disponibles
 * Catálogo mínimo de productos para armar paquetes.
 */
exports.getProductosDisponibles = (req, res) => responderListado(req, res, 'productos disponibles', `
    SELECT
        p.PRO_ID,
        p.PRO_NOMBRE,
        p.PRO_NOMBRE_DETALLADO,
        p.PRO_TIPO,
        p.PRO_VERSION,
        sem.SEM_NUMERO,
        sem.SEM_NOMBRE,
        sub.SUB_NOMBRE
    FROM MET_PRODUCTOS p
    LEFT JOIN MET_SEMESTRE sem ON sem.SEM_ID = p.PRO_SEM_ID
    LEFT JOIN MET_SUBSISTEMA sub ON sub.SUB_ID = sem.SEM_SUB_ID
    ORDER BY p.PRO_NOMBRE ASC
`);

/**
 * GET /mapa/v1/admin/comercial/licencias
 * MET_LICENCIA con la materia a la que apunta (y su semestre y subsistema),
 * la venta y el paquete asociados, y cuántos usuarios la tienen activada.
 */
exports.getLicencias = (req, res) => responderListado(req, res, 'licencias', `
    SELECT
        l.LIC_ID,
        l.LIC_LICENCIA,
        l.LIC_INDICIO,
        l.LIC_TIPO,
        l.LIC_STATUS,
        l.LIC_FECHA_CREACION,
        l.LIC_FECHA_INICIO,
        l.LIC_FECHA_FIN,
        l.LIC_TIEMPO,
        l.LIC_NUM_LICENCIAS,
        l.LIC_NUM_CARACTERES,
        l.LIC_MAT_ID,
        l.LIC_VEN_ID,
        l.LIC_PAQ_ID,
        l.LIC_PDD_ID,
        l.LIC_UAD_ID,
        m.MAT_NOMBRE,
        sem.SEM_NUMERO,
        sem.SEM_NOMBRE,
        sub.SUB_NOMBRE,
        v.VEN_TIPO,
        paq.PAQ_NOMBRE,
        ua.USU_USUARIO AS CREADO_POR,
        (SELECT COUNT(*) FROM MET_LICENCIAS_USUARIOS lu WHERE lu.LUS_LIC_ID = l.LIC_ID) AS TOTAL_USUARIOS
    FROM MET_LICENCIA l
    LEFT JOIN MET_MATERIA m ON m.MAT_ID = l.LIC_MAT_ID
    LEFT JOIN MET_SEMESTRE sem ON sem.SEM_ID = m.MAT_SEM_ID
    LEFT JOIN MET_SUBSISTEMA sub ON sub.SUB_ID = sem.SEM_SUB_ID
    LEFT JOIN MET_VENTA v ON v.VEN_ID = l.LIC_VEN_ID
    LEFT JOIN MET_PAQUETE paq ON paq.PAQ_ID = l.LIC_PAQ_ID
    LEFT JOIN MET_USUARIO_ADMIN ua ON ua.USU_ID = l.LIC_UAD_ID
    ORDER BY l.LIC_ID DESC
`);

/**
 * GET /mapa/v1/admin/comercial/pedidos
 * MET_PEDIDO con su creador y las licencias que salieron de ese pedido.
 */
exports.getPedidos = (req, res) => responderListado(req, res, 'pedidos', `
    SELECT
        p.PDD_ID,
        p.PDD_BITACORA,
        p.PDD_SISTEMA,
        p.PDD_SOLICITANTE,
        p.PDD_UAD_ID,
        ua.USU_USUARIO AS CREADO_POR,
        (SELECT COUNT(*) FROM MET_LICENCIA l WHERE l.LIC_PDD_ID = p.PDD_ID) AS TOTAL_LICENCIAS
    FROM MET_PEDIDO p
    LEFT JOIN MET_USUARIO_ADMIN ua ON ua.USU_ID = p.PDD_UAD_ID
    ORDER BY p.PDD_ID DESC
`);

/**
 * GET /mapa/v1/admin/comercial/concentrado
 * MET_CONCENTRADO con el pedido y la venta que relaciona.
 */
exports.getConcentrado = (req, res) => responderListado(req, res, 'concentrado', `
    SELECT
        c.CON_ID,
        c.CON_PDD_ID,
        c.CON_VEN_ID,
        c.CON_CANTIDAD_LICENCIAS,
        pd.PDD_SOLICITANTE,
        pd.PDD_SISTEMA,
        v.VEN_TIPO,
        v.VEN_FECHA_REGISTRO
    FROM MET_CONCENTRADO c
    LEFT JOIN MET_PEDIDO pd ON pd.PDD_ID = c.CON_PDD_ID
    LEFT JOIN MET_VENTA v ON v.VEN_ID = c.CON_VEN_ID
    ORDER BY c.CON_ID DESC
`);

// El formato de PAQ_PRODUCTOS lo define este módulo, así que su lectura se
// expone para que otros no tengan que reimplementarla.
exports.parsearProductosPaquete = parsearProductosPaquete;

/**
 * GET /mapa/v1/admin/comercial/conteos
 * Totales de cada sección, para las insignias de las sub-pestañas.
 */
exports.getConteos = async (req, res) => {
    try {
        const filas = await query(req.db, `
            SELECT
                (SELECT COUNT(*) FROM MET_PRODUCTOS)   AS productos,
                (SELECT COUNT(*) FROM MET_MATERIA)     AS materias,
                (SELECT COUNT(*) FROM MET_VENTA)       AS ventas,
                (SELECT COUNT(*) FROM MET_PAQUETE)     AS paquetes,
                (SELECT COUNT(*) FROM MET_LICENCIA)    AS licencias,
                (SELECT COUNT(*) FROM MET_PEDIDO)      AS pedidos,
                (SELECT COUNT(*) FROM MET_CONCENTRADO) AS concentrado
        `);

        res.status(200).json({
            success: true,
            data: (filas && filas[0]) || {}
        });
    } catch (error) {
        console.error('[COMERCIAL] Error al obtener conteos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener los conteos',
            detalle: error.message
        });
    }
};
