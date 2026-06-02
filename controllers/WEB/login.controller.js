const path = require("path");


exports.getAcces = (req, res) => {
  try {
    const { LICENCIA } = req.body;
    if (!LICENCIA) {
      return res.status(400).json({
        error: "Parámetro faltante",
        message: "Se requiere el parámetro 'LICENCIA' en el cuerpo de la solicitud.",
      });
    }
    const query = `call validarLicencia(?)`;
    req.db.query(query, [LICENCIA], (error, results) => {
      if (error) {
        if (error.sqlMessage) {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getAcces", message: error.sqlMessage });
        } else {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getAcces", message: error });
        }
      } else {
        if (results[0] && results[0].length > 0) {
          res.status(200).json({ data: results[0] });
        } else {
          res.status(200).json({ error: "No hay datos o la estructura del resultado es incorrecta /getAcces", message: "La consulta no arrojo datos" });
        }
      }
    });
  } catch (error) {
    console.error("Error en getAcces:", error);
    res.status(500).json({
      error: "Error al obtener getAcces",
      detalle: error.message,
    });
  }
};
