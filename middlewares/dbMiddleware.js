const { pool, poolCatalogo } = require('../config/pool');

function dbMiddleware(req, res, next) {
    req.db = pool;
    req.dbCatalogo = poolCatalogo;
    next();
}

module.exports = dbMiddleware;
