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
    if (!IDSUBSISTEMA) {
      return res.status(400).json({
        error: "Parámetro faltante",
        message: "Se requiere el parámetro 'IDSUBSISTEMA' en el cuerpo de la solicitud.",
      });
    }
    const query = `call AM_getSemestres(?)`;
    req.dbCatalogo.query(query, [IDSUBSISTEMA], (error, results) => {
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
    if (!IDSEMESTRE) {
      return res.status(400).json({
        error: "Parámetro faltante",
        message: "Se requiere el parámetro 'IDSEMESTRE' en el cuerpo de la solicitud.",
      });
    }
    const query = `call AM_getLibros(?)`;
    req.dbCatalogo.query(query, [IDSEMESTRE], (error, results) => {
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
