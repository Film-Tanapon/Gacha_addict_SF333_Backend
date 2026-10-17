# Incremental history backup (audit part 4)

History is no longer included in every deck snapshot. `backup_history` stores
immutable records keyed by `(user_id, client_id)`, with a server sequence for
pagination. There is no 10,000-record ceiling on the new protocol. Existing
authentication, ownership and mission rules still apply.

## Deploy

Deploy the backend before distributing the updated app. After the server has
the updated source, the existing Docker setup can rebuild/recreate the API:

```sh
docker compose up -d --build api
docker compose logs --tail=100 api
```

The Docker entrypoint runs `prisma migrate deploy` before starting the API.
For a non-Docker installation, run `npm ci`, `npm run prisma:generate` and
`npm run prisma:deploy` before restarting it. No new environment values are
required. Use the normal database backup procedure before a schema deployment.

Migration `20261017170000_paged_backup_history` creates the history table and
copies **all** accepted history from `user_backup.data.history`. It preserves
the original JSON and does not award mission progress for copied records.
Do not keep an old API instance writing JSON snapshots while applying this
migration; stop/recreate old API instances during this rollout. Accounts and
uploads are unchanged. Account deletion cascades into the new history table,
and the existing PostgreSQL backup includes it.

This change has been applied only to an isolated local test database, not the
production server.

## Protocol

All endpoints below require the account's bearer token:

- `GET /api/backup?historyMode=paged` returns the deck snapshot (history is an
  empty array), revision, card ID mappings and
  `historySync: {version: 1, head: "...", pageSize: 100}`. Data may be null for
  a new account even when its separately stored history exists.
- `GET /api/backup/history?after=0&until=<head>&take=100` returns entries,
  `nextCursor` and `hasMore`. Keep `until` fixed during a download. Cursors
  are decimal strings, not client timestamps. New uploads beyond that fence
  are downloaded on the next refresh. Queries are always scoped to the owner.
- `POST /api/backup/history` with `{entries: [...]}` accepts up to 100 records.
  The result includes `acceptedIds`, per-record `rejected` entries, coins and
  the current head. An accepted ID is durable or already present. Retrying the
  same ID does not append a second copy or grant a second reward. A malformed
  record does not block other valid records in the batch. The same ID cannot
  be used to overwrite an existing history record.
- `PUT /api/backup` with `historyMode: "paged"`, `expectedRevision` and
  `data: {version: 1, gachas: [...], history: []}` merges a deck chunk by stable
  ID/update time. It preserves earlier chunks and stored history. Each write
  returns a new revision and mappings; stale revisions receive 409. The app
  sends at most 100 decks per chunk and bounds serialized payloads as well.

History insertions acquire the account row lock before allocating sequences;
this preserves per-account commit order so an in-flight earlier record cannot
be skipped by a cursor advancing past a later record. Download order is server
sequence; the app merges/deduplicates and displays history newest first using
the original draw time.

## Local preservation and validation

The app persists a pending-ID outbox, each acknowledged batch, and each
download cursor. A lost response can therefore be retried safely after an app
restart. Upgrading an existing local store queues its history automatically;
migrated rows are deduplicated on the server. If the server head moves backward,
the app restarts its cursor and requeues local history. This comparison detects
a regressed head; it is not a general detector for arbitrary server data edits.

Deck names and item/result names are limited to 500 UTF-16 units consistently
with the existing backup validator. The editor restricts new input and checks
before uploading an image; saving through the service validates as well.
The existing limits of 1,000 decks and 100 items per deck remain. JSON request
limit remains 2 MB; the app chunks around 1.5 MB of serialized UTF-8 data and
requires an individual deck to fit within that size. Use uploaded image URLs
rather than embedding large image data in a deck.

Invalid old local records are retained unchanged, excluded from uploads, and
reported in the profile with the affected deck/history name. Good records keep
syncing, including new draws made during a sync. Repairing a deck in the editor
allows it to sync on the next refresh. Invalid historical results remain local;
this change does not silently truncate, rewrite or delete them.

## Compatibility and scope

Legacy `PUT /api/backup` remains supported for old clients within its original
limits and also appends history into the new table. Legacy GET includes the new
table's history while the complete response fits within 10,000 records. Above
that it returns 426 asking the user to update, rather than truncating history.
The updated app falls back to the old protocol against an older backend; that
backend still has its original limits, so backend rollout is necessary.

Mission trust/forged offline events (audit part 7) and grouping history by deck
ID (part 5) are separate pending changes. This implementation preserves the
current mission behavior and history fields.

## Validation and rollback

Tests cover more than 10,000 records, fresh-device restore, lost acknowledgements,
retries, frozen download fences, account isolation/switches, partially invalid
old data, UTF-8 body bounds, concurrent local changes, database backfill without
rewards, revision conflicts and deletion cascade. The release AAB builds.

The task snapshot contains guarded `restore.ps1` and per-file hashes. It restores
only this section's source and refuses to overwrite files edited afterward.
Keep the applied migration file and database history when restoring source;
do not drop the new table or roll back the database. Regenerate Prisma and
rebuild the app/API after source restoration. Old source will not expose new
table-only history, but those records remain in the database for a forward fix.
