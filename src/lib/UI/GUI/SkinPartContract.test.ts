import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { uiSkinParts } from 'src/ts/gui/uiSkinParts'

const sourceRoot = join(process.cwd(), 'src')

function svelteFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return entry.name === '백업' ? [] : svelteFiles(path)
        return entry.name.endsWith('.svelte') ? [path] : []
    })
}

const sources = svelteFiles(sourceRoot).map((path) => ({
    path: relative(process.cwd(), path).replaceAll('\\', '/'),
    source: readFileSync(path, 'utf8'),
}))
const usedParts = new Map<string, string[]>()
for (const { path, source } of sources) {
    for (const match of source.matchAll(/data-skin-part="([^"]+)"/g)) {
        usedParts.set(match[1], [...(usedParts.get(match[1]) ?? []), path])
    }
}

describe('skin part hooks (stable skin API)', () => {
    test('every registered part is rendered by at least one component', () => {
        const missing = uiSkinParts.filter(({ part }) => !usedParts.has(part)).map(({ part }) => part)
        expect(missing, 'A registered skin part lost its element; restore it or bump UI_SKIN_API_VERSION').toEqual([])
    })

    test('every data-skin-part value in the source is registered', () => {
        const registered = new Set(uiSkinParts.map(({ part }) => part))
        const unknown = [...usedParts.keys()].filter((part) => !registered.has(part))
        expect(unknown, 'Register new parts in src/ts/gui/uiSkinParts.ts').toEqual([])
    })

    test('core surfaces keep their hooks', () => {
        const expectHook = (file: string, part: string) => {
            expect(usedParts.get(part) ?? [], `${part} in ${file}`).toContain(file)
        }
        expectHook('src/App.svelte', 'app-shell')
        expectHook('src/lib/ChatScreens/Chat.svelte', 'message')
        expectHook('src/lib/ChatScreens/Chat.svelte', 'message-card')
        expectHook('src/lib/ChatScreens/DefaultChatScreen.svelte', 'composer')
        expectHook('src/lib/UI/GUI/ShButton.svelte', 'button')
        expectHook('src/lib/UI/GUI/ShDialog.svelte', 'modal')
        expectHook('src/lib/SideBars/Sidebar.svelte', 'sidebar-panel')
    })

    test('every legacy modal surface is also a modal part', () => {
        const untagged = sources.flatMap(({ path, source }) => {
            const lines = source.split(/\r?\n/)
            return lines.flatMap((line, index) => {
                if (!/class="risu-modal-surface\b/.test(line)) return []
                const window = `${lines[index - 1] ?? ''}\n${line}`
                return window.includes('data-skin-part="modal"') ? [] : [`${path}:${index + 1}`]
            })
        })
        expect(untagged).toEqual([])
    })
})
