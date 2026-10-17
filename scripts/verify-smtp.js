require('dotenv').config();
require('../src/services/mail.service').verifySmtp().then(() => {
  console.log('SMTP connection and authentication succeeded. No email was sent.');
}).catch(error => {
  console.error('SMTP verification failed:', /^[A-Z0-9_-]+$/.test(error.code || '') ? error.code : 'CONFIG_OR_CONNECTION_ERROR');
  process.exitCode = 1;
});
