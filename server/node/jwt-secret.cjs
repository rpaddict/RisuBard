const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { atomicWriteFile } = require('./file-store.cjs');

function loadJwtSecret(dataRoot) {
    let current;
    try { current = fs.readFileSync(path.join(dataRoot, '__jwt_secret'), 'utf8').trim(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Earlier portable builds included a smoke-test save. Rotate legacy keys
    // once so a key distributed in an archive cannot keep signing user tokens.
    if (/^v2:[a-f0-9]{128}$/.test(current || '')) return current;
    const secret = 'v2:' + randomBytes(64).toString('hex');
    // Old cookies can mint fresh JWTs, so revoke them before publishing the key.
    fs.rmSync(path.join(dataRoot, '__sessions'), { force: true });
    atomicWriteFile(dataRoot, '__jwt_secret', secret);
    return secret;
}

module.exports = { loadJwtSecret };
