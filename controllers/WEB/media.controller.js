const path = require("path");
const dns = require("dns").promises;
const { sendEmailSupport } = require("../../services/emailService");
const { sendEmail } = require("../../services/emailService");

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

exports.sendEmailRecupera = async (req, res) => {
  const { correo } = req.body;
  if (!correo) {
    return res.status(400).json({
      error: "Parámetro faltantes",
      message: "Se requieren los parámetros 'correo' en el cuerpo de la solicitud.",
    });
  }

  const query = `call AM_spGetDetallesByCorreo(?)`;
  req.db.query(query, [correo], async (error, results) => {
    if (error) {
      res.status(500).json({ error: "Error en la consulta a la base de datos /sendEmailRecupera" });
    } else {
      if (results[0] && results[0].length > 0) {
        console.log(results);
        if (results[0][0].RESPONSE == "1") {
          try {
            const access = {
              name: results[0][0].USU_USUARIO,
              password: results[0][0].USU_PASSWORD,
            };
            await sendEmail("forgotPassword", correo, { access });
            res.status(200).json({
              success: true,
              status: "OK",
              message: "Contraseña enviada al correo electrónico",
            });
          } catch (emailError) {
            console.error("Error enviando correo:", emailError);
            res.status(200).json({
              success: false,
              status: "ERROR",
              message: "Error al enviar el correo",
            });
          }
        } else if (results[0][0].RESPONSE == "0") {
          res.status(200).json({ success: false, message: "Correo no existe" });
        } else {
          res.status(200).json({ success: false, message: "Error en la consulta" });
        }
      } else {
        res.status(200).json({ success: false, message: "Error en la consulta" });
      }
    }
  });
};


const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DOMINIOS_DESECHABLES = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "yopmail.com", "trashmail.com", "sharklasers.com",
  "getnada.com", "dispostable.com", "maildrop.cc", "throwawaymail.com",
]);
const SOPORTE_COOLDOWN_MS = 10 * 60 * 1000;
const ultimoEnvioPorCorreo = new Map();

const escapeHtml = (texto) =>
  String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Verifica que el dominio del correo tenga servidores de correo (registros MX)
const dominioRecibeCorreo = async (dominio) => {
  try {
    const mx = await dns.resolveMx(dominio);
    return mx.some((r) => r.exchange);
  } catch (error) {
    return false;
  }
};

exports.sendEmailSupport = async (req, res) => {
  const nombre = typeof req.body.nombre === "string" ? req.body.nombre.trim() : "";
  const correo = typeof req.body.correo === "string" ? req.body.correo.trim().toLowerCase() : "";
  const mensaje = typeof req.body.mensaje === "string" ? req.body.mensaje.trim() : "";

  if (!nombre || !correo || !mensaje) {
    return res.status(400).json({
      error: "Parámetro faltantes",
      message: "Se requieren los parámetros 'nombre', 'correo' y 'mensaje' en el cuerpo de la solicitud.",
    });
  }

  if (nombre.length > 100 || mensaje.length < 10 || mensaje.length > 2000) {
    return res.status(400).json({
      success: false,
      status: "ERROR",
      message: "El nombre debe tener máximo 100 caracteres y el mensaje entre 10 y 2000 caracteres.",
    });
  }

  if (correo.length > 254 || !EMAIL_REGEX.test(correo)) {
    return res.status(400).json({
      success: false,
      status: "ERROR",
      message: "El correo electrónico no tiene un formato válido.",
    });
  }

  const dominio = correo.split("@")[1];
  if (DOMINIOS_DESECHABLES.has(dominio) || !(await dominioRecibeCorreo(dominio))) {
    return res.status(400).json({
      success: false,
      status: "ERROR",
      message: "El correo electrónico no existe o no puede recibir mensajes.",
    });
  }

  const ahora = Date.now();
  const ultimoEnvio = ultimoEnvioPorCorreo.get(correo);
  if (ultimoEnvio && ahora - ultimoEnvio < SOPORTE_COOLDOWN_MS) {
    return res.status(429).json({
      success: false,
      status: "ERROR",
      message: "Ya enviaste un mensaje recientemente, por favor espera unos minutos.",
    });
  }
  // Limpia entradas vencidas para que el mapa no crezca indefinidamente
  for (const [key, fecha] of ultimoEnvioPorCorreo) {
    if (ahora - fecha >= SOPORTE_COOLDOWN_MS) ultimoEnvioPorCorreo.delete(key);
  }

  try {
    await sendEmailSupport(escapeHtml(nombre), correo, escapeHtml(mensaje));
    ultimoEnvioPorCorreo.set(correo, ahora);

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
