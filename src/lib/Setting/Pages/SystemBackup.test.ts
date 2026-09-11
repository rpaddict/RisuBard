import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..', '..', '..', '..')

function read(relativePath: string): string {
    return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('system backup surface', () => {
    it('keeps full local export, settings export, and local restore', () => {
        const backupPage = read('src/lib/Setting/Pages/SystemBackup.svelte')

        expect(backupPage).toContain('SaveLocalBackup')
        expect(backupPage).toContain('SaveSettingsOnlyBackup')
        expect(backupPage).toContain('LoadLocalBackup')
    })

    it('keeps V1 migration and compatibility exports together', () => {
        const backupPage = read('src/lib/Setting/Pages/SystemBackup.svelte')

        expect(backupPage).toContain('SaveLocalBackupForUpstream')
        expect(backupPage).toContain('ImportFromSaveZip')
        expect(backupPage).toContain('CleanupMigratedFiles')
        expect(backupPage).toContain('SavePartialLocalBackup')
        expect(backupPage).toContain('exportAsDataset')
        expect(backupPage).not.toContain('V2Import')
    })

    it('does not expose server backups, compatibility snapshots, or boot backup prompts', () => {
        const backupPage = read('src/lib/Setting/Pages/SystemBackup.svelte')
        const dashboard = read('src/lib/Setting/Pages/SystemDashboard.svelte')
        const bootstrap = read('src/ts/bootstrap.ts')
        const updatePopup = read('src/lib/Others/UpdatePopup.svelte')

        for (const source of [backupPage, bootstrap, updatePopup]) {
            expect(source).not.toContain('SaveServerBackup')
        }
        expect(backupPage).not.toContain('ServerBackupList')
        expect(backupPage).not.toContain('/api/backup/server')
        expect(backupPage).not.toContain('backupSnapshot')
        expect(bootstrap).not.toContain('/api/backup/boot-reminder')
        expect(bootstrap).not.toContain('bootBackupPromptStore')
        expect(dashboard).not.toContain('storageBackupsManual')
        expect(dashboard).not.toContain('storageBackupsAuto')
        expect(dashboard).not.toContain('stats.backups')
    })
})
