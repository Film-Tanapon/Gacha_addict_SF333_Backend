# Atomic item replacement for direct card APIs

`PUT /api/cards/:id` and `PUT /api/gachas/:id` share
`card.service.updateCard`. Previously, normalization produced a nested
`create` operation, and the update appended `deleteMany` to it. With the Prisma
version in use, replacement items were inserted before the delete-all operation
and disappeared despite a successful response.

When an item list is supplied (`cardItems`, `Items` or `randomList`), the service
now validates it first and runs these steps in one interactive transaction:

1. Update the parent card's metadata. Its row lock serializes replacements of
   the same deck until commit.
2. Delete that card's old items.
3. Create the replacements and return the updated card with its items.

This does not rely on nested mutation object key order. If insertion fails,
the transaction rolls back metadata, deleted items and the history relations
modified by `ON DELETE SET NULL`. A title-only update keeps existing item IDs.

Successful replacement creates new item IDs, as the original API intended.
Existing Result rows retain their stored deck identity, title, result text and
timestamp; their link to a deleted item becomes null. Favorite links continue
to reference the same card. The separate backup sync service is unchanged.

## Verification

Run against an isolated, migrated and seeded PostgreSQL test database:

```sh
TEST_DATABASE_URL=postgresql://... JWT_SECRET=... node --test test/cardReplacement.test.js
TEST_DATABASE_URL=postgresql://... JWT_SECRET=... npm test -- --test-concurrency=1
```

The HTTP regression tests cover both routes, response and database contents,
subsequent pulls, preserved history and favorites, metadata-only changes,
invalid input, insertion failure rollback, concurrent replacements and ownership.
The rollback fixture uses a NUL in a replacement name, which PostgreSQL text
cannot store, to fail a real insert without changing database schema or
introducing production fault injection. Test accounts and their data are
removed after the run.

No schema migration, frontend update or environment change is required for
this fix. Rebuild/restart the backend to apply it. This prevents future loss;
it does not reconstruct items already removed by earlier updates. Those need
to be saved again from an intact client copy or recovered from a backup.
