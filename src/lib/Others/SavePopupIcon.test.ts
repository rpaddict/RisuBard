import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, unmount } from 'svelte'
import SavePopupIcon from './SavePopupIcon.svelte'

vi.mock('src/ts/globalApi.svelte', () => ({
    saving: { state: true },
}))

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: { showSavingIcon: true } },
}))

describe('save popup icon', () => {
    let mounted: ReturnType<typeof mount> | undefined

    beforeEach(() => {
        vi.useFakeTimers()
        document.body.innerHTML = ''
    })

    afterEach(async () => {
        if (mounted) await unmount(mounted)
        mounted = undefined
        vi.useRealTimers()
    })

    it('hides short saves and shows a compact non-blinking indicator for longer saves', async () => {
        mounted = mount(SavePopupIcon, { target: document.body })

        expect(document.querySelector('svg')).toBeNull()
        await vi.advanceTimersByTimeAsync(749)
        expect(document.querySelector('svg')).toBeNull()

        await vi.advanceTimersByTimeAsync(1)
        const indicator = document.querySelector('[data-save-indicator]')
        expect(indicator).not.toBeNull()
        expect(indicator?.className).not.toContain('saving-animation')
        expect(indicator?.querySelector('svg')?.getAttribute('width')).toBe('14')
    })
})
