# Backend admin

1. Set `ADMIN_API_KEY` to a long random secret in `.env` and restart the backend. The key stays in browser memory only; logging out clears it.
2. Run `npx prisma migrate deploy` and `npx prisma generate` before starting the updated server. For Docker, rebuild the API image to include the updated client and migration.
3. Open `http://localhost:3000/admin` or `/index.html`. Enter the backend URL and admin key.

The dashboard reads all 13 application tables with pagination, filters the current page, and exports an entire selected table as JSON. Password hashes and Google identity IDs are excluded from user responses. JSON export is an administrative data export, not a consistent transactional backup.

Frames and themes support create, edit and delete. Deleting a shop item removes its ownership records; deleting a frame also clears active frame selections. Editing a frame refreshes the color and image for users who selected it.

Upload PNG, JPEG or WebP images up to 5 MB in the frame editor. Images are stored in `UPLOAD_DIR` (default `uploads/`), normalized to WebP up to 1600px with transparency preserved, and linked by `Frame.imageUrl`. Download a frame image using its card's download button. The existing frame selection API returns this image as `frameUrl`. Keep the uploads directory persistent when deploying. Removing or replacing an image reference does not remove the stored file, so other existing references remain valid.

Admin APIs use `X-Admin-Key`; regular user JWTs cannot administer shop records. `/api/admin/summary`, `/api/admin/data/:table`, and POST/PUT/DELETE `/api/admin/frames` and `/api/admin/themes` are protected by this key. Admin uploads use the existing `/api/uploads` endpoint with the same header. Use HTTPS when accessing a remote backend.
