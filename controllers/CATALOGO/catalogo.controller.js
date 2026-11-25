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
  subsistema: { tabla: 'CAT_SUBSISTEMA', id: 'SUB_ID', portada: 'SUB_PORTADA', status: 'SUB_STATUS', insert: 'AM_InsertSubsistema', update: 'AM_updateSubsistema' },
  semestre: { tabla: 'CAT_SEMESTRE', id: 'SEM_ID', portada: 'SEM_PORTADA', status: 'SEM_STATUS', insert: 'AM_InsertSemestre', update: 'AM_updateSemestre' },
  libro: { tabla: 'CAT_LIBRO', id: 'LIB_ID', portada: 'LIB_PORTADA', status: 'LIB_STATUS', insert: 'AM_InsertLibro', update: 'AM_updateLibro' },
};

const CARPETA_TMP = path.join(CARPETA_PORTADAS, '.tmp');
const PREFIJO_PORTADA = '../catalogo/';

const sinPrefijo = (valor) => String(valor || '').replace(/^(\.\.\/)?catalogo\//, '');

const slug = (texto) => String(texto || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9\s]/g, ' ')
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 4)
  .join('')
  .slice(0, 40) || 'SinNombre';

const rutaAbsoluta = (valor) => {
  const relativa = sinPrefijo(valor);
  if (!relativa) return null;
  const base = path.resolve(CARPETA_PORTADAS);
  const absoluta = path.resolve(base, relativa);
  return absoluta.startsWith(base + path.sep) ? absoluta : null;
};

const borrarPortada = (relativa) => {
  const absoluta = rutaAbsoluta(relativa);
  if (absoluta) fs.unlink(absoluta, () => {});
};

const descartarTemporal = (archivo) => {
  if (archivo && archivo.path) fs.unlink(archivo.path, () => {});
};

const carpetaDestino = (db, tipo, padre, callback) => {
  if (tipo === 'subsistema') return callback(null, '');

  const query = tipo === 'semestre'
    ? `SELECT SUB_NOMBRE FROM CAT_SUBSISTEMA WHERE SUB_ID = ?`
    : `SELECT sb.SUB_NOMBRE, s.SEM_NOMBRE
       FROM CAT_SEMESTRE s
       INNER JOIN CAT_SUBSISTEMA sb ON sb.SUB_ID = s.SEM_SUB_ID
       WHERE s.SEM_ID = ?`;

  db.query(query, [padre], (error, results) => {
    if (error) return callback(error);
    if (results.length === 0) return callback(null, null);
    const fila = results[0];
    callback(null, tipo === 'semestre'
      ? slug(fila.SUB_NOMBRE)
      : path.posix.join(slug(fila.SUB_NOMBRE), slug(fila.SEM_NOMBRE)));
  });
};

const nombreDisponible = (carpeta, base, ext, actual) => {
  let intento = 1;
  let relativa;
  do {
    relativa = path.posix.join(carpeta, `${base}${intento > 1 ? intento : ''}${ext}`);
    intento++;
  } while (relativa !== actual && fs.existsSync(rutaAbsoluta(relativa)));
  return relativa;
};

const prepararPortada = (db, tipo, datos, archivo, actual, callback) => {
  if (!archivo) return callback(null, null);

  carpetaDestino(db, tipo, datos.padre, (error, carpeta) => {
    if (error) return callback(error);
    if (carpeta === null) {
      return callback(null, null, tipo === 'semestre' ? "El subsistema seleccionado no existe." : "El semestre seleccionado no existe.");
    }
    const ext = path.extname(archivo.originalname || '').toLowerCase();
    callback(null, PREFIJO_PORTADA + nombreDisponible(carpeta, slug(datos.nombre), ext, sinPrefijo(actual)));
  });
};

const moverPortada = (archivo, relativa, callback) => {
  const destino = rutaAbsoluta(relativa);
  if (!destino) return callback(new Error(`Ruta de portada inválida: ${relativa}`));
  fs.mkdir(path.dirname(destino), { recursive: true }, (error) => {
    if (error) return callback(error);
    fs.rename(archivo.path, destino, callback);
  });
};

const errorConsulta = (res, ruta, error) => {
  if (error.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ error: `No se puede eliminar ${ruta}`, message: "El registro tiene registros relacionados, desactívalo en su lugar." });
  }
  res.status(500).json({ error: `Error en la consulta a la base de datos ${ruta}`, message: error.sqlMessage || error.message });
};

const leerDatos = (tipo, body) => {
  const nombre = String(body.nombre || '').trim();
  if (nombre.length < 2) return { message: "El nombre es obligatorio (mínimo 2 caracteres)." };

  const datos = {
    nombre,
    status: ['1', 'true'].includes(String(body.status)) ? 1 : 0,
    padre: null,
    isbn: String(body.isbn || '').trim() || null,
    autores: String(body.autores || '').trim() || null,
    link: String(body.link || '').trim() || null,
  };

  if (tipo !== 'subsistema') {
    datos.padre = parseInt(body.padre_id, 10);
    if (!datos.padre) return { message: "Se requiere el parámetro 'padre_id'." };
  }

  return { datos };
};

const parametros = (tipo, datos, portada) => ({
  subsistema: [datos.nombre, portada],
  semestre: [datos.padre, datos.nombre, portada],
  libro: [datos.padre, datos.nombre, portada, datos.isbn, datos.autores, datos.link],
}[tipo]);

const llamar = (db, procedimiento, params, callback) => {
  const query = `call ${procedimiento}(${params.map(() => '?').join(', ')})`;
  db.query(query, params, (error, results) => {
    if (error) return callback(error);
    callback(null, results[0] && results[0][0] ? results[0][0] : {});
  });
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
        fs.mkdir(CARPETA_TMP, { recursive: true }, (error) => cb(error, CARPETA_TMP));
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${ext}`);
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
  const archivo = req.file || null;
  try {
    const tipo = req.body.tipo;
    const conf = TABLAS[tipo];
    if (!conf) {
      descartarTemporal(archivo);
      return res.status(400).json({ error: "Parámetro faltante", message: "Se requiere el parámetro 'tipo' (subsistema, semestre o libro)." });
    }
    if (!archivo) {
      return res.status(400).json({ error: "Parámetro faltante", message: "Se requiere la imagen de portada." });
    }
    const { datos, message } = leerDatos(tipo, req.body);
    if (message) {
      descartarTemporal(archivo);
      return res.status(400).json({ error: "Parámetro inválido", message });
    }

    prepararPortada(req.dbCatalogo, tipo, datos, archivo, null, (error, portada, mensajePortada) => {
      if (error) {
        descartarTemporal(archivo);
        return errorConsulta(res, '/addRegistro', error);
      }
      if (!portada) {
        descartarTemporal(archivo);
        return res.status(400).json({ error: "Error en /addRegistro", message: mensajePortada });
      }

      llamar(req.dbCatalogo, conf.insert, parametros(tipo, datos, portada), (error, respuesta) => {
        if (error) {
          descartarTemporal(archivo);
          return errorConsulta(res, '/addRegistro', error);
        }
        const id = Number(respuesta.RESPONSE);
        if (!id) {
          descartarTemporal(archivo);
          return res.status(400).json({ error: "Error en /addRegistro", message: respuesta.DESCRIPCION });
        }

        moverPortada(archivo, portada, (error) => {
          if (error) {
            console.error("Error al mover la portada en addRegistro:", error);
            descartarTemporal(archivo);
            return res.status(500).json({ error: "Error en /addRegistro", message: "El registro se creó pero no se pudo guardar la portada." });
          }
          if (datos.status === 1) {
            return res.status(200).json({ data: { id, portada }, message: respuesta.DESCRIPCION });
          }

          llamar(req.dbCatalogo, 'AM_updateStatus', [tipo, id, 0], (error) => {
            if (error) return errorConsulta(res, '/addRegistro', error);
            res.status(200).json({ data: { id, portada }, message: respuesta.DESCRIPCION });
          });
        });
      });
    });
  } catch (error) {
    descartarTemporal(archivo);
    console.error("Error en addRegistro:", error);
    res.status(500).json({ error: "Error al obtener addRegistro", detalle: error.message });
  }
};

exports.updateRegistro = (req, res) => {
  const archivo = req.file || null;
  try {
    const tipo = req.body.tipo;
    const conf = TABLAS[tipo];
    const id = parseInt(req.body.id, 10);
    if (!conf || !id) {
      descartarTemporal(archivo);
      return res.status(400).json({ error: "Parámetro faltante", message: "Se requieren los parámetros 'tipo' e 'id'." });
    }
    const { datos, message } = leerDatos(tipo, req.body);
    if (message) {
      descartarTemporal(archivo);
      return res.status(400).json({ error: "Parámetro inválido", message });
    }

    const query = `SELECT ${conf.portada} AS portada, ${conf.status} AS status FROM ${conf.tabla} WHERE ${conf.id} = ?`;
    req.dbCatalogo.query(query, [id], (error, results) => {
      if (error) {
        descartarTemporal(archivo);
        return errorConsulta(res, '/updateRegistro', error);
      }
      if (results.length === 0) {
        descartarTemporal(archivo);
        return res.status(404).json({ error: "No existe el registro /updateRegistro", message: `No existe el ${tipo} ${id}.` });
      }
      const anterior = results[0];

      prepararPortada(req.dbCatalogo, tipo, datos, archivo, anterior.portada, (error, nueva, mensajePortada) => {
        if (error) {
          descartarTemporal(archivo);
          return errorConsulta(res, '/updateRegistro', error);
        }
        if (archivo && !nueva) {
          descartarTemporal(archivo);
          return res.status(400).json({ error: "Error en /updateRegistro", message: mensajePortada });
        }
        const portada = nueva || anterior.portada;

        llamar(req.dbCatalogo, conf.update, [id, ...parametros(tipo, datos, portada)], (error, respuesta) => {
          if (error) {
            descartarTemporal(archivo);
            return errorConsulta(res, '/updateRegistro', error);
          }
          if (Number(respuesta.RESPONSE) !== 1) {
            descartarTemporal(archivo);
            return res.status(400).json({ error: "Error en /updateRegistro", message: respuesta.DESCRIPCION });
          }

          const terminar = () => {
            if (anterior.status === datos.status) {
              return res.status(200).json({ data: { id, portada }, message: respuesta.DESCRIPCION });
            }
            llamar(req.dbCatalogo, 'AM_updateStatus', [tipo, id, datos.status], (error) => {
              if (error) return errorConsulta(res, '/updateRegistro', error);
              res.status(200).json({ data: { id, portada }, message: respuesta.DESCRIPCION });
            });
          };

          if (!archivo) return terminar();

          moverPortada(archivo, portada, (error) => {
            if (error) {
              console.error("Error al mover la portada en updateRegistro:", error);
              descartarTemporal(archivo);
              return res.status(500).json({ error: "Error en /updateRegistro", message: "El registro se actualizó pero no se pudo guardar la portada." });
            }
            if (anterior.portada && sinPrefijo(anterior.portada) !== sinPrefijo(portada)) borrarPortada(anterior.portada);
            terminar();
          });
        });
      });
    });
  } catch (error) {
    descartarTemporal(archivo);
    console.error("Error en updateRegistro:", error);
    res.status(500).json({ error: "Error al obtener updateRegistro", detalle: error.message });
  }
};

exports.updateStatus = (req, res) => {
  try {
    const { tipo, id, status } = req.body;
    if (!TABLAS[tipo] || !parseInt(id, 10) || status === undefined) {
      return res.status(400).json({ error: "Parámetro faltante", message: "Se requieren los parámetros 'tipo', 'id' y 'status'." });
    }
    const estatus = ['1', 'true'].includes(String(status)) ? 1 : 0;
    llamar(req.dbCatalogo, 'AM_updateStatus', [tipo, parseInt(id, 10), estatus], (error, respuesta) => {
      if (error) return errorConsulta(res, '/updateStatus', error);
      if (Number(respuesta.RESPONSE) !== 1) {
        return res.status(400).json({ error: "Error en /updateStatus", message: respuesta.DESCRIPCION });
      }
      res.status(200).json({ data: { id, status: estatus }, message: respuesta.DESCRIPCION });
    });
  } catch (error) {
    console.error("Error en updateStatus:", error);
    res.status(500).json({ error: "Error al obtener updateStatus", detalle: error.message });
  }
};

