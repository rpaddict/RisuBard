import { afterEach, describe, expect, test, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import ChatBody from './ChatBody.svelte'
import { ParseMarkdown } from 'src/ts/parser/parser.svelte'

vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: {} } }))
vi.mock('src/ts/util', () => ({ sleep: async () => {} }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('src/ts/translator/translator', () => ({ getLLMCache: vi.fn(), translateHTML: vi.fn() }))
vi.mock('src/ts/process/modules', () => ({ getModuleAssets: () => [] }))
vi.mock('src/ts/storage/database.svelte', () => ({ getCurrentCharacter: () => ({}) }))
vi.mock('src/ts/globalApi.svelte', () => ({ getFileSrc: vi.fn() }))
vi.mock('src/ts/parser/parser.svelte', () => ({
    ParseMarkdown: vi.fn(async (text: string) => text),
    addMetadataToElement: (html: string) => html,
    trimMarkdown: (html: string) => html,
    postTranslationParse: (html: string) => html,
    getDistance: vi.fn(),
    resolveInlayPlaceholders: (root: HTMLElement) => {
        for (const placeholder of root.querySelectorAll('[data-inlay-id]')) {
            const image = document.createElement('img')
            image.src = `https://example.test/${placeholder.getAttribute('data-inlay-id')}.png`
            placeholder.replaceWith(image)
        }
    },
}))

const mounted: ReturnType<typeof mount>[] = []
afterEach(async () => {
    for (const component of mounted.splice(0)) await unmount(component)
    document.body.replaceChildren()
    vi.mocked(ParseMarkdown).mockReset().mockImplementation(async text => text)
})

async function settle() {
    await tick()
    await Promise.resolve()
    await tick()
    await Promise.resolve()
    await tick()
    await new Promise(resolve => setTimeout(resolve, 0))
}

async function render(html: string, onRemoveInlay?: (id: string, occurrence: number) => void) {
    const state = new SvelteMap<string, string>([['html', html], ['reloadKey', '0|0:0']])
    const target = document.createElement('div')
    document.body.append(target)
    mounted.push(mount(ChatBody, {
        target,
        props: {
            get msgDisplay() { return state.get('html')! },
            get reloadKey() { return state.get('reloadKey')! },
            idx: 1, character: 'test', role: 'char', translated: false,
            retranslate: false, translating: false, modelShortName: '', bodyRoot: target,
            onRemoveInlay,
        },
    }))
    await settle()
    return {
        target,
        update: (html: string) => state.set('html', html),
        reload: (reloadKey: string) => state.set('reloadKey', reloadKey),
    }
}

describe('streaming chat body', () => {
    test('offers an accessible removal control for an editable inlay and retains it across text updates', async () => {
        const remove = vi.fn()
        const html = '<p><img data-inlay-image-id="scene" data-inlay-occurrence="1" src="https://example.test/a.png">One</p>'
        const { target, update } = await render(html, remove)
        const button = target.querySelector<HTMLButtonElement>('button[aria-label="본문에서 이미지 삭제"]')
        expect(button).not.toBeNull()
        const image = target.querySelector('img')
        update(html.replace('One', 'One two'))
        await settle()
        expect(target.querySelector('img')).toBe(image)
        button!.click()
        expect(remove).toHaveBeenCalledWith('scene', 1)
    })

    test('does not offer removal for ordinary images or read-only inlays', async () => {
        const { target } = await render('<p><img data-inlay-image-id="scene" data-inlay-occurrence="0" src="https://example.test/a.png"></p>')
        expect(target.querySelector('button')).toBeNull()
        const editable = await render('<p><img src="https://example.test/a.png"></p>', vi.fn())
        expect(editable.target.querySelector('button')).toBeNull()
    })
    test('keeps loaded images and existing text nodes while parsing and appending tokens', async () => {
        const { target, update } = await render('<p><img src="https://example.test/a.png">Hello</p>')
        const paragraph = target.querySelector('p')!
        const image = target.querySelector('img')!
        const text = paragraph.lastChild!
        let finish!: (html: string) => void
        vi.mocked(ParseMarkdown).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
        update('next chunk')
        await settle()
        expect(target.querySelector('p')).toBe(paragraph)
        expect(target.querySelector('img')).toBe(image)
        finish('<p><img src="https://example.test/a.png">Hello world</p>')
        await settle()
        expect(target.querySelector('img')).toBe(image)
        expect(paragraph.lastChild).toBe(text)
        expect(target.textContent).toBe('Hello world')
    })

    test('retains resolved inlays when text in the same paragraph grows', async () => {
        const { target, update } = await render('<p><span data-inlay-id="scene"></span>One</p>')
        const image = target.querySelector('img')!
        expect(image).not.toBeNull()
        update('<p><span data-inlay-id="scene"></span>One two</p>')
        await settle()
        expect(target.querySelector('img')).toBe(image)
        expect(target.textContent).toBe('One two')
    })

    test('applies edits and image changes without retaining deleted content', async () => {
        const { target, update } = await render('<p class="old"><img src="https://example.test/a.png">Old</p><p>Remove me</p>')
        update('<p class="new"><img src="https://example.test/b.png">New <strong>text</strong></p>')
        await settle()
        expect(target.querySelectorAll('p')).toHaveLength(1)
        expect(target.querySelector('p')?.className).toBe('new')
        expect(target.querySelector('img')?.getAttribute('src')).toBe('https://example.test/b.png')
        expect(target.textContent).toBe('New text')
    })

    test('keeps adjacent content when an inlay becomes a hidden placeholder', async () => {
        const { target, update } = await render('<p><span data-inlay-id="scene"></span>One</p>')
        const paragraph = target.querySelector('p')!
        const text = paragraph.lastChild
        target.querySelector('img')!.replaceWith(document.createComment('hidden inlay'))
        update('<p><span data-inlay-id="scene"></span>One two</p>')
        await settle()
        expect(target.querySelector('p')).toBe(paragraph)
        expect(paragraph.lastChild).toBe(text)
        expect(target.querySelector('img, [data-inlay-id]')).toBeNull()
        expect(target.textContent).toBe('One two')
    })

    test('ignores late parser results from an older streaming update', async () => {
        const { target, update } = await render('<p>Initial</p>')
        let finishOld!: (html: string) => void
        vi.mocked(ParseMarkdown).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
        update('slow chunk')
        await settle()
        update('<p>Newest</p>')
        await settle()
        finishOld('<p>Outdated</p>')
        await settle()
        expect(target.textContent).toBe('Newest')
    })

    test('re-parses in place on reloadKey changes and preserves inner panel scroll', async () => {
        vi.mocked(ParseMarkdown)
            .mockImplementationOnce(async () => '<div class="panel"><div class="body"><p>Before</p></div></div>')
            .mockImplementationOnce(async () => '<div class="panel"><div class="body"><p>After</p></div></div>')
        const { target, reload } = await render('same message')
        const body = target.querySelector<HTMLElement>('.body')!
        body.scrollTop = 320

        reload('0|0:1')
        await settle()

        expect(ParseMarkdown).toHaveBeenCalledTimes(2)
        expect(target.querySelector('.body')).toBe(body)
        expect(body.scrollTop).toBe(320)
        expect(body.textContent).toBe('After')
    })
})
