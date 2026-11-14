import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./globalApi.svelte', () => ({ forageStorage: { createAuth: async () => '' } }))
vi.mock('./stores.svelte', () => ({ DBState: { db: { language: 'ko' } } }))

import { checkRisuUpdate, dismissUpdatePopup, updatePopupStore } from './update'

const info = {
    currentVersion: '0.9.101',
    latestVersion: '0.9.102',
    hasUpdate: true,
    severity: 'optional',
    releaseUrl: '',
    releaseName: '',
    publishedAt: '',
}

describe('update popup', () => {
    beforeEach(() => {
        localStorage.clear()
        updatePopupStore.set(null)
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(info))))
    })

    it('shows the same version again when the popup closed without "later"', async () => {
        await checkRisuUpdate()
        expect(get(updatePopupStore)?.latestVersion).toBe('0.9.102')
        // An update that was started, then failed or was interrupted.
        dismissUpdatePopup()
        await checkRisuUpdate()
        expect(get(updatePopupStore)?.latestVersion).toBe('0.9.102')
    })

    it('stays hidden for a version the user put off', async () => {
        await checkRisuUpdate()
        dismissUpdatePopup(true)
        await checkRisuUpdate()
        expect(get(updatePopupStore)).toBeNull()
    })
})
