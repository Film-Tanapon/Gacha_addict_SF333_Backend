# Email/password login attempts

`POST /api/auth/login` allows 15 password checks per normalized email in a fixed
three-hour window. The window starts with the first attempt; it does not extend
when further requests arrive. A successful login before lockout clears the
counter. The 15th failed check and subsequent requests return HTTP 429 with
`code: LOGIN_RATE_LIMITED`, a Thai explanation and a `Retry-After` header in seconds.
During lockout even the correct password must wait until the window expires.

The same limit applies to unknown emails. Changing email capitalization, adding
surrounding whitespace, changing IPs or restarting the app/backend cannot reset
the counter. Atomic PostgreSQL reservations prevent parallel requests from
checking more than 15 passwords. Server errors release their reservation.
Expired counters reset on the next attempt; existing password-reset housekeeping
also removes expired rows. No additional environment variable or migration is
needed beyond the existing `password_reset_rate_limit` table migration.

Counters use an `email-login:` prefix and a SHA-256 email digest in the existing
rate-limit table, separate from OTP, password-change and Google-link limits.
Google sign-in and existing authenticated sessions are unaffected.

Deploy the updated backend for this rule to take effect. The app already displays
the API's error message on the Sign In screen; a frontend-only update cannot
enforce this limit.

The current app persists its backend token in AsyncStorage (`auth_token`) and its
account scope/profile separately. Closing and reopening the app does not clear
them. It restores the account by requesting `/auth/me`. `JWT_EXPIRES_IN` currently
defaults to `7d`; there is no refresh-token flow. Expired/revoked tokens require
sign-in again. A failed network/profile/mission request can currently make the UI
show Guest even though the stored token remains; that pre-existing behavior is
only inspected in this change.
