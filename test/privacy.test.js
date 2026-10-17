const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('privacy and external deletion resources are public, identify the operator and offer a usable email request path', async () => {
  const app = express();
  app.use(require('../src/routes/privacy.routes'));
  app.get('/admin', (req, res) => res.send('admin scripts remain unaffected'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of ['/privacy', '/account-deletion']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html/);
      const html = await response.text();
      assert.match(html, /Gacha Addict/); assert.match(html, /Aymahakon/);
      assert.match(html, /mailto:filmoko2345@gmail.com/); assert.match(html, /90/);
      assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal((await fetch(base + '/admin')).headers.get('content-security-policy'), null);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
