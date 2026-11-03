const path = require("path");
const fs = require("fs");
const archiver = require("archiver");

exports.getConsultaVobookUsuario = (req, res) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) {
      return res.status(400).json({
        error: "Parámetro faltante",
        message: "Se requieren los parámetros 'usuario' y 'password' en el cuerpo de la solicitud.",
      });
    }
    const query = `call AM_spConsultaVobookUsuario(?, ?)`;
    req.db.query(query, [usuario, password], (error, results) => {
      if (error) {
        if (error.sqlMessage) {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getConsultaVobookUsuario", message: error.sqlMessage });
        } else {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getConsultaVobookUsuario", message: error });
        }
      } else {
        if (results[0] && results[0].length > 0) {
          res.status(200).json({ data: results[0] });
        } else {
          res.status(200).json({ error: "No hay datos o la estructura del resultado es incorrecta /getConsultaVobookUsuario", message: "La consulta no arrojo datos" });
        }
      }
    });
  } catch (error) {
    console.error("Error en getConsultaVobookUsuario:", error);
    res.status(500).json({
      error: "Error al obtener getConsultaVobookUsuario",
      detalle: error.message,
    });
  }
};


exports.getConsultaVoolanUsuario = (req, res) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) {
      return res.status(400).json({
        error: "Parámetro faltante",
        message: "Se requieren los parámetros 'usuario' y 'password' en el cuerpo de la solicitud.",
      });
    }
    const query = `call AM_spConsultaVoolanUsuario(?, ?)`;
    req.db.query(query, [usuario, password], (error, results) => {
      if (error) {
        if (error.sqlMessage) {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getConsultaVoolanUsuario", message: error.sqlMessage });
        } else {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getConsultaVoolanUsuario", message: error });
        }
      } else {
        if (results[0] && results[0].length > 0) {
          res.status(200).json({ data: results[0] });
        } else {
          res.status(200).json({ error: "No hay datos o la estructura del resultado es incorrecta /getConsultaVoolanUsuario", message: "La consulta no arrojo datos" });
        }
      }
    });
  } catch (error) {
    console.error("Error en getConsultaVoolanUsuario:", error);
    res.status(500).json({
      error: "Error al obtener getConsultaVoolanUsuario",
      detalle: error.message,
    });
  }
};

const limpiarNombre = (nombre) => {
  return String(nombre || "SIN_NOMBRE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
};

const obtenerRutaContenido = () =>
  path.resolve(
    process.env.CONTENIDO_LMS || "/var/www/html/CONTENIDO-CLEAR-LMS"
  );

const normalizarRutaRelativa = (ruta) => {
  let relativa = String(ruta || "").trim().replace(/\\/g, "/");

  relativa = relativa.replace(/^[a-z]+:\/\/[^/]+/i, ""); // quita protocolo y dominio
  relativa = relativa.split(/[?#]/)[0];
  try { relativa = decodeURIComponent(relativa); } catch (_) {}

  const marcador = "CONTENIDO-CLEAR-LMS/";
  const idx = relativa.indexOf(marcador);
  if (idx !== -1) relativa = relativa.slice(idx + marcador.length);

  return relativa.replace(/^\/+/, "").replace(/\/+$/, "");
};

const resolverRutaTema = (ruta) => {
  const RUTA_CONTENIDO = obtenerRutaContenido();
  const relativa = normalizarRutaRelativa(ruta);

  if (!relativa) {
    throw new Error("El tema no tiene ruta (TEM_RUTA vacía)");
  }

  const rutaCompleta = path.resolve(RUTA_CONTENIDO, relativa);
  const relativaFinal = path.relative(RUTA_CONTENIDO, rutaCompleta);

  if (
    !relativaFinal ||
    relativaFinal === ".." ||
    relativaFinal.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativaFinal)
  ) {
    throw new Error("Ruta de tema fuera de CONTENIDO-CLEAR-LMS");
  }

  return rutaCompleta;
};

// Genera un ZIP por bloque respetando la estructura de origen:
//   CONTENIDO-CLEAR-LMS/META/1-Semestre/<Materia>/<Bloque>/<Proposito>
//   -> CONTENIDO_ZIPS/META/1-Semestre/<Materia>/<N><NombreBloque>.zip
const crearZipBloque = async (bloque, temas, rutaZipsBase) => {
  const RUTA_CONTENIDO = obtenerRutaContenido();
  const temasNoEncontrados = [];
  const carpetasTemas = [];

  // 1. Resolver y validar las carpetas de los temas
  for (const tema of temas) {
    try {
      let rutaTema = resolverRutaTema(tema.TEM_RUTA);

      if (!fs.existsSync(rutaTema)) {
        temasNoEncontrados.push({
          TEM_ID: tema.TEM_ID,
          TEM_NOMBRE: tema.TEM_NOMBRE,
          RUTA: tema.TEM_RUTA,
          RUTA_BUSCADA: rutaTema
        });
        continue;
      }

      const estadisticas = await fs.promises.stat(rutaTema);

      // Si TEM_RUTA apunta a un archivo (ej. index.html), usar su carpeta
      if (!estadisticas.isDirectory()) {
        rutaTema = path.dirname(rutaTema);
      }

      if (!carpetasTemas.includes(rutaTema)) {
        carpetasTemas.push(rutaTema);
      }
    } catch (error) {
      temasNoEncontrados.push({
        TEM_ID: tema.TEM_ID,
        TEM_NOMBRE: tema.TEM_NOMBRE,
        RUTA: tema.TEM_RUTA,
        ERROR: error.message
      });
    }
  }

  if (carpetasTemas.length === 0) {
    return {
      RESPONSE: "3",
      BLOQUE_ID: bloque.BLQ_ID,
      BLOQUE: bloque.BLQ_NOMBRE,
      MENSAJE: "No se encontraron carpetas de temas para comprimir",
      TEMAS_NO_ENCONTRADOS: temasNoEncontrados
    };
  }

  // 2. Carpeta destino = carpeta de la materia (padre de la carpeta del bloque)
  //    .../<Materia>/<Bloque>/<Proposito>  ->  .../<Materia>
  const carpetaBloqueOrigen = path.dirname(carpetasTemas[0]);
  const carpetaMateriaOrigen = path.dirname(carpetaBloqueOrigen);
  const relativaMateria = path.relative(RUTA_CONTENIDO, carpetaMateriaOrigen);

  if (!relativaMateria || relativaMateria.startsWith("..")) {
    throw new Error(
      `No se pudo determinar la carpeta de la materia a partir de ${carpetasTemas[0]}`
    );
  }

  const carpetaDestino = path.join(rutaZipsBase, relativaMateria);
  await fs.promises.mkdir(carpetaDestino, { recursive: true });

  const nombreZip = `${bloque.BLQ_NUMERO}${limpiarNombre(bloque.BLQ_NOMBRE)}`;
  const rutaZip = path.join(carpetaDestino, `${nombreZip}.zip`);

  // 3. Crear el ZIP con las carpetas de los temas (Proposito1, Proposito2, ...)
  return new Promise((resolve, reject) => {
    const archivo = fs.createWriteStream(rutaZip);
    const zip = archiver("zip", { zlib: { level: 9 } });

    archivo.on("close", () => {
      resolve({
        RESPONSE: "1",
        BLOQUE_ID: bloque.BLQ_ID,
        BLOQUE: bloque.BLQ_NOMBRE,
        ZIP: `${nombreZip}.zip`,
        RUTA: rutaZip,
        BYTES: zip.pointer(),
        TEMAS_AGREGADOS: carpetasTemas.length,
        TEMAS_NO_ENCONTRADOS: temasNoEncontrados
      });
    });

    archivo.on("error", reject);
    zip.on("error", (error) => {
      archivo.destroy();
      reject(error);
    });

    zip.pipe(archivo);

    // Dentro del ZIP se conserva la ruta completa desde CONTENIDO-CLEAR-LMS:
    //   META/1-Semestre/<Materia>/<Bloque>/<Proposito>/...
    for (const carpeta of carpetasTemas) {
      const rutaDentroZip = path
        .relative(RUTA_CONTENIDO, carpeta)
        .split(path.sep)
        .join("/");
      zip.directory(carpeta, rutaDentroZip);
    }

    zip.finalize().catch(reject);
  });
};

exports.generarZips = async (req, res) => {
const RUTA_ZIPS = path.resolve(
  process.env.CONTENIDO_ZIPS || "/var/www/html/CONTENIDO_ZIPS"
);


  try {

    const { subsistema, semestre } = req.query;

    // -----------------------------------------
    // 1. VALIDAR PARÁMETROS
    // -----------------------------------------

    if (
      typeof subsistema !== "string" ||
      !subsistema.trim() ||
      semestre === undefined ||
      !Number.isInteger(Number(semestre)) ||
      Number(semestre) <= 0
    ) {
      return res.status(400).json({
        RESPONSE: "0",
        DESCRIPCION:
          "Debes proporcionar el nombre del subsistema y el número del semestre"
      });
    }

    const nombreSubsistema = subsistema.trim();
    const numeroSemestre = Number(semestre);

    // -----------------------------------------
    // 2. CONSULTAR SUBSISTEMA Y SEMESTRE
    // -----------------------------------------

    const query = `
      SELECT
        sub.SUB_ID,
        sub.SUB_NOMBRE,
        s.SEM_ID,
        s.SEM_NUMERO,
        s.SEM_NOMBRE
      FROM MET_SUBSISTEMA sub
      INNER JOIN MET_SEMESTRE s
        ON s.SEM_SUB_ID = sub.SUB_ID
      WHERE TRIM(sub.SUB_NOMBRE) = ?
        AND s.SEM_NUMERO = ?
        AND sub.SUB_STATUS = 1
        AND s.SEM_STATUS = 1
    `;

    const datos = await new Promise((resolve, reject) => {
      req.db.query(
        query,
        [nombreSubsistema, numeroSemestre],
        (error, results) => {
          if (error) return reject(error);
          resolve(results);
        }
      );
    });

    if (!datos || datos.length === 0) {
      return res.status(404).json({
        RESPONSE: "0",
        DESCRIPCION:
          "No se encontró el subsistema o el semestre solicitado"
      });
    }

    if (datos.length > 1) {
      return res.status(409).json({
        RESPONSE: "0",
        DESCRIPCION:
          "El nombre del subsistema y número de semestre no identifican un único registro"
      });
    }

    const subsistemaEncontrado = datos[0];

    const subId = subsistemaEncontrado.SUB_ID;
    const semId = subsistemaEncontrado.SEM_ID;

    // -----------------------------------------
    // 3. CONSULTAR BLOQUES Y TEMAS
    // -----------------------------------------

    const queryContenido = `
      SELECT DISTINCT
        b.BLQ_ID,
        b.BLQ_NUMERO,
        b.BLQ_NOMBRE,
        t.TEM_ID,
        t.TEM_NOMBRE,
        t.TEM_RUTA
      FROM MET_PRODUCTOS pr
      INNER JOIN MET_MATERIA m
        ON m.MAT_ID = pr.PRO_MAT_ID
       AND m.MAT_SEM_ID = ?
      INNER JOIN MET_BLOQUE b
        ON b.BLQ_MAT_ID = m.MAT_ID
      INNER JOIN MET_TEMA t
        ON t.TEM_BLQ_ID = b.BLQ_ID
      WHERE pr.PRO_SEM_ID = ?
        AND pr.PRO_TIPO = 'Plataforma'
      ORDER BY
        b.BLQ_NUMERO,
        b.BLQ_ID,
        t.TEM_ID
    `;

    const resultados = await new Promise((resolve, reject) => {
      req.db.query(
        queryContenido,
        [semId, semId],
        (error, results) => {
          if (error) return reject(error);
          resolve(results);
        }
      );
    });

    if (!resultados || resultados.length === 0) {
      return res.status(404).json({
        RESPONSE: "0",
        DESCRIPCION:
          "No se encontraron bloques o temas para el subsistema y semestre indicados"
      });
    }

    // -----------------------------------------
    // 4. AGRUPAR TEMAS POR BLOQUE
    // -----------------------------------------

    const bloques = new Map();

    for (const row of resultados) {

      if (!bloques.has(row.BLQ_ID)) {
        bloques.set(row.BLQ_ID, {
          BLQ_ID: row.BLQ_ID,
          BLQ_NUMERO: row.BLQ_NUMERO,
          BLQ_NOMBRE: row.BLQ_NOMBRE,
          TEMAS: []
        });
      }

      bloques.get(row.BLQ_ID).TEMAS.push({
        TEM_ID: row.TEM_ID,
        TEM_NOMBRE: row.TEM_NOMBRE,
        TEM_RUTA: row.TEM_RUTA
      });

    }

    // -----------------------------------------
    // 5. CREAR CARPETA PRINCIPAL DE DESTINO
    // -----------------------------------------

    await fs.promises.mkdir(RUTA_ZIPS, {
      recursive: true
    });

    // -----------------------------------------
    // 6. GENERAR UN ZIP POR BLOQUE
    // -----------------------------------------

    const zipsGenerados = [];
    const errores = [];

    for (const bloque of bloques.values()) {

      try {

        const resultado = await crearZipBloque(
          bloque,
          bloque.TEMAS,
          RUTA_ZIPS
        );

        zipsGenerados.push(resultado);

      } catch (error) {

        errores.push({
          BLOQUE_ID: bloque.BLQ_ID,
          BLOQUE: bloque.BLQ_NOMBRE,
          ERROR: error.message
        });

      }

    }

    // -----------------------------------------
    // 7. RESPUESTA
    // -----------------------------------------

    const totalGenerados = zipsGenerados.length;

    return res.status(200).json({

      RESPONSE: totalGenerados > 0 ? "1" : "3",

      DESCRIPCION:
        totalGenerados > 0
          ? "Generación de ZIPs terminada"
          : "No se pudieron generar los ZIPs",

      SUBSISTEMA: subsistemaEncontrado.SUB_NOMBRE,
      SEMESTRE: subsistemaEncontrado.SEM_NUMERO,

      TOTAL_BLOQUES: bloques.size,
      TOTAL_ZIPS_GENERADOS: totalGenerados,

      CARPETA_DESTINO: RUTA_ZIPS,

      ZIPS: zipsGenerados,
      ERRORES: errores

    });

  } catch (error) {

    console.error("Error en generarZips:", error);

    return res.status(500).json({
      RESPONSE: "0",
      DESCRIPCION: "Error al generar los ZIPs",
      ERROR: error.message
    });

  }

};