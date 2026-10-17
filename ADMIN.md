# Backend admin

1. Set `ADMIN_API_KEY` to a long random secret in `.env` and restart the backend. The key stays in browser memory only; logging out clears it.
2. Run `npx prisma migrate deploy` and `npx prisma generate` before starting the updated server. For Docker, rebuild the API image to include the updated client and migration.
3. Open `http://localhost:3000/admin` or `/index.html`. Enter the backend URL and admin key.

The dashboard reads all 13 application tables with pagination, filters the current page, and exports an entire selected table as JSON. Password hashes and Google identity IDs are excluded from user responses. JSON export is an administrative data export, not a consistent transactional backup.

Frames and themes support create, edit and delete. Deleting a shop item removes its ownership records; deleting a frame also clears active frame selections. Editing a frame refreshes the color and image for users who selected it.

Upload PNG, JPEG or WebP images up to 5 MB in the frame editor. Images are stored in `UPLOAD_DIR` (default `uploads/`), normalized to WebP up to 1600px with transparency preserved, and linked by `Frame.imageUrl`. Download a frame image using its card's download button. The existing frame selection API returns this image as `frameUrl`. Keep the uploads directory persistent when deploying. Removing or replacing an image reference does not remove the stored file, so other existing references remain valid.

Admin APIs use `X-Admin-Key`; regular user JWTs cannot administer shop records. `/api/admin/summary`, `/api/admin/data/:table`, and POST/PUT/DELETE `/api/admin/frames` and `/api/admin/themes` are protected by this key. Admin uploads use the existing `/api/uploads` endpoint with the same header. Use HTTPS when accessing a remote backend.

## Mission resets

Open Missions in the admin dashboard to create, edit or delete missions. Set event (login or pull), target, coin reward, reset interval (1-3650 days), and the first cycle date. In the form, 0 means a one-time mission; the API uses null for this value. All cycle boundaries are at 00:00 in Asia/Bangkok, shared by all users. A 7-day cycle anchored on a Monday resets every Monday. A future anchor schedules the mission to start on that day.

Built-in login mission m1 resets weekly (Monday); draw missions m2 and m3 reset daily. Migration preserves custom missions as one-time missions until configured in admin. Seed no longer overwrites existing mission settings.

Resets happen transactionally when reading missions or recording activity; no scheduler is required. GET /api/missions includes resetEveryDays, resetAnchorDate, startsAt and nextResetAt. The app's existing progress/progressLabel/claimed fields remain compatible. Completed missions credit automatically once per period. Legacy claim requests cannot receive a reward again after completion or use previous-period progress.

Changing event, interval or anchor begins a new mission schedule and resets each user's mission on their next access. Changes to title, target or reward preserve the current progress and claimed flag. Lowering a target can leave a mission ready to claim; it pays on the next eligible activity or claim request. Targets for login missions cannot exceed the number of days in the cycle. IDs are immutable. Deletion removes all ownership/progress records for that mission.

Synced draws are deduplicated permanently by client ID. Only newly synced events with timestamps inside the current round and no later than server time count toward repeating missions; old or future events are not credited to the new round. Delayed events from completed rounds do not grant retroactive rewards.

Admin POST /api/admin/missions, PUT /api/admin/missions/:id and DELETE /api/admin/missions/:id require X-Admin-Key. Example body:

    { "id": "daily-pull", "title": "Draw 5 times", "event": "pull", "target": 5, "coinReward": 3, "resetEveryDays": 1, "resetAnchorDate": "2026-01-05" }

Deploy on the server from the backend directory:

    docker compose up -d --build api

The Docker startup command runs prisma migrate deploy. For Node deployment, run npx prisma migrate deploy and npx prisma generate, then restart the API. The new code requires the new migration; do not run it against an unmigrated schema. Database changes are additive, and earned coins and draw history are retained. The first request after enabling recurrence starts the current period with zero mission progress.

Validation: npm test with TEST_DATABASE_URL pointed at a disposable PostgreSQL database runs tests for midnight boundaries, weekly cycles, concurrent rewards and pulls, scheduled starts, one-time state preservation, offline replay, admin authorization and CRUD. Never point TEST_DATABASE_URL at a production database.
