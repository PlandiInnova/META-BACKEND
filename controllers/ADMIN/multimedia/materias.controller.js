// ==========================================================================
// Utilidades de conexión y transacción
// ==========================================================================

function obtenerConexion(pool) {
    return new Promise((resolve, reject) => {
        pool.getConnection((error, conexion) => (error ? reject(error) : resolve(conexion)));
    });
}

function ejecutar(conexion, sql, params = []) {
    return new Promise((resolve, reject) => {
        conexion.query(sql, params, (error, resultados) => (error ? reject(error) : resolve(resultados)));
    });
}

function iniciarTransaccion(conexion) {
    return new Promise((resolve, reject) => {
        conexion.beginTransaction((error) => (error ? reject(error) : resolve()));
    });
}

function confirmar(conexion) {
    return new Promise((resolve, reject) => {
        conexion.commit((error) => (error ? reject(error) : resolve()));
    });
}

function revertir(conexion) {
    return new Promise((resolve) => {
        conexion.rollback(() => resolve());
    });
}

// ==========================================================================
// División de la materia en bloques / unidades
// ==========================================================================

/** Tope de bloques por materia. Más que esto es un dedazo en el formulario. */
const MAX_BLOQUES = 100;

/** Largo util del tipo dentro de MET_BLOQUE.BLQ_NOMBRE. */
const MAX_LARGO_TIPO = 50;

/**
 * Normaliza el tipo de división que llega del formulario: "Bloque", "Unidad"
 * o el nombre que se haya capturado en la opción "Otro".
 *
 * @param {*} tipo
 * @returns {string} cadena vacía si no se mandó nada
 */
function normalizarTipoBloque(tipo) {
    return typeof tipo === 'string' ? tipo.trim().slice(0, MAX_LARGO_TIPO) : '';
}

/**
 * El tipo que se eligió al crear la materia, deducido del nombre del bloque.
 * No se guarda en una columna aparte: vive dentro de BLQ_NOMBRE.
 * "Bloque 1" -> "Bloque", "Módulo 12" -> "Módulo".
 *
 * @param {*} nombreBloque
 * @returns {string}
 */
function tipoDesdeNombre(nombreBloque) {
    if (typeof nombreBloque !== 'string') {
        return '';
    }

    return nombreBloque.replace(/\s+\d+\s*$/, '').trim();
}

/**
 * Los motivos por los que una materia no se puede eliminar. Devuelve una lista
 * vacía cuando sí se puede.
 *
 * @param {{multimedia: number, licencias: number, temas: number}} conteos
 * @returns {string[]}
 */
function motivosParaNoEliminar(conteos) {
    const motivos = [];

    if (conteos.multimedia > 0) {
        motivos.push(`tiene ${conteos.multimedia} archivo(s) de multimedia`);
    }

    if (conteos.licencias > 0) {
        motivos.push(`tiene ${conteos.licencias} licencia(s) vinculada(s)`);
    }

    if (conteos.temas > 0) {
        motivos.push(`sus bloques tienen ${conteos.temas} tema(s) registrado(s)`);
    }

    return motivos;
}

/**
 * Los renglones que se van a insertar en MET_BLOQUE, uno por cada bloque:
 * con tipo "Bloque" y cantidad 3 salen Bloque 1, Bloque 2 y Bloque 3.
 *
 * @param {number} matId
 * @param {string} tipo
 * @param {number} cantidad
 * @returns {Array<Array<*>>} renglones [BLQ_NUMERO, BLQ_NOMBRE, BLQ_MAT_ID]
 */
function construirBloques(matId, tipo, cantidad) {
    const renglones = [];

    for (let numero = 1; numero <= cantidad; numero++) {
        renglones.push([numero, `${tipo} ${numero}`, matId]);
    }

    return renglones;
}

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
                l.LIC_LICENCIA AS LICENCIA,
                (SELECT COUNT(*) FROM MET_MULTIMEDIA mm
                  WHERE mm.MUL_MAT_ID = m.MAT_ID) AS TOTAL_MULTIMEDIA,
                (SELECT COUNT(*) FROM MET_LICENCIA ml
                  WHERE ml.LIC_MAT_ID = m.MAT_ID) AS TOTAL_LICENCIAS,
                (SELECT COUNT(*) FROM MET_BLOQUE mb
                  WHERE mb.BLQ_MAT_ID = m.MAT_ID) AS TOTAL_BLOQUES,
                (SELECT COUNT(*) FROM MET_TEMA mt
                  INNER JOIN MET_BLOQUE mb2 ON mb2.BLQ_ID = mt.TEM_BLQ_ID
                  WHERE mb2.BLQ_MAT_ID = m.MAT_ID) AS TOTAL_TEMAS,
                (SELECT mb3.BLQ_NOMBRE FROM MET_BLOQUE mb3
                  WHERE mb3.BLQ_MAT_ID = m.MAT_ID
                  ORDER BY mb3.BLQ_NUMERO LIMIT 1) AS PRIMER_BLOQUE
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

            // El tipo de división y si se puede borrar se calculan aquí para que
            // la pantalla no tenga que deducirlos.
            const materias = (results || []).map((materia) => {
                const conteos = {
                    multimedia: materia.TOTAL_MULTIMEDIA,
                    licencias: materia.TOTAL_LICENCIAS,
                    temas: materia.TOTAL_TEMAS
                };
                const motivos = motivosParaNoEliminar(conteos);

                return {
                    ...materia,
                    TIPO_BLOQUE: tipoDesdeNombre(materia.PRIMER_BLOQUE),
                    PUEDE_ELIMINARSE: motivos.length === 0,
                    MOTIVOS_VINCULO: motivos
                };
            });

            res.status(200).json({
                success: true,
                data: materias
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
    const {
        MAT_NOMBRE,
        MAT_DESCRIPCION,
        MAT_SEM_ID,
        MAT_STATUS,
        BLQ_TIPO,
        BLQ_CANTIDAD
    } = req.body;

    if (!MAT_NOMBRE || !MAT_SEM_ID) {
        return res.status(400).json({
            success: false,
            message: 'MAT_NOMBRE y MAT_SEM_ID son obligatorios'
        });
    }

    // El tipo y la cantidad no se guardan como tales: solo sirven para armar
    // los renglones de MET_BLOQUE. El tipo queda dentro de BLQ_NOMBRE y la
    // cantidad es el número de renglones de la materia.
    const tipoBloque = normalizarTipoBloque(BLQ_TIPO);
    const cantidad = Number(BLQ_CANTIDAD);

    if (!tipoBloque) {
        return res.status(400).json({
            success: false,
            message: 'Indique el tipo de división de la materia (Bloque, Unidad u otro)'
        });
    }

    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_BLOQUES) {
        return res.status(400).json({
            success: false,
            message: `La cantidad de ${tipoBloque.toLowerCase()}s debe ser un número entero entre 1 y ${MAX_BLOQUES}`
        });
    }

    const status = MAT_STATUS === undefined || MAT_STATUS === null ? 1 : Number(MAT_STATUS);
    const descripcion = MAT_DESCRIPCION || '';
    const semId = Number(MAT_SEM_ID);

    let conexion;

    try {
        conexion = await obtenerConexion(req.db);
        await iniciarTransaccion(conexion);

        const insercion = await ejecutar(
            conexion,
            `INSERT INTO MET_MATERIA (MAT_NOMBRE, MAT_DESCRIPCION, MAT_SEM_ID, MAT_STATUS)
             VALUES (?, ?, ?, ?)`,
            [MAT_NOMBRE, descripcion, semId, status]
        );

        const matId = insercion.insertId;

        // Un renglón por bloque: 3 bloques son 3 registros en MET_BLOQUE.
        await ejecutar(
            conexion,
            'INSERT INTO MET_BLOQUE (BLQ_NUMERO, BLQ_NOMBRE, BLQ_MAT_ID) VALUES ?',
            [construirBloques(matId, tipoBloque, cantidad)]
        );

        await confirmar(conexion);

        const materia = {
            MAT_ID: matId,
            MAT_NOMBRE,
            MAT_DESCRIPCION: descripcion,
            MAT_SEM_ID: semId,
            MAT_STATUS: status
        };

        res.status(201).json({
            success: true,
            message: `Materia creada correctamente con ${cantidad} ${tipoBloque.toLowerCase()}(s)`,
            data: materia
        });

        if (req.io) {
            req.io.to('global-room').emit('new-materia', {
                operation: 'insert',
                ...materia
            });
        }
    } catch (error) {
        if (conexion) {
            await revertir(conexion);
        }

        console.error('[MATERIAS] Error al crear materia:', error);

        // La llave única UQ_MET_MATERIA_NOMBRE_SEM. Pasa cuando se reenvía el
        // alta (doble clic, reintento tras un corte de red) o cuando de plano
        // ya existe esa materia en el semestre.
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: 'Ya existe una materia con ese nombre en el semestre seleccionado'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Error al crear materia',
            detalle: error.message
        });
    } finally {
        if (conexion) {
            conexion.release();
        }
    }
};

/**
 * Los conteos de todo lo que cuelga de una materia. Se usan tanto para decidir
 * si se puede eliminar como para avisar por qué no.
 *
 * @param {object} conexion
 * @param {number} matId
 * @returns {Promise<{multimedia: number, licencias: number, temas: number}>}
 */
async function contarVinculos(conexion, matId) {
    const [fila] = await ejecutar(
        conexion,
        `SELECT
            (SELECT COUNT(*) FROM MET_MULTIMEDIA WHERE MUL_MAT_ID = ?) AS multimedia,
            (SELECT COUNT(*) FROM MET_LICENCIA   WHERE LIC_MAT_ID = ?) AS licencias,
            (SELECT COUNT(*) FROM MET_TEMA mt
              INNER JOIN MET_BLOQUE mb ON mb.BLQ_ID = mt.TEM_BLQ_ID
              WHERE mb.BLQ_MAT_ID = ?) AS temas`,
        [matId, matId, matId]
    );

    return fila;
}

exports.updateMateria = async (req, res) => {
    const matId = Number(req.params.id);

    const {
        MAT_NOMBRE,
        MAT_DESCRIPCION,
        MAT_SEM_ID,
        MAT_STATUS,
        BLQ_TIPO,
        BLQ_CANTIDAD
    } = req.body;

    if (!Number.isInteger(matId) || matId < 1) {
        return res.status(400).json({
            success: false,
            message: 'El identificador de la materia no es válido'
        });
    }

    if (!MAT_NOMBRE || !MAT_SEM_ID) {
        return res.status(400).json({
            success: false,
            message: 'MAT_NOMBRE y MAT_SEM_ID son obligatorios'
        });
    }

    const tipoBloque = normalizarTipoBloque(BLQ_TIPO);
    const cantidad = Number(BLQ_CANTIDAD);

    if (!tipoBloque) {
        return res.status(400).json({
            success: false,
            message: 'Indique el tipo de división de la materia (Bloque, Unidad u otro)'
        });
    }

    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_BLOQUES) {
        return res.status(400).json({
            success: false,
            message: `La cantidad de ${tipoBloque.toLowerCase()}s debe ser un número entero entre 1 y ${MAX_BLOQUES}`
        });
    }

    const status = MAT_STATUS === undefined || MAT_STATUS === null ? 1 : Number(MAT_STATUS);
    const descripcion = MAT_DESCRIPCION || '';
    const semId = Number(MAT_SEM_ID);

    let conexion;

    try {
        conexion = await obtenerConexion(req.db);
        await iniciarTransaccion(conexion);

        const existentes = await ejecutar(conexion, 'SELECT MAT_ID FROM MET_MATERIA WHERE MAT_ID = ?', [matId]);

        if (existentes.length === 0) {
            await revertir(conexion);
            return res.status(404).json({
                success: false,
                message: 'La materia no existe'
            });
        }

        await ejecutar(
            conexion,
            `UPDATE MET_MATERIA
                SET MAT_NOMBRE = ?, MAT_DESCRIPCION = ?, MAT_SEM_ID = ?, MAT_STATUS = ?
              WHERE MAT_ID = ?`,
            [MAT_NOMBRE, descripcion, semId, status, matId]
        );

        const bloques = await ejecutar(
            conexion,
            'SELECT BLQ_ID, BLQ_NUMERO FROM MET_BLOQUE WHERE BLQ_MAT_ID = ? ORDER BY BLQ_NUMERO',
            [matId]
        );

        // Bajarle a la cantidad borra los últimos bloques, pero solo si están
        // vacíos: un bloque con temas se queda y la edición se rechaza entera.
        const sobrantes = bloques.filter((bloque) => bloque.BLQ_NUMERO > cantidad);

        if (sobrantes.length > 0) {
            const ids = sobrantes.map((bloque) => bloque.BLQ_ID);
            const ocupados = await ejecutar(
                conexion,
                `SELECT mb.BLQ_NOMBRE, COUNT(*) AS temas
                   FROM MET_TEMA mt
                   INNER JOIN MET_BLOQUE mb ON mb.BLQ_ID = mt.TEM_BLQ_ID
                  WHERE mt.TEM_BLQ_ID IN (?)
                  GROUP BY mb.BLQ_ID, mb.BLQ_NOMBRE`,
                [ids]
            );

            if (ocupados.length > 0) {
                await revertir(conexion);
                const detalle = ocupados.map((b) => `${b.BLQ_NOMBRE} (${b.temas} tema(s))`).join(', ');
                return res.status(409).json({
                    success: false,
                    message: `No se puede reducir la cantidad: hay temas registrados en ${detalle}. Elimine primero esos temas.`
                });
            }

            await ejecutar(conexion, 'DELETE FROM MET_BLOQUE WHERE BLQ_ID IN (?)', [ids]);
        }

        // Subirle a la cantidad agrega los que faltan, continuando la numeración.
        // El máximo se mide sobre los que sobreviven, no sobre los que había al
        // entrar: si la numeración trae huecos, así se rellenan en vez de
        // quedarse cortos.
        const maximoActual = bloques
            .filter((bloque) => bloque.BLQ_NUMERO <= cantidad)
            .reduce((max, bloque) => Math.max(max, bloque.BLQ_NUMERO), 0);

        if (cantidad > maximoActual) {
            const nuevos = [];

            for (let numero = maximoActual + 1; numero <= cantidad; numero++) {
                nuevos.push([numero, `${tipoBloque} ${numero}`, matId]);
            }

            await ejecutar(
                conexion,
                'INSERT INTO MET_BLOQUE (BLQ_NUMERO, BLQ_NOMBRE, BLQ_MAT_ID) VALUES ?',
                [nuevos]
            );
        }

        // Renombrar siempre: es lo que aplica el cambio de tipo (Bloque -> Unidad)
        // y deja parejos los nombres si algo había quedado disparejo.
        await ejecutar(
            conexion,
            `UPDATE MET_BLOQUE
                SET BLQ_NOMBRE = CONCAT(?, ' ', BLQ_NUMERO)
              WHERE BLQ_MAT_ID = ?`,
            [tipoBloque, matId]
        );

        await confirmar(conexion);

        const materia = {
            MAT_ID: matId,
            MAT_NOMBRE,
            MAT_DESCRIPCION: descripcion,
            MAT_SEM_ID: semId,
            MAT_STATUS: status
        };

        res.status(200).json({
            success: true,
            message: `Materia actualizada correctamente con ${cantidad} ${tipoBloque.toLowerCase()}(s)`,
            data: materia
        });

        if (req.io) {
            req.io.to('global-room').emit('new-materia', {
                operation: 'update',
                ...materia
            });
        }
    } catch (error) {
        if (conexion) {
            await revertir(conexion);
        }

        console.error('[MATERIAS] Error al actualizar materia:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: 'Ya existe otra materia con ese nombre en el semestre seleccionado'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Error al actualizar materia',
            detalle: error.message
        });
    } finally {
        if (conexion) {
            conexion.release();
        }
    }
};

exports.deleteMateria = async (req, res) => {
    const matId = Number(req.params.id);

    if (!Number.isInteger(matId) || matId < 1) {
        return res.status(400).json({
            success: false,
            message: 'El identificador de la materia no es válido'
        });
    }

    let conexion;

    try {
        conexion = await obtenerConexion(req.db);
        await iniciarTransaccion(conexion);

        const materias = await ejecutar(
            conexion,
            'SELECT MAT_ID, MAT_NOMBRE FROM MET_MATERIA WHERE MAT_ID = ?',
            [matId]
        );

        if (materias.length === 0) {
            await revertir(conexion);
            return res.status(404).json({
                success: false,
                message: 'La materia no existe'
            });
        }

        const materia = materias[0];

        // El candado: multimedia, licencias o temas dentro de sus bloques. Los
        // bloques vacíos no cuentan, son parte de la materia y se van con ella.
        const motivos = motivosParaNoEliminar(await contarVinculos(conexion, matId));

        if (motivos.length > 0) {
            await revertir(conexion);
            return res.status(409).json({
                success: false,
                message: `No se puede eliminar «${materia.MAT_NOMBRE}» porque ${motivos.join(' y ')}.`,
                motivos
            });
        }

        const bloquesBorrados = await ejecutar(conexion, 'DELETE FROM MET_BLOQUE WHERE BLQ_MAT_ID = ?', [matId]);
        await ejecutar(conexion, 'DELETE FROM MET_MATERIA WHERE MAT_ID = ?', [matId]);

        await confirmar(conexion);

        res.status(200).json({
            success: true,
            message: `Materia «${materia.MAT_NOMBRE}» eliminada correctamente`,
            data: {
                MAT_ID: matId,
                BLOQUES_ELIMINADOS: bloquesBorrados.affectedRows
            }
        });

        if (req.io) {
            req.io.to('global-room').emit('new-materia', {
                operation: 'delete',
                MAT_ID: matId,
                MAT_NOMBRE: materia.MAT_NOMBRE
            });
        }
    } catch (error) {
        if (conexion) {
            await revertir(conexion);
        }

        console.error('[MATERIAS] Error al eliminar materia:', error);

        // Red de seguridad: si alguna tabla nueva apunta a la materia y no está
        // contemplada arriba, la FK la detiene y se avisa igual de claro.
        if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') {
            return res.status(409).json({
                success: false,
                message: 'No se puede eliminar la materia porque tiene información vinculada'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Error al eliminar materia',
            detalle: error.message
        });
    } finally {
        if (conexion) {
            conexion.release();
        }
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
                    // La licencia no existe, la creamos y la vinculamos a la materia
                    const insertQuery = `INSERT INTO MET_LICENCIA (LIC_LICENCIA, LIC_MAT_ID, LIC_STATUS, LIC_FECHA_CREACION) VALUES (?, ?, 1, CURDATE())`;
                    
                    req.db.query(insertQuery, [LIC_LICENCIA, MAT_ID], (insertError, insertResult) => {
                        if (insertError) {
                            console.error('[LICENCIA] Error al crear licencia:', insertError);
                            return res.status(500).json({ success: false, message: 'Error en la base de datos al crear licencia' });
                        }

                        return res.status(200).json({
                            success: true,
                            message: 'Licencia creada y vinculada correctamente'
                        });
                    });
                    return;
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
