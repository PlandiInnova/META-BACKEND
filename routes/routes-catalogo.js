const express = require('express');
const router = express.Router();
const catalogo = require('../controllers/CATALOGO/catalogo.controller');

module.exports = () => {
    router.get('/getEjemploCatalogo', catalogo.getEjemploCatalogo);
    return router;
}
