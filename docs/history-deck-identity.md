# History deck identity (audit part 5)

New draws retain an immutable `gachaId` in addition to `gachaName`, the name at
draw time. Backups use the local deck's stable `GachaItem.id`, including built-in
IDs. Direct server pulls use the decimal-string ID returned by `/api/gachas`.
The backup history table and direct server result table remain separate stores;
this change does not combine or remap their ID namespaces.

## Display and legacy behavior

The app groups identified history by `gachaId`, navigates by that ID, and matches
the cover image by ID. Two decks can share the same name without sharing a
history group or image. Renaming a deck updates the group's title to its current
name; the detail still shows the recorded name on draws made under an older
name. Draws and groups remain ordered newest first.

If a deck has been removed, its history retains the ID, uses its most recently
recorded name and default artwork, and can still be opened. There is no foreign
key from the saved identity to the live deck or item, so deleting/replacing
items cannot erase that identity.

Old local/backup history with no ID is preserved in separate, explicitly labeled
legacy groups by its recorded name. It is never assigned to a current deck just
because the names match, even if only one matching deck exists today: deleted,
renamed or same-name decks make that inference unreliable. Such an old group
can still contain several original decks with the same name; there is no
reliable way to split it retroactively from names alone. New identified draws
never mix into that legacy group.

## Backend and deployment

Migration `20261017180000_history_deck_id` adds nullable `gacha_id` text columns
to `backup_history` and `result`. Direct server results with a surviving
`cardItem` relation are backfilled using the actual related card ID. Results
whose item was already deleted and ID-less backups remain NULL. No rows are
deleted, renamed or inferred from names. Mission/economy behavior is unchanged.

Deploy this backend before distributing the updated app, so its first new draws
are not sent through an older backend that strips unknown history fields. With
the existing Docker setup and updated server source:

```sh
docker compose up -d --build api
docker compose logs --tail=100 api
```

The entrypoint applies migrations before starting the API. Non-Docker installs
must regenerate Prisma and run `npm run prisma:deploy` before restarting. No new
environment variable is required. Only an isolated local test database has been
migrated during implementation; production has not been deployed.

Backup APIs validate an optional nonempty string `gachaId` up to 500 UTF-16 units;
missing/null values remain compatible with legacy clients. The paged API returns
it when present. The immutable duplicate-ID rule prevents an old client sending
an ID-less copy from erasing an accepted identity. Client backup merges likewise
preserve a known server identity when its local copy has none. New local draws
write their identity before syncing, and the persisted outbox carries it across
restarts and device restoration.

## Validation and rollback

Tests cover same-name decks, rename, the recorded name at draw time, ID-scoped
navigation and images, deleted decks/items, legacy isolation, optional-ID
validation, paged and legacy round trips, older-client retries, evidence-based
migration and restoration of 10,051 identified records on a new device.
Account ownership filtering remains in place.

Use the task's guarded source snapshot to revert this section. Keep the applied
migration file and database columns; do not drop/rewrite history to undo source.
After source restoration, regenerate Prisma and rebuild the API/app. Older code
uses its original name grouping, while saved IDs remain in the database for a
forward update.
