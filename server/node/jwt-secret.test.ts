import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import { afterEach, expect, test } from 'vitest'

const require = createRequire(import.meta.url)
const { loadJwtSecret } = require('./jwt-secret.cjs')
const roots: string[] = []
function root() { const p = mkdtempSync(join(tmpdir(), 'risubard-jwt-test-')); roots.push(p); return p }
afterEach(() => { for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }) })

test('replaces a legacy shared key once, rejects its signatures and preserves the password', () => {
    const p = root(), legacy = 'a'.repeat(128)
    writeFileSync(join(p, '__jwt_secret'), legacy)
    writeFileSync(join(p, '__password'), 'unchanged-password-hash')
    writeFileSync(join(p, '__sessions'), JSON.stringify([['old-session', Date.now() + 60000]]))
    const secret = loadJwtSecret(p)
    expect(secret).toMatch(/^v2:[a-f0-9]{128}$/)
    expect(createHmac('sha256', secret).update('token').digest('hex')).not.toBe(createHmac('sha256', legacy).update('token').digest('hex'))
    expect(loadJwtSecret(p)).toBe(secret)
    expect(existsSync(join(p, '__sessions'))).toBe(false)
    expect(readFileSync(join(p, '__password'), 'utf8')).toBe('unchanged-password-hash')
})

test('new installations get different persistent keys', () => {
    const a = root(), b = root(), key = loadJwtSecret(a)
    writeFileSync(join(a, '__sessions'), 'keep current sessions')
    expect(loadJwtSecret(a)).toBe(key)
    expect(readFileSync(join(a, '__sessions'), 'utf8')).toBe('keep current sessions')
    expect(loadJwtSecret(b)).not.toBe(key)
})

test('unreadable key paths fail instead of continuing with an ephemeral key', () => {
    const p = root()
    require('node:fs').mkdirSync(join(p, '__jwt_secret'))
    expect(() => loadJwtSecret(p)).toThrow()
})
