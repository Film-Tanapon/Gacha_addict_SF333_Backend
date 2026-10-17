const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gacha-jwt-test-'));
const testSecret = 'e5d2c87b049a3f6c11a8750f7e946b3dd85ac309b5f4e278d6a19cc07ed63542';
const jwtPath = JSON.stringify(path.join(root, 'src/utils/jwt'));
const libraryPath = JSON.stringify(path.join(root, 'node_modules/jsonwebtoken'));
const appPath = JSON.stringify(path.join(root, 'index.js'));
const configurationError = 'JWT_SECRET must be configured with a non-default secret before starting the backend.';

after(() => {
  const target = path.resolve(scratch);
  if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('gacha-jwt-test-'))
    throw new Error('Unsafe temporary test directory');
  fs.rmSync(target, { recursive: true, force: true });
});
function child(secret, script, { fileSecret, expires = '7d', main = false } = {}) {
  const cwd = fs.mkdtempSync(path.join(scratch, 'case-'));
  if (fileSecret !== undefined) fs.writeFileSync(path.join(cwd, '.env'), `JWT_SECRET=${fileSecret}\n`);
  const env = { ...process.env, JWT_EXPIRES_IN: expires, PORT: '0',
    // A regression must never reach the real database, storage or workers.
    DATABASE_URL: 'postgresql://jwt_test@127.0.0.1:1/unused',
    UPLOAD_DIR: path.join(cwd, 'uploads'), BACKUP_DIR: path.join(cwd, 'backups'),
    DELETION_LEDGER_PATH: path.join(cwd, 'ledger/deletions.jsonl'), BACKUP_ENABLED: 'false' };
  delete env.JWT_SECRET;
  if (secret !== undefined) env.JWT_SECRET = secret;
  return spawnSync(process.execPath, main ? [path.join(root, 'index.js')] : ['-e', script],
    { cwd, env, encoding: 'utf8', timeout: 5000, windowsHide: true });
}

test('JWT utility fails without a secret and rejects blank or known placeholder values', () => {
  for (const secret of [undefined, '', ' \t\n ', 'dev_secret_change_me', ' DEV_SECRET_CHANGE_ME ', 'change_me',
    'changeme', 'secret', 'jwt_secret', 'your_jwt_secret', 'your_jwt_secret_here', 'replace_me', 'change_me_to_a_long_random_secret']) {
    const result = child(secret, `require(${jwtPath})`);
    assert.equal(result.error, undefined); assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(configurationError));
  }
});

test('actual backend entrypoint exits before starting workers or listening with invalid configuration', () => {
  for (const secret of [undefined, '', 'dev_secret_change_me']) {
    const result = child(secret, '', { main: true });
    assert.equal(result.error, undefined); assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(configurationError));
    assert.doesNotMatch(result.stdout + result.stderr, /Server running|Backup\/retention|Account cleanup worker|PrismaClientInitializationError/);
  }
});

test('configured keys keep existing token compatibility, expiry and signature rejection', () => {
  for (const secret of [testSecret, ` ${testSecret} `]) {
    const result = child(secret, `
      const assert = require('node:assert/strict');
      const library = require(${libraryPath});
      const {signToken, verifyToken} = require(${jwtPath});
      const existing = library.sign({id: 7, authVersion: 3}, process.env.JWT_SECRET, {expiresIn: '7d'});
      assert.equal(verifyToken(existing).id, 7);
      assert.equal(verifyToken(existing).authVersion, 3);
      const issued = signToken({id: 8});
      const claims = library.verify(issued, process.env.JWT_SECRET);
      assert.equal(claims.id, 8); assert.equal(claims.exp - claims.iat, 604800);
      assert.throws(() => verifyToken(library.sign({id: 7}, 'dev_secret_change_me')));
      assert.throws(() => verifyToken(library.sign({id: 7}, process.env.JWT_SECRET, {expiresIn: -1})), {name: 'TokenExpiredError'});
    `);
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret));
  }
});

test('configured token lifetime is retained', () => {
  const result = child(testSecret, `
    const {signToken, verifyToken} = require(${jwtPath});
    const claims = verifyToken(signToken({id: 7}));
    require('node:assert/strict').equal(claims.exp - claims.iat, 3600);
  `, { expires: '1h' });
  assert.equal(result.status, 0, result.stderr);
});

test('backend loads its configured .env before validating JWT and environment injection still takes precedence', () => {
  const script = `
    const assert = require('node:assert/strict');
    assert.equal(typeof require(${appPath}), 'function');
    const {signToken} = require(${jwtPath});
    assert.equal(require(${libraryPath}).verify(signToken({id: 7}), ${JSON.stringify(testSecret)}).id, 7);
  `;
  const fromFile = child(undefined, script, { fileSecret: testSecret });
  assert.equal(fromFile.status, 0, fromFile.stderr);
  const injected = child(testSecret, script, { fileSecret: 'dev_secret_change_me' });
  assert.equal(injected.status, 0, injected.stderr);
  const invalidInjection = child('dev_secret_change_me', '', { fileSecret: testSecret, main: true });
  assert.equal(invalidInjection.status, 1); assert.ok(invalidInjection.stderr.includes(configurationError));
  for (const result of [fromFile, injected, invalidInjection]) {
    assert.ok(!result.stdout.includes(testSecret) && !result.stderr.includes(testSecret));
  }
});
