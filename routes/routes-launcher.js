const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// Evita spam en el formulario de soporte: máximo 3 mensajes por IP cada 15 minutos
const supportLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    skipFailedRequests: true,
    legacyHeaders: false,
    message: {
        success: false,
        status: 'ERROR',
        message: 'Has enviado demasiados mensajes, por favor intenta más tarde'
    }
});
const launcher = require('../controllers/LAUNCHER/launcher.controller');

module.exports = () => {
    router.post('/getConsultaVobookUsuario', launcher.getConsultaVobookUsuario);
    router.post('/getConsultaVoolanUsuario', launcher.getConsultaVoolanUsuario);
    return router;
}