# Frontend API and persistence

All paths below start with /api. Send JSON with Content-Type: application/json and Authorization: Bearer <token> except register/login/google. Error responses are { "error": "message" }.

## Authentication and profile

- POST /auth/register: { username, email, password, profileImage?, frameId?, frameColor?, frameUrl?, phoneNo? }. profileImage aliases avatarUrl. Returns { token, user }.
- POST /auth/login: { email, password }; POST /auth/google: { idToken } (verified Firebase Google account).
- GET /auth/me: profile including coins, avatarUrl, frameId, frameColor, frameUrl, selectedThemeId.
- PUT /profile: editable username, avatarUrl/profileImage, frameId, frameColor, frameUrl, phoneNo, password. Wallet balance cannot be set by clients.

## Frontend models

| Endpoint                   | Purpose                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------- |
| GET /gachas?skip=0&take=20 | List GachaItem objects; authenticated user's isFavorite                             |
| GET /gachas/:id            | GachaItem details                                                                   |
| POST /gachas               | Save custom gacha and all items atomically                                          |
| PUT /gachas/:id            | Owner edits gacha; supplied items replace the list atomically                       |
| DELETE /gachas/:id         | Owner deletes gacha; saved history remains                                          |
| PUT /favorites/:id         | Mark favorite, safely repeatable                                                    |
| DELETE /favorites/:id      | Remove favorite, safely repeatable                                                  |
| GET /favorites             | Current user's favorite GachaItem objects                                           |
| POST /gachas/:id/pull      | Free pulls: integer count from 1 to 100; returns { resultElements, history, coins } |
| GET /history               | HistoryEntry objects with UTC ISO pulledAt                                          |
| DELETE /history/:id        | Delete own history entry                                                            |
| GET /wallet                | { coins }                                                                           |
| GET /themes                | Theme objects with per-user owned                                                   |
| POST /themes/:id/purchase  | Deduct coins and persist ownership atomically; returns theme and coins              |
| PUT /themes/:id/select     | Activate owned theme                                                                |
| GET /missions              | Mission objects with progress, progressLabel, claimed                               |
| POST /missions/:id/claim   | Claim completed mission once; returns { claimed, coinReward, coins }                |

IDs of gachas/history/items are numeric database IDs serialized as strings (e.g. "1"), replacing mock IDs such as g-food. List routes accept integer skip >= 0 and take from 1 to 100.

### Custom gacha request

Both the existing form payload and GachaItem-style fields are accepted:

```json
{
  "Title": "Dinner",
  "Card_Image": "https://example.com/banner.png",
  "Frame_ID": "frame1",
  "Animation": "anim1",
  "is_equal_rate": 0,
  "Items": [
    { "name": "Pizza", "rate": 25 },
    { "name": "Rice", "rate": 75 }
  ]
}
```

Aliases: Title/title/name; Card_Image/cardImage/bannerUri; Frame_ID/frame/frameId; Animation/animation; is_equal_rate/isEqualRate; Items/cardItems/randomList. Items accept name/element and numeric rate/weight or a percentage string. Rates are non-negative relative weights. Equal mode ignores weights. Responses expose normalized percentage strings in randomList. Create_by from clients is ignored: creator comes from the verified token. Defaults: category Custom, suggested pull count 5. All pulls are free, including at a zero coin balance. Compatibility fields pullOneCost/pullManyCost are always zero; client-supplied costs are ignored. Suggested pullManyCount may be between 2 and 100 and does not restrict the requested count. A gacha created without items through the legacy API cannot be pulled until items are added.

The legacy /cards, /cards/:id/items, /cards/:id/pull and /results routes remain available with their original response shapes. Their pull route is also free and accepts 1–100 draws.

## Database setup

Run from the backend project with DATABASE_URL configured for the intended PostgreSQL database:

```powershell
npm run prisma:generate
npm run prisma:deploy
```

Migration 20261008010000_free_gacha_pulls sets existing and future pull costs to zero and enforces free pulls in the database. Migration 20261008000000_frontend_support adds user profile/wallet fields, gacha pricing/category, favorites, themes and ownership, missions and progress. It backfills result labels and changes item references to nullable with ON DELETE SET NULL, preserving history when an item/card is deleted or replaced. Foreign keys cascade for account-owned data. Database CHECK constraints guard non-negative coins, prices and item weights. The migration includes the theme and mission catalogs. npm run prisma:seed can restore/update catalogs idempotently.

New accounts start with 20 coins. Mint (t1) is free and considered owned by all users; the remaining catalog prices match the frontend. Missions count one login per Bangkok calendar day and successful individual draws. The login mission requires 3 distinct days; pull missions require 2 and 10 draws. Rewards are lifetime, claimable once; they do not reset daily. No client API allows adding arbitrary coins or supplying draw outcomes.

## Frontend integration

The current React Native screens still use src/data/mockStore.ts, and SignUpScreen03 still has a registration TODO. This backend change does not replace those screen flows. Replace mock reads/writes with asynchronous calls to the endpoints above, send the stored auth token, and use returned IDs and balances. Do not call spendCoins for pulls or generate outcomes locally when using /pull: the server generates outcomes and saves history and mission progress in one transaction without changing the wallet. Show success only after a successful API response.

Image fields store URLs or strings; they do not upload files. A device-local file:// URI is not a shared image URL. Use an uploaded, remotely accessible image URL when adding real image selection.

## Verification

npm test runs validation tests; integration tests are skipped unless TEST_DATABASE_URL is set to a disposable, migrated PostgreSQL database. The integration test overrides DATABASE_URL with TEST_DATABASE_URL, creates its own accounts, and deletes them afterward.

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:password@localhost:55433/gacha_test?schema=public&connection_limit=5'
$env:JWT_SECRET = 'local-test-secret'
npm test
```

Coverage includes form aliases, user profile persistence, favorite state, free transactional pulls at zero balance, counts up to 100 and unchanged wallet balances, incomplete/duplicate claims, concurrent claims/purchases/pulls, ownership enforcement, editing/deleting cards with saved history, and Bangkok login progress.
