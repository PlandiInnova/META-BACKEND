const path = require("path");

exports.getTest = (req, res) => {
  try {
    res.send("Servidor Express multimedia usuarios funcionando correctamente.");
  } catch (error) {
    console.error(error);
  }
};

exports.getMultimediaByMat = (req, res) => {
  try {
    const { subtipo,materia } = req.body;
    if (!subtipo,materia) {
      return res.status(400).json({
        error: "Parámetro faltante",
        message: "Se requiere el parámetro 'subtipo,materia' en el cuerpo de la solicitud.",
      });
    }
    const query = `call spGetMultimediaBySub(?,?)`;
    req.db.query(query, [subtipo,materia], (error, results) => {
      if (error) {
        if (error.sqlMessage) {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getMultimediaByMat", message: error.sqlMessage });
        } else {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getMultimediaByMat", message: error });
        }
      } else {
        if (results[0] && results[0].length > 0) {
          res.status(200).json({ data: results[0] });
        } else {
          res.status(500).json({ error: "No hay datos o la estructura del resultado es incorrecta /getMultimediaByMat", message: "La consulta no arrojo datos" });
        }
      }
    });
  } catch (error) {
    console.error("Error en getMultimediaByMat:", error);
    res.status(500).json({
      error: "Error al obtener getMultimediaByMat",
      detalle: error.message,
    });
  }
};
