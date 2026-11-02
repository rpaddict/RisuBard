import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    alertClear: vi.fn(), alertError: vi.fn(), alertWait: vi.fn(), alertMd: vi.fn(),
    alertConfirm: vi.fn(), alertConfirmMulti: vi.fn(),
    createWriteStream: vi.fn(), exportBackup: vi.fn(), settingsBackupEstimate: vi.fn(),
    notifySuccess: vi.fn(), notifyInfo: vi.fn(), requestImmediateSave: vi.fn(),
    getDatabase: vi.fn(), fetchChatFromServer: vi.fn(),
}))

vi.mock('../alert', () => ({
    ...mocks,
    alertStore: { set: vi.fn() }, notifyError: vi.fn(), waitAlert: vi.fn(),
}))
vi.mock('../globalApi.svelte', () => ({
    downloadFile: vi.fn(), LocalWriter: class { async init() { return true } async writeBackup() {} async close() {} },
    forageStorage: { exportBackup: mocks.exportBackup, settingsBackupEstimate: mocks.settingsBackupEstimate },
    requestImmediateSave: mocks.requestImmediateSave,
}))
vi.mock('../storage/risuSave', () => ({ encodeRisuSaveLegacy: vi.fn() }))
vi.mock('../storage/database.svelte', () => ({ getDatabase: mocks.getDatabase }))
vi.mock('../storage/chatStorage', () => ({ fetchChatFromServer: mocks.fetchChatFromServer }))
vi.mock('src/lang', () => ({ language: {
    backupDownloadRequested: 'Check browser downloads',
    backupSettingsOnlyConfirm: () => 'Confirm',
    backupSettingsOnlyWithModuleAssets: () => 'Include assets',
    backupSettingsOnlyWithoutModuleAssets: () => 'Skip assets',
    backupSettingsOnlyBreakdown: () => 'Breakdown',
    backupSettingsOnlyModuleAssetsSkipped: 'Download requested without module assets',
} }))
vi.mock('streamsaver', () => ({ createWriteStream: mocks.createWriteStream }))

import { SaveLocalBackup, SaveLocalBackupForUpstream, SavePartialLocalBackup, SaveSettingsOnlyBackup } from './backuplocal'

describe('local backup download handoff', () => {
    beforeEach(() => {
        vi.resetAllMocks()
        mocks.requestImmediateSave.mockResolvedValue(undefined)
        mocks.exportBackup.mockResolvedValue(undefined)
        mocks.alertConfirm.mockResolvedValue(true)
        mocks.settingsBackupEstimate.mockResolvedValue({
            dbBytes: 100, baseAssets: { bytes: 0 }, moduleAssets: { count: 0 },
        })
    })

    it.each([
        ['full', SaveLocalBackup, undefined],
        ['upstream', SaveLocalBackupForUpstream, { target: 'upstream' }],
        ['settings', SaveSettingsOnlyBackup, { mode: 'settings', moduleAssets: true }],
    ] as const)('flushes before handing off %s, without claiming completion', async (_name, save, options) => {
        await save()
        expect(mocks.requestImmediateSave).toHaveBeenCalledWith({ flushServer: true, rejectOnFailure: true })
        expect(mocks.exportBackup.mock.calls).toEqual(options ? [[options]] : [[]])
        expect(mocks.requestImmediateSave.mock.invocationCallOrder[0]).toBeLessThan(mocks.exportBackup.mock.invocationCallOrder[0])
        expect(mocks.createWriteStream).not.toHaveBeenCalled()
        expect(mocks.notifySuccess).not.toHaveBeenCalled()
        expect(mocks.notifyInfo).toHaveBeenCalledWith('Check browser downloads')
        expect(mocks.alertError).not.toHaveBeenCalled()
    })

    it('does not download when saving the current state fails', async () => {
        mocks.requestImmediateSave.mockRejectedValue(new Error('disk flush failed'))
        await SaveLocalBackup()
        expect(mocks.exportBackup).not.toHaveBeenCalled()
        expect(mocks.notifyInfo).not.toHaveBeenCalled()
        expect(mocks.alertError).toHaveBeenCalledWith('disk flush failed')
    })

    it('reports a failed authentication handoff without claiming download success', async () => {
        mocks.exportBackup.mockRejectedValue(new Error('Download authentication failed'))
        await SaveLocalBackup()
        expect(mocks.notifyInfo).not.toHaveBeenCalled()
        expect(mocks.notifySuccess).not.toHaveBeenCalled()
        expect(mocks.alertError).toHaveBeenCalledWith('Download authentication failed')
    })

    it('preserves the settings-only module asset choice', async () => {
        mocks.settingsBackupEstimate.mockResolvedValue({
            dbBytes: 100, baseAssets: { bytes: 0 }, moduleAssets: { count: 2, bytes: 200, moduleCount: 1 },
        })
        mocks.alertConfirmMulti.mockResolvedValue(1)
        await SaveSettingsOnlyBackup()
        expect(mocks.exportBackup).toHaveBeenCalledWith({ mode: 'settings', moduleAssets: false })
        expect(mocks.alertMd).toHaveBeenCalledWith('Download requested without module assets')
        expect(mocks.notifySuccess).not.toHaveBeenCalled()
    })
})

describe('partial local backup', () => {
    beforeEach(() => {
        vi.resetAllMocks()
        mocks.alertConfirm.mockResolvedValue(true)
    })

    it('names the chat and keeps the server reason when a chat cannot be read', async () => {
        mocks.getDatabase.mockReturnValue({ characters: [{
            chaId: 'cha-1', name: 'Alice', chats: [{ id: 'chat-1', name: 'Old chat', _placeholder: true }],
        }] })
        mocks.fetchChatFromServer.mockRejectedValue(new Error('fetchChatContent page error: 500 (Cold storage restore failed)'))
        await expect(SavePartialLocalBackup()).rejects.toThrow(
            'Could not read chat "Alice" / "Old chat" (chat-1) from the server: fetchChatContent page error: 500 (Cold storage restore failed). Backup aborted to prevent data loss.',
        )
    })
})
