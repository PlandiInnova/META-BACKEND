const express = require('express');
const router = express.Router();
const media = require('../controllers/WEB/media.controller');
const login = require('../controllers/WEB/login.controller');

module.exports = () => {
    router.get('/test', media.getTest);
    router.post('/getAcces', login.getAcces);
    router.post('/getInicioSesion', login.getInicioSesion);
    router.post('/getRegistroUsuario', login.getRegistroUsuario);
    router.post('/getMultimediaByMat', media.getMultimediaByMat);
    router.post('/sendEmailSupport', media.sendEmailSupport);
    router.post('/sendEmailRecupera', media.sendEmailRecupera);
    return router;
}