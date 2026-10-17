# Privacy, account deletion and 90-day backup retention

Public operator/contact: **Aymahakon**, **filmoko2345@gmail.com**. These can be
overridden with PRIVACY_OPERATOR_NAME and PRIVACY_SUPPORT_EMAIL. Existing server
JWT_SECRET settings are unchanged; no real .env or credential file was edited.

## Deploy backend before installing the new app

The migration adds uploaded_image ownership and durable account_deletion_job
tables. It does not remove existing accounts or images. The Docker startup command
applies migrations before starting the API, and the image generates its own Linux
Prisma client. .dockerignore excludes local credentials, Windows node_modules,
uploads, backups, deletion records and Git files.

```sh
git pull
docker compose up -d --build api
docker compose logs --tail=100 api
```

For a non-Docker installation, run npm ci, npx prisma generate and
npx prisma migrate deploy using the correct runtime DATABASE_URL, then restart the
API. Install compatible pg_dump/pg_restore tools if enabling managed backups.

After deploy, verify these public URLs load without a login:

- https://gachaapi.filmtanapon.com/privacy
- https://gachaapi.filmtanapon.com/account-deletion

Use the first URL as the Play Console Privacy Policy URL, and the second as the
account deletion web resource. The app links to /privacy from Profile, Sign In and
Sign Up. App release 1.0.1 uses versionCode 2 and the existing private upload key.

## What deletion does

Profile shows a red delete button immediately below Log Out. Opening it does not
delete anything. Confirmation requires the account password or a fresh Firebase
ID token for the same Google account (auth_time within five minutes, revocation
checked). DELETE /api/users/:id accepts confirmation: DELETE plus password or
firebaseIdToken. Another user's ID is rejected. A successful request returns 202.

The database transaction removes the User and cascading cards/items, owned
results, favorites, wallet, frame/theme rights, mission state, synced-pull markers
and backup snapshot. Authentication checks that the account still exists and has
no recorded deletion request, so its previous JWT cannot continue uploading or
reading private endpoints. No JWT secret rotation is required.

The app clears its account document, token and guest document on this device;
guest data may previously have been merged into the account. Other account stores
on the device remain untouched. Generation checks prevent in-flight sync results
from restoring the deleted profile. Failed authentication keeps local data intact.
Deletion from support cannot remotely erase storage on an offline device; the
public policy explains clearing app data/uninstalling there.

New uploaded files have an owner record, including unused uploads. Admin uploads
are catalog assets without an account owner. Deletion queues removal of owned
uploads and Firebase Authentication users. The worker runs at startup and every
minute, retrying failed provider/disk operations durably. It treats missing files
and Firebase auth/user-not-found as successful cleanup. Do not remove pending
cleanup jobs manually just to clear an error.

For older images without ownership records, the service collects references from
the account, cards/items and backup. It removes files exclusively associated with
that account, protecting catalog images and files used by another account. Old
unreferenced uploads cannot reliably be attributed to an owner; review those on
the real server rather than deleting arbitrary shared files. Existing copies
downloaded/cached outside this service cannot be recalled; the policy discloses it.

## External deletion requests

The public /account-deletion page prominently offers an email request to
filmoko2345@gmail.com and describes what is deleted and retained. This works after
uninstalling the app and does not require reinstallation. Google permits a support
email pathway: https://support.google.com/googleplay/android-developer/answer/13327111

Monitor that inbox. Verify ownership by communicating with the email registered to
the account; do not trust only a sender display name. Never request passwords or
OTP. After verification, an operator with server access can use the User ID from
the protected admin dashboard:

```sh
docker compose exec api node scripts/delete-account.js 123 DELETE-USER-123
```

The confirmation must repeat the actual ID. This command uses the same deletion,
file cleanup and Firebase workflow; it is not exposed as a public bypass API.
Record and communicate the request's progress to its owner, and monitor retries.

## Managed backups: maximum 90 days

Docker Compose enables a complete database/image backup approximately every 24
hours and checks retention hourly. It starts expiration at age 89 days to leave
time for a sweep before the public 90-day maximum. It also removes incomplete
managed backups older than 24 hours. Unrelated files are not removed.

Persistent host directories:

| Directory | Purpose |
|---|---|
| ./uploads | Active images |
| ./private-backups | Managed database.dump + image snapshots and manifests |
| ./private-data | Independent account-deletions.jsonl ledger |

Keep private directories outside web serving, restrict access, and keep sufficient
space for daily full snapshots. Docker includes the PostgreSQL client. A manual
managed backup uses `docker compose exec api node scripts/backup.js`.

The ledger contains only the account ID, its creation timestamp and the deletion
timestamp. It is synced before deletion commits, excludes email/password/Firebase
UID, and is retained for at most 90 days (its sweep also starts at day 89 after
expired managed snapshots are removed). It is independent of rolling database/image
snapshots. Preserve it separately during a disaster or restore; never replace it
with an older copy. Pending external cleanup jobs retain necessary file names and
Firebase UID until cleanup succeeds, as explained in the policy.

**Existing backups created by other tools are not automatically deleted.** Before
publishing the 90-day policy, inventory those on the server, remove expired copies
and set the external tool's retention to at most 90 days or retire that schedule.
The new worker intentionally only deletes directories with its own validated
manifest and gacha-backup-* name. It cannot enforce retention on unknown cloud,
host or operator-made copies. The service must remain running and retention errors
must be resolved; code does not replace server operations.

## Restore without resurrecting deleted accounts

Stop the API first. Preserve the independent ledger. The restore command refuses
expired snapshots, missing/corrupt ledgers and paths outside the configured backup
directory. It restores in a database transaction, deploys any later migrations,
copies images, and reapplies all still-retained deletion requests before exit.
JWT authentication also rejects matching accounts from an older snapshot while
the cleanup worker removes them. Do not manually restore an old database and
start serving it without replaying the ledger.

```sh
docker compose stop api
docker compose run --rm api node scripts/restore-backup.js gacha-backup-YYYYMMDDTHHMMSSZ-UUID RESTORE-AND-DELETE-CURRENT-DATA
docker compose up -d api
```

Replace the name with an actual managed directory. The confirmation is intentionally
explicit because this replaces the active database. On failure keep the API stopped
and inspect the private ledger/backup. The ordinary account deletion flow never
restores data. Test restoration on an isolated database before production use.

## Play Console Data safety and verification

The policy describes account identifiers/email/name, optional profile photos/phone,
user-created decks/history/favorites and the server economy. Complete Data safety
based on actual app and SDK behavior; Google/Firebase processing, optional versus
required features and third-party service-provider exemptions must be assessed
accurately. Do not claim no collection just because guest mode works offline.
The app does not add ads, tracking, location or a new analytics SDK in this change.

Verify in production with disposable accounts: email/Google reauthentication,
cancel/wrong password behavior, cross-account rejection, account data and owned
images gone, JWT rejected, Firebase account removed, local storage cleared, public
policy/email path working, backups expiring and deletion replay after restore.
No code review can guarantee legal compliance or Play approval. Console forms and
server practices must match the published policy, including external backups.

Sources: https://support.google.com/googleplay/android-developer/answer/10144311
and https://firebase.google.com/docs/auth/admin/manage-users
