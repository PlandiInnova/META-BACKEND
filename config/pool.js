require('dotenv').config();
const mysql = require('mysql');
const config = require('./config')[process.env.NODE_ENV || 'development'];

// Crea un pool para la base indicada (mismo host, usuario y contraseña)
function crearPool(database, nombre) {
    const pool = mysql.createPool({
        host: config.host,
        port: config.port,
        database,
        user: config.username,
        password: config.password,
        waitForConnections: true,
        queueLimit: 0
    });

    function connectToDatabase() {
        pool.getConnection((err, connection) => {
            if (err) {
                console.error(`Error de conexión a ${nombre} (${new Date().toISOString()}):`, err.code);
                setTimeout(connectToDatabase, 5000);
            } else {
                console.log(`✅ Conexión exitosa a la base de datos ${nombre}`);
            }
            if (connection) connection.release();
        });
    }

    connectToDatabase();
    return pool;
}

const pool = crearPool(config.database, 'META');
const poolCatalogo = crearPool(config.databaseCatalogo, 'CATALOGO');

module.exports = { pool, poolCatalogo };
