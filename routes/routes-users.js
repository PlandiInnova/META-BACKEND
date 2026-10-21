const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// Evita spam en el formulario de soporte: máximo 3 mensajes por IP cada 15 minutos
const supportLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        status: 'ERROR',
        message: 'Has enviado demasiados mensajes, por favor intenta más tarde'
    }
});
const media = require('../controllers/WEB/media.controller');
const login = require('../controllers/WEB/login.controller');

module.exports = () => {
    router.get('/test', media.getTest);
    router.post('/getAcces', login.getAcces);
    router.post('/getInicioSesion', login.getInicioSesion);
    router.post('/getRegistroUsuario', login.getRegistroUsuario);
    router.post('/getMultimediaByMat', media.getMultimediaByMat);
    router.post('/sendEmailSupport', supportLimiter, media.sendEmailSupport);
    router.post('/sendEmailRecupera', media.sendEmailRecupera);
    return router;
}