import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { tick } from 'svelte'
import { createClassComponent } from 'svelte/legacy'
import { createPainterChatData } from 'src/ts/bardPainter/types'
import { painterTestState } from './BardPainterTestState.svelte'
import BardPainterTools from './BardPainterTools.svelte'

let component: ReturnType<typeof createClassComponent> | undefined
let session: any
let onClose = vi.fn<() => void>()
async function mount(mode: 'style' | 'characters' | 'settings' | 'fragments' | null, disabled = false) {
    component = createClassComponent({ component: BardPainterTools, target: document.body, props: { session, mode, onClose, disabled } })
    await tick()
}
function button(label: string) {
    const result = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)
    expect(result, label).toBeDefined()
    return result!
}
async function change(label: string, value: string) {
    const field = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)
    expect(field, label).not.toBeNull()
    field!.value = value
    field!.dispatchEvent(new Event('input', { bubbles: true }))
    field!.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
}
beforeEach(() => {
    onClose = vi.fn<() => void>()
    const style = { id: 'default', name: '기본', artist: '', rendering: '', negative: '', steps: 28, scale: 5, cfgRescale: 0, sampler: 'k_euler_ancestral' }
    const data = createPainterChatData()
    session = painterTestState({
        data, styles: [style], style,
        get settings() { return this.data.settings },
        generationSettingsPinned: false, hasGenerationOverrides: true,
        updateGenerationSettings: vi.fn(() => session.persist()), pinGenerationSettings: vi.fn(),
        applyGenerationSettingsToGlobal: vi.fn(), useGlobalGenerationSettings: vi.fn(),
        bot: { identities: [{ id: 'example', name: '예시 인물', aliases: [], appearance: '' }], outfits: [] },
        state: { status: 'idle', error: '', notice: '', loadingWiki: false, wikiDocs: [{ id: 'place', title: '예시 장소' }] },
        persist: vi.fn().mockResolvedValue(undefined), saveStyle: vi.fn().mockResolvedValue('saved-copy'), loadWiki: vi.fn(),
        removeStyle: vi.fn().mockResolvedValue(true), moveStyle: vi.fn().mockResolvedValue(true),
    })
})
afterEach(() => { component?.$destroy(); component = undefined; document.body.replaceChildren() })

describe('BardPainter tools', () => {
    test('creates, edits, copies, adds and deletes saved fragments in the floating manager', async () => {
        session.fragments = []
        session.data.draft = { scene: 'night', rendering: '', negative: '', subjects: [] }
        session.saveFragment = async (item: any, asNew: boolean) => {
            const saved = { ...item, id: asNew || !item.id ? String(session.fragments.length + 1) : item.id }
            session.fragments = [...session.fragments.filter((value: any) => value.id !== saved.id), saved]
            return saved.id
        }
        session.addFragment = async (id: string) => { session.data.draft.fragments = [{ ...session.fragments.find((item: any) => item.id === id) }]; return true }
        session.removeFragment = async (id: string) => { session.fragments = session.fragments.filter((item: any) => item.id !== id); return true }
        await mount('fragments')
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('표현 조각 관리')
        await change('표현 조각 이름', '빛')
        await change('표현 조각 프롬프트', 'glow')
        button('저장').click(); await tick(); await tick()
        await vi.waitFor(() => expect(button('복제').disabled).toBe(false))
        expect(session.fragments[0].prompt).toBe('glow')
        await change('표현 조각 프롬프트', 'rim light')
        button('저장').click(); await tick(); await tick()
        await vi.waitFor(() => expect(button('복제').disabled).toBe(false))
        expect(session.fragments[0].prompt).toBe('rim light')
        button('복제').click(); await tick(); await tick()
        await vi.waitFor(() => expect(button('복제').disabled).toBe(false))
        expect(session.fragments.map((item: any) => item.name)).toEqual(['빛', '빛 복사'])
        document.querySelector<HTMLButtonElement>('[aria-label="빛 복사 추가"]')!.click(); await tick(); await tick()
        await vi.waitFor(() => expect(button('복제').disabled).toBe(false))
        expect(session.data.draft.fragments[0].prompt).toBe('rim light')
        button('삭제').click(); await tick()
        button('삭제 확인').click(); await tick(); await tick()
        expect(session.fragments).toHaveLength(1)
        expect(session.data.draft.fragments[0].prompt).toBe('rim light')
    })
    test('sets the selected saved style as default and shows its designation', async () => {
        const favorite = { ...session.style, id: 'favorite', name: '자주 쓰는 화풍' }
        session.styles.push(favorite); session.style = favorite; session.data.settings.styleId = favorite.id
        session.defaultStyle = session.styles[0]
        session.setDefaultStyle = vi.fn(async (id: string) => { session.defaultStyle = session.styles.find((item: any) => item.id === id); return true })
        await mount('style')
        button('기본 화풍으로 지정').click(); await tick(); await tick()
        expect(session.setDefaultStyle).toHaveBeenCalledWith('favorite')
        expect(document.querySelector('[data-painter-style="favorite"]')?.textContent).toContain('기본 화풍')
        expect(button('기본 화풍으로 지정').disabled).toBe(true)
    })
    test('exposes pin/global controls and disables global actions when already inheriting', async () => {
        await mount('settings')
        const scope = document.querySelector('[aria-label="생성 설정 적용 범위"]')!
        const pin = scope.querySelector('input')!
        pin.checked = true; pin.dispatchEvent(new Event('change', { bubbles: true }))
        expect(session.pinGenerationSettings).toHaveBeenCalledWith(true)
        button('전역값으로 설정').click(); button('전역값 사용').click()
        expect(session.applyGenerationSettingsToGlobal).toHaveBeenCalledOnce()
        expect(session.useGlobalGenerationSettings).toHaveBeenCalledOnce()
        session.hasGenerationOverrides = false; await tick()
        expect(button('전역값으로 설정').disabled).toBe(true)
        expect(button('전역값 사용').disabled).toBe(true)
    })
    test('saves changed generation values without sharing wiki selections', async () => {
        await mount('settings')
        const model = [...document.querySelectorAll('select')].find(select => select.value === 'nai-diffusion-5-full')!
        model.value = 'nai-diffusion-5-curated'; model.dispatchEvent(new Event('change', { bubbles: true }))
        expect(session.updateGenerationSettings).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'nai-diffusion-5-curated' }))
        const persona = [...document.querySelectorAll('label')].find(label => label.textContent?.trim() === '페르소나')!.querySelector('input')!
        persona.checked = true; persona.dispatchEvent(new Event('change', { bubbles: true }))
        expect(session.updateGenerationSettings).toHaveBeenLastCalledWith(expect.objectContaining({ context: expect.objectContaining({ persona: true }) }))
        session.updateGenerationSettings.mockClear(); session.persist.mockClear()
        const wiki = [...document.querySelectorAll('label')].find(label => label.textContent?.trim() === '예시 장소')!.querySelector('input')!
        wiki.checked = true; wiki.dispatchEvent(new Event('change', { bubbles: true }))
        expect(session.persist).toHaveBeenCalledOnce()
        expect(session.updateGenerationSettings).not.toHaveBeenCalled()
        expect(session.data.settings.context.wikiIds).toEqual(['place'])
    })
    test('dismisses generation settings on an outside click and shows only the reference slot', async () => {
        await mount('settings')
        expect(document.querySelector('[data-painter-reference]')).not.toBeNull()
        expect(document.querySelector('[data-painter-gallery]')).toBeNull()
        await new Promise(resolve => setTimeout(resolve, 20))
        const overlay = document.querySelector('[data-dialog-overlay]')!
        expect(overlay).not.toBeNull()
        overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', clientX: 10, clientY: 10 }))
        overlay.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }))
        overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
        await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    })
    test('keeps settings unmounted until a toolbar window opens', async () => {
        await mount(null)
        expect(document.querySelector('[role="dialog"]')).toBeNull()
        component!.$set({ mode: 'settings' })
        await tick()
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
        expect(document.querySelector('[aria-label="이전 메시지 수"]')).not.toBeNull()
        expect(document.querySelector('[data-painter-presets]')).toBeNull()
    })
    test('edits a separate style copy and saves only on an explicit action', async () => {
        await mount('style')
        expect(document.body.textContent).toContain('기본 프리셋에는 화풍 태그가 없습니다')
        await change('화풍 작가 태그', 'example artist style')
        await change('화풍 프리셋 이름', '예시 화풍')
        expect(session.style.artist).toBe('')
        expect(session.saveStyle).not.toHaveBeenCalled()
        button('새 이름으로 저장').click()
        await tick()
        expect(session.saveStyle).toHaveBeenCalledWith(expect.objectContaining({ id: 'default', name: '예시 화풍', artist: 'example artist style' }), true)
        expect(onClose).not.toHaveBeenCalled()
    })
    test('opens the searchable character library immediately without a second disclosure step', async () => {
        await mount('characters')
        const library = document.querySelector('[data-painter-presets]')
        expect(library?.tagName).toBe('SECTION')
        expect(document.querySelector('[data-painter-person="example"]')).not.toBeNull()
        expect(document.querySelector('[aria-label="인물과 의상 검색"]')).not.toBeNull()
    })
    test('persists reference settings and resolution without making an AI request', async () => {
        await mount('settings')
        await change('이전 메시지 수', '3')
        await change('이미지 크기', '1216x832')
        await change('이미지 시드', '0')
        const wiki = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(item => item.parentElement?.textContent?.includes('예시 장소'))!
        wiki.click()
        await tick()
        expect(session.data.settings.context.before).toBe(3)
        expect(session.data.settings.context.wikiIds).toEqual(['place'])
        expect(session.data.settings).toMatchObject({ width: 1216, height: 832, seed: 0 })
        await change('이미지 시드', '')
        expect(session.data.settings.seed).toBeNull()
        expect(session.persist).toHaveBeenCalled()
    })
    test('locks changes during generation but still permits closing the window', async () => {
        await mount('settings', true)
        expect(document.querySelector<HTMLInputElement>('[aria-label="이전 메시지 수"]')?.closest('fieldset')?.disabled).toBe(true)
        button('닫기').click()
        expect(onClose).toHaveBeenCalledOnce()
    })
    test('separates overwriting and copying an existing style without saving on blur', async () => {
        const custom = { ...session.style, id: 'custom', name: '저녁 화풍' }
        session.styles.push(custom); session.style = custom; session.data.settings.styleId = custom.id
        await mount('style')
        await change('화풍 프리셋 이름', '다른 화풍')
        expect(session.saveStyle).not.toHaveBeenCalled()
        button('덮어쓰기').click(); await tick()
        expect(session.saveStyle).toHaveBeenCalledWith(expect.objectContaining({ id: 'custom', name: '다른 화풍' }), false)
    })
    test('confirms discarding edits before closing and retains failed saves', async () => {
        await mount('style')
        await change('화풍 프리셋 이름', '새 화풍')
        session.saveStyle.mockResolvedValue(undefined); session.state.error = '저장 실패'
        button('새 이름으로 저장').click(); await tick()
        expect(document.querySelector<HTMLInputElement>('[aria-label="화풍 프리셋 이름"]')?.value).toBe('새 화풍')
        button('닫기').click(); await tick()
        expect(onClose).not.toHaveBeenCalled()
        button('변경 버리고 닫기').click(); await tick()
        expect(onClose).toHaveBeenCalledOnce()
    })
    test('guards navigation and deletes only after confirming the selected style', async () => {
        const custom = { ...session.style, id: 'custom', name: '저녁 화풍' }
        session.styles.push(custom); session.style = custom; session.data.settings.styleId = custom.id
        await mount('style')
        await change('화풍 작가 태그', 'edited rendering')
        document.querySelector<HTMLButtonElement>('[data-painter-style="default"]')!.click(); await tick()
        expect(session.persist).not.toHaveBeenCalled()
        button('계속 편집').click(); await tick()
        document.querySelector<HTMLButtonElement>('[aria-label="화풍 삭제"]')!.click(); await tick()
        expect(session.removeStyle).not.toHaveBeenCalled()
        button('삭제 확인').click(); await tick()
        expect(session.removeStyle).toHaveBeenCalledWith('custom')
    })
    test('exposes persisted resize controls and reorders the selected custom preset', async () => {
        const a = { ...session.style, id: 'a', name: '화풍 A' }, b = { ...session.style, id: 'b', name: '화풍 B' }
        session.styles.push(a, b); session.style = b; session.data.settings.styleId = b.id
        await mount('style')
        expect(document.querySelector('[data-manager-window-resize="se"]')).not.toBeNull()
        document.querySelector<HTMLButtonElement>('[aria-label="화풍 위로 이동"]')!.click(); await tick()
        expect(session.moveStyle).toHaveBeenCalledWith('b', -1)
    })
    test('reveals a copied style beyond the first page after clearing a search', async () => {
        session.styles.push(...Array.from({ length: 20 }, (_, n) => ({ ...session.style, id: `style-${n}`, name: `화풍 ${n}` })))
        session.saveStyle.mockImplementation(async (style: any) => {
            const saved = { ...style, id: 'copied' }; session.styles.push(saved); session.style = saved
            return saved.id
        })
        await mount('style')
        await change('화풍 검색', '기본')
        await change('화풍 프리셋 이름', '새로 저장한 화풍')
        button('새 이름으로 저장').click()
        for (let i = 0; i < 5; i++) await tick()
        expect(document.querySelector('[data-painter-style="copied"]')?.getAttribute('aria-pressed')).toBe('true')
    })
    test('guards Escape dismissal and leaves the edited style intact', async () => {
        await mount('style')
        await change('화풍 프리셋 이름', '편집 중인 이름')
        document.querySelector('[aria-label="화풍 프리셋 이름"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await tick()
        expect(onClose).not.toHaveBeenCalled()
        expect(button('변경 버리고 닫기')).toBeDefined()
        button('계속 편집').click(); await tick()
        expect(document.querySelector<HTMLInputElement>('[aria-label="화풍 프리셋 이름"]')?.value).toBe('편집 중인 이름')
    })
})
