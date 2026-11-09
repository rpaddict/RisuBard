import { describe, expect, test, vi } from 'vitest'

vi.mock('./stores.svelte', () => ({ DBState: { db: {} } }))
vi.mock('./globalApi.svelte', () => ({ getFileSrc: async () => '' }))
vi.mock('./process/generationState', async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) }
})

const { findUiSoundTarget } = await import('./uiSound')

function render(html: string) {
    document.body.innerHTML = html
    return (selector: string) => document.querySelector(selector)
}

describe('findUiSoundTarget', () => {
    test('resolves an inner icon to its button', () => {
        const $ = render('<button id="b"><svg><path id="p"></path></svg></button>')
        expect(findUiSoundTarget($('#p'))).toBe($('#b'))
    })

    test('covers menu items, switches, links and dropdown triggers', () => {
        const $ = render('<div role="menuitem" id="m">x</div><button role="switch" id="s"></button><a href="#" id="a">x</a><div role="combobox" id="c"><span id="cs">v</span></div>')
        expect(findUiSoundTarget($('#m'))).toBe($('#m'))
        expect(findUiSoundTarget($('#s'))).toBe($('#s'))
        expect(findUiSoundTarget($('#a'))).toBe($('#a'))
        expect(findUiSoundTarget($('#cs'))).toBe($('#c'))
    })

    test('treats a pointer-cursor div as one control', () => {
        const $ = render('<div id="row" style="cursor: pointer"><span id="label" style="cursor: pointer">x</span></div>')
        expect(findUiSoundTarget($('#label'))).toBe($('#row'))
    })

    test('stays silent for plain text, text fields, disabled controls and opted-out areas', () => {
        const $ = render(`
            <p id="t">text</p>
            <div style="cursor: pointer"><input id="i" type="text"></div>
            <button id="d" disabled>x</button>
            <div role="menuitem" id="md" data-disabled>x</div>
            <div data-ui-sound="off"><button id="o">x</button></div>
        `)
        expect(findUiSoundTarget($('#t'))).toBeNull()
        expect(findUiSoundTarget($('#i'))).toBeNull()
        expect(findUiSoundTarget($('#d'))).toBeNull()
        expect(findUiSoundTarget($('#md'))).toBeNull()
        expect(findUiSoundTarget($('#o'))).toBeNull()
    })
})
