const path = require("path");

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