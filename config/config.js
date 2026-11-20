require('dotenv').config();

module.exports = {
    development: {
        host: process.env.META_HOST_DEV,
        port: process.env.META_PORT_DEV,
        database: process.env.META_DATABASE_DEV,
        databaseCatalogo: process.env.META_DATABASE_CATALOGO_DEV,
        username: process.env.META_USERNAME_DEV,
        password: process.env.META_PASSWORD_DEV,
        dialect: process.env.META_DIALECT_DEV,
    },
    production: {
        host: process.env.META_HOST,
        port: process.env.META_PORT,
        database: process.env.META_DATABASE,
        databaseCatalogo: process.env.META_DATABASE_CATALOGO,
        username: process.env.META_USERNAME,
        password: process.env.META_PASSWORD,
        dialect: process.env.META_DIALECT,
    }
};
