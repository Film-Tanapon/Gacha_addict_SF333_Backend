const nodemailer = require('nodemailer');

function smtpOptions(env = process.env) {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const port = Number(env.SMTP_PORT || 465);
  const secureText = env.SMTP_SECURE ?? (port === 465 ? 'true' : 'false');
  const pass = env.SMTP_PASS?.replace(/\s/g, '');
  const from = env.MAIL_FROM?.trim();
  if (!host || !user || !pass || !from || ![465, 587].includes(port) ||
      !['true', 'false'].includes(secureText) || (port === 465) !== (secureText === 'true')) {
    const error = new Error('ระบบส่งอีเมลยังไม่พร้อม กรุณาติดต่อผู้ดูแล');
    error.status = 503;
    throw error;
  }
  return { host, port, secure: secureText === 'true', requireTLS: true,
    auth: { user, pass }, connectionTimeout: 10000, greetingTimeout: 10000,
    socketTimeout: 15000, logger: false, debug: false,
    disableFileAccess: true, disableUrlAccess: true };
}
let transport;
function getTransport() {
  if (!transport) transport = nodemailer.createTransport(smtpOptions());
  return transport;
}
function assertConfigured() { smtpOptions(); }
async function verifySmtp() { await getTransport().verify(); }
async function sendResetCode(email, code) {
  await getTransport().sendMail({ from: process.env.MAIL_FROM, to: email,
    subject: 'Gacha Addict — รหัสยืนยันรีเซ็ตรหัสผ่าน',
    text: `รหัส OTP ของคุณคือ ${code}\n\nรหัสนี้ใช้ได้ครั้งเดียวภายใน 10 นาที อย่าเปิดเผยรหัสนี้ให้ผู้อื่น\nหากคุณไม่ได้ขอรีเซ็ตรหัสผ่าน ให้ละเว้นอีเมลนี้ บัญชีของคุณยังไม่มีการเปลี่ยนแปลง` });
}
async function sendPasswordChanged(email) {
  await getTransport().sendMail({ from: process.env.MAIL_FROM, to: email,
    subject: 'Gacha Addict — เปลี่ยนรหัสผ่านแล้ว',
    text: 'รหัสผ่านบัญชี Gacha Addict ของคุณถูกเปลี่ยนแล้ว และ session เดิมถูกยกเลิก\nหากคุณไม่ได้ดำเนินการ โปรดติดต่อผู้ดูแลผ่านหน้า Privacy Policy ในแอปทันที' });
}
module.exports = { smtpOptions, assertConfigured, verifySmtp, sendResetCode, sendPasswordChanged };
