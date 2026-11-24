const express = require('express');
const router = express.Router();
const catalogo = require('../controllers/CATALOGO/catalogo.controller');

module.exports = () => {
    router.get('/getTestCatalogo', catalogo.getTestCatalogo);
    router.post('/getSubsistemas', catalogo.getSubsistemas);
    router.post('/getSemestres', catalogo.getSemestres);
    router.post('/getLibros', catalogo.getLibros);

    router.get('/getCatalogo', catalogo.getCatalogo);
    router.post('/addRegistro', catalogo.uploadPortada, catalogo.addRegistro);
    router.post('/updateRegistro', catalogo.uploadPortada, catalogo.updateRegistro);
    router.post('/deleteRegistro', catalogo.deleteRegistro);
    return router;
}
