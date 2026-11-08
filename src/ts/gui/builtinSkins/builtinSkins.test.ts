import { describe, expect, it } from 'vitest'
import { validateAppSkin } from '../appSkin'
import { BUILTIN_APP_SKINS } from '.'

describe('built-in app skins', () => {
    it('pass the same validation as an installed skin file', () => {
        for (const skin of BUILTIN_APP_SKINS) {
            const result = validateAppSkin(skin)
            expect(result.errors, skin.id).toEqual([])
            expect(result.ok).toBe(true)
        }
    })

    it('have unique ids and no embedded font data', () => {
        const ids = BUILTIN_APP_SKINS.map((skin) => skin.id)
        expect(new Set(ids).size).toBe(ids.length)
        for (const skin of BUILTIN_APP_SKINS) {
            expect((skin.fonts ?? []).every((font) => !font.data && !font.asset)).toBe(true)
        }
    })
})
