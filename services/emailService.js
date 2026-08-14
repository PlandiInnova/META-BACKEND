const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const handlebars = require("handlebars");

const transporter = nodemailer.createTransport({
  host: "mail.metabooks.com.mx",
  port: 465,
  secure: true,
  auth: {
    user: process.env.SUPPORT_EMAIL,
    pass: process.env.SUPPORT_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

const emailTemplates = {
  forgotPassword: {
    subject: `Recuperación de contraseña Meta`,
    template: "recupera.html",
    attachments: [
      {
        filename: "ok.png",
        path: path.join(__dirname, "../controllers/WEB/template/ok.png"),
        cid: "ok",
      },
      {
        filename: "logoMeta.png",
        path: path.join(__dirname, "../controllers/WEB/template/logoMeta.png"),
        cid: "logoMeta",
      },
    ],
    dataMapping: (data) => ({
      usuario: data.name,
      contraseña: data.password,
    }),
  },
  changePassword: {
    subject: `Recuperación de contraseña Meta`,
    template: "recupera.html",
    attachments: [
      {
        filename: "unnamed.png",
        path: path.join(__dirname, "../controllers/WEB/template/unnamed.png"),
        cid: "unnamed",
      },
    ],
    dataMapping: (data) => ({ contraseña: data.password }),
  },
  register: {
    subject: `¡Bienvenido a ${process.env.APP_NAME}!`,
    template: "register.html",
    attachments: [
      {
        filename: "ok.png",
        path: path.join(__dirname, "../controllers/WEB/template/ok.png"),
        cid: "ok",
      },
      {
        filename: "logoMeta.png",
        path: path.join(__dirname, "../controllers/WEB/template/logoMeta.png"),
        cid: "logoMeta",
      },
    ],
    dataMapping: (data) => ({
      name: data.name,
      usuario: data.usuario,
      password: data.password,
    }),
  },
};

const sendEmail = async (type, email, data) => {
  console.log(`[emailService] Iniciando envío tipo="${type}" to="${email}" data=`, JSON.stringify(data));
  try {
    const templateConfig = emailTemplates[type];

    if (!templateConfig) {
      throw new Error(`Tipo de correo no soportado: ${type}`);
    }

    const templatePath = path.join(__dirname, "../controllers/WEB/template", templateConfig.template);
    const htmlTemplate = fs.readFileSync(templatePath, "utf8");

    const template = handlebars.compile(htmlTemplate);
    const templateData = templateConfig.dataMapping(data.access);
    const htmlContent = template(templateData);

    const mailOptions = {
      from: `Soporte sistema Meta Holox <${process.env.SUPPORT_EMAIL}>`,
      to: email,
      subject: templateConfig.subject,
      html: htmlContent,
      attachments: templateConfig.attachments,
    };

    console.log(`[emailService] Enviando a "${email}" con subject="${templateConfig.subject}"`);
    const info = await transporter.sendMail(mailOptions);
    console.log(`[emailService] Correo enviado OK messageId=${info.messageId}`);
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error(`[emailService] Error tipo="${type}":`, error.message);
    console.error(`[emailService] Stack:`, error.stack);
    throw error;
  }
};

const sendEmailSupport = async (nombre, correo, mensaje) => {
  const now = new Date();
  const formato = now.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).replace(' de ', ' ').replace(' de ', ', ');
  try {
    const mailOptions = {
      from: `"META Support System" <${correo}>`, // El nombre del remitente y su correo
      to: "contacto@metabooks.com.mx",
      replyTo: correo, // This allows you to reply directly to the user
      subject: `Nuevo mensaje de soporte de ${nombre}`,
      html: `
                <html>
                <head>
                  <style>
                  .user-info {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 20px;
                  }
                  .user-info td {
                      padding: 12px;
                      border-bottom: 1px solid #f0f0f0;
                  }
                  </style>
                </head>
                <body>
                  <span>  📥 ¡Hemos recibido un nuevo mensaje!</span> 
                  <span>Hola Equipo de Soporte META, se ha generado una nueva consulta a través del formulario de contacto. 
                  Aquí tienes los detalles: </span> 
                  <table class="user-info">
                  <tr>
                      <td class="label">👤 Nombre</td>
                      <td class="value">${nombre}</td>
                  </tr>
                  <tr>
                      <td class="label">📧 Correo</td>
                      <td class="value"><a href="mailto:${correo}" style="color: #2563eb; text-decoration: none;">${correo}</a></td>
                  </tr>
                  <tr>
                      <td class="label">📅 Fecha</td>
                      <td class="value">${formato}</td>
                  </tr>
                  </table>
                  <span>Mensaje del usuario:</span> 
                  <div class="message-box">
                   "${mensaje}"
                  </div>
                </body>
                </html>
            `,
    };

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error(`Error en sendEmailSupport (${correo}):`, error);
    throw new Error(`Error al enviar el correo de ${correo}`);
  }
};

module.exports = {
  sendEmail,
  sendEmailSupport,
};
