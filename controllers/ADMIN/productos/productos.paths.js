/**
 * Helpers de rutas y seguridad para el módulo de PRODUCTOS del admin.
 *
 * Un producto = un registro en MET_PRODUCTOS + una carpeta en disco.
 * La carpeta se guarda en PRO_FILES como ruta relativa web, por ejemplo:
 *   PRO_FILES  = /productos/ciencias-naturales-experimentales-y-tecnologia-2
 *   PRO_IMAGEN = /productos/ciencias-naturales-experimentales-y-tecnologia-2/icon.png
 *   PRO_EXE    = Ciencias Naturales, EyT II.exe   (solo el nombre, vive dentro de la carpeta)
 *
 * No existe tabla de archivos: agregar, listar o eliminar archivos se hace
 * siempre contra el disco usando PRO_FILES, sin modificar el registro.
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
require('dotenv').config();

// Misma ruta base que multimedia (ver controllers/ADMIN/multimedia/multimedia.controller.js)
// En desarrollo: ruta relativa, en producción: ruta absoluta desde .env
const BASE_UPLOAD_PATH = process.env.NODE_ENV === 'production'
    ? (process.env.UPLOAD_BASE_PATH || '/var/www/html')
    : path.resolve(__dirname, '../../../../var/www/html');

// Carpeta raíz de todos los productos
const PRODUCTOS_DIRNAME = 'productos';
const PRODUCTOS_ROOT_ABS = path.join(BASE_UPLOAD_PATH, PRODUCTOS_DIRNAME);

// Carpeta de chunks en curso. Empieza con punto para quedar fuera de los listados
// y vive en el mismo volumen que los productos para que el rename final sea atómico.
const UPLOADS_TMP_DIRNAME = '.uploads';
const UPLOADS_TMP_ABS = path.join(PRODUCTOS_ROOT_ABS, UPLOADS_TMP_DIRNAME);

// Sufijo del archivo mientras se está ensamblando (se ignora en los listados)
const ENSAMBLANDO_SUFFIX = '.ensamblando';

// Límites configurables por variable de entorno
const MAX_FILE_SIZE = parseInt(process.env.PRODUCTOS_MAX_FILE_SIZE, 10) || 20 * 1024 * 1024 * 1024; // 20 GB
const MAX_CHUNK_SIZE = parseInt(process.env.PRODUCTOS_MAX_CHUNK_SIZE, 10) || 100 * 1024 * 1024;     // 100 MB
const MAX_IMAGEN_SIZE = parseInt(process.env.PRODUCTOS_MAX_IMAGEN_SIZE, 10) || 10 * 1024 * 1024;    // 10 MB

// Nombres reservados por Windows: no pueden usarse ni con extensión
const NOMBRES_RESERVADOS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Convierte un texto a slug de carpeta: sin acentos, minúsculas, guiones.
 * 'Ciencias Naturales, Experimentales y Tecnología 2'
 *   -> 'ciencias-naturales-experimentales-y-tecnologia-2'
 * @param {string} texto
 * @returns {string}
 */
function slugify(texto) {
    if (!texto || typeof texto !== 'string') return '';
    return texto
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
        .replace(/-+$/g, '');
}

/**
 * Limpia el nombre de un archivo dejándolo utilizable en disco pero reconocible.
 * Conserva espacios, acentos y comas (ej. 'Ciencias Naturales, EyT II.exe'),
 * elimina separadores de ruta, bytes nulos y caracteres inválidos en Windows.
 * @param {string} nombre
 * @returns {string} nombre limpio, o '' si no queda nada usable
 */
function sanitizarNombreArchivo(nombre) {
    if (!nombre || typeof nombre !== 'string') return '';

    let limpio = nombre
        .replace(/\0/g, '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f\x7f]/g, '')
        .replace(/[\\/]/g, '')
        .replace(/[:*?"<>|]/g, '')
        .trim()
        // Windows no admite puntos ni espacios al final del nombre
        .replace(/[. ]+$/g, '')
        .slice(0, 200)
        .replace(/[. ]+$/g, '');

    if (!limpio || limpio === '.' || limpio === '..') return '';
    if (NOMBRES_RESERVADOS.test(limpio)) return '';

    return limpio;
}

/**
 * Limpia una ruta relativa que puede traer subcarpetas ('data/assets/a.pak').
 * Rechaza cualquier intento de salir de la carpeta del producto.
 * @param {string} ruta
 * @returns {string} ruta relativa con separador '/', o '' si es inválida
 */
function sanitizarRutaRelativa(ruta) {
    if (!ruta || typeof ruta !== 'string') return '';

    const segmentos = ruta.split(/[\\/]+/);
    const limpios = [];

    for (const segmento of segmentos) {
        if (segmento === '' || segmento === '.') continue;
        if (segmento === '..') return '';

        const limpio = sanitizarNombreArchivo(segmento);
        if (!limpio) return '';
        limpios.push(limpio);
    }

    return limpios.join('/');
}

/**
 * Resuelve una ruta relativa dentro de una carpeta base y verifica que no se escape.
 * Es la única forma permitida de construir rutas a partir de datos del cliente.
 * @param {string} baseAbs - carpeta base absoluta
 * @param {string} relativo - ruta relativa (ya sanitizada de preferencia)
 * @returns {string|null} ruta absoluta segura, o null si sale de la base
 */
function resolverDentro(baseAbs, relativo) {
    if (!relativo) return null;

    const abs = path.resolve(baseAbs, relativo);
    const rel = path.relative(baseAbs, abs);

    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;

    return abs;
}

/**
 * Convierte el valor de PRO_FILES (ruta web '/productos/slug') a ruta absoluta en disco,
 * validando que quede dentro de la carpeta raíz de productos.
 * @param {string} proFiles
 * @returns {string|null}
 */
function carpetaProductoAbs(proFiles) {
    if (!proFiles || typeof proFiles !== 'string') return null;

    // Aceptamos '/productos/slug', 'productos/slug' o solo 'slug'
    let relativo = proFiles.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (relativo.startsWith(`${PRODUCTOS_DIRNAME}/`)) {
        relativo = relativo.slice(PRODUCTOS_DIRNAME.length + 1);
    } else if (relativo === PRODUCTOS_DIRNAME) {
        return null; // la raíz no es una carpeta de producto válida
    }

    const sanitizado = sanitizarRutaRelativa(relativo);
    if (!sanitizado) return null;

    return resolverDentro(PRODUCTOS_ROOT_ABS, sanitizado);
}

/**
 * Ruta web relativa (la que se guarda en la base y sirve express.static) de una carpeta de producto.
 * @param {string} slug
 * @returns {string} ej. '/productos/mi-producto'
 */
function rutaWebProducto(slug) {
    return `/${PRODUCTOS_DIRNAME}/${slug}`;
}

/**
 * Busca un slug libre en disco. Si 'mi-producto' ya existe prueba 'mi-producto-2', '-3'...
 * @param {string} slugBase
 * @returns {Promise<string>}
 */
async function slugDisponible(slugBase) {
    const base = slugBase || 'producto';
    let candidato = base;
    let intento = 2;

    while (intento < 1000) {
        const abs = resolverDentro(PRODUCTOS_ROOT_ABS, candidato);
        if (!abs) throw new Error('No se pudo generar una carpeta válida para el producto');

        if (!fs.existsSync(abs)) return candidato;

        candidato = `${base}-${intento}`;
        intento += 1;
    }

    throw new Error('No se pudo generar una carpeta libre para el producto');
}

/**
 * Lista recursivamente los archivos reales de la carpeta de un producto.
 * Ignora entradas ocultas (incluida .uploads) y archivos a medio ensamblar.
 * @param {string} carpetaAbs - carpeta del producto en disco
 * @param {string} rutaWebBase - PRO_FILES, para construir la url de cada archivo
 * @returns {Promise<Array<{nombre:string, ruta_relativa:string, ruta_web:string, size:number, modificado:Date}>>}
 */
async function listarArchivos(carpetaAbs, rutaWebBase) {
    const archivos = [];

    async function recorrer(dirAbs, prefijo) {
        let entradas;
        try {
            entradas = await fsp.readdir(dirAbs, { withFileTypes: true });
        } catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
        }

        for (const entrada of entradas) {
            if (entrada.name.startsWith('.')) continue;
            if (entrada.name.endsWith(ENSAMBLANDO_SUFFIX)) continue;

            const hijoAbs = path.join(dirAbs, entrada.name);
            const rutaRelativa = prefijo ? `${prefijo}/${entrada.name}` : entrada.name;

            if (entrada.isDirectory()) {
                await recorrer(hijoAbs, rutaRelativa);
                continue;
            }

            if (!entrada.isFile()) continue;

            let stat;
            try {
                stat = await fsp.stat(hijoAbs);
            } catch (error) {
                if (error.code === 'ENOENT') continue;
                throw error;
            }

            archivos.push({
                nombre: entrada.name,
                ruta_relativa: rutaRelativa,
                ruta_web: `${rutaWebBase}/${rutaRelativa}`,
                size: stat.size,
                modificado: stat.mtime
            });
        }
    }

    await recorrer(carpetaAbs, '');

    archivos.sort((a, b) => a.ruta_relativa.localeCompare(b.ruta_relativa, 'es'));
    return archivos;
}

/**
 * Elimina las carpetas vacías que queden entre un archivo borrado y la carpeta del producto.
 * @param {string} dirAbs - carpeta donde estaba el archivo
 * @param {string} limiteAbs - carpeta del producto (no se elimina nunca)
 */
async function limpiarCarpetasVacias(dirAbs, limiteAbs) {
    let actual = path.resolve(dirAbs);
    const limite = path.resolve(limiteAbs);

    while (actual !== limite) {
        const rel = path.relative(limite, actual);
        if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return;

        let entradas;
        try {
            entradas = await fsp.readdir(actual);
        } catch (error) {
            return;
        }

        if (entradas.length > 0) return;

        try {
            await fsp.rmdir(actual);
        } catch (error) {
            return;
        }

        actual = path.dirname(actual);
    }
}

/**
 * Formatea bytes a texto legible, solo para respuestas informativas.
 * @param {number} bytes
 * @returns {string}
 */
function formatearTamano(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
    let valor = bytes;
    let i = 0;
    while (valor >= 1024 && i < unidades.length - 1) {
        valor /= 1024;
        i += 1;
    }
    return `${valor.toFixed(i === 0 ? 0 : 2)} ${unidades[i]}`;
}

module.exports = {
    BASE_UPLOAD_PATH,
    PRODUCTOS_DIRNAME,
    PRODUCTOS_ROOT_ABS,
    UPLOADS_TMP_ABS,
    ENSAMBLANDO_SUFFIX,
    MAX_FILE_SIZE,
    MAX_CHUNK_SIZE,
    MAX_IMAGEN_SIZE,
    slugify,
    sanitizarNombreArchivo,
    sanitizarRutaRelativa,
    resolverDentro,
    carpetaProductoAbs,
    rutaWebProducto,
    slugDisponible,
    listarArchivos,
    limpiarCarpetasVacias,
    formatearTamano
};
