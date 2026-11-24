const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const CARPETA_PORTADAS = path.join(
  process.env.NODE_ENV === 'production'
    ? (process.env.UPLOAD_BASE_PATH || '/var/www/html')
    : path.resolve(__dirname, '../../../var/www/html'),
  'catalogo'
);

const TABLAS = {
  subsistema: { tabla: 'CAT_SUBSISTEMA', id: 'SUB_ID', nombre: 'SUB_NOMBRE', portada: 'SUB_PORTADA', status: 'SUB_STATUS', padre: null },
  semestre: { tabla: 'CAT_SEMESTRE', id: 'SEM_ID', nombre: 'SEM_NOMBRE', portada: 'SEM_PORTADA', status: 'SEM_STATUS', padre: 'SEM_SUB_ID' },
  libro: { tabla: 'CAT_LIBRO', id: 'LIB_ID', nombre: 'LIB_NOMBRE', portada: 'LIB_PORTADA', status: 'LIB_STATUS', padre: 'LIB_SEM_ID' },
};

const borrarPortada = (archivo) => {
  if (!archivo || archivo !== path.basename(archivo)) return;
  fs.unlink(path.join(CARPETA_PORTADAS, archivo), () => {});
};

const errorConsulta = (res, ruta, error) => {
  if (error.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ error: `No se puede eliminar ${ruta}`, message: "El registro tiene registros relacionados, desactívalo en su lugar." });
  }
  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(400).json({ error: `Error en ${ruta}`, message: "El registro padre seleccionado no existe." });
  }
  res.status(500).json({ error: `Error en la consulta a la base de datos ${ruta}`, message: error.sqlMessage || error.message });
};

const leerCampos = (conf, body) => {
  const nombre = String(body.nombre || '').trim();
  if (nombre.length < 2) return { message: "El nombre es obligatorio (mínimo 2 caracteres)." };

  const campos = {
    [conf.nombre]: nombre,
    [conf.status]: ['1', 'true'].includes(String(body.status)) ? 1 : 0,
  };

  if (conf.padre) {
    const padre = parseInt(body.padre_id, 10);
    if (!padre) return { message: "Se requiere el parámetro 'padre_id'." };
    campos[conf.padre] = padre;
  }

  if (conf.tabla === 'CAT_LIBRO') {
    campos.LIB_ISBN = String(body.isbn || '').trim() || null;
    campos.LIB_AUTORES = String(body.autores || '').trim() || null;
    campos.LIB_LINK = String(body.link || '').trim() || null;
  }

  return { campos };
};

// Ejemplo de consulta usando la segunda conexión (req.dbCatalogoCatalogo)
exports.getTestCatalogo = (req, res) => {
  try {
    // Cambia la consulta por tu tabla o procedimiento, p. ej. `call spMiProcedimiento(?)`
    const query = `SELECT * FROM nombre_tabla LIMIT ?`;
    const limite = parseInt(req.query.limite, 10) || 10;

    req.dbCatalogoCatalogo.query(query, [limite], (error, results) => {
      if (error) {
        return res.status(500).json({
          error: "Error en la consulta a la base de datos /getTestCatalogo",
          message: error.sqlMessage || error,
        });
      }
      if (results && results.length > 0) {
        return res.status(200).json({ data: results });
      }
      res.status(200).json({ error: "No hay datos /getTestCatalogo", message: "La consulta no arrojo datos" });
    });
  } catch (error) {
    console.error("Error en getTestCatalogo:", error);
    res.status(500).json({ error: "Error al obtener getTestCatalogo", detalle: error.message });
  }
};

exports.getSubsistemas = (req, res) => {
  try {
    const query = `call AM_getSubsistemas()`;
    req.dbCatalogo.query(query, [], (error, results) => {
      if (error) {
        if (error.sqlMessage) {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getSubsistemas", message: error.sqlMessage });
        } else {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getSubsistemas", message: error });
        }
      } else {
        if (results[0] && results[0].length > 0) {
          res.status(200).json({ data: results[0] });
        } else {
          res.status(200).json({ error: "No hay datos o la estructura del resultado es incorrecta /getSubsistemas", message: "La consulta no arrojo datos" });
        }
      }
    });
  } catch (error) {
    console.error("Error en getSubsistemas:", error);
    res.status(500).json({
      error: "Error al obtener getSubsistemas",
      detalle: error.message,
    });
  }
};

exports.getSemestres = (req, res) => {
  try {
    const { IDSUBSISTEMA } = req.body;
    const query = `call AM_getSemestres(?)`;
    req.dbCatalogo.query(query, [IDSUBSISTEMA || null], (error, results) => {
      if (error) {
        if (error.sqlMessage) {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getSemestres", message: error.sqlMessage });
        } else {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getSemestres", message: error });
        }
      } else {
        if (results[0] && results[0].length > 0) {
          res.status(200).json({ data: results[0] });
        } else {
          res.status(200).json({ error: "No hay datos o la estructura del resultado es incorrecta /getSemestres", message: "La consulta no arrojo datos" });
        }
      }
    });
  } catch (error) {
    console.error("Error en getSemestres:", error);
    res.status(500).json({
      error: "Error al obtener getSemestres",
      detalle: error.message,
    });
  }
};

exports.getLibros = (req, res) => {
  try {
    const { IDSEMESTRE } = req.body;
    const query = `call AM_getLibros(?)`;
    req.dbCatalogo.query(query, [IDSEMESTRE || null], (error, results) => {
      if (error) {
        if (error.sqlMessage) {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getLibros", message: error.sqlMessage });
        } else {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getLibros", message: error });
        }
      } else {
        if (results[0] && results[0].length > 0) {
          res.status(200).json({ data: results[0] });
        } else {
          res.status(200).json({ error: "No hay datos o la estructura del resultado es incorrecta /getLibros", message: "La consulta no arrojo datos" });
        }
      }
    });
  } catch (error) {
    console.error("Error en getLibros:", error);
    res.status(500).json({
      error: "Error al obtener getLibros",
      detalle: error.message,
    });
  }
};

exports.uploadPortada = (req, res, next) => {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        fs.mkdir(CARPETA_PORTADAS, { recursive: true }, (error) => cb(error, CARPETA_PORTADAS));
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        cb(null, `portada-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}${ext}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (!file.mimetype.startsWith('image/') || !['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
        return cb(new Error("La portada debe ser una imagen png, jpg, webp o gif."));
      }
      cb(null, true);
    },
  }).single('portada');

  upload(req, res, (error) => {
    if (error) {
      const esLimite = error.code === 'LIMIT_FILE_SIZE';
      return res.status(esLimite ? 413 : 400).json({
        error: "Error al subir la portada",
        message: esLimite ? "La imagen supera el límite de 5 MB." : error.message,
      });
    }
    next();
  });
};

exports.getCatalogo = (req, res) => {
  try {
    const query = `
      SELECT sb.SUB_ID, sb.SUB_NOMBRE, sb.SUB_PORTADA,
             s.SEM_ID, s.SEM_NOMBRE, s.SEM_PORTADA,
             l.LIB_ID, l.LIB_NOMBRE, l.LIB_PORTADA, l.LIB_ISBN, l.LIB_AUTORES, l.LIB_LINK
      FROM CAT_SUBSISTEMA sb
      LEFT JOIN CAT_SEMESTRE s ON s.SEM_SUB_ID = sb.SUB_ID AND s.SEM_STATUS = 1
      LEFT JOIN CAT_LIBRO l ON l.LIB_SEM_ID = s.SEM_ID AND l.LIB_STATUS = 1
      WHERE sb.SUB_STATUS = 1
      ORDER BY sb.SUB_ID, s.SEM_ID, l.LIB_ID`;
    req.dbCatalogo.query(query, [], (error, results) => {
      if (error) return errorConsulta(res, '/getCatalogo', error);

      const subsistemas = [];
      const subs = new Map();
      const sems = new Map();

      for (const fila of results) {
        if (!subs.has(fila.SUB_ID)) {
          const sub = { id: fila.SUB_ID, nombre: fila.SUB_NOMBRE, portada: fila.SUB_PORTADA, semestres: [] };
          subs.set(fila.SUB_ID, sub);
          subsistemas.push(sub);
        }
        const sub = subs.get(fila.SUB_ID);
        if (!fila.SEM_ID) continue;

        if (!sems.has(fila.SEM_ID)) {
          const sem = { id: fila.SEM_ID, numero: sub.semestres.length + 1, nombre: fila.SEM_NOMBRE, portada: fila.SEM_PORTADA, libros: [] };
          sems.set(fila.SEM_ID, sem);
          sub.semestres.push(sem);
        }
        if (!fila.LIB_ID) continue;

        sems.get(fila.SEM_ID).libros.push({
          id: fila.LIB_ID,
          nombre: fila.LIB_NOMBRE,
          portada: fila.LIB_PORTADA,
          isbn: fila.LIB_ISBN,
          autores: fila.LIB_AUTORES,
          link: fila.LIB_LINK,
        });
      }

      res.status(200).json({ data: subsistemas });
    });
  } catch (error) {
    console.error("Error en getCatalogo:", error);
    res.status(500).json({ error: "Error al obtener getCatalogo", detalle: error.message });
  }
};

exports.addRegistro = (req, res) => {
  const archivo = req.file ? req.file.filename : null;
  try {
    const conf = TABLAS[req.body.tipo];
    if (!conf) {
      borrarPortada(archivo);
      return res.status(400).json({ error: "Parámetro faltante", message: "Se requiere el parámetro 'tipo' (subsistema, semestre o libro)." });
    }
    if (!archivo) {
      return res.status(400).json({ error: "Parámetro faltante", message: "Se requiere la imagen de portada." });
    }
    const { campos, message } = leerCampos(conf, req.body);
    if (message) {
      borrarPortada(archivo);
      return res.status(400).json({ error: "Parámetro inválido", message });
    }
    campos[conf.portada] = archivo;

    req.dbCatalogo.query(`INSERT INTO ${conf.tabla} SET ?`, [campos], (error, results) => {
      if (error) {
        borrarPortada(archivo);
        return errorConsulta(res, '/addRegistro', error);
      }
      res.status(200).json({ data: { id: results.insertId } });
    });
  } catch (error) {
    borrarPortada(archivo);
    console.error("Error en addRegistro:", error);
    res.status(500).json({ error: "Error al obtener addRegistro", detalle: error.message });
  }
};

exports.updateRegistro = (req, res) => {
  const archivo = req.file ? req.file.filename : null;
  try {
    const conf = TABLAS[req.body.tipo];
    const id = parseInt(req.body.id, 10);
    if (!conf || !id) {
      borrarPortada(archivo);
      return res.status(400).json({ error: "Parámetro faltante", message: "Se requieren los parámetros 'tipo' e 'id'." });
    }
    const { campos, message } = leerCampos(conf, req.body);
    if (message) {
      borrarPortada(archivo);
      return res.status(400).json({ error: "Parámetro inválido", message });
    }
    if (archivo) campos[conf.portada] = archivo;

    req.dbCatalogo.query(`SELECT ${conf.portada} AS portada FROM ${conf.tabla} WHERE ${conf.id} = ?`, [id], (error, results) => {
      if (error) {
        borrarPortada(archivo);
        return errorConsulta(res, '/updateRegistro', error);
      }
      if (results.length === 0) {
        borrarPortada(archivo);
        return res.status(404).json({ error: "No existe el registro /updateRegistro", message: `No existe el ${req.body.tipo} ${id}.` });
      }
      const portadaAnterior = results[0].portada;

      req.dbCatalogo.query(`UPDATE ${conf.tabla} SET ? WHERE ${conf.id} = ?`, [campos, id], (error) => {
        if (error) {
          borrarPortada(archivo);
          return errorConsulta(res, '/updateRegistro', error);
        }
        if (archivo && portadaAnterior) borrarPortada(portadaAnterior);
        res.status(200).json({ data: { id } });
      });
    });
  } catch (error) {
    borrarPortada(archivo);
    console.error("Error en updateRegistro:", error);
    res.status(500).json({ error: "Error al obtener updateRegistro", detalle: error.message });
  }
};

exports.deleteRegistro = (req, res) => {
  try {
    const conf = TABLAS[req.body.tipo];
    const id = parseInt(req.body.id, 10);
    if (!conf || !id) {
      return res.status(400).json({ error: "Parámetro faltante", message: "Se requieren los parámetros 'tipo' e 'id'." });
    }
    req.dbCatalogo.query(`SELECT ${conf.portada} AS portada FROM ${conf.tabla} WHERE ${conf.id} = ?`, [id], (error, results) => {
      if (error) return errorConsulta(res, '/deleteRegistro', error);
      if (results.length === 0) {
        return res.status(404).json({ error: "No existe el registro /deleteRegistro", message: `No existe el ${req.body.tipo} ${id}.` });
      }

      req.dbCatalogo.query(`DELETE FROM ${conf.tabla} WHERE ${conf.id} = ?`, [id], (error) => {
        if (error) return errorConsulta(res, '/deleteRegistro', error);
        borrarPortada(results[0].portada);
        res.status(200).json({ data: { id } });
      });
    });
  } catch (error) {
    console.error("Error en deleteRegistro:", error);
    res.status(500).json({ error: "Error al obtener deleteRegistro", detalle: error.message });
  }
};
