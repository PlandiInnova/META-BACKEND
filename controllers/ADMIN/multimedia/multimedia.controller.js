const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Ruta base para guardar archivos
// En desarrollo: ruta relativa, en producción: ruta absoluta desde .env
const BASE_UPLOAD_PATH = process.env.NODE_ENV === 'production' 
    ? (process.env.UPLOAD_BASE_PATH || '/var/www/html')
    : path.resolve(__dirname, '../../../../var/www/html');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const tipo = req.body.type?.toLowerCase();
        const uploadPath = path.join(BASE_UPLOAD_PATH, 'multimedia', tipo);

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

const fileFilter = (req, file, cb) => {
    const tipo = req.query.type?.toString().toLowerCase();

    const allowedTypes = {
        audios: ['audio/mpeg', 'audio/wav', 'audio/aac'],
        ar: ['model/gltf-binary', 'application/octet-stream'],
        videos: ['video/mp4', 'video/webm', 'video/ogg'],
        juegos: ['application/json'],
    };

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
            const videoStorage = multer.diskStorage({
                destination: (req, file, cb) => {
                    if (file.fieldname === 'videofile') {
                        const uploadPath = path.join(BASE_UPLOAD_PATH, 'multimedia/videos');
                        fs.mkdir(uploadPath, { recursive: true }, (error) => {
                            if (error) return cb(error);
                            cb(null, uploadPath);
                        });
                    } else {
                        const uploadPath = path.join(BASE_UPLOAD_PATH, 'multimedia/thumbnails');
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
                fileSize: 500 * 1024 * 1024,
                fieldSize: 10 * 1024 * 1024
            },
            fileFilter: (req, file, cb) => {
                if (file.fieldname === 'videofile') {
                    if (file.mimetype.startsWith('video/')) {
                        cb(null, true);
                    } else {
                        cb(new Error('Solo se permiten archivos de video'), false);
                    }
                } else if (file.fieldname === 'image') {
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
                console.error('❌ Error en multer:', err.message);
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
                detalle: 'Asegúrate de enviar: type, titulo'
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
        let iconPath = '';
        const baseDir = BASE_UPLOAD_PATH;

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
                    metadata = extractRelativePath(fullPath);
                    
                    if (isEdit) {
                        const existingAudio = await new Promise((resolve, reject) => {
                            req.db.query(
                                'CALL ObtenerEnlaceMultimedia(?)',
                                [multimediaId],
                                (error, results) => {
                                    if (error) reject(error);
                                    else {
                                        const row = results[0] && results[0][0];
                                        resolve(row ? (row.MUL_ENLACE || '') : '');
                                    }
                                }
                            );
                        });

                        if (existingAudio && existingAudio !== metadata) {
                            normalizeAndDeleteOldFile(existingAudio, baseDir);
                        }
                    }
                } else {
                    if (isEdit) {
                        const existingAudio = await new Promise((resolve, reject) => {
                            req.db.query(
                                'CALL ObtenerEnlaceMultimedia(?)',
                                [multimediaId],
                                (error, results) => {
                                    if (error) reject(error);
                                    else {
                                        const row = results[0] && results[0][0];
                                        resolve(row ? (row.MUL_ENLACE || '') : '');
                                    }
                                }
                            );
                        });
                        const existingMetadata = cleanMetadata(existingAudio || req.body.existing_metadata || '');
                        metadata = extractRelativePath(existingMetadata);
                    } else {
                        const existingMetadata = cleanMetadata(req.body.existing_metadata || '');
                        metadata = extractRelativePath(existingMetadata);
                    }
                }
                break;
            case 'Juegos':
                if (!req.body.json_game && !isEdit) {
                    return res.status(400).json({ error: 'json_game no recibido' });
                }
                if (req.body.json_game) {
                    iconPath = req.body.image_game;
                    metadata = req.body.json_game;
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
            
                let existingVideoPath = '';
                if (isEdit) {
                    const currentVideo = await new Promise((resolve, reject) => {
                        req.db.query(
                            'CALL ObtenerEnlaceMultimedia(?)',
                            [multimediaId],
                            (error, results) => {
                                if (error) reject(error);
                                else {
                                    const row = results[0] && results[0][0];
                                    const videoPath = row ? (row.MUL_ENLACE || '') : '';
                                    if (videoPath && !videoPath.includes('youtube.com') && !videoPath.includes('youtu.be')) {
                                        resolve(extractRelativePath(videoPath));
                                    } else {
                                        resolve(videoPath);
                                    }
                                }
                            }
                        );
                    });
                    existingVideoPath = currentVideo || '';
                }
            
                if (videoFileUploaded) {
                    const fullPath = videoFileUploaded.path;
                    metadata = extractRelativePath(fullPath);
            
                    if (isEdit && existingVideoPath && !existingVideoPath.includes('youtube.com') && !existingVideoPath.includes('youtu.be')) {
                        normalizeAndDeleteOldFile(existingVideoPath, baseDir);
                    }
                }
                else if (videoUrlProvided) {
                    let videoURL = cleanMetadata(videoUrlProvided);
                    if (videoURL.includes('/embed/')) {
                        const videoId = videoURL.split('/embed/')[1].split('?')[0];
                        videoURL = `https://www.youtube.com/watch?v=${videoId}`;
                    } else if (videoURL.includes('youtu.be/')) {
                        const videoId = videoURL.split('youtu.be/')[1].split('?')[0];
                        videoURL = `https://www.youtube.com/watch?v=${videoId}`;
                    }
                    metadata = videoURL;
            
                    if (isEdit && existingVideoPath && 
                        !existingVideoPath.includes('youtube.com') && 
                        !existingVideoPath.includes('youtu.be') &&
                        videoURL.includes('youtube.com')) {
                        normalizeAndDeleteOldFile(existingVideoPath, baseDir);
                    }
                }
                else if (isEdit) {
                    const existingMetadata = cleanMetadata(req.body.existing_metadata || existingVideoPath || '');
                    metadata = extractRelativePath(existingMetadata);
                }
            
                const imageFile = req.files?.image?.[0];
                
                const hasNewImageFile = !!imageFile && imageFile.path;
                
                // Logs de depuración
                console.log('🔍 DEBUG - Procesando miniatura:');
                console.log('  - hasNewImageFile:', hasNewImageFile);
                console.log('  - req.body.image:', req.body.image);
                console.log('  - req.body.remove_thumbnail:', req.body.remove_thumbnail);
                console.log('  - isEdit:', isEdit);
                
                let existingIconPath = '';
                if (isEdit) {
                    const currentIcon = await new Promise((resolve, reject) => {
                        req.db.query(
                            'CALL ObtenerImagenMultimedia(?)',
                            [multimediaId],
                            (error, results) => {
                                if (error) reject(error);
                                else {
                                    const row = results[0] && results[0][0];
                                    const iconPath = row ? (row.MUL_IMAGEN || '') : '';
                                    if (iconPath.includes('i.ytimg.com')) {
                                        resolve(iconPath);
                                    } else {
                                        resolve(extractRelativePath(iconPath) || iconPath);
                                    }
                                }
                            }
                        );
                    });
                    existingIconPath = currentIcon || '';
                    console.log('  - existingIconPath:', existingIconPath);
                }
                
                    const removeThumbnail = req.body.remove_thumbnail === 'true' || req.body.remove_thumbnail === true;
                
                // Validar que no se intente eliminar miniatura de YouTube
                if (removeThumbnail && existingIconPath && existingIconPath.includes('i.ytimg.com')) {
                    return res.status(400).json({
                        error: 'No se puede eliminar miniatura de YouTube',
                        detalle: 'Las miniaturas de YouTube no se pueden eliminar, solo las personalizadas'
                    });
                }
                
                // Validar que no se intente eliminar la miniatura por defecto
                if (removeThumbnail && isDefaultThumbnail(existingIconPath)) {
                    return res.status(400).json({
                        error: 'No se puede eliminar miniatura por defecto',
                        detalle: 'La miniatura por defecto del sistema no se puede eliminar'
                    });
                }
                
                // Prioridad de miniatura:
                // 1. Nuevo archivo de imagen subido
                // 2. Miniatura preservada en req.body.image (cuando se cambia solo el video)
                // 3. Solicitud de eliminar miniatura
                // 4. Miniatura existente en modo edición
                // 5. Miniatura por defecto
                
                if (hasNewImageFile) {
                    // Caso 1: Se subió un nuevo archivo de imagen
                    const fullPath = imageFile.path;
                    const normalizedNewPath = extractRelativePath(fullPath);
                    iconPath = normalizedNewPath;
                    console.log('✅ Usando nueva imagen subida:', iconPath);
                    
                    if (isEdit && existingIconPath && 
                        !existingIconPath.includes('i.ytimg.com') &&
                        !isDefaultThumbnail(existingIconPath)) {
                        const normalizedExisting = extractRelativePath(existingIconPath);
                        if (normalizedExisting !== iconPath) {
                            normalizeAndDeleteOldFile(existingIconPath, baseDir);
                        }
                    }
                }
                else if (req.body.image && req.body.image.trim() !== '') {
                    // Caso 2: Miniatura preservada (ruta/URL) - PRIORIDAD ALTA cuando se cambia solo el video
                    const imageValue = cleanMetadata(req.body.image);
                    console.log('  - imageValue (después de cleanMetadata):', imageValue);
                    
                    if (imageValue.includes('i.ytimg.com')) {
                        iconPath = imageValue;
                        console.log('✅ Usando miniatura preservada de YouTube:', iconPath);
                        if (isEdit && existingIconPath && 
                            !existingIconPath.includes('i.ytimg.com') && 
                            !isDefaultThumbnail(existingIconPath) &&
                            existingIconPath !== iconPath) {
                            normalizeAndDeleteOldFile(existingIconPath, baseDir);
                        }
                    } else {
                        const extractedPath = extractRelativePath(imageValue);
                        iconPath = extractedPath;
                        console.log('✅ Usando miniatura preservada del servidor:');
                        console.log('  - imageValue original:', imageValue);
                        console.log('  - iconPath extraído:', iconPath);
                        if (isEdit && existingIconPath && 
                            !existingIconPath.includes('i.ytimg.com') &&
                            !isDefaultThumbnail(existingIconPath)) {
                            const normalizedExisting = extractRelativePath(existingIconPath);
                            if (normalizedExisting !== iconPath) {
                                normalizeAndDeleteOldFile(existingIconPath, baseDir);
                            }
                        }
                    }
                }
                else if (removeThumbnail) {
                    // Caso 3: Solicitud de eliminar miniatura
                    if (existingIconPath && existingIconPath.includes('i.ytimg.com')) {
                        // Si es YouTube, mantener la miniatura de YouTube (no se puede eliminar)
                        iconPath = existingIconPath;
                    } else if (metadata.includes('youtube.com') || metadata.includes('youtu.be')) {
                        // Si se elimina miniatura personalizada de un video de YouTube, usar la de YouTube por defecto
                        const videoIdMatch = metadata.match(/[?&]v=([^&]+)/) || metadata.match(/youtu\.be\/([^?]+)/);
                        if (videoIdMatch && videoIdMatch[1]) {
                            iconPath = `https://i.ytimg.com/vi/${videoIdMatch[1]}/hqdefault.jpg`;
                        } else {
                            iconPath = '/multimedia/thumbnails/default-video-thumbnail.jpg';
                        }
                        
                        // Eliminar miniatura personalizada anterior si existe (no la por defecto)
                        if (isEdit && existingIconPath && 
                            !existingIconPath.includes('i.ytimg.com') &&
                            !isDefaultThumbnail(existingIconPath)) {
                            normalizeAndDeleteOldFile(existingIconPath, baseDir);
                        }
                    } else {
                        // Para archivos de video, si se elimina la miniatura personalizada, usar la por defecto
                        iconPath = '/multimedia/thumbnails/default-video-thumbnail.jpg';
                        
                        // Eliminar miniatura personalizada anterior si existe (no la por defecto)
                        if (isEdit && existingIconPath && 
                            !existingIconPath.includes('i.ytimg.com') &&
                            !isDefaultThumbnail(existingIconPath)) {
                            normalizeAndDeleteOldFile(existingIconPath, baseDir);
                        }
                    }
                } 
                else if (isEdit && existingIconPath) {
                    // Caso 4: En modo edición, si hay miniatura existente, usarla
                    if (existingIconPath.includes('i.ytimg.com')) {
                        iconPath = existingIconPath;
                    } else if (isDefaultThumbnail(existingIconPath)) {
                        // Mantener la miniatura por defecto intacta
                        iconPath = '/multimedia/thumbnails/default-video-thumbnail.jpg';
                    } else {
                        iconPath = extractRelativePath(existingIconPath);
                    }
                    console.log('✅ Usando miniatura existente en modo edición:', iconPath);
                } 
                else {
                    // Caso 5: Si no hay miniatura proporcionada, usar la por defecto
                    if (metadata.includes('youtube.com') || metadata.includes('youtu.be')) {
                        // Para YouTube, usar miniatura por defecto de YouTube
                        const videoIdMatch = metadata.match(/[?&]v=([^&]+)/) || metadata.match(/youtu\.be\/([^?]+)/);
                        if (videoIdMatch && videoIdMatch[1]) {
                            iconPath = `https://i.ytimg.com/vi/${videoIdMatch[1]}/hqdefault.jpg`;
                        } else {
                            iconPath = '/multimedia/thumbnails/default-video-thumbnail.jpg';
                        }
                    } else {
                        // Para archivos nuevos sin miniatura, usar miniatura por defecto
                        iconPath = '/multimedia/thumbnails/default-video-thumbnail.jpg';
                    }
                    console.log('⚠️ Usando miniatura por defecto:', iconPath);
                }
            
                break;
        }

        // Limpiar metadata antes de normalizar (por si viene con texto adicional de Angular)
        let cleanedMetadata = cleanMetadata(metadata);
        let normalizedMetadata = cleanedMetadata;
        if (cleanedMetadata && !cleanedMetadata.includes('youtube.com') && !cleanedMetadata.includes('youtu.be')) {
            normalizedMetadata = extractRelativePath(cleanedMetadata);
        }
        
        let normalizedIconPath = iconPath || '';
        
        console.log('🔍 DEBUG - Antes de normalización final:');
        console.log('  - iconPath:', iconPath);
        console.log('  - req.body.type:', req.body.type);
        
        if (req.body.type === 'Videos') {
            if (iconPath) {
                if (iconPath.includes('i.ytimg.com')) {
                    normalizedIconPath = iconPath;
                    console.log('  - Miniatura de YouTube, sin normalizar:', normalizedIconPath);
                } else {
                    if (iconPath.startsWith('/multimedia/')) {
                        normalizedIconPath = iconPath;
                        console.log('  - Ya tiene /multimedia/, sin normalizar:', normalizedIconPath);
                    } else {
                        normalizedIconPath = extractRelativePath(iconPath);
                        console.log('  - Normalizado con extractRelativePath:', normalizedIconPath);
                    }
                }
            } else {
                console.log('  - ⚠️ iconPath está vacío!');
            }
        } else {
            if (!iconPath && req.body.image) {
                if (req.body.image.includes('i.ytimg.com')) {
                    normalizedIconPath = req.body.image;
                } else {
                    normalizedIconPath = extractRelativePath(req.body.image);
                }
            } else if (iconPath) {
                normalizedIconPath = iconPath;
            } else {
                normalizedIconPath = req.body.image || '';
            }
        }

        console.log('🔍 DEBUG - Después de normalización final:');
        console.log('  - normalizedIconPath:', normalizedIconPath);
        
        if (req.body.type === 'Videos' && (!normalizedIconPath || normalizedIconPath.trim() === '')) {
            console.error('❌ ERROR: iconPath está vacío para un video');
            return res.status(400).json({
                error: 'Miniatura requerida',
                detalle: 'No se puede guardar un video sin miniatura'
            });
        }

        const registro = {
            titulo: titulo,
            descripcion: descripcion,
            unidad: unidad ? parseInt(unidad) : null,
            progresion: progresion || null,
            tipo_contenido: tipoContenidoMap[req.body.type],
            icon: normalizedIconPath,
            metadata: normalizedMetadata,
            fecha_creacion: new Date(),
            materia_id: parseInt(materia_id),
            status: 1,
            usuario_creacion: 1,
        };

        let dbResult;

        if (isEdit) {
            dbResult = await new Promise((resolve, reject) => {
                req.db.query(
                    'CALL ActualizarMultimedia(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
                        if (error) {
                            console.error('❌ Error en UPDATE:', error);
                            reject(error);
                        } else {
                            resolve(results);
                        }
                    }
                );
            });

        } else {
            dbResult = await new Promise((resolve, reject) => {
                req.db.query(
                    'CALL InsertarMultimedia(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
                        else {
                            const insertId = (results[0] && results[0][0] && results[0][0].insertId) ? results[0][0].insertId : null;
                            resolve({ insertId });
                        }
                    }
                );
            });
        }

        const responseData = {
            success: true,
            id: isEdit ? multimediaId : dbResult.insertId,
            operation: isEdit ? 'update' : 'insert',
            ...registro,
            metadata: normalizedMetadata,
            icon: normalizedIconPath
        };

        if (!res.headersSent) {
            if (res.socket && !res.socket.destroyed) {
                res.status(201).json(responseData);
            }
        }

    } catch (error) {
        console.error('❌ Error general en handleUpload:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            detalle: error.message || 'Error desconocido al procesar la solicitud'
        });
    }
};

function cleanMetadata(value) {
    if (!value || typeof value !== 'string') return value;
    
    // Eliminar texto adicional de Angular sobre seguridad XSS
    const angularSecurityPattern = /\s*\(see\s+https?:\/\/[^\)]+\)/gi;
    let cleaned = value.replace(angularSecurityPattern, '');
    
    // Eliminar espacios al inicio y final
    cleaned = cleaned.trim();
    
    return cleaned;
}

function extractRelativePath(fullPath) {
    if (!fullPath) return '';
    
        if (fullPath.includes('http://') || fullPath.includes('https://')) {
        const filesStaticMatch = fullPath.match(/\/FILES\/static\/multimedia\/.*/);
        if (filesStaticMatch) {
            return filesStaticMatch[0].replace('/FILES/static', '');
        }
        
        const staticMatch = fullPath.match(/\/static\/multimedia\/.*/);
        if (staticMatch) {
            return staticMatch[0].replace('/static', '');
        }
        
        const multimediaMatch = fullPath.match(/\/multimedia\/.*/);
        if (multimediaMatch) {
            return multimediaMatch[0];
        }
    }
    
    const multimediaMatch = fullPath.match(/[\/\\]multimedia[\/\\].*/);
    if (multimediaMatch) {
        return multimediaMatch[0].replace(/\\/g, '/');
    }
    
    if (fullPath.includes('multimedia')) {
        const parts = fullPath.split(/[\/\\]multimedia[\/\\]/);
        if (parts.length > 1) {
            return '/multimedia/' + parts[1].replace(/\\/g, '/');
        }
    }

    if (fullPath.includes('{"nextpass":')) {
          return fullPath;
    }
    
    if (fullPath.startsWith('/')) {
        return fullPath;
    }
    
    return '/' + fullPath;
}

function isDefaultThumbnail(thumbnailPath) {
    if (!thumbnailPath) return false;
    const normalized = extractRelativePath(thumbnailPath);
    return normalized.includes('default-video-thumbnail.jpg') || 
           normalized.endsWith('/default-video-thumbnail.jpg') ||
           normalized === '/multimedia/thumbnails/default-video-thumbnail.jpg';
}

function normalizeAndDeleteOldFile(oldPath, baseDir) {
    if (!oldPath || oldPath.trim() === '') {
        return;
    }
    
    // No eliminar nunca la miniatura por defecto
    if (isDefaultThumbnail(oldPath)) {
        console.log('⚠️ Intento de eliminar miniatura por defecto bloqueado:', oldPath);
        return;
    }
    
    const normalizedPath = extractRelativePath(oldPath);

    const fullPath = path.join(baseDir, normalizedPath);
    
    if (fs.existsSync(fullPath)) {
        const resolvedPath = path.resolve(fullPath);
        const resolvedBase = path.resolve(baseDir);
        
        if (resolvedPath.startsWith(resolvedBase)) {
            fs.unlink(fullPath, (err) => {
                if (err) {
                    console.error(`❌ Error eliminando archivo antiguo ${fullPath}:`, err);
                }
            });
        } else {
            console.warn(`⚠️ Intento de eliminar archivo fuera del directorio permitido: ${fullPath}`);
        }
    }
}

exports.handleDelete = async (req, res) => {
    try {
        const multimediaId = parseInt(req.query.id);
        
        if (!multimediaId || isNaN(multimediaId)) {
            return res.status(400).json({
                error: 'ID de multimedia requerido',
                detalle: 'Debes proporcionar un ID válido'
            });
        }

        const multimediaInfo = await new Promise((resolve, reject) => {
            req.db.query(
                'CALL ObtenerEnlaceEImagenMultimedia(?)',
                [multimediaId],
                (error, results) => {
                    if (error) reject(error);
                    else resolve((results[0] && results[0][0]) || null);
                }
            );
        });

        if (!multimediaInfo) {
            return res.status(404).json({
                error: 'Multimedia no encontrado',
                detalle: 'El recurso que intentas eliminar no existe'
            });
        }

        const baseDir = BASE_UPLOAD_PATH;
        const videoPath = multimediaInfo.MUL_ENLACE || '';
        const thumbnailPath = multimediaInfo.MUL_IMAGEN || '';

        // Validar si el video es un archivo (no URL de YouTube)
        const isVideoFile = videoPath && 
                           !videoPath.includes('youtube.com') && 
                           !videoPath.includes('youtu.be') &&
                           (videoPath.includes('/multimedia/') || videoPath.startsWith('/'));

        // Validar si tiene imagen en servidor (no de YouTube ni por defecto)
        const hasServerThumbnail = thumbnailPath && 
                                  !thumbnailPath.includes('i.ytimg.com') && 
                                  !isDefaultThumbnail(thumbnailPath) &&
                                  (thumbnailPath.includes('/multimedia/') || thumbnailPath.startsWith('/'));

        // Eliminar archivo de video si es un archivo
        if (isVideoFile) {
            const normalizedVideoPath = extractRelativePath(videoPath);
            if (normalizedVideoPath) {
                const fullVideoPath = path.join(baseDir, normalizedVideoPath);
                if (fs.existsSync(fullVideoPath)) {
                    const resolvedPath = path.resolve(fullVideoPath);
                    const resolvedBase = path.resolve(baseDir);
                    
                    if (resolvedPath.startsWith(resolvedBase)) {
                        fs.unlink(fullVideoPath, (err) => {
                            if (err) {
                                console.error(`❌ Error eliminando archivo de video ${fullVideoPath}:`, err);
                            } else {
                                console.log(`✅ Archivo de video eliminado: ${fullVideoPath}`);
                            }
                        });
                    } else {
                        console.warn(`⚠️ Intento de eliminar archivo de video fuera del directorio permitido: ${fullVideoPath}`);
                    }
                }
            }
        }

        // Eliminar miniatura si es del servidor
        if (hasServerThumbnail) {
            const normalizedThumbnailPath = extractRelativePath(thumbnailPath);
            if (normalizedThumbnailPath) {
                const fullThumbnailPath = path.join(baseDir, normalizedThumbnailPath);
                if (fs.existsSync(fullThumbnailPath)) {
                    const resolvedPath = path.resolve(fullThumbnailPath);
                    const resolvedBase = path.resolve(baseDir);
                    
                    if (resolvedPath.startsWith(resolvedBase)) {
                        fs.unlink(fullThumbnailPath, (err) => {
                            if (err) {
                                console.error(`❌ Error eliminando miniatura ${fullThumbnailPath}:`, err);
                            } else {
                                console.log(`✅ Miniatura eliminada: ${fullThumbnailPath}`);
                            }
                        });
                    } else {
                        console.warn(`⚠️ Intento de eliminar miniatura fuera del directorio permitido: ${fullThumbnailPath}`);
                    }
                }
            }
        }

        // Eliminar registro de la base de datos
        await new Promise((resolve, reject) => {
            req.db.query(
                'CALL EliminarMultimedia(?)',
                [multimediaId],
                (error) => {
                    if (error) {
                        console.error('❌ Error eliminando registro de la base de datos:', error);
                        reject(error);
                    } else {
                        resolve();
                    }
                }
            );
        });

        res.status(200).json({
            success: true,
            message: 'Multimedia eliminado correctamente',
            id: multimediaId,
            deletedFiles: {
                video: isVideoFile,
                thumbnail: hasServerThumbnail
            }
        });

    } catch (error) {
        console.error('❌ Error general en handleDelete:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            detalle: error.message || 'Error desconocido al procesar la eliminación'
        });
    }
};

exports.uploadFile = uploadFile;
exports.handleFormData = handleFormData;