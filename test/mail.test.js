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

test('reset emails greet the account owner, preserve OTP zeros and show the change time in Bangkok', async () => {
  const nodemailer = require('nodemailer');
  const privacy = require('../src/config/privacy');
  const mail = require('../src/services/mail.service');
  const originalTransport = nodemailer.createTransport;
  const originalSupport = privacy.supportEmail;
  const originalEnv = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  const messages = [];
  Object.assign(process.env, env);
  nodemailer.createTransport = () => ({ async sendMail(message) { messages.push(message); } });
  try {
    await mail.sendResetCode('owner@example.invalid', '001234', { username: 'เจ้าของบัญชี' });
    assert.equal(messages[0].to, 'owner@example.invalid');
    assert.equal(messages[0].text, 'สวัสดีคุณ เจ้าของบัญชี\n\nเราได้รับคำขอรีเซ็ตรหัสผ่านสำหรับบัญชีของ GachaAddict ของคุณ หากนี่คือคำขอของคุณ กรุณาใช้รหัส OTP ด้านล่างนี้เพื่อดำเนินการต่อ\n\n001234\nรหัสนี้จะหมดอายุภายใน 10 นาที');
    privacy.supportEmail = 'support@example.invalid';
    await mail.sendPasswordChanged('owner@example.invalid', { username: 'เจ้าของบัญชี', changedAt: new Date('2026-10-18T02:15:30.000Z') });
    const notice = messages[1];
    assert.equal(notice.to, 'owner@example.invalid');
    assert.ok(notice.text.startsWith('สวัสดีคุณ เจ้าของบัญชี,'));
    assert.match(notice.text, /18 ตุลาคม 2026/);
    assert.match(notice.text, /09:15:30/);
    assert.match(notice.text, /\(เวลาไทย\)/);
    assert.match(notice.text, /หากคุณเป็นผู้ดำเนินการเอง สามารถเพิกเฉยอีเมลฉบับนี้ได้เลย/);
    assert.match(notice.text, /ทันทีที่ support@example.invalid เพื่อระงับบัญชีและกู้คืนความปลอดภัย/);
    assert.ok(!notice.text.includes('001234'));
  } finally {
    nodemailer.createTransport = originalTransport;
    privacy.supportEmail = originalSupport;
    for (const [key, value] of originalEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
