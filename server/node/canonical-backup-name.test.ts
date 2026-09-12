import { describe, expect, it } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'

describe('RisuBard canonical backup entry names', () => {
    it('uses a flat portable-compatible name and restores the original path', () => {
        const { encodeCanonicalBackupName, decodeCanonicalBackupName } = require('./canonical-backup-name.cjs')
        const portable = 'characters/example/character.json'
        const encoded = encodeCanonicalBackupName(portable)

        expect(encoded).toBe(path.basename(encoded))
        expect(encoded).not.toContain('/')
        expect(decodeCanonicalBackupName(encoded)).toBe(portable)
    })

    it('continues to read backups made with the legacy slash prefix', () => {
        const { decodeCanonicalBackupName } = require('./canonical-backup-name.cjs')

        expect(decodeCanonicalBackupName('risubard-data/lorebooks/world.md')).toBe('lorebooks/world.md')
        expect(decodeCanonicalBackupName('ordinary-asset.png')).toBeNull()
    })

    it('wires the flat name into export and both names into import', () => {
        const server = fs.readFileSync('server/node/server.cjs', 'utf8')

        expect(server).toContain('backupName: encodeCanonicalBackupName(portable)')
        expect(server).toContain('const canonicalPortable = decodeCanonicalBackupName(name)')
    })
})
