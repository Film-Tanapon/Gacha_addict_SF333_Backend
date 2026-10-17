const path = require('node:path');
const { unlink } = require('node:fs/promises');

const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
const filenamePattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}\.webp$/i;

function uploadedFilename(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, 'https://uploads.invalid');
    const match = /^\/api\/uploads\/([^/]+)$/.exec(url.pathname);
    return match && filenamePattern.test(match[1]) ? match[1] : null;
  } catch { return null; }
}

async function removeUpload(filename) {
  if (!filenamePattern.test(filename)) throw new Error('Invalid upload filename');
  try { await unlink(path.join(uploadDir, filename)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

module.exports = { uploadDir, uploadedFilename, removeUpload };
