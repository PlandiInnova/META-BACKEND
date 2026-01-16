const activeSockets = new Map();

module.exports = (io) => {
    io.on('connection', (socket) => {
        activeSockets.set(socket.id, socket);
        console.log(`Nuevo usuario conectado: ${socket.id}`);

        socket.join('global-room');
        console.log(`Usuario ${socket.id} unido a la sala global`);

        socket.removeAllListeners('client-upload-complete');
        socket.removeAllListeners('client-complete');

        socket.on('client-upload-complete', (data) => {
            console.log('Subida recibida:', data);
            io.to('global-room').emit('new-upload', data);
        });

        socket.on('client-complete', (data) => {
            console.log('Subida issue recibida:', data);
            io.to('global-room').emit('new-issue', data);
        });

        socket.on('disconnect', (reason) => {
            console.log(`Usuario desconectado: ${socket.id} (${reason})`);
            if (activeSockets.has(socket.id)) {
                activeSockets.delete(socket.id);
                console.log(`Socket ${socket.id} removido de activeSockets`);
            }
        });
    });
};