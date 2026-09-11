// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import type { loreBook } from 'src/ts/storage/database.svelte'
import LoreBookList from './LoreBookList.svelte'

vi.mock('sortablejs/modular/sortable.core.esm.js', () => ({
    default: { create: () => ({ destroy: () => undefined }) },
}))

let mounted: ReturnType<typeof mount> | undefined

const folderKey = '\uf000folder:places'
const sourceEntries = (): loreBook[] => [
    {
        id: 'folder', mode: 'folder', key: folderKey, comment: 'Places', content: '',
        insertorder: 100, alwaysActive: true, secondkey: '', selective: false,
    },
    {
        id: 'child', mode: 'normal', folder: folderKey, key: 'library', comment: 'Library', content: 'Books',
        insertorder: 100, alwaysActive: false, secondkey: '', selective: false,
    },
]

beforeEach(() => {
    document.body.replaceChildren()
})

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
})

describe('legacy lorebook folder state', () => {
    test('keeps a folder open when persistence replaces entries with equivalent objects', async () => {
        const props = $state({ externalLoreBooks: sourceEntries() })
        mounted = mount(LoreBookList, { target: document.body, props })
        await tick()

        document.body.querySelector<HTMLButtonElement>('.valuer')!.click()
        await tick()
        expect(document.body.textContent).toContain('Library')

        props.externalLoreBooks = sourceEntries().map((entry) => ({ ...entry }))
        await tick()

        expect(document.body.textContent).toContain('Library')
        expect(document.body.querySelector('.valuer svg')).not.toBeNull()
    })
})
