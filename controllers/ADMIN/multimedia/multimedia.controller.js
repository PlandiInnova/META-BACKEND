const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const tipo = req.body.type?.toLowerCase();
        const uploadPath = path.join(__dirname, '../../../../var/www/html/multimedia', tipo);
        console.log(uploadPath)

        fs.mkdir(uploadPath, { recursive: true }, (error) => {
            if (error) {
                return cb(error);
            }
            cb(null, uploadPath);
        });
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `${uniqueSuffix}${ext}`);
    }
});

// parallel storage for thumbnails
const thumbnailStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../../../../var/www/html/multimedia/thumbnails');

        fs.mkdir(uploadPath, { recursive: true }, (error) => {
            if (error) {
                return cb(error);
            }
            cb(null, uploadPath);
        });
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'thumb-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const tipo = req.query.type?.toString().toLowerCase();

    const allowedTypes = {
        pdf: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        audios: ['audio/mpeg', 'audio/wav', 'audio/aac'],
        ar: ['model/gltf-binary', 'application/octet-stream'],
        otros: [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain',
            'application/zip',
            'application/x-rar-compressed'
        ]
    };

    if (tipo === 'otros') {
        if (!file) {
            return cb(null, true);
        }

        if (allowedTypes.otros.includes(file.mimetype)) {
            return cb(null, true);
        } else {
            const error = new Error(`Tipo de archivo no permitido para ${tipo}. Tipo recibido: ${file.mimetype}`);
            error.code = 'LIMIT_FILE_TYPE';
            return cb(error, false);
        }
    }

    if (!tipo || !allowedTypes[tipo]?.includes(file.mimetype)) {
        const error = new Error(`Tipo de archivo no permitido para ${tipo}`);
        error.code = 'LIMIT_FILE_TYPE';
        return cb(error, false);
    }

    cb(null, true);
};

const uploadFile = multer({
    storage: storage,
    limits: { fileSize: 200 * 1024 * 1024 },
    fileFilter: fileFilter
}).single('archivo');

const handleFormData = (req, res, next) => {
    const tipo = req.query.type?.toString();
    if (tipo === 'Videos') {
        // Para videos, puede venir 'image' (miniatura) y 'videofile' (video local)
        const videoStorage = multer.diskStorage({
            destination: (req, file, cb) => {
                if (file.fieldname === 'videofile') {
                    const uploadPath = path.join(__dirname, '../../../../var/www/html/multimedia/videos');
                    fs.mkdir(uploadPath, { recursive: true }, (error) => {
                        if (error) return cb(error);
                        cb(null, uploadPath);
                    });
                } else {
                    // Para miniaturas
                    const uploadPath = path.join(__dirname, '../../../../var/www/html/multimedia/thumbnails');
                    fs.mkdir(uploadPath, { recursive: true }, (error) => {
                        if (error) return cb(error);
                        cb(null, uploadPath);
                    });
                }
            },
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                if (file.fieldname === 'videofile') {
                    cb(null, `video-${uniqueSuffix}${path.extname(file.originalname)}`);
                } else {
                    cb(null, `thumb-${uniqueSuffix}${path.extname(file.originalname)}`);
                }
            }
        });

        const upload = multer({
            storage: videoStorage,
            limits: {
                fileSize: 500 * 1024 * 1024, // 500MB para videos
                fieldSize: 10 * 1024 * 1024 // 10MB para otros campos
            },
            fileFilter: (req, file, cb) => {
                if (file.fieldname === 'videofile') {
                    // Validar que sea un video
                    if (file.mimetype.startsWith('video/')) {
                        cb(null, true);
                    } else {
                        cb(new Error('Solo se permiten archivos de video'), false);
                    }
                } else if (file.fieldname === 'image') {
                    // Validar que sea una imagen
                    if (file.mimetype.startsWith('image/')) {
                        cb(null, true);
                    } else {
                        cb(new Error('Solo se permiten imágenes para miniaturas'), false);
                    }
                } else {
                    cb(null, true);
                }
            }
        }).fields([
            { name: 'image', maxCount: 1 },
            { name: 'videofile', maxCount: 1 }
        ]);

        upload(req, res, (err) => {
            if (err) {
                return res.status(400).json({ error: err.message });
            }
            next();
        });
    } else {
        multer().none()(req, res, next);
    }
};

exports.handleUpload = async (req, res) => {
    try {
        const titulo = req.body.mul_titulo || req.body.titulo;
        const descripcion = req.body.mul_descripcion || req.body.descripcion || '';
        const unidad = req.body.mul_unidad || req.body.unidad;
        const progresion = req.body.mul_progresion || req.body.progresion;
        const materia_id = req.body.mul_mat_id || req.body.mul_mat_id;

        const missingFields = [];

        if (!req.body.type) missingFields.push('type');
        if (!titulo) missingFields.push('titulo');

        if (missingFields.length > 0) {
            return res.status(400).json({
                error: `Campos requeridos faltantes: ${missingFields.join(', ')}`,
                detalle: 'Asegúrate de enviar: type, titulo (o mul_titulo)'
            });
        }

        const allowedContentTypes = ['Videos', 'Audios', 'AR', 'Juegos'];
        if (!allowedContentTypes.includes(req.body.type)) {
            return res.status(400).json({
                error: 'Tipo de contenido no válido',
                detalle: `Tipo permitido: ${allowedContentTypes.join(', ')}`
            });
        }

        const isEdit = req.body.id_multimedia && req.body.id_multimedia.trim() !== '';

        const multimediaId = isEdit ? parseInt(req.body.id_multimedia) : null;

        let metadata = '';
        let videoFile = '';
        let iconPath = '';

        const tipoContenidoMap = {
            'Videos': 1,
            'Audios': 2,
            'Juegos': 3,
            'AR': 4,
        };

        switch (req.body.type) {
            case 'Audios':
            case 'AR':
                if (!req.file && !isEdit) {
                    return res.status(400).json({
                        error: 'Archivo no recibido',
                        detalle: 'Debes proporcionar un archivo para Audios o AR'
                    });
                }
                if (req.file) {
                    const fullPath = req.file.path;
                    // Extraer ruta relativa: /multimedia/audios/archivo.ext o /multimedia/ar/archivo.ext
                    const relativePath = fullPath.match(/\/multimedia\/.*/)?.[0] || fullPath.replace(/.*[\/\\]multimedia[\/\\]/, '/multimedia/');
                    metadata = relativePath.replace(/\\/g, '/');

                    // Eliminar archivo anterior si existe
                    if (req.body.old_metadata) {
                        const oldPath = req.body.old_metadata.startsWith('/')
                            ? req.body.old_metadata
                            : '/' + req.body.old_metadata;
                        const oldFilePath = path.join(__dirname, '../../../../var/www/html', oldPath);
                        if (fs.existsSync(oldFilePath)) {
                            fs.unlink(oldFilePath, (err) => {
                                if (err) console.error('Error eliminando archivo anterior:', err);
                                else console.log('✅ Archivo anterior eliminado:', oldFilePath);
                            });
                        }
                    }
                } else {
                    // En modo edición sin archivo nuevo, mantener el existente
                    metadata = req.body.existing_metadata || req.body.old_metadata || '';
                }
                break;
            case 'Juegos':
                if (!req.body.json_game && !isEdit) {
                    return res.status(400).json({ error: 'json_game no recibido' });
                }
                if (req.body.json_game) {
                    metadata = req.body.json_game;
                } else {
                    console.log('📁 Archivo recibido para "Juegos":', req.body);
                }
                break;
            case 'Videos':
                const videoFileUploaded = req.files?.videofile?.[0];
                const videoUrlProvided = req.body.video_url;

                if (!videoUrlProvided && !videoFileUploaded && !isEdit) {
                    return res.status(400).json({
                        error: 'Video requerido',
                        detalle: 'Debes proporcionar una URL de YouTube o subir un archivo de video'
                    });
                }

                // Manejar video local
                if (videoFileUploaded) {
                    const fullPath = videoFileUploaded.path;
                    const relativePath = fullPath.match(/\/multimedia\/.*/)?.[0] || fullPath.replace(/.*[\/\\]multimedia[\/\\]/, '/multimedia/');
                    videoFile = relativePath.replace(/\\/g, '/');
                    metadata = videoFile;

                    // Eliminar video anterior si existe
                    if (isEdit && req.body.old_metadata) {
                        const oldPath = req.body.old_metadata.startsWith('/')
                            ? req.body.old_metadata
                            : '/' + req.body.old_metadata;
                        const oldFilePath = path.join(__dirname, '../../../../var/www/html', oldPath);
                        if (fs.existsSync(oldFilePath)) {
                            fs.unlink(oldFilePath, (err) => {
                                if (err) console.error('❌ Error eliminando video anterior:', err);
                                else console.log('✅ Video anterior eliminado:', oldFilePath);
                            });
                        }
                    }
                }
                // Manejar video de YouTube
                else if (videoUrlProvided) {
                    let videoURL = videoUrlProvided;
                    // Normalizar URL de YouTube
                    if (videoURL.includes('/embed/')) {
                        const videoId = videoURL.split('/embed/')[1].split('?')[0];
                        videoURL = `https://www.youtube.com/watch?v=${videoId}`;
                    } else if (videoURL.includes('youtu.be/')) {
                        const videoId = videoURL.split('youtu.be/')[1].split('?')[0];
                        videoURL = `https://www.youtube.com/watch?v=${videoId}`;
                    }
                    metadata = videoURL;
                }
                // En modo edición sin cambios en el video
                else if (isEdit) {
                    // Mantener el video existente
                    metadata = req.body.existing_metadata || req.body.old_metadata || '';
                }

                // --- Lógica para la miniatura ---
                const imageFile = req.files?.image?.[0];
                const removeOldThumbnail = () => {
                    if (isEdit && req.body.old_icon && !req.body.old_icon.includes('i.ytimg.com')) {
                        const oldPath = req.body.old_icon.startsWith('/')
                            ? req.body.old_icon
                            : '/' + req.body.old_icon;
                        const oldFilePath = path.join(__dirname, '../../../../var/www/html', oldPath);
                        if (fs.existsSync(oldFilePath)) {
                            fs.unlink(oldFilePath, (unlinkErr) => {
                                if (unlinkErr) console.error('❌ Error eliminando miniatura anterior:', unlinkErr);
                                else console.log('✅ Miniatura anterior eliminada:', oldFilePath);
                            });
                        }
                    }
                };

                if (imageFile) {
                    // Nueva miniatura subida
                    const fullPath = imageFile.path;
                    const relativePath = fullPath.match(/\/multimedia\/.*/)?.[0] || fullPath.replace(/.*[\/\\]multimedia[\/\\]/, '/multimedia/');
                    iconPath = relativePath.replace(/\\/g, '/');
                    removeOldThumbnail();
                } else if (req.body.image) {
                    // Miniatura como string (URL de YouTube o ruta relativa)
                    const imageValue = req.body.image;
                    if (imageValue.includes('i.ytimg.com')) {
                        // URL de YouTube, mantenerla
                        iconPath = imageValue;
                        if (isEdit) {
                            removeOldThumbnail();
                        }
                    } else {
                        // Ruta relativa del servidor
                        iconPath = imageValue.startsWith('/') ? imageValue : '/' + imageValue;
                    }
                } else if (isEdit && req.body.old_icon) {
                    // Mantener miniatura existente en modo edición
                    iconPath = req.body.old_icon;
                } else {
                    return res.status(400).json({
                        error: 'Miniatura requerida',
                        detalle: 'Debes proporcionar una miniatura para el video'
                    });
                }

                break;
        }

        const registro = {
            titulo: titulo,
            descripcion: descripcion,
            unidad: unidad ? parseInt(unidad) : null,
            progresion: progresion || null,
            tipo_contenido: tipoContenidoMap[req.body.type],
            icon: req.body.type === 'Videos' ? iconPath : (req.body.image || ''),
            metadata: metadata,
            fecha_creacion: new Date(),
            materia_id: parseInt(materia_id),
            status: 1,
            usuario_creacion: 1,
        };

        let dbResult;

        if (isEdit) {
            dbResult = await new Promise((resolve, reject) => {
                req.db.query(
                    `UPDATE MET_MULTIMEDIA SET MUL_TITULO = ?, MUL_UNIDAD = ?, MUL_PROGRESION = ?, MUL_DESCRIPCION = ?, MUL_SBT_ID = ?, MUL_IMAGEN = ?, MUL_ENLACE = ?, MUL_FECHA_CREACION = ?, MUL_MAT_ID = ?, MUL_STATUS = ?, MUL_USU_ID = ? WHERE MUL_ID = ?`,
                    [
                        registro.titulo,
                        registro.unidad,
                        registro.progresion,
                        registro.descripcion,
                        registro.tipo_contenido,
                        registro.icon,
                        registro.metadata,
                        registro.fecha_creacion,
                        registro.materia_id,
                        registro.status,
                        registro.usuario_creacion,
                        multimediaId
                    ],
                    (error, results) => {
                        if (error) reject(error);
                        else resolve(results);
                    }
                );
            });
        } else {
            dbResult = await new Promise((resolve, reject) => {
                req.db.query(
                    `INSERT INTO MET_MULTIMEDIA (MUL_TITULO, MUL_UNIDAD, MUL_PROGRESION, MUL_DESCRIPCION, MUL_SBT_ID, MUL_IMAGEN, MUL_ENLACE, MUL_FECHA_CREACION, MUL_MAT_ID, MUL_STATUS, MUL_USU_ID) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        registro.titulo,
                        registro.unidad,
                        registro.progresion,
                        registro.descripcion,
                        registro.tipo_contenido,
                        registro.icon,
                        registro.metadata,
                        registro.fecha_creacion,
                        registro.materia_id,
                        registro.status,
                        registro.usuario_creacion
                    ],
                    (error, results) => {
                        if (error) reject(error);
                        else resolve(results);
                    }
                );
            });
        }

        const responseData = {
            success: true,
            id: isEdit ? multimediaId : dbResult.insertId,
            operation: isEdit ? 'update' : 'insert',
            ...registro,
            metadata: metadata
        };

        res.status(201).json(responseData);

    } catch (error) {
        console.error('❌ Error general en handleUpload:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            detalle: error.message || 'Error desconocido al procesar la solicitud'
        });
    }
};



exports.uploadFile = uploadFile;
exports.handleFormData = handleFormData;