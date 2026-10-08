# Image uploads

`POST /api/uploads` requires a Bearer token and multipart form data containing one file named `image`. The maximum input size is 5 MB. JPEG, PNG and WebP are decoded and validated (up to 25 million pixels), rotated according to EXIF, resized to fit 1600 × 1600 and encoded as WebP without original metadata.

The response is `201 { "url": "/api/uploads/<uuid>.webp" }`. Resolve this path against the API server origin and save the resulting URL in `avatarUrl`, `cardImage` or `imageUrl` through the existing APIs. Files are publicly readable, so only upload photos intended to be visible in the app.

Files default to the backend's `uploads/` directory, excluded from Git. Set `UPLOAD_DIR` to an absolute path on persistent storage in production. Mount that directory as a persistent volume if using containers; preserve it between deployments and include it in backups. Multiple server instances must share storage. Configure the reverse proxy to allow multipart requests slightly larger than 5 MB and forward both POST and GET `/api/uploads` to this backend.

No database migration or FFmpeg installation is needed. Uploads and profile/card saves are separate requests; unreferenced files are currently retained, including files from abandoned saves. There is no automatic deletion or per-user storage quota yet.

The React Native frontend uses react-native-image-picker for signup photos, Edit Profile photos and custom gacha covers. Signup uploads after registration, using the new session token. If that upload fails, registration still succeeds and the user can retry in Edit Profile. Guest mode requires signing in before selecting a cover for upload.

Rebuild the mobile app after installing the native picker dependency. On macOS, run `bundle exec pod install` in the frontend `ios/` directory before building iOS. The frontend API_BASE_URL must point to a deployment containing this upload endpoint.
