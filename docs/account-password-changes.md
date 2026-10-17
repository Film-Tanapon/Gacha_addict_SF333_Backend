# Account password changes

`PUT /api/profile` and `PUT /api/users/:id` reject any `password` field before
writing any profile fields. Use `POST /api/auth/password/change` instead.

The change endpoint requires the current bearer session plus exactly one proof:

- `{ currentPassword, newPassword }` for accounts with an app password.
- `{ firebaseIdToken, newPassword }` for the same linked Google UID, with a verified
  Google provider/email and an authentication time at most five minutes old.

The account ID comes from the bearer token. A body userId/email cannot select a
different account. Google-only users can establish an app password with fresh
Google proof. Previously unverified automatic links remain subject to the separate
Google-link confirmation rules; this endpoint does not bypass them.

Register, change and email OTP reset use `utils/password.js`: at least eight UTF-16
code units, uppercase ASCII, lowercase ASCII and a digit, and at most 72 UTF-8
bytes for bcrypt. Existing passwords remain accepted for sign-in and identity
confirmation even when they do not meet the new creation policy.

Confirmation is limited to five requests per account per 15 minutes in PostgreSQL.
After checking the proof, the service locks the user row and rechecks the credential
and session version to reject races with resets, linking or deletion. A successful
change increments authVersion and deletes outstanding reset challenges. All old
sessions, including the requesting device, must sign in again. A notification email
is attempted after commit; email delivery failure does not undo the password change.

In Edit Profile, use the password button. Google users can choose Google verification
or an existing app password if they have one. Fields stay in component memory only.
The device clears its old bearer token and returns to the guest store after success,
while preserving the account's locally saved decks/history for the next sign-in.

There is no new environment variable or database migration in this change. Deploy
the API before the updated frontend. It assumes existing auth-version and password
reset migrations (and the preceding Google-link migration) are already applied.
