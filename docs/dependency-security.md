# Dependency remediation — 2026-10-17 (audit part 11)

The final npm audit reports **0 vulnerabilities** for both the full and
`--omit=dev` dependency trees, down from 16 and 12 affected packages respectively.
This is the result for the current npm advisory database, not a guarantee that
the entire application has no defects.

## Changes

- gRPC 1.14.4 moved to 1.14.6 and brace-expansion 5.0.9 to 5.0.12 in the lockfile.
- `deepmerge-ts` is overridden from 7.1.5 to 8.0.2 for Prisma's config loader.
  Prisma/client stay at 6.19.3. The v8 security fix and Map/type changes are in
  the [upstream release notes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0).
  A regression check loads real Prisma config with the project schema/migrations.
- `uuid` is overridden from 9.0.1 to 11.1.1 for existing Google SDK dependency
  callers. This is the patched CommonJS-compatible release; v12 removed CommonJS
  support, so a blanket latest override would not fit this backend. Tests check
  nested gaxios/google-gax/teeny-request callers and the affected buffer-boundary
  behavior. See the [uuid advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq)
  and [upstream changelog](https://github.com/uuidjs/uuid/blob/main/CHANGELOG.md).
- `nodemon` was removed. `npm run dev` now uses `node --watch index.js`, retaining
  development restart behavior while removing nodemon/chokidar/braces from this
  tree. Watch startup/restart was checked locally; [Node 20 documents watch mode](https://nodejs.org/docs/latest-v20.x/api/cli.html#--watch).

Firebase Admin remains on its existing v13 line, retaining the Node 20 Docker
runtime and current Auth API. API behavior, JWT configuration, actual `.env`,
Docker/network settings, schemas and business data are unchanged. No new
migration is added by this section.

## Install and verify

```sh
npm ci
npm run prisma:generate
```

Generate Prisma after a fresh install before running the API/tests. The existing
Dockerfile already runs generation explicitly, then applies migrations through
its entrypoint. Deploy updated package.json and package-lock.json together and
rebuild the existing API image through the normal server process. Keep all
previously required migrations and environment settings.

`test/dependencyCompatibility.test.js` adds checks for the overridden libraries
and the actual Firebase Admin Auth methods without external credentials/network
calls. Full integration tests use an isolated PostgreSQL database plus an
explicit test JWT key. Live Google authentication and real SMTP delivery are not
part of this dependency smoke test.

Frontend still has the separate unpatched braces advisory through its build
tooling. Do not interpret this backend's clean audit as a clean frontend audit.

To roll back, use the guarded task snapshot, reinstall with `npm ci`, generate
Prisma and rebuild. Source fixes from earlier audit parts and database contents
are preserved. Restoring the former dependency tree restores its advisories too.
