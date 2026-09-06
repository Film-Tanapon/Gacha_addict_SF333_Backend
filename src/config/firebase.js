const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

let initialized = false;

// Default location we recommend in the setup guide: project root, next to package.json.
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', '..', 'firebase-admin-sdk.json');

function initFirebase() {
  if (initialized) return admin;

  try {
    const explicitPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
      ? path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
      : null;
    const fileToLoad = explicitPath || (fs.existsSync(DEFAULT_SERVICE_ACCOUNT_PATH) ? DEFAULT_SERVICE_ACCOUNT_PATH : null);

    if (fileToLoad) {
      // Preferred: a standalone firebase-admin-sdk.json file (see FIREBASE_ADMIN_SDK_SETUP.md)
      const serviceAccount = JSON.parse(fs.readFileSync(fileToLoad, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log(`[firebase] Loaded service account from ${fileToLoad}`);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // .env stores literal "\n" - convert back to real newlines
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    } else {
      console.warn(
        `[firebase] No Firebase credentials found. Place firebase-admin-sdk.json at ${DEFAULT_SERVICE_ACCOUNT_PATH} ` +
        'or set FIREBASE_SERVICE_ACCOUNT_PATH / FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_* env vars. ' +
        'See FIREBASE_ADMIN_SDK_SETUP.md - Google login will not work until configured.'
      );
      return null;
    }
    initialized = true;
  } catch (err) {
    console.error('[firebase] Failed to initialize firebase-admin:', err.message);
    return null;
  }

  return admin;
}

module.exports = { initFirebase, admin };