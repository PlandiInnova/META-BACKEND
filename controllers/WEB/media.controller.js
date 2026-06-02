const path = require("path");
const { sendEmailSupport } = require("../../services/emailService");

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
    if (!subtipo || !materia) {
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
          res.status(200).json({ error: "No hay datos o la estructura del resultado es incorrecta /getMultimediaByMat", message: "La consulta no arrojo datos" });
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


exports.sendEmailSupport = async (req, res) => {
  const { nombre, correo, mensaje } = req.body;
  if (!nombre && !correo && !mensaje) {
    return res.status(400).json({
      error: "Parámetro faltantes",
      message: "Se requieren los parámetros 'nombre', 'correo' y 'mensaje' en el cuerpo de la solicitud.",
    });
  }

  try {
    await sendEmailSupport(nombre, correo, mensaje);

    res.status(200).json({
      success: true,
      status: "OK",
      message: "Correo enviado con éxito",
    });
  } catch (emailError) {
    console.error("Error enviando correo:", emailError);
    res.status(200).json({
      success: false,
      status: "ERROR",
      message: `${emailError.message}`,
    });
  }
};
