const { test } = require('node:test');
const assert = require('node:assert/strict');
const { smtpOptions } = require('../src/services/mail.service');
const env = { SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'sender@example.com', SMTP_PASS: 'abcd efgh ijkl mnop', MAIL_FROM: 'sender@example.com', SMTP_PORT: '465', SMTP_SECURE: 'true' };

test('SMTP uses authenticated TLS and normalizes the App Password without exposing it', () => {
  const options = smtpOptions(env);
  assert.equal(options.secure, true);
  assert.equal(options.requireTLS, true);
  assert.equal(options.auth.pass.length, 16);
  assert.equal(options.logger, false);
  assert.equal(options.debug, false);
  assert.equal(options.disableFileAccess, true);
  assert.equal(smtpOptions({ ...env, SMTP_PORT: '587', SMTP_SECURE: 'false' }).secure, false);
  for (const overrides of [{ SMTP_PASS: '' }, { MAIL_FROM: '' }, { SMTP_PORT: '25' }, { SMTP_SECURE: 'false' }])
    assert.throws(() => smtpOptions({ ...env, ...overrides }), { status: 503 });
});
