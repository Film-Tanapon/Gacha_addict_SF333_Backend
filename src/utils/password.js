const { fail } = require('./input');

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 ||
      Buffer.byteLength(password, 'utf8') > 72 ||
      !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    fail('รหัสผ่านต้องมีอย่างน้อย 8 ตัว มี A-Z, a-z และตัวเลข และยาวไม่เกิน 72 ไบต์');
  }
  return password;
}

module.exports = { validatePassword };
