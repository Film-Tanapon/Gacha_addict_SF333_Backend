const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const sharp = require('sharp');
const { mkdtemp, readdir, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { signToken } = require('../src/utils/jwt');

test('uploads authenticated images, serves WebP, and rejects invalid or oversized files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gacha-upload-'));
  process.env.UPLOAD_DIR = dir;
  const { router, uploadDir } = require('../src/routes/upload.routes');
  const app = express();
  app.use('/api/uploads', router, express.static(uploadDir));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = signToken({ id: 1 });
  const send = (bytes, authenticated = true) => {
    const body = new FormData();
    body.append('image', new Blob([bytes], { type: 'image/png' }), '../../fake.png');
    return fetch(base + '/api/uploads', { method: 'POST', body, headers: authenticated ? { Authorization: `Bearer ${token}` } : {} });
  };
  try {
    const png = await sharp({ create: { width: 2000, height: 1000, channels: 4, background: '#ff0000' } }).png().toBuffer();
    assert.equal((await send(png, false)).status, 401);
    const response = await send(png);
    assert.equal(response.status, 201);
    const { url } = await response.json();
    assert.match(url, /^\/api\/uploads\/[a-f0-9-]+\.webp$/);
    const downloaded = await fetch(base + url);
    assert.equal(downloaded.status, 200);
    const metadata = await sharp(Buffer.from(await downloaded.arrayBuffer())).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 1600);
    assert.equal(metadata.height, 800);
    assert.equal((await send(Buffer.from('not an image'))).status, 400);
    assert.equal((await send(Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413);
    const empty = await fetch(base + '/api/uploads', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: new FormData() });
    assert.equal(empty.status, 400);
    assert.equal((await readdir(dir)).length, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
    delete process.env.UPLOAD_DIR;
  }
});
