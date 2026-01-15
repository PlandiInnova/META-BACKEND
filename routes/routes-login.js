const express = require('express');
const router = express.Router();

const { login } = require('../controllers/ADMIN/login/login.controller');

module.exports = () => {

    // Login Route
    router.post('/admin', login);

    return router;
}