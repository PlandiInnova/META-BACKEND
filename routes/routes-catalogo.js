const express = require('express');
const router = express.Router();
const catalogo = require('../controllers/CATALOGO/catalogo.controller');

module.exports = () => {
    router.get('/getTestCatalogo', catalogo.getTestCatalogo);
    router.post('/getSubsistemas', catalogo.getSubsistemas);
    router.post('/getSemestres', catalogo.getSemestres);
    router.post('/getLibros', catalogo.getLibros);

    router.get('/getCatalogo', catalogo.getCatalogo);
    router.get('/getPortadaGeneral', catalogo.getPortadaGeneral);
    router.post('/updatePortadaGeneral', catalogo.uploadPortada, catalogo.updatePortadaGeneral);
    router.post('/addRegistro', catalogo.uploadPortada, catalogo.addRegistro);
    router.post('/updateRegistro', catalogo.uploadPortada, catalogo.updateRegistro);
    router.post('/updateStatus', catalogo.updateStatus);
    return router;
}
