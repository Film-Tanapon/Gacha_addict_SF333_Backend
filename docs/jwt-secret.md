# Required JWT configuration (audit part 10, JWT only)

The backend requires an explicit `JWT_SECRET`. It validates that value directly
after loading `.env`, before loading routes, starting background workers or
listening for requests. The JWT utility also validates on import, so other
callers cannot issue or verify tokens using an implicit development key.

Missing/empty/whitespace-only values and the following known placeholders cause
startup to exit with an error (comparison ignores surrounding whitespace and
case):

- `dev_secret_change_me`
- `change_me`, `changeme`, `secret`, `jwt_secret`
- `your_jwt_secret`, `your_jwt_secret_here`, `replace_me`
- `change_me_to_a_long_random_secret`

The error identifies `JWT_SECRET` without including its configured value. This
checks known placeholders, not the randomness of arbitrary non-placeholder keys.
Use a random private secret for real deployments.

## Existing server configuration

Keep the existing server `.env` value if it is already configured correctly.
This change does not rotate, generate, print or edit the real secret. Injected
environment values take precedence over `.env`, following the existing dotenv
behavior. The valid secret is used exactly as configured (it is not trimmed),
so previously signed tokens continue to verify with the same key. The existing
token lifetime remains `JWT_EXPIRES_IN` or `7d` when omitted.

After deploying the updated backend source, rebuild/restart the API through the
existing server deployment process. No database migration or frontend build is
needed for this section. Check API startup logs without printing environment
values. If startup reports the configuration error, supply a valid private
`JWT_SECRET` through the server environment or its `.env`, then restart.
Changing a key intentionally invalidates tokens signed with the previous key;
this patch does not itself change the key.

Database connection settings, Docker networking/ports, real `.env`, and password
reset configuration are untouched. The user confirmed that only the backend is
published externally and authorized this section for JWT only.

## Verification

`test/jwt.test.js` uses isolated child processes and temporary fixture `.env`
files, never the real secret. It checks missing/default values, actual entrypoint
failure before workers/listener start, `.env` load order and environment
precedence, compatibility with existing valid signatures, whitespace preservation,
expiry, rejection of signatures made with the former fallback and no secret
values in output. Database integration tests must inject a non-placeholder
test `JWT_SECRET` explicitly, along with `TEST_DATABASE_URL` for an isolated DB.

The task snapshot contains guarded source restoration with checksums. Restoring
this section reverts source only and does not modify environment values,
sessions or database contents.
