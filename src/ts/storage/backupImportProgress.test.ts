import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

function read(path: string) {
    return readFileSync(path, 'utf8')
}

describe('local backup restore progress', () => {
    it('forwards server restore phases to the loading dialog', () => {
        const storage = read('src/ts/storage/nodeStorage.ts')
        const backupUi = read('src/ts/drive/backuplocal.ts')
        const serverBackupUi = read('src/lib/Setting/ServerBackupList.svelte')

        expect(storage).toContain("msg.type === 'phase'")
        expect(storage).toContain('onProgress?.(msg.bytes, msg.totalBytes, msg.phase)')
        expect(read('server/node/server.cjs')).toContain("onStaged: () => onPhase?.('processing')")
        expect(backupUi).toContain("phase === 'processing'")
        expect(backupUi).toContain("phase === 'validating'")
        expect(backupUi).toContain("phase === 'publishing'")
        expect(backupUi).toContain("phase === 'finalizing'")
        expect(storage).toContain('onProgress?.(msg.bytes, msg.totalBytes, msg.phase)')
        expect(serverBackupUi).toContain("phase === 'processing'")
        expect(serverBackupUi).toContain("phase === 'validating'")
        expect(serverBackupUi).toContain("phase === 'publishing'")
        expect(serverBackupUi).toContain("phase === 'finalizing'")
    })
})
