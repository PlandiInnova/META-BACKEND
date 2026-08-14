const path = require("path");
const { sendEmail } = require("../../services/emailService");


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


exports.getInicioSesion = (req, res) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) {
      return res.status(400).json({
        error: "Parámetro faltante",
        message: "Se requieren los parámetros 'usuario' y 'password' en el cuerpo de la solicitud.",
      });
    }
    const query = `call AM_spInicioSesion(?, ?)`;
    req.db.query(query, [usuario, password], (error, results) => {
      if (error) {
        if (error.sqlMessage) {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getInicioSesion", message: error.sqlMessage });
        } else {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getInicioSesion", message: error });
        }
      } else {
        if (results[0] && results[0].length > 0) {
          res.status(200).json({ data: results[0] });
        } else {
          res.status(200).json({ error: "No hay datos o la estructura del resultado es incorrecta /getInicioSesion", message: "La consulta no arrojo datos" });
        }
      }
    });
  } catch (error) {
    console.error("Error en getInicioSesion:", error);
    res.status(500).json({
      error: "Error al obtener getInicioSesion",
      detalle: error.message,
    });
  }
};


exports.getRegistroUsuario = (req, res) => {
  try {
    const { usuario, password, nombre, apellido1, apellido2, telefono, email, licencia } = req.body;
    if (!usuario || !password || !nombre || !apellido1 || !apellido2 || !telefono || !email || !licencia) {
      return res.status(400).json({
        error: "Parámetro faltante",
        message: "Se requieren usuario, password, nombre, apellido1, apellido2, telefono, email, licencia de parámetros en el cuerpo de la solicitud.",
      });
    }
    const query = `call AM_spRegistrarUsuario(?, ?, ?, ?, ?, ?, ?, ?)`;
    req.db.query(query, [usuario, password, nombre, apellido1, apellido2, telefono, email, licencia], async (error, results) => {
      if (error) {
        if (error.sqlMessage) {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getRegistroUsuario", message: error.sqlMessage });
        } else {
          res.status(500).json({ error: "Error en la consulta a la base de datos /getRegistroUsuario", message: error });
        }
      } else {
        if (results[0] && results[0].length > 0) {
          const RESPONSE = results[0][0] ? results[0][0].RESPONSE : undefined;
          res.status(200).json({ data: results[0] });
          if (RESPONSE === "1" || RESPONSE === 1) {
            try {
              const access = {
                name: nombre,
                usuario: usuario,
                password: password,
              };
              await sendEmail("register", email, { access });
              console.log("Correo creedenciales correctamente");
            } catch (emailError) {
              console.error("Error enviando correo credenciales:", emailError);
            }
          }
        } else {
          res.status(200).json({ error: "No hay datos o la estructura del resultado es incorrecta /getRegistroUsuario", message: "La consulta no arrojo datos" });
        }
      }
    });
  } catch (error) {
    console.error("Error en getRegistroUsuario:", error);
    res.status(500).json({
      error: "Error al obtener getRegistroUsuario",
      detalle: error.message,
    });
  }
};