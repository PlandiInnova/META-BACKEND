const activeSockets = new Map();

// Función para validar datos recibidos
function validateSocketData(data, eventName) {
    if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Los datos deben ser un objeto' };
    }
    return { valid: true };
}

// Función para obtener el número de sockets activos
function getActiveSocketsCount() {
    return activeSockets.size;
}

module.exports = (io) => {
    io.on('connection', (socket) => {
        try {
            activeSockets.set(socket.id, socket);
            console.log(`[SOCKET] Nuevo usuario conectado: ${socket.id}`);
            console.log(`[SOCKET] Total de conexiones activas: ${activeSockets.size}`);

            socket.join('global-room');
            console.log(`[SOCKET] Usuario ${socket.id} unido a la sala global`);

            // Listener para subida completa
            socket.on('client-upload-complete', (data) => {
                try {
                    const validation = validateSocketData(data, 'client-upload-complete');
                    if (!validation.valid) {
                        console.error(`[SOCKET ERROR] ${socket.id} - ${validation.error}`);
                        socket.emit('error', { message: validation.error });
                        return;
                    }
                    console.log(`[SOCKET] Subida recibida de ${socket.id}:`, data);
                    io.to('global-room').emit('new-upload', data);
                } catch (error) {
                    console.error(`[SOCKET ERROR] Error procesando client-upload-complete:`, error);
                    socket.emit('error', { message: 'Error al procesar la subida' });
                }
            });

            // Listener para issue completa
            socket.on('client-complete', (data) => {
                try {
                    const validation = validateSocketData(data, 'client-complete');
                    if (!validation.valid) {
                        console.error(`[SOCKET ERROR] ${socket.id} - ${validation.error}`);
                        socket.emit('error', { message: validation.error });
                        return;
                    }
                    console.log(`[SOCKET] Subida issue recibida de ${socket.id}:`, data);
                    io.to('global-room').emit('new-issue', data);
                } catch (error) {
                    console.error(`[SOCKET ERROR] Error procesando client-complete:`, error);
                    socket.emit('error', { message: 'Error al procesar la issue' });
                }
            });

            // Listener para eliminación completa
            socket.on('client-delete-complete', (data) => {
                try {
                    const validation = validateSocketData(data, 'client-delete-complete');
                    if (!validation.valid) {
                        console.error(`[SOCKET ERROR] ${socket.id} - ${validation.error}`);
                        socket.emit('error', { message: validation.error });
                        return;
                    }
                    console.log(`[SOCKET] Eliminación recibida de ${socket.id}:`, data);
                    io.to('global-room').emit('new-delete', data);
                } catch (error) {
                    console.error(`[SOCKET ERROR] Error procesando client-delete-complete:`, error);
                    socket.emit('error', { message: 'Error al procesar la eliminación' });
                }
            });

            // Manejo de desconexión
            socket.on('disconnect', (reason) => {
                console.log(`[SOCKET] Usuario desconectado: ${socket.id} (${reason})`);
                if (activeSockets.has(socket.id)) {
                    activeSockets.delete(socket.id);
                    console.log(`[SOCKET] Socket ${socket.id} removido de activeSockets`);
                    console.log(`[SOCKET] Total de conexiones activas: ${activeSockets.size}`);
                }
            });

            // Manejo de errores del socket
            socket.on('error', (error) => {
                console.error(`[SOCKET ERROR] Error en socket ${socket.id}:`, error);
            });

        } catch (error) {
            console.error(`[SOCKET ERROR] Error al configurar socket ${socket.id}:`, error);
        }
    });

    // Manejo de errores a nivel de servidor
    io.engine.on('connection_error', (error) => {
        console.error('[SOCKET ERROR] Error en conexión:', error);
    });
};

// Exportar funciones útiles
module.exports.getActiveSocketsCount = getActiveSocketsCount;
module.exports.getActiveSockets = () => activeSockets;