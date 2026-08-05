/**
 * Generador de licencias del admin.
 *
 * Una generación escribe en tres tablas a la vez:
 *   1. MET_PEDIDO       -> el pedido que originó el lote
 *   2. MET_LICENCIA     -> una fila por licencia generada
 *   3. MET_CONCENTRADO  -> el resumen que liga pedido, venta y cantidad
 *
 * Todo va dentro de una transacción: si algo falla a mitad del camino no puede
 * quedar un pedido sin licencias ni licencias huérfanas.
 */

const crypto = require('crypto');

/** Tipos de licencia admitidos. Catálogo cerrado. */
const TIPOS_LICENCIA = ['ESTUDIANTE', 'DOCENTE', 'GENERICA', 'INVITADO'];

/**
 * Alfabeto de la parte variable del código.
 * Se omiten I, O, 0 y 1 a propósito: son los que la gente confunde al dictar
 * o teclear una licencia, y una licencia mal copiada es una llamada de soporte.
 */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Formato del código: INDICIO-XXXX-XXXX.
 *
 * Todo lo que va después del indicio es aleatorio; el guion solo parte la tira en
 * dos bloques para que se pueda dictar por teléfono sin perder el lugar a media
 * lectura. Estos son los caracteres que se apartan para el bloque final.
 */
const LARGO_BLOQUE_FINAL = 4;

// Longitudes reales de las columnas
const MAX_LARGO_LICENCIA = 100;   // LIC_LICENCIA varchar(100)
const MAX_LARGO_INDICIO = 100;    // LIC_INDICIO varchar(100)
const MAX_LARGO_SOLICITANTE = 100; // PDD_SOLICITANTE varchar(100)

/**
 * Topes de la generación.
 *
 * LIC_NUM_CARACTERES cuenta el total de la parte variable: si se piden 8, el
 * código sale como INDICIO-XXXX-XXXX. El mínimo es 8 para que los dos bloques
 * queden de cuatro o más; por debajo de eso el segundo bloque se comería casi
 * todo el código y partirlo dejaría de tener sentido.
 */
const MIN_CARACTERES = 8;
const MAX_CARACTERES = 32;
const MAX_POR_LOTE = 300000;

/**
 * Filas por INSERT. max_allowed_packet es de 16 MB y cada fila ocupa unos
 * 200 bytes de sentencia, así que 5000 filas por tanda deja mucho margen.
 */
const FILAS_POR_TANDA = 5000;

/**
 * Ocupación máxima del espacio de códigos: no se permite pedir más de la cuarta
 * parte de las combinaciones posibles.
 *
 * El motivo es el problema del recolector de cupones: si se intenta llenar casi
 * todo el espacio con códigos al azar, los últimos tardan una eternidad porque
 * casi todo lo que sale ya está tomado. Quedándose por debajo del 25% la
 * generación es de una sola pasada en la práctica.
 */
const OCUPACION_MAXIMA = 4;

/** Cuántos códigos se devuelven en la respuesta. El resto se descarga aparte. */
const MUESTRA_CODIGOS = 100;

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

/** Consulta simple con el pool, para lecturas fuera de la transacción. */
function query(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (error, resultados) => (error ? reject(error) : resolve(resultados)));
    });
}

// ==========================================================================
// Generación de códigos
// ==========================================================================

/**
 * El prefijo del código. Si el indicio ya viene con guion al final no se le
 * agrega otro.
 *
 * @param {string} indicio
 * @returns {string}
 */
function prefijoDe(indicio) {
    return indicio.endsWith('-') ? indicio : `${indicio}-`;
}

/**
 * Cuántos caracteres le tocan al primer bloque: el total menos los que se
 * apartan para el bloque final.
 *
 * @param {number} caracteres
 * @returns {number}
 */
function largoPrimerBloque(caracteres) {
    return caracteres - LARGO_BLOQUE_FINAL;
}

/**
 * Largo del código completo: prefijo + los dos bloques + el guion que los parte.
 * Con indicio META y 10 caracteres da 16, el largo de META-XXXXXX-XXXX.
 *
 * @param {string} indicio
 * @param {number} caracteres
 * @returns {number}
 */
function largoDelCodigo(indicio, caracteres) {
    return prefijoDe(indicio).length + caracteres + 1;
}

/**
 * Cuántas combinaciones distintas existen con esta longitud total. El guion no
 * suma nada: solo parte en dos una tira que es aleatoria de principio a fin.
 * Se usa BigInt: con 13 caracteres ya se supera el entero seguro de JavaScript
 * y el cálculo daría un número redondeado que no sirve para comparar.
 *
 * @param {number} caracteres
 * @returns {bigint}
 */
function combinacionesPosibles(caracteres) {
    return BigInt(ALFABETO.length) ** BigInt(caracteres);
}

/**
 * Cuántos caracteres hacen falta como mínimo para acomodar esta cantidad
 * respetando el margen de ocupación. Sirve para sugerirlo en el mensaje de error.
 *
 * @param {number} cantidad
 * @param {number} yaUsados
 * @returns {number|null} null si ni con el máximo alcanza
 */
function caracteresNecesarios(cantidad, yaUsados) {
    const requerido = BigInt(cantidad) * BigInt(OCUPACION_MAXIMA) + BigInt(yaUsados);

    for (let n = MIN_CARACTERES; n <= MAX_CARACTERES; n++) {
        if (combinacionesPosibles(n) >= requerido) return n;
    }
    return null;
}

/**
 * Genera en bloque la parte variable del código: la tira aleatoria ya partida en
 * dos por el guion. Con 10 caracteres sale `XXXXXX-XXXX`.
 *
 * Pide todos los bytes de una sola vez en lugar de llamar al generador por cada
 * carácter: con 300 000 licencias de 10 caracteres serían 3 millones de llamadas
 * y ahí se va el tiempo.
 *
 * El alfabeto tiene 32 símbolos y 256 es múltiplo exacto de 32, así que tomar el
 * resto de cada byte reparte por igual y no introduce sesgo.
 *
 * @param {number} cuantos
 * @param {number} caracteres Total de la parte variable, los dos bloques juntos
 * @returns {string[]}
 */
function bloqueDeCadenas(cuantos, caracteres) {
    const corte = largoPrimerBloque(caracteres);
    const bytes = crypto.randomBytes(cuantos * caracteres);
    const salida = new Array(cuantos);
    let pos = 0;

    for (let i = 0; i < cuantos; i++) {
        let cadena = '';

        for (let c = 0; c < caracteres; c++) {
            if (c === corte) cadena += '-';
            cadena += ALFABETO[bytes[pos++] % ALFABETO.length];
        }

        salida[i] = cadena;
    }

    return salida;
}

/**
 * Genera la cantidad pedida de códigos, garantizando que ninguno se repita.
 *
 * La unicidad se asegura en tres capas:
 *   1. Un Set en memoria: imposible que se repitan entre sí dentro del lote.
 *   2. Los códigos ya existentes con el mismo indicio y la misma longitud se
 *      cargan y se descartan. Solo esos pueden chocar: cualquier otro tiene
 *      distinto prefijo o distinto largo.
 *   3. El índice UNIQUE de LIC_LICENCIA en la base. Si algo se escapara, el
 *      INSERT falla y la transacción revierte: nunca quedan duplicados guardados.
 *
 * @param {object} db
 * @param {string} indicio
 * @param {number} caracteres
 * @param {number} cantidad
 * @returns {Promise<{codigos: string[], yaExistian: number, pasadas: number}>}
 */
async function generarCodigosUnicos(db, indicio, caracteres, cantidad) {
    const prefijo = prefijoDe(indicio);
    const largoTotal = largoDelCodigo(indicio, caracteres);

    // Capa 2: lo ya emitido con este mismo prefijo y largo
    const previos = await query(
        db,
        'SELECT LIC_LICENCIA FROM MET_LICENCIA WHERE LIC_LICENCIA LIKE ? AND CHAR_LENGTH(LIC_LICENCIA) = ?',
        [`${prefijo}%`, largoTotal]
    );
    const ocupados = new Set((previos || []).map((f) => f.LIC_LICENCIA));

    // Capa 1: el Set no admite repetidos, así que el lote es único por construcción
    const codigos = new Set();
    let pasadas = 0;

    while (codigos.size < cantidad) {
        pasadas++;

        if (pasadas > 60) {
            throw new Error(
                `No se pudieron generar ${cantidad} códigos distintos con ${caracteres} caracteres. ` +
                'Aumenta la cantidad de caracteres o usa otro indicio.'
            );
        }

        // Se pide un 10% extra para absorber los repetidos sin volver a entrar al bucle
        const faltan = cantidad - codigos.size;
        const aGenerar = Math.max(faltan, Math.ceil(faltan * 1.1));

        for (const cadena of bloqueDeCadenas(aGenerar, caracteres)) {
            if (codigos.size >= cantidad) break;

            const codigo = prefijo + cadena;
            if (!ocupados.has(codigo)) codigos.add(codigo);
        }
    }

    return { codigos: [...codigos], yaExistian: ocupados.size, pasadas };
}

// ==========================================================================
// Validación
// ==========================================================================

/**
 * Valida el cuerpo de la generación.
 * @param {object} body
 * @returns {{errores: string[], datos: object}}
 */
function validarGeneracion(body) {
    const errores = [];
    const datos = {};

    const texto = (v) => (v === undefined || v === null ? '' : String(v).trim());

    // --- Venta ---
    const venId = Number(body.VEN_ID);
    if (!Number.isInteger(venId) || venId <= 0) errores.push('Debes elegir la venta');
    else datos.VEN_ID = venId;

    // --- Paquete ---
    const paqId = Number(body.PAQ_ID);
    if (!Number.isInteger(paqId) || paqId <= 0) errores.push('Debes elegir el paquete');
    else datos.PAQ_ID = paqId;

    // --- Tipo de licencia ---
    const tipo = texto(body.LIC_TIPO).toUpperCase();
    if (!tipo) errores.push('Debes elegir el tipo de licencia');
    else if (!TIPOS_LICENCIA.includes(tipo)) {
        errores.push(`El tipo de licencia debe ser uno de: ${TIPOS_LICENCIA.join(', ')}`);
    } else {
        datos.LIC_TIPO = tipo;
    }

    // --- Vigencia: o dos fechas, o días. Nunca ambas ni ninguna ---
    const inicio = texto(body.LIC_FECHA_INICIO);
    const fin = texto(body.LIC_FECHA_FIN);
    const diasCrudo = body.LIC_TIEMPO;
    const hayFechas = !!inicio || !!fin;
    const hayDias = diasCrudo !== undefined && diasCrudo !== null && String(diasCrudo).trim() !== '';

    if (hayFechas && hayDias) {
        errores.push('Elige una sola forma de vigencia: fechas o días, no las dos');
    } else if (!hayFechas && !hayDias) {
        errores.push('Debes indicar la vigencia: fecha de inicio y vencimiento, o tiempo en días');
    } else if (hayFechas) {
        if (!inicio) errores.push('Falta la fecha de inicio');
        if (!fin) errores.push('Falta la fecha de vencimiento');

        if (inicio && fin) {
            const dInicio = new Date(inicio);
            const dFin = new Date(fin);

            if (Number.isNaN(dInicio.getTime())) errores.push('La fecha de inicio no es válida');
            else if (Number.isNaN(dFin.getTime())) errores.push('La fecha de vencimiento no es válida');
            else if (dFin <= dInicio) errores.push('El vencimiento debe ser posterior al inicio');
            else {
                datos.LIC_FECHA_INICIO = inicio.slice(0, 10);
                datos.LIC_FECHA_FIN = fin.slice(0, 10);
                datos.LIC_TIEMPO = null;
            }
        }
    } else {
        const dias = Number(diasCrudo);
        if (!Number.isInteger(dias) || dias <= 0) errores.push('El tiempo en días debe ser un entero mayor a 0');
        else {
            datos.LIC_TIEMPO = dias;
            datos.LIC_FECHA_INICIO = null;
            datos.LIC_FECHA_FIN = null;
        }
    }

    // --- Indicio ---
    const indicio = texto(body.LIC_INDICIO);
    if (!indicio) errores.push('Debes escribir el indicio');
    else if (indicio.length > MAX_LARGO_INDICIO) {
        errores.push(`El indicio excede ${MAX_LARGO_INDICIO} caracteres (recibidos ${indicio.length})`);
    } else {
        datos.LIC_INDICIO = indicio;
    }

    // --- Cantidad de caracteres de la parte aleatoria ---
    const caracteres = Number(body.LIC_NUM_CARACTERES);
    if (!Number.isInteger(caracteres) || caracteres < MIN_CARACTERES || caracteres > MAX_CARACTERES) {
        errores.push(`La cantidad de caracteres debe estar entre ${MIN_CARACTERES} y ${MAX_CARACTERES}`);
    } else {
        datos.LIC_NUM_CARACTERES = caracteres;
    }

    // El código completo tiene que caber en la columna
    if (datos.LIC_INDICIO && datos.LIC_NUM_CARACTERES) {
        const largoTotal = largoDelCodigo(datos.LIC_INDICIO, datos.LIC_NUM_CARACTERES);
        if (largoTotal > MAX_LARGO_LICENCIA) {
            errores.push(
                `El código quedaría de ${largoTotal} caracteres y el máximo es ${MAX_LARGO_LICENCIA}. ` +
                'Acorta el indicio o la cantidad de caracteres.'
            );
        }
    }

    // --- Cuántas licencias generar ---
    const cantidad = Number(body.cantidad ?? body.CANTIDAD);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
        errores.push('La cantidad de licencias a generar debe ser un entero mayor a 0');
    } else if (cantidad > MAX_POR_LOTE) {
        errores.push(`No se pueden generar más de ${MAX_POR_LOTE} licencias por lote (pediste ${cantidad})`);
    } else {
        datos.cantidad = cantidad;
    }

    // --- Pedido: solicitante y bitácora ---
    const solicitante = texto(body.PDD_SOLICITANTE);
    if (!solicitante) errores.push('Debes escribir el solicitante del pedido');
    else if (solicitante.length > MAX_LARGO_SOLICITANTE) {
        errores.push(`El solicitante excede ${MAX_LARGO_SOLICITANTE} caracteres (recibidos ${solicitante.length})`);
    } else {
        datos.PDD_SOLICITANTE = solicitante;
    }

    // La bitácora sí es editable; el sistema se asigna solo
    if (body.PDD_BITACORA !== undefined && body.PDD_BITACORA !== null && String(body.PDD_BITACORA).trim() !== '') {
        const bitacora = Number(body.PDD_BITACORA);
        if (!Number.isInteger(bitacora) || bitacora < 0) errores.push('La bitácora debe ser un número entero');
        else datos.PDD_BITACORA = bitacora;
    } else {
        datos.PDD_BITACORA = null;
    }

    return { errores, datos };
}

// ==========================================================================
// Endpoints
// ==========================================================================

/**
 * GET /mapa/v1/admin/comercial/licencias/catalogos
 * Tipos de licencia y límites, para que el formulario no los tenga codificados.
 */
exports.getCatalogosLicencia = (req, res) => {
    res.status(200).json({
        success: true,
        data: {
            tipos: TIPOS_LICENCIA,
            min_caracteres: MIN_CARACTERES,
            max_caracteres: MAX_CARACTERES,
            max_por_lote: MAX_POR_LOTE,
            max_largo_licencia: MAX_LARGO_LICENCIA,
            largo_bloque_final: LARGO_BLOQUE_FINAL
        }
    });
};

/**
 * POST /mapa/v1/admin/comercial/licencias/generar
 *
 * Crea el pedido, las licencias y el concentrado en una sola transacción.
 */
exports.generarLicencias = async (req, res) => {
    const { errores, datos } = validarGeneracion(req.body);
    if (errores.length > 0) {
        return res.status(400).json({ success: false, message: 'Datos inválidos', errores });
    }

    let conexion = null;

    try {
        // La venta y el paquete deben existir antes de tocar nada
        const venta = await query(req.db, 'SELECT VEN_ID, VEN_TIPO FROM MET_VENTA WHERE VEN_ID = ?', [datos.VEN_ID]);
        if (!venta || venta.length === 0) {
            return res.status(400).json({ success: false, message: `La venta ${datos.VEN_ID} no existe` });
        }

        const paquete = await query(req.db, 'SELECT PAQ_ID, PAQ_NOMBRE FROM MET_PAQUETE WHERE PAQ_ID = ?', [datos.PAQ_ID]);
        if (!paquete || paquete.length === 0) {
            return res.status(400).json({ success: false, message: `El paquete ${datos.PAQ_ID} no existe` });
        }

        // Usuario que genera: si no existe se guarda null en lugar de romper la FK
        let usuarioId = null;
        const usuarioCrudo = req.body.usuario_id;
        if (usuarioCrudo !== undefined && usuarioCrudo !== null && String(usuarioCrudo).trim() !== '') {
            const candidato = Number(usuarioCrudo);
            if (Number.isInteger(candidato) && candidato > 0) {
                const existe = await query(req.db, 'SELECT USU_ID FROM MET_USUARIO_ADMIN WHERE USU_ID = ?', [candidato]);
                if (existe && existe.length > 0) usuarioId = candidato;
            }
        }

        // ---- ¿Alcanzan las combinaciones? ----
        // Se compara contra lo ya emitido con el mismo prefijo y largo, que es lo
        // único que reduce el espacio disponible de verdad.
        const prefijo = prefijoDe(datos.LIC_INDICIO);
        const largoCodigo = largoDelCodigo(datos.LIC_INDICIO, datos.LIC_NUM_CARACTERES);

        const usadosFila = await query(
            req.db,
            'SELECT COUNT(*) AS n FROM MET_LICENCIA WHERE LIC_LICENCIA LIKE ? AND CHAR_LENGTH(LIC_LICENCIA) = ?',
            [`${prefijo}%`, largoCodigo]
        );
        const yaUsados = Number(usadosFila && usadosFila[0] ? usadosFila[0].n : 0);

        const posibles = combinacionesPosibles(datos.LIC_NUM_CARACTERES);
        const necesarias = BigInt(datos.cantidad) * BigInt(OCUPACION_MAXIMA) + BigInt(yaUsados);

        if (posibles < necesarias) {
            const sugerencia = caracteresNecesarios(datos.cantidad, yaUsados);
            const libres = posibles - BigInt(yaUsados);

            return res.status(400).json({
                success: false,
                message:
                    `No alcanzan las combinaciones: con ${datos.LIC_NUM_CARACTERES} caracteres hay ` +
                    `${posibles.toLocaleString('es-MX')} códigos posibles` +
                    (yaUsados > 0 ? ` (${libres.toLocaleString('es-MX')} libres, ${yaUsados.toLocaleString('es-MX')} ya emitidos con este indicio)` : '') +
                    `, y para generar ${datos.cantidad.toLocaleString('es-MX')} de forma confiable se necesitan al menos ` +
                    `${necesarias.toLocaleString('es-MX')}. ` +
                    (sugerencia
                        ? `Usa ${sugerencia} caracteres o más.`
                        : 'Reduce la cantidad o cambia el indicio.'),
                data: {
                    caracteres_actuales: datos.LIC_NUM_CARACTERES,
                    combinaciones_posibles: posibles.toString(),
                    combinaciones_libres: libres.toString(),
                    ya_emitidas_con_este_indicio: yaUsados,
                    cantidad_pedida: datos.cantidad,
                    caracteres_sugeridos: sugerencia
                }
            });
        }

        // Los códigos se preparan antes de abrir la transacción: es la parte que
        // más tarda y no conviene tener la transacción abierta mientras corre
        const tGeneracion = Date.now();
        const { codigos, pasadas } = await generarCodigosUnicos(
            req.db, datos.LIC_INDICIO, datos.LIC_NUM_CARACTERES, datos.cantidad
        );
        const msGeneracion = Date.now() - tGeneracion;

        conexion = await obtenerConexion(req.db);
        await iniciarTransaccion(conexion);

        // ---- 1. Pedido ----
        // PDD_SISTEMA no se captura: se asigna el siguiente consecutivo
        const maxSistema = await ejecutar(
            conexion,
            'SELECT COALESCE(MAX(PDD_SISTEMA), 0) + 1 AS siguiente FROM MET_PEDIDO'
        );
        const sistema = (maxSistema && maxSistema[0] ? maxSistema[0].siguiente : 1);

        const resPedido = await ejecutar(
            conexion,
            'INSERT INTO MET_PEDIDO (PDD_BITACORA, PDD_SISTEMA, PDD_SOLICITANTE, PDD_UAD_ID) VALUES (?, ?, ?, ?)',
            [datos.PDD_BITACORA, sistema, datos.PDD_SOLICITANTE, usuarioId]
        );
        const pedidoId = resPedido.insertId;

        // ---- 2. Licencias, insertadas por tandas ----
        // Un solo INSERT con 300 000 filas superaría max_allowed_packet (16 MB),
        // así que se parte en tandas. Todas van dentro de la misma transacción:
        // si una falla, revierte el lote completo.
        //
        // LIC_MAT_ID queda en null: estas licencias se ligan al paquete, no a una
        // materia. LIC_NUM_LICENCIAS se deja en 1 mientras se define su uso.
        const tInsercion = Date.now();
        const SQL_FILA = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE())';
        let tandas = 0;

        for (let desde = 0; desde < codigos.length; desde += FILAS_POR_TANDA) {
            const trozo = codigos.slice(desde, desde + FILAS_POR_TANDA);
            const valores = [];

            for (const codigo of trozo) {
                valores.push(
                    datos.VEN_ID,                // LIC_VEN_ID
                    codigo,                      // LIC_LICENCIA
                    datos.LIC_INDICIO,           // LIC_INDICIO
                    null,                        // LIC_MAT_ID
                    usuarioId,                   // LIC_UAD_ID
                    pedidoId,                    // LIC_PDD_ID
                    1,                           // LIC_STATUS
                    datos.LIC_FECHA_INICIO,      // LIC_FECHA_INICIO
                    datos.LIC_FECHA_FIN,         // LIC_FECHA_FIN
                    datos.PAQ_ID,                // LIC_PAQ_ID
                    datos.LIC_TIEMPO,            // LIC_TIEMPO
                    1,                           // LIC_NUM_LICENCIAS
                    datos.LIC_NUM_CARACTERES,    // LIC_NUM_CARACTERES
                    datos.LIC_TIPO               // LIC_TIPO
                );
            }

            await ejecutar(
                conexion,
                `INSERT INTO MET_LICENCIA
                    (LIC_VEN_ID, LIC_LICENCIA, LIC_INDICIO, LIC_MAT_ID, LIC_UAD_ID, LIC_PDD_ID,
                     LIC_STATUS, LIC_FECHA_INICIO, LIC_FECHA_FIN, LIC_PAQ_ID, LIC_TIEMPO,
                     LIC_NUM_LICENCIAS, LIC_NUM_CARACTERES, LIC_TIPO, LIC_FECHA_CREACION)
                 VALUES ${trozo.map(() => SQL_FILA).join(', ')}`,
                valores
            );

            tandas++;
        }

        const msInsercion = Date.now() - tInsercion;

        // ---- 3. Concentrado ----
        const resConcentrado = await ejecutar(
            conexion,
            'INSERT INTO MET_CONCENTRADO (CON_PDD_ID, CON_VEN_ID, CON_CANTIDAD_LICENCIAS) VALUES (?, ?, ?)',
            [pedidoId, datos.VEN_ID, datos.cantidad]
        );

        await confirmar(conexion);
        conexion.release();
        conexion = null;

        console.log(
            `[LICENCIAS] Generadas ${codigos.length} licencias ${datos.LIC_TIPO} ` +
            `(pedido ${pedidoId}, sistema ${sistema}, venta ${datos.VEN_ID}, paquete ${datos.PAQ_ID}) ` +
            `en ${msGeneracion + msInsercion} ms [generar ${msGeneracion} ms, ${pasadas} pasada(s); ` +
            `insertar ${msInsercion} ms, ${tandas} tanda(s)]`
        );

        // Con lotes grandes no se devuelven todos los códigos: 300 000 serían
        // varios MB de JSON y el navegador no puede pintarlos. Se manda una
        // muestra y el resto se obtiene por el endpoint de descarga.
        const muestra = codigos.slice(0, MUESTRA_CODIGOS);

        res.status(201).json({
            success: true,
            message: `Se generaron ${codigos.length.toLocaleString('es-MX')} licencia${codigos.length !== 1 ? 's' : ''} correctamente`,
            data: {
                total_generadas: codigos.length,
                muestra_codigos: muestra,
                muestra_parcial: codigos.length > MUESTRA_CODIGOS,
                tiempos: {
                    generacion_ms: msGeneracion,
                    insercion_ms: msInsercion,
                    total_ms: msGeneracion + msInsercion,
                    tandas: tandas,
                    pasadas_generacion: pasadas
                },
                pedido: {
                    PDD_ID: pedidoId,
                    PDD_SISTEMA: sistema,
                    PDD_BITACORA: datos.PDD_BITACORA,
                    PDD_SOLICITANTE: datos.PDD_SOLICITANTE
                },
                concentrado: {
                    CON_ID: resConcentrado.insertId,
                    CON_CANTIDAD_LICENCIAS: datos.cantidad
                },
                venta: { VEN_ID: datos.VEN_ID, VEN_TIPO: venta[0].VEN_TIPO },
                paquete: { PAQ_ID: datos.PAQ_ID, PAQ_NOMBRE: paquete[0].PAQ_NOMBRE },
                licencia: {
                    LIC_TIPO: datos.LIC_TIPO,
                    LIC_INDICIO: datos.LIC_INDICIO,
                    LIC_NUM_CARACTERES: datos.LIC_NUM_CARACTERES,
                    LIC_TIEMPO: datos.LIC_TIEMPO,
                    LIC_FECHA_INICIO: datos.LIC_FECHA_INICIO,
                    LIC_FECHA_FIN: datos.LIC_FECHA_FIN
                },
                // Para obtener el listado completo: /comercial/pedidos/:id/licencias.csv
                descarga_csv: `/mapa/v1/admin/comercial/pedidos/${pedidoId}/licencias.csv`
            }
        });

        if (req.io) {
            req.io.to('global-room').emit('comercial-update', {
                operation: 'generar',
                seccion: 'licencias',
                total: codigos.length,
                PDD_ID: pedidoId
            });
        }
    } catch (error) {
        if (conexion) {
            await revertir(conexion);
            conexion.release();
        }

        console.error('[LICENCIAS] Error al generar:', error);
        res.status(500).json({
            success: false,
            message: 'Error al generar las licencias',
            detalle: error.message
        });
    }
};

/**
 * GET /mapa/v1/admin/comercial/pedidos/:id/licencias.csv
 *
 * Descarga las licencias de un pedido en CSV. Se envía por tandas mientras se
 * leen de la base: con 300 000 filas armar el archivo completo en memoria antes
 * de responder consumiría cientos de megas.
 */
exports.descargarLicenciasCsv = async (req, res) => {
    const pedidoId = Number(req.params.id);
    if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
        return res.status(400).json({ success: false, message: 'ID de pedido inválido' });
    }

    try {
        const pedido = await query(
            req.db,
            'SELECT PDD_ID, PDD_SISTEMA, PDD_SOLICITANTE FROM MET_PEDIDO WHERE PDD_ID = ?',
            [pedidoId]
        );

        if (!pedido || pedido.length === 0) {
            return res.status(404).json({ success: false, message: 'El pedido no existe' });
        }

        const total = await query(
            req.db,
            'SELECT COUNT(*) AS n FROM MET_LICENCIA WHERE LIC_PDD_ID = ?',
            [pedidoId]
        );
        const cuantas = Number(total && total[0] ? total[0].n : 0);

        // La vigencia se define al generar el lote, así que todas las licencias
        // del pedido la comparten: basta mirar una para saber si el archivo lleva
        // la columna de días o las de fechas. No tiene sentido incluir las dos y
        // dejar una vacía.
        const referencia = await query(
            req.db,
            'SELECT LIC_TIEMPO, LIC_FECHA_INICIO FROM MET_LICENCIA WHERE LIC_PDD_ID = ? LIMIT 1',
            [pedidoId]
        );
        const muestra = (referencia && referencia[0]) || {};
        const porDias = muestra.LIC_TIEMPO !== null && muestra.LIC_TIEMPO !== undefined;
        const porFechas = !porDias && !!muestra.LIC_FECHA_INICIO;

        // Solo lo que se usa: sin fecha de creación, indicio ni estado
        const columnas = ['LICENCIA', 'TIPO'];
        if (porDias) columnas.push('DIAS');
        else if (porFechas) columnas.push('FECHA_INICIO', 'FECHA_FIN');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="licencias-pedido-${pedidoId}.csv"`);

        // BOM para que Excel reconozca el UTF-8 y no rompa los acentos
        res.write('﻿');
        res.write(columnas.join(',') + '\n');

        const TANDA = 5000;
        for (let offset = 0; offset < cuantas; offset += TANDA) {
            const filas = await query(
                req.db,
                `SELECT LIC_LICENCIA, LIC_TIPO, LIC_FECHA_INICIO, LIC_FECHA_FIN, LIC_TIEMPO
                 FROM MET_LICENCIA WHERE LIC_PDD_ID = ?
                 ORDER BY LIC_ID LIMIT ? OFFSET ?`,
                [pedidoId, TANDA, offset]
            );

            const fecha = (v) => (v ? String(new Date(v).toISOString()).slice(0, 10) : '');
            let bloque = '';

            for (const f of filas) {
                const campos = [f.LIC_LICENCIA, f.LIC_TIPO || ''];

                if (porDias) campos.push(f.LIC_TIEMPO ?? '');
                else if (porFechas) campos.push(fecha(f.LIC_FECHA_INICIO), fecha(f.LIC_FECHA_FIN));

                bloque += campos.join(',') + '\n';
            }

            res.write(bloque);
        }

        res.end();
        console.log(
            `[LICENCIAS] CSV del pedido ${pedidoId} enviado (${cuantas} filas, ` +
            `vigencia por ${porDias ? 'días' : porFechas ? 'fechas' : 'sin definir'})`
        );
    } catch (error) {
        console.error('[LICENCIAS] Error al generar el CSV:', error);

        // Si ya se empezó a enviar el archivo no se puede cambiar a JSON
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Error al generar el CSV',
                detalle: error.message
            });
        } else {
            res.end();
        }
    }
};

exports.TIPOS_LICENCIA = TIPOS_LICENCIA;
