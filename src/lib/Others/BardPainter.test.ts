import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { tick } from 'svelte'
import { createClassComponent } from 'svelte/legacy'
import { createPainterChatData, type PainterDraft, type PainterResult } from 'src/ts/bardPainter/types'
import BardPainter from './BardPainter.svelte'
import { painterTestState } from './BardPainterTestState.svelte'
import { painterSelection, painterInsertionRequest } from 'src/ts/bardPainter/selectionState'
import { get } from 'svelte/store'
import { DBState } from 'src/ts/stores.svelte'
import { normalizeTagAutocompleteSettings } from 'src/ts/tagAutocomplete/settings'

vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: {} }, botMakerMode: { set: vi.fn() }, CharConfigSubMenu: { set: vi.fn() }, risuBardGalleryOpen: { set: vi.fn() }, MobileSideBar: { set: vi.fn() } }))
vi.mock('src/ts/bardPainter/gallery', async () => { const { writable } = await import('svelte/store'); return { painterGalleryRequested: writable(null) } })

const runtime = vi.hoisted(() => ({ current: null as any }))
vi.mock('src/ts/bardPainter/runtime.svelte', () => ({ getPainterSession: () => runtime.current }))
const tagSearch = vi.hoisted(() => vi.fn())
vi.mock('src/ts/tagAutocomplete/client', () => ({ searchTags: tagSearch }))

let component: ReturnType<typeof createClassComponent> | undefined
const anchor = { characterId: 'bot', chatId: 'chat', messageId: 'message', start: 4, end: 11, text: '붉은 보석함' }
const draft = (): PainterDraft => ({ rendering: 'watercolor', scene: 'night, indoors', negative: '', subjects: [
    { id: 'aria', name: '아리아', aliases: ['아리'], kind: 'character', appearance: 'black hair', clothing: 'white shirt', state: 'wet clothes', pose: 'standing', negative: '' },
] })
const result = (id = 'result'): PainterResult => ({
    id, assetId: id, createdAt: 1, anchor: { ...anchor }, draft: draft(),
    style: { id: 'ink', name: '잉크', artist: 'artist style', rendering: 'ink', negative: '', steps: 28, scale: 5, cfgRescale: 0, sampler: 'k_euler_ancestral' },
    settings: createPainterChatData().settings, seed: 42,
})
function mount(visible = true) {
    component = createClassComponent({ component: BardPainter, target: document.body, props: { characterId: 'bot', chatId: 'chat', visible } })
}
function button(label: string) {
    const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent?.trim() === label)
    expect(found, `button: ${label}`).toBeDefined()
    return found!
}
beforeEach(() => {
    DBState.db.tagAutocomplete = normalizeTagAutocompleteSettings()
    tagSearch.mockReset().mockResolvedValue([{ word: 'blue hair', category: 0, frequency: 200, redirect: 'null' }])
    window.getSelection()?.removeAllRanges()
    painterSelection.set(null)
    painterInsertionRequest.set(null)
    const data = createPainterChatData()
    const style = result().style
    runtime.current = painterTestState({
        data, get settings() { return this.data.settings }, chat: { isStreaming: false }, bot: { identities: [], outfits: [] }, style, styles: [style],
        promptPreset: { id: 'current' }, imagePreset: undefined,
        imagePresets: [{ index: 0, preset: { name: 'Image', values: { toggle_detail: '0' } } }], applyImagePreset: vi.fn().mockResolvedValue(true),
        state: { status: 'idle', error: '', notice: '', wikiDocs: [], loadingWiki: false, pendingImage: false },
        ...Object.fromEntries(['prepare', 'generate', 'retrySave', 'cancel', 'insert', 'loadWiki', 'persist', 'saveOutfit', 'promoteOutfit', 'applyOutfit', 'removeOutfit', 'rememberIdentity', 'saveStyle', 'removeResult', 'downloadOriginal', 'restoreDraft', 'clearConversation', 'resetWorkspace'].map(name => [name, vi.fn()])),
    })
    data.settings.styleId = style.id
})
afterEach(() => { component?.$destroy(); component = undefined; document.body.replaceChildren() })

describe('BardPainter workspace', () => {
    test('places style before a collapsible main block and allows editing and removing fragments', async () => {
        runtime.current.data.draft = { ...draft(), fragments: [{ id: 'light', name: '빛', prompt: 'rim light' }] }
        runtime.current.style.negative = 'blur'
        mount(); await tick()
        const section = document.querySelector('[aria-label="프롬프트 초안"]')!
        const details = section.querySelectorAll('details')
        expect(details[0].querySelector('summary')?.textContent).toBe('화풍')
        expect(details[0].textContent).toContain('blur')
        expect(details[1].querySelector('summary')?.textContent).toBe('메인 블록')
        expect(details[1].open).toBe(true)
        expect(section.textContent).not.toContain('AI가 초안을 작성하거나 개선해도')
        const help = button('표현 조각')
        help.dispatchEvent(new MouseEvent('mouseenter'))
        await vi.waitFor(() => expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('AI가 초안을 작성하거나 개선해도'))
        help.dispatchEvent(new MouseEvent('mouseleave'))
        const field = section.querySelector<HTMLTextAreaElement>('[aria-label="표현 조각 빛"]')!
        const fragment = field.closest('details')!
        expect(fragment.open).toBe(false)
        fragment.querySelector('summary')!.click(); await tick()
        expect(fragment.open).toBe(true)
        field.value = 'soft glow'; field.dispatchEvent(new Event('input', { bubbles: true })); await tick()
        expect(runtime.current.data.draft.fragments[0].prompt).toBe('soft glow')
        fragment.querySelector('summary')!.click(); await tick()
        expect(fragment.open).toBe(false)
        section.querySelector<HTMLButtonElement>('[aria-label="표현 조각 빛 제거"]')!.click(); await tick()
        expect(runtime.current.data.draft.fragments).toEqual([])
    })
    test('shows the effective image orientation and active style beside generation settings', async () => {
        mount(); await tick()
        const summary = () => document.querySelector('[aria-label="현재 이미지 형식과 화풍"]')
        expect(summary()?.textContent).toContain('세로')
        expect(summary()?.textContent).toContain('잉크')
        expect(summary()?.parentElement?.querySelector('button:last-of-type')?.textContent).toBe('생성 설정')
        runtime.current.data.settings.width = 1216
        runtime.current.data.settings.height = 832
        runtime.current.style.name = '수채화'
        await tick()
        expect(summary()?.textContent).toContain('가로')
        expect(summary()?.textContent).toContain('수채화')
        runtime.current.data.settings.height = 1216
        await tick()
        expect(summary()?.textContent).toContain('정사각형')
    })
    test('applies an image preset only on button click and restores the applied label', async () => {
        runtime.current.imagePreset = { name: 'Saved image', promptPresetId: 'current', values: {} }
        mount(); await tick()
        const select = document.querySelector<HTMLSelectElement>('[aria-label="이미지 프리셋"]')!
        expect(select).not.toBeNull()
        expect(select.selectedOptions[0].textContent).toContain('Saved image')
        expect(select.closest('.scene-options')).toBe(document.querySelector('[aria-label="그림 시점"]')!.closest('.scene-options'))
        select.value = '0'; select.dispatchEvent(new Event('change', { bubbles: true })); await tick()
        expect(runtime.current.applyImagePreset).not.toHaveBeenCalled()
        button('적용').click(); await tick(); await tick()
        expect(runtime.current.applyImagePreset).toHaveBeenCalledWith(0)
        expect(runtime.current.prepare).not.toHaveBeenCalled()
        select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); await tick()
        button('적용').click(); await tick(); await tick()
        expect(runtime.current.applyImagePreset).toHaveBeenLastCalledWith(null)
        runtime.current.state.status = 'prompt'; await tick()
        expect(select.disabled).toBe(true)
        expect(button('적용').disabled).toBe(true)
    })
    test('saves perspective above the scene without triggering generation or editing the draft', async () => {
        delete runtime.current.data.settings.perspective
        runtime.current.data.draft = draft()
        const previous = JSON.stringify(runtime.current.data.draft)
        mount(); await tick()
        const select = document.querySelector<HTMLSelectElement>('[aria-label="그림 시점"]')!
        expect(select.value).toBe('third-person')
        expect([...select.options].map(option => option.text)).toEqual(['1인칭', '3인칭'])
        expect(select.compareDocumentPosition(document.querySelector('[aria-label="그릴 장면"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        select.value = 'first-person'; select.dispatchEvent(new Event('change', { bubbles: true })); await tick()
        expect(runtime.current.data.settings.perspective).toBe('first-person')
        expect(runtime.current.persist).toHaveBeenCalledOnce()
        expect(runtime.current.prepare).not.toHaveBeenCalled()
        expect(JSON.stringify(runtime.current.data.draft)).toBe(previous)
        runtime.current.state.status = 'prompt'; await tick()
        expect(select.disabled).toBe(true)
    })
    test('always shows scene selection and enables it only for a valid current-chat passage', async () => {
        mount(); await tick()
        const choose = button('그릴 장면 선택')
        expect(choose.closest('[aria-label="그릴 장면"]')).not.toBeNull()
        expect(choose.disabled).toBe(true)
        painterSelection.set({ characterId: 'bot', chatId: 'other', anchor: { ...anchor } })
        await tick()
        expect(choose.disabled).toBe(true)
        painterSelection.set({ characterId: 'bot', chatId: 'chat', anchor: { ...anchor } })
        await tick()
        expect(choose.disabled).toBe(false)
        choose.click(); await tick()
        expect(runtime.current.data.anchor).toEqual(anchor)
        expect(runtime.current.persist).toHaveBeenCalledOnce()
        expect(runtime.current.prepare).not.toHaveBeenCalled()
        runtime.current.state.status = 'image'; await tick()
        expect(choose.disabled).toBe(true)
        runtime.current.state.status = 'idle'; runtime.current.chat.isStreaming = true; await tick()
        expect(choose.disabled).toBe(true)
    })
    test('confirms workspace reset with retention details and clears the preview on success', async () => {
        const current = runtime.current
        current.data.anchor = { ...anchor }; current.data.draft = draft(); current.data.results = [result()]
        current.resetWorkspace.mockImplementation(async () => { current.data.anchor = undefined; current.data.draft = undefined; current.data.results = []; return true })
        mount(); await tick()
        const range = document.createRange()
        range.selectNodeContents(document.querySelector('blockquote')!)
        window.getSelection()!.addRange(range)
        expect([...document.querySelectorAll('nav button')].map(el => el.textContent)).toEqual(['리셋', '화풍', '캐릭터', '생성 설정'])
        button('리셋').click(); await tick()
        expect(document.body.textContent).toContain('갤러리')
        expect(document.body.textContent).toContain('프리셋')
        expect(current.resetWorkspace).not.toHaveBeenCalled()
        button('취소').click(); await tick()
        expect(document.querySelector('[data-painter-result]')).not.toBeNull()
        button('리셋').click(); await tick()
        button('리셋 확인').click(); await tick(); await tick()
        expect(current.resetWorkspace).toHaveBeenCalledOnce()
        expect(window.getSelection()?.rangeCount).toBe(0)
        expect(document.querySelector('[data-painter-result]')).toBeNull()
        expect(button('프롬프트 작성').disabled).toBe(true)
    })
    test('retains reset confirmation on failure and prevents resetting during streaming', async () => {
        runtime.current.resetWorkspace.mockResolvedValue(false)
        mount(); await tick()
        const range = document.createRange()
        range.selectNodeContents(document.querySelector('h2')!)
        window.getSelection()!.addRange(range)
        button('리셋').click(); await tick()
        button('리셋 확인').click(); await tick(); await tick()
        expect(window.getSelection()?.toString()).toBe('바드페인터')
        expect(button('리셋 확인').disabled).toBe(false)
        runtime.current.chat.isStreaming = true; await tick()
        expect(button('리셋').disabled).toBe(true)
        expect(button('리셋 확인').disabled).toBe(true)
    })
    test('copies only prompt text and reports clipboard failure without an unhandled rejection', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
        runtime.current.data.draft = draft()
        mount(); await tick()
        button('원문 카피').click(); await tick(); await tick()
        expect(writeText).toHaveBeenCalledWith('night, indoors\n\nartist style\n\nink\nwatercolor\n\nblack hair\n\nwhite shirt, wet clothes\n\nstanding')
        expect(document.querySelector('[role="status"]')?.textContent).toContain('복사')
        writeText.mockRejectedValueOnce(new Error('clipboard denied'))
        button('원문 카피').click(); await tick(); await tick()
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('복사')
        expect(document.querySelector('[role="status"]')?.textContent).not.toContain('복사했습니다')
    })
    test('clears conversation only after confirmation and retains the current work', async () => {
        const current = runtime.current
        current.data.anchor = { ...anchor }; current.data.draft = draft(); current.data.results = [result()]
        current.data.conversation = [{ id: 'request', role: 'user', text: 'earlier request' }]
        current.clearConversation.mockImplementation(async () => { current.data.conversation = []; return true })
        mount(); await tick()
        button('대화 비우기').click(); await tick()
        expect(document.body.textContent).toContain('초안과 생성한 삽화는 유지됩니다.')
        expect(current.clearConversation).not.toHaveBeenCalled()
        button('취소').click(); await tick()
        expect(document.querySelector('[role="log"]')?.textContent).toContain('earlier request')
        button('대화 비우기').click(); await tick()
        button('비우기 확인').click(); await tick(); await tick()
        expect(current.clearConversation).toHaveBeenCalledOnce()
        expect(document.querySelector('[role="log"]')).toBeNull()
        expect(button('대화 비우기').disabled).toBe(true)
        expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="메인 프롬프트"]')?.value).toBe('night, indoors')
        expect(document.querySelector('[data-painter-result]')).not.toBeNull()
    })
    test('disables conversation clearing when empty or busy and resets confirmation on chat changes', async () => {
        mount(); await tick()
        expect(button('대화 비우기').disabled).toBe(true)
        runtime.current.data.conversation = [{ id: 'request', role: 'user', text: 'request' }]
        await tick()
        button('대화 비우기').click(); await tick()
        runtime.current.state.status = 'prompt'; await tick()
        expect(button('비우기 확인').disabled).toBe(true)
        runtime.current.state.status = 'idle'
        component!.$set({ chatId: 'other' }); await tick()
        expect([...document.querySelectorAll('button')].some(el => el.textContent === '비우기 확인')).toBe(false)
        expect(runtime.current.clearConversation).not.toHaveBeenCalled()
    })
    test('keeps the conversation and retry confirmation visible after a failed clear', async () => {
        runtime.current.data.conversation = [{ id: 'request', role: 'user', text: 'keep request' }]
        runtime.current.clearConversation.mockImplementation(async () => { runtime.current.state.error = '저장 실패'; return false })
        mount(); await tick()
        button('대화 비우기').click(); await tick()
        button('비우기 확인').click(); await tick(); await tick()
        expect(document.querySelector('[role="log"]')?.textContent).toContain('keep request')
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('저장 실패')
        expect(button('비우기 확인').disabled).toBe(false)
    })
    test('offers specified placement with the same accent as before and after', async () => {
        runtime.current.data.anchor = { ...anchor }
        runtime.current.data.draft = draft()
        runtime.current.data.results = [result()]
        mount(); await tick()
        for (const label of ['위에 삽입', '아래에 삽입', '지정 삽입']) expect(button(label).classList.contains('primary')).toBe(true)
        button('지정 삽입').click(); await tick()
        expect(get(painterInsertionRequest)).toMatchObject({ characterId: 'bot', chatId: 'chat', resultId: 'result', messageId: 'message' })
        expect(runtime.current.insert).not.toHaveBeenCalled()
        const position = { ...anchor, start: 7, end: 7 }
        await get(painterInsertionRequest)!.insert(position)
        expect(runtime.current.insert).toHaveBeenCalledWith('result', 'after', position)
    })
    test('places generation settings beside the compact image generation action', async () => {
        mount(); await tick()
        const row = button('이미지 생성').parentElement!
        expect([...row.querySelectorAll('button')].some(button => button.textContent === '생성 설정')).toBe(true)
        expect(button('이미지 생성').classList.contains('generate')).toBe(false)
    })
    test('shows toolbar actions and enables explicit preparation on the first highlight', async () => {
        mount()
        expect(button('화풍')).toBeDefined()
        expect(button('캐릭터')).toBeDefined()
        expect(button('생성 설정')).toBeDefined()
        expect(document.querySelector('[aria-label="이전 메시지 수"]')).toBeNull()
        expect(button('프롬프트 작성').disabled).toBe(true)
        painterSelection.set({ characterId: 'bot', chatId: 'chat', anchor: { ...anchor } })
        await tick()
        expect(button('프롬프트 작성').disabled).toBe(false)
        expect(runtime.current.prepare).not.toHaveBeenCalled()
        button('프롬프트 작성').click()
        expect(runtime.current.prepare).toHaveBeenCalledWith(anchor, expect.objectContaining({ fresh: false }))
    })
    test('keeps the draft scene pinned while a new selection becomes the insertion destination', async () => {
        runtime.current.data.anchor = { ...anchor }
        runtime.current.data.draft = draft()
        runtime.current.data.results = [result()]
        mount()
        const destination = { ...anchor, messageId: 'elsewhere', start: 0, end: 20, text: '다른 삽입 위치', insertionUnavailable: true }
        painterSelection.set({ characterId: 'bot', chatId: 'chat', anchor: destination })
        await tick()
        expect(button('이미지 생성').disabled).toBe(false)
        expect(document.querySelector('[aria-label="그릴 장면"]')?.textContent).toContain(anchor.text)
        expect(runtime.current.data.anchor).toEqual(anchor)
        button('아래에 삽입').click()
        expect(runtime.current.insert).toHaveBeenCalledWith('result', 'after', destination)
    })
    test('requires an explicit scene change before replacing the pinned draft', async () => {
        runtime.current.data.anchor = { ...anchor }; runtime.current.data.draft = draft()
        mount()
        const next = { ...anchor, start: 20, end: 28, text: '새 장면' }
        painterSelection.set({ characterId: 'bot', chatId: 'chat', anchor: next })
        await tick()
        button('그릴 장면 선택').click()
        await tick()
        expect(runtime.current.data.draft).toBeDefined()
        button('장면 변경 확인').click()
        await tick()
        expect(runtime.current.data.anchor).toEqual(next)
        expect(runtime.current.data.draft).toBeUndefined()
    })
    test('sends refinement instructions with the pinned scene without generating an image', async () => {
        runtime.current.data.anchor = { ...anchor }; runtime.current.data.draft = draft()
        mount()
        const composer = document.querySelector<HTMLTextAreaElement>('[aria-label="프롬프트 대화 입력"]')!
        composer.value = '구도를 가깝게'
        composer.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        button('초안 개선').click()
        expect(runtime.current.prepare).toHaveBeenCalledWith(anchor, { instruction: '구도를 가깝게', fresh: false })
        expect(runtime.current.generate).not.toHaveBeenCalled()
    })
    test('formats composer weights and accepts suggestions without submitting the prompt conversation', async () => {
        runtime.current.data.anchor = { ...anchor }
        mount(); await tick()
        const composer = document.querySelector<HTMLTextAreaElement>('[aria-label="프롬프트 대화 입력"]')!
        composer.focus(); composer.value = '1.5::blu::'; composer.setSelectionRange(8, 8)
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'u' }))
        await tick(); await new Promise(resolve => setTimeout(resolve, 0))
        expect(composer.parentElement?.querySelector('[data-tone="strong"]')?.textContent).toContain('blu')
        expect(tagSearch).toHaveBeenCalledWith('blu', expect.any(AbortSignal))
        expect(document.querySelector('[role="listbox"]')).not.toBeNull()
        composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        await tick()
        expect(runtime.current.data.settings.instruction).toBe('1.5::blue hair::')
        expect(runtime.current.prepare).not.toHaveBeenCalled()
        expect(document.activeElement).toBe(composer)
        expect(document.querySelector('[role="listbox"]')).toBeNull()
        for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
            composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...modifier }))
            await tick()
        }
        expect(runtime.current.prepare).toHaveBeenCalledTimes(2)
        expect(runtime.current.prepare).toHaveBeenLastCalledWith(anchor, { instruction: '1.5::blue hair::', fresh: false })
    })
    test('gives configured autocomplete shortcuts priority over prompt submission', async () => {
        DBState.db.tagAutocomplete = normalizeTagAutocompleteSettings({ hotkeys: { accept: [{ key: 'Enter', ctrl: true, alt: false, shift: false, meta: false }] } })
        runtime.current.data.anchor = { ...anchor }
        mount(); await tick()
        const composer = document.querySelector<HTMLTextAreaElement>('[aria-label="프롬프트 대화 입력"]')!
        composer.focus(); composer.value = 'blu'; composer.setSelectionRange(3, 3)
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'u' }))
        await tick(); await new Promise(resolve => setTimeout(resolve, 0))
        composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))
        await tick()
        expect(composer.value).toBe('blue hair')
        expect(runtime.current.prepare).not.toHaveBeenCalled()
    })
    test('keeps IME confirmation and composer submission from triggering outer shortcuts', async () => {
        runtime.current.data.anchor = { ...anchor }
        mount(); await tick()
        const composer = document.querySelector<HTMLTextAreaElement>('[aria-label="프롬프트 대화 입력"]')!
        const outer = vi.fn()
        document.body.addEventListener('keydown', outer)
        try {
            composer.focus()
            composer.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
            composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true }))
            composer.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
            composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))
            expect(runtime.current.prepare).not.toHaveBeenCalled()
            expect(outer).not.toHaveBeenCalled()
            composer.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
            composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))
            expect(runtime.current.prepare).toHaveBeenCalledOnce()
            expect(outer).not.toHaveBeenCalled()
        } finally { document.body.removeEventListener('keydown', outer) }
    })
    test('keeps the latest result only even when the chat has hundreds of illustrations', () => {
        runtime.current.data.results = Array.from({ length: 300 }, (_, i) => ({ ...result(`result-${i}`), createdAt: i }))
        mount()
        expect(document.querySelectorAll('img')).toHaveLength(1)
        expect(document.querySelector('[data-painter-result]')?.getAttribute('data-painter-result')).toBe('result-299')
        expect(document.querySelector('[aria-label="삽화 보관함"]')).toBeNull()
        expect(button('갤러리 열기')).toBeDefined()
    })
    test('does not insert incomplete compressed images and keeps recovery actions', () => {
        runtime.current.state.pendingImage = true
        runtime.current.data.results = [{ ...result(), compressionPending: true }]
        mount()
        expect(button('아래에 삽입').disabled).toBe(true)
        button('저장 다시 시도').click(); button('원본 다운로드').click()
        expect(runtime.current.retrySave).toHaveBeenCalledOnce()
        expect(runtime.current.downloadOriginal).toHaveBeenCalledOnce()
    })
    test('unmounts preview images when the painter view is hidden', async () => {
        runtime.current.data.results = [result()]
        mount()
        expect(document.querySelectorAll('img')).toHaveLength(1)
        component!.$set({ visible: false }); await tick()
        expect(document.querySelectorAll('img')).toHaveLength(0)
    })
})
