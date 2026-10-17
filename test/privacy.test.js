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
      assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
      assert.equal(response.headers.get('cache-control'), 'no-store, no-transform');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.doesNotMatch(html, /<script\b|__cf_email__|\/cdn-cgi\/l\/email-protection/i);
      const emailLinks = [...html.matchAll(/<a\b[^>]*href="mailto:[^"]*"[^>]*>[\s\S]*?<\/a>/g)];
      assert.ok(emailLinks.length > 0);
      for (const [link] of emailLinks)
        assert.ok(html.includes(`<!--email_off-->${link}<!--/email_off-->`), 'Each email link must opt out of Cloudflare obfuscation, including its href');
      if (route === '/account-deletion') {
        const action = emailLinks.find(([link]) => link.includes('class="action"'));
        assert.ok(action, 'Account deletion needs a direct email request button');
        const href = action[0].match(/href="([^"]+)"/)[1].replace(/&amp;/g, '&');
        const mailto = new URL(href);
        assert.equal(mailto.protocol, 'mailto:');
        assert.equal(mailto.pathname, 'filmoko2345@gmail.com');
        assert.equal(mailto.searchParams.get('subject'), 'ขอลบบัญชี Gacha Addict');
        assert.match(mailto.searchParams.get('body'), /อีเมลที่ใช้กับบัญชี:/);
        assert.match(mailto.searchParams.get('body'), /ฉันจะไม่ส่งรหัสผ่านหรือรหัส OTP/);
      }
    }
    const admin = await fetch(base + '/admin');
    assert.equal(admin.headers.get('content-security-policy'), null);
    assert.equal(admin.headers.get('cache-control'), null);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
