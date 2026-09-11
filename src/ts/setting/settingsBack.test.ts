import { expect, test, vi } from 'vitest'
import { goBackInSettings, registerSettingsBack } from './settingsBack'

test('returns one level at a time and releases unmounted pages', () => {
    let editing = true
    const parent = vi.fn(() => false)
    const removeParent = registerSettingsBack(parent)
    const removeEditor = registerSettingsBack(() => {
        if (!editing) return false
        editing = false
        return true
    })
    try {
        expect(goBackInSettings()).toBe(true)
        expect(parent).not.toHaveBeenCalled()
        expect(goBackInSettings()).toBe(false)
        expect(parent).toHaveBeenCalledOnce()
        removeEditor()
        editing = true
        expect(goBackInSettings()).toBe(false)
    } finally {
        removeEditor()
        removeParent()
    }
    expect(goBackInSettings()).toBe(false)
})
