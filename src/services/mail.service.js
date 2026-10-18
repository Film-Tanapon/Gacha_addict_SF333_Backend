const nodemailer = require('nodemailer');
const privacy = require('../config/privacy');

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
async function sendResetCode(email, code, { username = 'ผู้ใช้' } = {}) {
  await getTransport().sendMail({ from: process.env.MAIL_FROM, to: email,
    subject: 'GachaAddict — รหัสยืนยันรีเซ็ตรหัสผ่าน',
    text: `สวัสดีคุณ ${username}\n\nเราได้รับคำขอรีเซ็ตรหัสผ่านสำหรับบัญชีของ GachaAddict ของคุณ หากนี่คือคำขอของคุณ กรุณาใช้รหัส OTP ด้านล่างนี้เพื่อดำเนินการต่อ\n\n${code}\nรหัสนี้จะหมดอายุภายใน 10 นาที` });
}
async function sendPasswordChanged(email, { username = 'ผู้ใช้', changedAt = new Date() } = {}) {
  const timestamp = new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date(changedAt));
  await getTransport().sendMail({ from: process.env.MAIL_FROM, to: email,
    subject: 'GachaAddict — เปลี่ยนรหัสผ่านแล้ว',
    text: `สวัสดีคุณ ${username},\n\nอีเมลฉบับนี้ส่งมาเพื่อแจ้งให้ทราบว่า รหัสผ่านสำหรับบัญชี GachaAddict ของคุณได้รับการเปลี่ยนแปลงเรียบร้อยแล้วเมื่อ ${timestamp} (เวลาไทย)\n\nหากคุณเป็นผู้ดำเนินการเอง สามารถเพิกเฉยอีเมลฉบับนี้ได้เลย\n\nแต่ถ้าคุณไม่ได้เป็นคนเปลี่ยนรหัสผ่านนี้ บัญชีของคุณอาจตกอยู่ในอันตราย กรุณาติดต่อทีมงานสนับสนุนของเราทันทีที่ ${privacy.supportEmail} เพื่อระงับบัญชีและกู้คืนความปลอดภัย` });
}
module.exports = { smtpOptions, assertConfigured, verifySmtp, sendResetCode, sendPasswordChanged };
