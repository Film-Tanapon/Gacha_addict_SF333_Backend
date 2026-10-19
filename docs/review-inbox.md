# Restricted Play review inbox

This optional HTTPS page mirrors only GachaAddict password-reset OTP and password-changed emails sent successfully through SMTP to **one dedicated test account**. It does not connect to Gmail, expose arbitrary mailboxes, bypass OTP validation, or change regular account login. It is disabled by default.

## Configure on the server

1. Create a dedicated account in the app using a real email address you control. Do not use a real customer's account, your personal inbox, or the SMTP sender account. Give it sample data only.
2. Set these in the backend `.env` (placeholders have already been added):

```dotenv
REVIEW_INBOX_ENABLED=true
REVIEW_INBOX_ORIGIN=https://gachaapi.filmtanapon.com
REVIEW_INBOX_EMAIL=your-dedicated-test-account@example.com
REVIEW_INBOX_PASSWORD=PASTE_A_SEPARATE_RANDOM_PASSWORD_HERE
```

Generate the inbox password locally using `openssl rand -hex 24`. At least 24 characters are required. Keep it separate from the app account password, SMTP App Password, admin key and JWT secret. Do not send these secrets in chat or commit `.env`.

3. Deploy with `docker compose up -d --build api`. Changes to `.env` alone require recreating the API container, not just restarting it: `docker compose up -d --force-recreate api`.
4. Open `https://gachaapi.filmtanapon.com/review-inbox`. Sign in with `REVIEW_INBOX_EMAIL` and **the inbox password**. HTTPS is required for its secure session cookie. `REVIEW_INBOX_ORIGIN` must be the public HTTPS origin without a path (for example, `https://gachaapi.filmtanapon.com`, not a URL ending in `/review-inbox`). It lets form checks use the intended public URL even if a reverse proxy rewrites the internal scheme or Host header. Other origins and cross-site submissions remain forbidden. Invalid configured origins fail closed. Leaving it unset falls back to the request origin for compatibility.

   Keep `TRUST_PROXY_HOPS` matched to your real proxy chain for accurate client IP rate limiting (for the existing Cloudflare Proxy -> API deployment this is 1). No extra Cloudflare challenge, geographic restriction or login wall should prevent reviewers from reaching this page.

   The inbox responses use `Referrer-Policy: same-origin`, which preserves a valid Origin on native HTML form POSTs while withholding referrers from other sites. Do not override this page with `no-referrer` in Cloudflare or another proxy: browsers then submit `Origin: null` and the request is rejected. After updating, navigate freshly to `/review-inbox` before submitting; do not resubmit an old `/login` error page.
5. In the app, choose Forgot Password and enter the test account email. After SMTP succeeds, refresh the inbox page, copy the newest OTP, and complete the usual reset flow. Test that a wrong/expired/used OTP is still rejected. A password-change notification is mirrored too.

The app password and inbox password serve different purposes. Resetting the app password does not change the inbox password. Prefer a separate reset-test account from the main review login account, so resetting a password does not invalidate the main login credentials another reviewer needs. Supply both accounts' instructions in Play Console. Keep any current app credentials there updated during preparation.

## English App access instructions

Enter the app account email and current app password in the regular login fields. In additional instructions, supply the following with actual values **in Play Console only**:

```text
Use the supplied email and app password to sign in. OTP is not required for sign-in.

To test password reset:
1. Select Forgot Password in the app and enter this dedicated reset-test email: [REVIEW_INBOX_EMAIL]. Do not reset the main review login account.
2. Open https://gachaapi.filmtanapon.com/review-inbox in a browser.
3. Sign in using the dedicated reset-test email and this separate inbox password: [INBOX PASSWORD].
4. Wait a few seconds and select Refresh messages. Copy the latest OTP into the app.
5. Complete the password reset and use the new password to sign in.
The inbox contains only this test account's reset/confirmation messages.
```

## Scope, retention and operations

- Only the configured recipient is captured. Recipient query parameters, other account credentials and normal app JWTs cannot select another inbox.
- The page requires its own random password, uses an HttpOnly/Secure/SameSite cookie, expires sessions after 30 minutes, checks logout CSRF and rejects cross-site posts. Login checks are capped at 10 per IP and 100 globally per 15-minute window, in memory.
- At most 10 messages stay in this process's memory, for at most 10 minutes. Old reset-code messages are superseded when a new code is delivered. Mail is escaped as text; scripts and embedded images are not rendered. Nothing is written to a mail database, backup file or application log.
- Retention starts at delivery. The actual OTP validity is enforced by the existing reset challenge, so a displayed code may already have expired or been consumed. Request a new code in the app when necessary. Existing reset cooldowns still apply.
- Restarting the API clears messages, sessions and rate-limit counters. Multiple API processes/replicas are not supported by this memory-only inbox; use one API instance while enabled. Do not restart during a review test; otherwise sign in again and request a fresh OTP.
- Deleting the test account through the app or supported deletion service clears messages and sessions and stops late sends from appearing. After recreating the test account, restart the API before using its inbox again.
- Changing the inbox email/password/public origin revokes existing sessions and clears messages. Invalid configuration returns 503 for this page without interrupting normal SMTP. The SMTP sender cannot be configured as the review recipient.
- Set `REVIEW_INBOX_ENABLED=false` and recreate the API to disable it (returns 404). Keep it available while the review instructions depend on it.
- The normal email is still delivered to the test email address; retention in that real mailbox is separate. Production users' reset messages are never mirrored.

This supplies review access, not a guarantee of approval. Official access requirements: https://support.google.com/googleplay/android-developer/answer/15748846?hl=en
