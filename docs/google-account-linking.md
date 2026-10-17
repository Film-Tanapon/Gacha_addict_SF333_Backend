# Explicit Google account linking

Deploy the backend migration and updated API before distributing the updated app.
The container startup already runs `prisma migrate deploy`; rebuild the API image
to generate the Prisma client for the updated schema.

`POST /api/auth/google` accepts a Firebase Google ID token. For an existing email
account it returns HTTP 409 with `code: "GOOGLE_LINK_REQUIRED"`. It does not create
a session or modify the account. Supplying a password or link flag to this route
does not bypass the confirmation flow.

`POST /api/auth/google/link` accepts `{ idToken, password }`. Both the verified
Google email and the existing Gacha Addict password must match. The Google
authentication must be at most five minutes old. The endpoint rejects a different
Google UID already attached to the account, limits confirmation attempts to five
per account per 15 minutes in the database, and rechecks the password and account
version under a row lock before linking. Confirmation revokes older sessions and
outstanding reset challenges. No new SMTP secret or environment variable is needed.

The app keeps the pending Firebase token and confirmation password in component
memory only. Cancel and password-reset navigation clear the confirmation form.
The password is the existing app password, not the Google password. Users who do
not recognize the existing account must reset its password using the email OTP
flow before confirming; this removes the password chosen by a possible squatter.

The migration marks existing Google-only accounts as verified. Existing Google
accounts that also have a password must confirm once again; their existing JWTs
are invalidated, and ordinary password login remains blocked until confirmation.
This addresses accounts created by the previous automatic linking behavior.
Previously linked users who cannot confirm their Google identity should use the
support channel; a matching email/password alone never replaces a Google UID.

This change does not introduce email verification at initial password signup.
The separate approved password change API is documented in account-password-changes.md.
The explicit link flow prevents a new Google user
from silently entering a password account registered by somebody else.

Rollback snapshots restore source files only. Do not drop user data or reverse
the authentication-version invalidation on the server. Keep applied migration
history when rolling back a deployed release, and regenerate Prisma after any
schema restoration.
