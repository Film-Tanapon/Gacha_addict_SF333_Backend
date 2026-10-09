const { Router } = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { requireAdmin } = require('../middleware/admin.middleware');
const { requireAuth } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../middleware/error.middleware');

const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
const router = Router();
const receive = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } }).single('image');
router.post('/', (req,res,next) => req.get('X-Admin-Key') !== undefined ? requireAdmin(req,res,next) : requireAuth(req,res,next), (req, res, next) => {
  receive(req, res, error => {
    if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Image must be at most 5 MB' : 'Send one image in the image field' });
    next();
  });
}, asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image is required' });
  let image;
  try {
    const source = sharp(req.file.buffer, { limitInputPixels: 25000000 });
    const metadata = await source.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('Unsupported image');
    image = await source.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  } catch {
    return res.status(400).json({ error: 'Send a valid JPEG, PNG or WebP image (at most 25 megapixels)' });
  }
  await mkdir(uploadDir, { recursive: true });
  const filename = randomUUID() + '.webp';
  await writeFile(path.join(uploadDir, filename), image, { flag: 'wx' });
  res.status(201).json({ url: '/api/uploads/' + filename });
}));
module.exports = { router, uploadDir };
