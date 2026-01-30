const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const { Server } = require('socket.io');
const dbMiddleware = require('./middlewares/dbMiddleware');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const socketHandler = require('./middlewares/sockets');

// ============   ======== MANEJO GLOBAL DE ERRORES ====================

process.on('uncaughtException', (error) => {
    console.error('========================================');
    console.error('[FATAL] ERROR CRÍTICO - uncaughtException');
    console.error(`Fecha: ${new Date().toISOString()}`);
    console.error(`Mensaje: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    console.error('========================================');
    setTimeout(() => process.exit(1), 1000);
});


process.on('unhandledRejection', (reason, promise) => {
    console.error('========================================');
    console.error('[ERROR - unhandledRejection]');
    console.error(`Fecha: ${new Date().toISOString()}`);
    console.error(`Razón: ${reason}`);
    if (reason instanceof Error) {
        console.error(`Mensaje: ${reason.message}`);
        console.error(`Stack: ${reason.stack}`);
    } else {
        console.error(`Datos: ${JSON.stringify(reason, null, 2)}`);
    }
    console.error('========================================');
});

process.on('warning', (warning) => {
    console.warn('========================================');
    console.warn('[ADVERTENCIA]');
    console.warn(`Fecha: ${new Date().toISOString()}`);
    console.warn(`Nombre: ${warning.name}`);
    console.warn(`Mensaje: ${warning.message}`);
    console.warn(`Stack: ${warning.stack}`);
    console.warn('========================================');
});

const app = express();
const server = http.createServer(app);

server.on('error', (error) => {
    console.error('========================================');
    if (error.code === 'EADDRINUSE') {
        console.error('[ERROR] El puerto ya está en uso');
    } else {
        console.error('[ERROR EN SERVIDOR HTTP]');
    }
    console.error(`Fecha: ${new Date().toISOString()}`);
    console.error(`Mensaje: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    console.error('========================================');
});

server.on('clientError', (error, socket) => {
    // Ignorar errores de conexión abortada (ECONNABORTED, ECONNRESET) - son comunes cuando el cliente cierra la conexión
    if (error.code === 'ECONNABORTED' || error.code === 'ECONNRESET' || error.message === 'write ECONNABORTED') {
        // Estos errores son normales cuando el cliente cierra la conexión antes de que termine la respuesta
        // No son críticos si la respuesta ya se envió correctamente
        return;
    }
    
    // Solo registrar errores realmente importantes
    console.error('========================================');
    console.error('[ERROR EN CLIENTE HTTP]');
    console.error(`Fecha: ${new Date().toISOString()}`);
    console.error(`Código: ${error.code || 'N/A'}`);
    console.error(`Mensaje: ${error.message}`);
    console.error('========================================');
    if (!socket.destroyed) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
});


const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];

const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true
    },
});

socketHandler(io);

io.on('error', (error) => {
    console.error('========================================');
    console.error('[ERROR EN SOCKET.IO]');
    console.error(`Fecha: ${new Date().toISOString()}`);
    console.error(`Mensaje: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    console.error('========================================');
});

io.engine.on('connection_error', (error) => {
    console.error('========================================');
    console.error('[ERROR EN CONEXIÓN SOCKET.IO]');
    console.error(`Fecha: ${new Date().toISOString()}`);
    console.error(`Mensaje: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    console.error('========================================');
});

app.use((req, res, next) => {
    req.io = io;
    next();
});

const PORT = process.env.PORT;

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        status: 429,
        message: 'Demasiadas solicitudes, por favor intente más tarde'
    }
});

const cspDirectives = {
    ...helmet.contentSecurityPolicy.getDefaultDirectives(),
    "frame-ancestors": ["'self'", ...allowedOrigins]
};

app.use(helmet({
    contentSecurityPolicy: { directives: cspDirectives },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    crossOriginResourcePolicy: false,
    permissionsPolicy: {
        features: {
            fullscreen: ["'self'", ...allowedOrigins]
        }
    }
}));

app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    maxAge: 600
}));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(apiLimiter);

// Ruta base para servir archivos estáticos
// En desarrollo: ruta relativa, en producción: ruta absoluta desde .env
const folderPath = process.env.NODE_ENV === 'production'
    ? (process.env.UPLOAD_BASE_PATH || '/var/www/html')
    : path.resolve(__dirname, '../var/www/html');
console.log(`[INFO] Intentando servir archivos desde: ${folderPath}`);

if (fs.existsSync(folderPath)) {
    console.log('[ÉXITO] La carpeta existe. Configurando middleware estático.');
    app.use('/FILES/static', express.static(folderPath));
} else {
    console.error('[ERROR] La carpeta NO existe. Revisa la ruta o los permisos.');
}

const login = require('./routes/routes-login');
app.use('/mapa/v1/login/', dbMiddleware, login());

const users = require('./routes/routes-users');
app.use('/mapa/v1/users/', dbMiddleware, users());

const admin = require('./routes/routes-admin');
app.use('/mapa/v1/admin/', dbMiddleware, admin());

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Ruta no encontrada',
        path: req.originalUrl
    });
});


app.use((err, req, res, next) => {
    const statusCode = err.status || 500;
    const message = process.env.NODE_ENV === 'development'
        ? 'Error interno del servidor'
        : err.message;

    console.error('========================================');
    console.error('[ERROR EN EXPRESS MIDDLEWARE]');
    console.error(`Fecha: ${new Date().toISOString()}`);
    console.error(`Método: ${req.method}`);
    console.error(`URL: ${req.originalUrl}`);
    console.error(`Mensaje: ${err.message}`);
    console.error(`Stack: ${err.stack}`);
    console.error('========================================');

    if (!res.headersSent) {
        res.status(statusCode).json({
            success: false,
            status: statusCode,
            message: message,
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
    }
});



try {
    server.listen(PORT, () => {
        console.log(`Servidor en funcionamiento en el puerto ${PORT}`);
        console.log(`Entorno: ${process.env.NODE_ENV || 'development'}`);
    });
} catch (error) {
    console.error('========================================');
    console.error('[ERROR AL CONFIGURAR SERVIDOR]');
    console.error(`Fecha: ${new Date().toISOString()}`);
    console.error(`Mensaje: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    console.error('========================================');
}