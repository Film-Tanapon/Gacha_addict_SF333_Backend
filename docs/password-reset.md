# SMTP และรีเซ็ตรหัสผ่านด้วย OTP

ใช้รหัสผ่านของ backend เดิม ไม่ย้ายบัญชีไป Firebase และไม่ต้องมีหน้าเว็บรีเซ็ต ผู้ใช้กด **Forgot your password?** ในหน้า Sign In แล้วกรอกอีเมล → OTP → รหัสผ่านใหม่

## ตั้งค่า server

เพิ่มค่าต่อไปนี้ใน `.env` ของ **server** (ไฟล์นี้ไม่ส่งผ่าน Git):

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-sender@gmail.com
SMTP_PASS=your-google-app-password
MAIL_FROM="Aymahakon <your-sender@gmail.com>"
PASSWORD_RESET_SECRET=generate-a-private-random-secret-at-least-32-characters
TRUST_PROXY_HOPS=0
```

ใช้บัญชีเดียวกันสำหรับผู้ส่งและ App Password ค่า `PASSWORD_RESET_SECRET` ควรสร้างด้วย `openssl rand -hex 32` และเก็บให้คงที่นอก source code ค่านี้ใช้ hash รหัส/ข้อมูลจำกัดคำขอและเข้ารหัส OTP ที่รอส่ง หากเปลี่ยนค่านี้ OTP เดิมจะใช้ไม่ได้ ห้ามใส่ค่าเหล่านี้ใน frontend

หาก API อยู่หลัง reverse proxy ที่เชื่อถือได้หนึ่งชั้นและ API รับ traffic จาก proxy นั้นเท่านั้น ให้ตั้ง `TRUST_PROXY_HOPS=1` เพื่อจำกัดคำขอตาม IP จริง ห้ามเชื่อ `X-Forwarded-For` จากอินเทอร์เน็ตโดยไม่มี proxy ที่ควบคุม ไม่ตั้งค่าจะใช้ IP ของการเชื่อมต่อโดยตรง

ต้องให้ server เชื่อมต่อออก `smtp.gmail.com:465` ได้ พอร์ต 587 รองรับด้วย `SMTP_SECURE=false` และบังคับ STARTTLS ตรวจการเชื่อมต่อโดย **ไม่ส่งอีเมล** ด้วย:

```bash
npm ci
npm run smtp:verify
```

## Deploy ด้วย Docker

```bash
docker compose build api
docker compose run --rm api npx prisma migrate deploy
docker compose up -d api
docker compose exec api npm run smtp:verify
```

Migration เพิ่ม `user.auth_version` และตาราง OTP/rate limit ต้องใช้ schema ใหม่ก่อนเริ่ม API รุ่นนี้ สำรองฐานข้อมูลก่อน migrate ตามขั้นตอนของระบบเดิม ค่า SMTP/JWT เดิมไม่ถูกแก้ไข

## API

ไม่ต้องมี Authorization และตอบ `Cache-Control: no-store` ทุกขั้นตอน:

1. `POST /api/auth/password-reset/request` รับ `{ "email": "owner@example.com" }` ตอบ 202 พร้อม `challengeId`, `resendAfter: 60`, `expiresIn: 600` และข้อความเดียวกันทั้งบัญชีที่มีอยู่/ไม่มีอยู่/Google อย่างเดียว ไม่คืน OTP
2. `POST /api/auth/password-reset/verify` รับ `{ "challengeId": "...", "code": "123456" }` ตอบ `resetToken`, `expiresIn: 300` เมื่อยืนยันสำเร็จ รหัสใช้ซ้ำไม่ได้
3. `POST /api/auth/password-reset/complete` รับ `{ "resetToken": "...", "password": "NewPassword123" }` บันทึก bcrypt ยกเลิก session API เก่าทุกเครื่อง และลบคำขอรีเซ็ตของบัญชี ต้องเข้าสู่ระบบใหม่ ไม่มีการ login อัตโนมัติ

รหัสใหม่ต้องมีอย่างน้อย 8 ตัว มี A-Z, a-z, ตัวเลข และไม่เกิน 72 ไบต์ UTF-8 เพื่อไม่ให้ bcrypt ตัดรหัสผ่าน บัญชี Google อย่างเดียวใช้ Google Sign-In และไม่สามารถเพิ่มรหัสผ่านผ่าน OTP นี้ได้ บัญชีอีเมลที่ผูก Google ภายหลังยังรีเซ็ตรหัสผ่านอีเมลได้

## ความปลอดภัยและการส่งอีเมล

- OTP สุ่ม 6 หลัก ใช้ได้ 10 นาที กรอกผิดได้ 5 ครั้ง; เมื่อผ่านได้ reset token สุ่ม 256 บิตที่ใช้ได้ครั้งเดียวใน 5 นาที
- ขอใหม่ได้ทุก 60 วินาที สูงสุด 5 ครั้ง/ชั่วโมงต่ออีเมล และ 30 ครั้ง/ชั่วโมงต่อ IP; ตรวจ OTP สูงสุด 60 ครั้ง/15 นาทีต่อ IP; ตั้งรหัสใหม่สูงสุด 30 ครั้ง/15 นาทีต่อ IP ตอบ 429 พร้อม `Retry-After`
- เก็บ hash แบบมีคีย์ของ OTP/token อีเมล และ IP เก็บ OTP ที่รอส่งด้วย AES-256-GCM ไม่บันทึกรหัส/token ลง log
- ส่ง OTP จากคิวในฐานข้อมูลหลังตอบ HTTP เพื่อไม่เปิดเผยบัญชีจากเวลาส่ง SMTP เมื่อส่งสำเร็จลบรหัสที่เข้ารหัส คิว retry สูงสุด 3 ครั้งห่าง 60 วินาที และอยู่รอดเมื่อ API restart ใช้รหัสจากคำขอล่าสุดเสมอ
- worker ทำงานทุก 15 วินาทีเมื่อเริ่มด้วย `node index.js` ลบคำขอ/rate limit ที่หมดอายุ หากส่งไม่ถึงให้ตรวจ log ข้อความทั่วไปและรัน `smtp:verify` ใน server ห้าม log App Password หรือ OTP
- แจ้งอีเมลเมื่อเปลี่ยนรหัสผ่านสำเร็จแบบ best effort หากส่งแจ้งเตือนไม่สำเร็จจะไม่ย้อนรหัสผ่านกลับ
- ข้อมูลหลักของ OTP ถูกลบเมื่อหมดอายุ/ลบบัญชี สำเนาสำรองยังเป็นไปตามนโยบาย 90 วัน เวลากำหนดหมดอายุถูกตรวจใหม่ทุกครั้ง จึงใช้รหัสที่หมดอายุจาก backup ไม่ได้
- การทดสอบอัตโนมัติใช้ SMTP stub และ PostgreSQL แยก ไม่ส่งอีเมลจริงและไม่เปลี่ยนรหัสผ่านของบัญชีจริง

เครื่องพัฒนามีการตรวจ SMTP จริงด้วย `verify()` เท่านั้น ต้อง deploy backend บน server และให้แอปเชื่อม API รุ่นใหม่ จึงจะขอ OTP จริงได้

แนวทางอ้างอิง: [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [Nodemailer SMTP](https://nodemailer.com/smtp)
