const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createReviewInbox } = require('../src/services/reviewInbox.service');
const { createReviewInboxRouter } = require('../src/routes/reviewInbox.routes');
const credentials = { REVIEW_INBOX_ENABLED: 'true', REVIEW_INBOX_EMAIL: 'review@example.invalid',
  REVIEW_INBOX_PASSWORD: 'a-unique-inbox-password-with-32-characters', SMTP_USER: 'sender@example.invalid' };
const message = { to: credentials.REVIEW_INBOX_EMAIL, subject: 'Reset password', text: 'OTP: 001234' };

test('review inbox only records allowlisted reset mail, supersedes old codes, and expires without disk storage', () => {
  let now = Date.now();
  const inbox = createReviewInbox({ env: () => credentials, clock: () => now });
  try {
    const token = inbox.login(credentials.REVIEW_INBOX_EMAIL, credentials.REVIEW_INBOX_PASSWORD, 'tester');
    assert.ok(token);
    assert.equal(inbox.record({ ...message, to: 'private@example.invalid' }, 'reset-code'), false);
    assert.equal(inbox.record(message, 'arbitrary-mail'), false);
    assert.equal(inbox.record({ ...message, to: ' REVIEW@EXAMPLE.INVALID ' }, 'reset-code'), true);
    assert.equal(inbox.list('forged-token'), null);
    assert.equal(inbox.list(token)[0].text, 'OTP: 001234');
    inbox.record({ ...message, text: 'OTP: 005678' }, 'reset-code');
    assert.equal(inbox.list(token).length, 1);
    assert.equal(inbox.list(token)[0].text, 'OTP: 005678');
    for (let i = 0; i < 20; i++) inbox.record(message, 'password-changed');
    assert.equal(inbox.list(token).length, 10);
    now += 10 * 60 * 1000;
    assert.deepEqual(inbox.list(token), []);
    now += 20 * 60 * 1000;
    assert.equal(inbox.session(token), null);
  } finally { inbox.stop(); }
});

test('disabled or invalid configuration fails closed and changing credentials revokes old messages and sessions', () => {
  let config = { ...credentials, REVIEW_INBOX_ENABLED: 'false' };
  const inbox = createReviewInbox({ env: () => config });
  try {
    assert.equal(inbox.record(message, 'reset-code'), false);
    assert.equal(inbox.login(config.REVIEW_INBOX_EMAIL, config.REVIEW_INBOX_PASSWORD, 'tester'), null);
    for (const overrides of [{ REVIEW_INBOX_EMAIL: 'broken' }, { REVIEW_INBOX_PASSWORD: 'short' },
      { REVIEW_INBOX_EMAIL: credentials.SMTP_USER }, { REVIEW_INBOX_EMAIL: 'first@example.invalid,second@example.invalid' }]) {
      config = { ...credentials, ...overrides };
      assert.throws(() => inbox.settings(), { status: 503 });
      assert.equal(inbox.record(message, 'reset-code'), false);
    }
    config = { ...credentials };
    const token = inbox.login(config.REVIEW_INBOX_EMAIL, config.REVIEW_INBOX_PASSWORD, 'tester');
    inbox.record(message, 'reset-code');
    config.REVIEW_INBOX_PASSWORD += '-rotated';
    assert.equal(inbox.session(token), null);
    const replacement = inbox.login(config.REVIEW_INBOX_EMAIL, config.REVIEW_INBOX_PASSWORD, 'tester');
    assert.deepEqual(inbox.list(replacement), []);
    config.REVIEW_INBOX_ENABLED = 'false';
    assert.equal(inbox.session(replacement), null);
  } finally { inbox.stop(); }
});

test('inbox password guessing is bounded per IP and globally and rate limits expire', () => {
  let now = Date.now();
  const inbox = createReviewInbox({ env: () => credentials, clock: () => now });
  try {
    for (let i = 0; i < 10; i++) assert.equal(inbox.login(credentials.REVIEW_INBOX_EMAIL, 'wrong', 'same-ip'), null);
    assert.throws(() => inbox.login(credentials.REVIEW_INBOX_EMAIL, credentials.REVIEW_INBOX_PASSWORD, 'same-ip'), { status: 429 });
    for (let i = 10; i < 100; i++) inbox.login(credentials.REVIEW_INBOX_EMAIL, 'wrong', `ip-${i}`);
    assert.throws(() => inbox.login(credentials.REVIEW_INBOX_EMAIL, credentials.REVIEW_INBOX_PASSWORD, 'new-ip'), { status: 429 });
    now += 15 * 60 * 1000;
    assert.ok(inbox.login(credentials.REVIEW_INBOX_EMAIL, credentials.REVIEW_INBOX_PASSWORD, 'same-ip'));
  } finally { inbox.stop(); }
});

test('deleting the test account clears its inbox, revokes sessions and blocks late SMTP completion', () => {
  const inbox = createReviewInbox({ env: () => credentials });
  try {
    const token = inbox.login(credentials.REVIEW_INBOX_EMAIL, credentials.REVIEW_INBOX_PASSWORD, 'tester');
    inbox.record(message, 'reset-code');
    inbox.clearForRecipient('someone-else@example.invalid');
    assert.equal(inbox.list(token).length, 1);
    inbox.clearForRecipient(credentials.REVIEW_INBOX_EMAIL);
    assert.equal(inbox.session(token), null);
    assert.equal(inbox.record(message, 'reset-code'), false);
    assert.equal(inbox.login(credentials.REVIEW_INBOX_EMAIL, credentials.REVIEW_INBOX_PASSWORD, 'tester'), null);
  } finally { inbox.stop(); }
});

test('HTTP inbox requires its own credentials, escapes mail, protects sessions and rejects cross-site posts', async () => {
  let config = { ...credentials };
  const inbox = createReviewInbox({ env: () => config });
  const app = express();
  app.use('/review-inbox', createReviewInboxRouter(inbox));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/review-inbox`;
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body) });
  try {
    inbox.record({ ...message, subject: '<script>bad</script>', text: '001234 <img src=x onerror=bad()>' }, 'reset-code');
    const anonymous = await fetch(base + '?email=private@example.invalid');
    assert.equal(anonymous.status, 200);
    assert.match(anonymous.headers.get('cache-control'), /no-store/);
    assert.match(anonymous.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(anonymous.headers.get('x-robots-tag'), /noindex/);
    const anonymousHtml = await anonymous.text();
    assert.doesNotMatch(anonymousHtml, /001234|review@example.invalid/);
    assert.equal((await post('/login', { email: credentials.REVIEW_INBOX_EMAIL, password: 'bad' })).status, 401);
    assert.equal((await post('/login', { email: 'other@example.invalid', password: credentials.REVIEW_INBOX_PASSWORD })).status, 401);
    assert.equal((await post('/login', {}, { Origin: 'https://evil.invalid' })).status, 403);
    const signedIn = await post('/login', { email: credentials.REVIEW_INBOX_EMAIL, password: credentials.REVIEW_INBOX_PASSWORD });
    assert.equal(signedIn.status, 303);
    const setCookie = signedIn.headers.get('set-cookie');
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(setCookie.includes(attribute));
    const Cookie = setCookie.split(';')[0];
    const page = await fetch(base + '?email=private@example.invalid', { headers: { Cookie } });
    const html = await page.text();
    assert.match(html, /review@example.invalid/);
    assert.match(html, /001234 &lt;img/);
    assert.match(html, /&lt;script&gt;bad/);
    assert.doesNotMatch(html, /<script>|<img |private@example.invalid/);
    assert.equal((await post('/logout', { csrf: 'wrong' }, { Cookie })).status, 403);
    const csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
    assert.equal((await post('/logout', { csrf }, { Cookie, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await post('/logout', { csrf }, { Cookie })).status, 303);
    assert.doesNotMatch(await (await fetch(base, { headers: { Cookie } })).text(), /001234/);
    config.REVIEW_INBOX_ENABLED = 'false';
    assert.equal((await fetch(base)).status, 404);
    config = { ...credentials, REVIEW_INBOX_PASSWORD: '' };
    assert.equal((await fetch(base)).status, 503);
  } finally { inbox.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('SMTP integration mirrors only successful test-account sends; ordinary mail and failed sends are excluded', async () => {
  const nodemailer = require('nodemailer');
  const originalTransport = nodemailer.createTransport;
  const values = { ...credentials, SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_SECURE: 'true',
    SMTP_PASS: 'fake-test-password', MAIL_FROM: 'sender@example.invalid' };
  const originalEnv = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  let failDelivery = false;
  nodemailer.createTransport = () => ({ async sendMail() { if (failDelivery) throw new Error('Simulated SMTP failure'); } });
  const inbox = require('../src/services/reviewInbox.service');
  const mail = require('../src/services/mail.service');
  try {
    const token = inbox.login(credentials.REVIEW_INBOX_EMAIL, credentials.REVIEW_INBOX_PASSWORD, 'tester');
    await mail.sendResetCode('private@example.invalid', '999999');
    assert.deepEqual(inbox.list(token), []);
    await mail.sendResetCode(credentials.REVIEW_INBOX_EMAIL, '001234');
    await mail.sendPasswordChanged(credentials.REVIEW_INBOX_EMAIL, { username: 'Review test user' });
    assert.equal(inbox.list(token).length, 2);
    assert.match(inbox.list(token)[1].text, /001234/);
    failDelivery = true;
    await assert.rejects(mail.sendResetCode(credentials.REVIEW_INBOX_EMAIL, '777777'));
    assert.equal(inbox.list(token).length, 2);
    assert.ok(inbox.list(token).every(row => !row.text.includes('777777')));
    process.env.REVIEW_INBOX_PASSWORD = 'misconfigured';
    failDelivery = false;
    await mail.sendResetCode('ordinary@example.invalid', '999999');
  } finally {
    nodemailer.createTransport = originalTransport;
    for (const [key, value] of originalEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    inbox.settings();
  }
});

test('configured public origin supports HTTPS proxy forms with an internal HTTP host while rejecting other origins', async () => {
  const publicOrigin = 'https://gachaapi.filmtanapon.com';
  const config = { ...credentials, REVIEW_INBOX_ORIGIN: publicOrigin };
  const inbox = createReviewInbox({ env: () => config });
  const app = express();
  app.set('trust proxy', 1);
  app.use('/review-inbox', createReviewInboxRouter(inbox));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/review-inbox`;
  const post = (path, body, extra = {}) => fetch(base + path, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Host: 'internal-api.local:3000',
      'X-Forwarded-Proto': 'http', Origin: publicOrigin, 'Sec-Fetch-Site': 'same-origin', ...extra },
    body: new URLSearchParams(body) });
  try {
    const fields = { email: credentials.REVIEW_INBOX_EMAIL, password: credentials.REVIEW_INBOX_PASSWORD };
    const response = await post('/login', fields);
    assert.equal(response.status, 303, 'Public HTTPS origin must work despite internal host/protocol rewriting');
    const Cookie = response.headers.get('set-cookie').split(';')[0];
    const html = await (await fetch(base, { headers: { Cookie } })).text();
    const csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
    for (const origin of ['https://evil.invalid', 'http://gachaapi.filmtanapon.com',
      'https://gachaapi.filmtanapon.com.evil.invalid', 'null', 'http://internal-api.local:3000']) {
      assert.equal((await post('/login', fields, { Origin: origin })).status, 403);
      assert.equal((await post('/logout', { csrf }, { Cookie, Origin: origin })).status, 403);
    }
    assert.equal((await post('/login', fields, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await post('/logout', { csrf: 'wrong' }, { Cookie })).status, 403);
    assert.equal((await post('/logout', { csrf }, { Cookie })).status, 303);
    for (const origin of ['http://gachaapi.filmtanapon.com', 'https://user:pass@example.com',
      'https://example.com/path', 'https://example.com/?q=1', 'https://example.com/#fragment', 'https://*.example.com']) {
      config.REVIEW_INBOX_ORIGIN = origin;
      assert.throws(() => inbox.settings(), { status: 503 });
      assert.equal((await fetch(base)).status, 503);
    }
  } finally { inbox.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
