<script lang="ts">
    import BardPainterPromptInput from './BardPainterPromptInput.svelte'
    import BardPainterLorePicker from './BardPainterLorePicker.svelte'
    import BardPainterHelp from './BardPainterHelp.svelte'
    import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eraser, ListChecks, Search, Shirt, UserPlus } from '@lucide/svelte'
    import { tick, untrack } from 'svelte'
    import type { getPainterSession } from 'src/ts/bardPainter/runtime.svelte'
    import type { PainterIdentity, PainterOutfit } from 'src/ts/bardPainter/types'

    let { session, disabled = false, expanded = false, onDirtyChange }: {
        session: ReturnType<typeof getPainterSession>; disabled?: boolean; expanded?: boolean; onDirtyChange?: (dirty: boolean) => void
    } = $props()
    /** `globalRef`: a global outfit selected for this bot; edits change the global original. */
    type OutfitItem = { outfit: PainterOutfit; shared: boolean; globalRef?: boolean }
    type Owner = { id: string; name: string; aliases: string[]; identity?: PainterIdentity; outfits: OutfitItem[] }
    type Editor = {
        kind: 'identity' | 'outfit'; id: string; subjectId: string; exists: boolean; name: string; originalName: string
        aliases: string; note: string; appearance: string; clothing: string; state: string; shared: boolean; targetShared: boolean
        attachToCard: boolean; globalRef: boolean
    }
    const fieldId = $props.id()
    let draft = $state<Editor | null>(null)
    let baseline = $state('')
    let query = $state('')
    let scope = $state('all')
    let global = $state(false)
    let loreOpen = $state(false)
    let picking = $state(false)
    let pickQuery = $state('')
    let presets = $derived(global ? (session.globalLibrary ?? { identities: [], outfits: [] }) : session.bot)
    let catalog = $derived(global ? presets : session.botCatalog)
    let localOutfits = $derived(global ? [] : session.data.outfits)
    let botOutfitIds = $derived(new Set(session.bot.outfits.map(item => item.id)))
    const isGlobalRef = (id: string) => !global && !botOutfitIds.has(id)
    let independentOutfits = $derived(catalog.outfits.filter(item => !item.subjectId))
    let globalChoices = $derived((session.globalLibrary?.outfits ?? []).filter(item => !item.subjectId))
    let selectedGlobalIds = $derived((session.bot.globalOutfits ?? []).map(ref => ref.id))
    let unreflectedIds = $derived(new Set(session.unreflectedGlobalIdentities.map(item => item.id)))
    let blankCount = $derived(session.blankIdentityIds.length)
    let personLimit = $state(12)
    let independentLimit = $state(12)
    let outfitLimits = $state<Record<string, number>>({})
    let opened = $state<string[]>([])
    let closedSearch = $state<string[]>([])
    let pendingAction = $state<(() => void) | null>(null)
    let deleting = $state(false)
    let busy = $state(false)
    let feedback = $state('')
    let failed = $state(false)
    let library: HTMLElement | undefined
    let operation = 0
    let locked = $derived(disabled || busy)
    let dirty = $derived(!!draft && JSON.stringify(draft) !== baseline)
    let valid = $derived(!!draft?.name.trim() && (draft.kind === 'identity' || !!draft.clothing.trim()))
    const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim()
    let canCopy = $derived(!!draft && valid && (normalized(draft.name) !== normalized(draft.originalName) || (draft.kind === 'outfit' && !draft.globalRef && draft.targetShared !== draft.shared)))
    let searchWords = $derived(normalized(query).split(/\s+/).filter(Boolean))
    const matches = (value: string) => searchWords.every(word => normalized(value).includes(word))
    let matchingIndependent = $derived(independentOutfits.filter(item => matches(`${item.name} ${item.clothing} ${item.state}`)))
    let pickWords = $derived(normalized(pickQuery).split(/\s+/).filter(Boolean))
    let pickMatches = $derived(globalChoices.filter(item => pickWords.every(word => normalized(`${item.name} ${item.clothing}`).includes(word))))
    let owners = $derived.by(() => {
        const result = new Map<string, Owner>(presets.identities.map(person => [person.id, { id: person.id, name: person.name, aliases: person.aliases, identity: person, outfits: [] }]))
        for (const item of [
            ...localOutfits.map(outfit => ({ outfit, shared: false })),
            ...catalog.outfits.map(outfit => ({ outfit, shared: true, globalRef: isGlobalRef(outfit.id) })),
        ]) {
            const id = item.outfit.subjectId
            if (!id) continue
            if (!result.has(id)) {
                const subject = session.data.draft?.subjects.find(person => person.id === id)
                result.set(id, { id, name: subject?.name || `이름 미등록 (${id.slice(0, 8)})`, aliases: subject?.aliases ?? [], outfits: [] })
            }
            result.get(id)!.outfits.push(item)
        }
        for (const person of result.values()) {
            for (const outfit of catalog.outfits) {
                if (person.identity?.outfitIds?.includes(outfit.id) && !person.outfits.some(item => item.outfit.id === outfit.id && item.shared)) person.outfits.push({ outfit, shared: true, globalRef: isGlobalRef(outfit.id) })
            }
        }
        return [...result.values()]
    })
    let folders = $derived(owners.map(person => {
        const personMatches = matches([person.name, ...person.aliases].join(' '))
        const outfits = person.outfits.filter(item => (scope === 'all' || item.shared === (scope === 'shared'))
            && (personMatches || matches([person.name, ...person.aliases, item.outfit.name, item.outfit.clothing, item.outfit.state].join(' '))))
        return { ...person, outfits, visible: (scope === 'all' && personMatches) || outfits.length > 0 }
    }).filter(person => person.visible))
    let owner = $derived(owners.find(person => person.id === draft?.subjectId))
    let linkedIds = $derived(owner?.identity ? catalog.outfits.filter(item => item.subjectId === owner!.id || owner!.identity!.outfitIds?.includes(item.id)).map(item => item.id) : [])
    let scopeLabel = $derived(!draft ? '' : global ? '글로벌' : draft.kind === 'identity' ? '봇 공용' : draft.globalRef ? '글로벌 의상' : draft.subjectId ? `${owner?.name ?? '인물'} / ${(draft.exists ? draft.shared : draft.targetShared) ? '봇 공용' : '현재 챗'}` : '봇 전용')

    $effect(() => {
        session
        untrack(() => {
            operation += 1; busy = false; global = false; loreOpen = false; picking = false; query = ''; scope = 'all'; opened = []; pendingAction = null; feedback = ''; failed = false; resetLimits()
            const first = owners[0]
            if (first) selectIdentity(first); else setEditor(null)
        })
    })
    $effect(() => { onDirtyChange?.(dirty) })

    function setEditor(value: Editor | null) {
        draft = value; baseline = value ? JSON.stringify(value) : ''; deleting = false; pendingAction = null; feedback = ''; failed = false; picking = false
        if (value?.subjectId && !opened.includes(value.subjectId)) opened = [...opened, value.subjectId]
        if (value?.subjectId) {
            personLimit = Math.max(personLimit, owners.findIndex(person => person.id === value.subjectId) + 1)
            if (value.kind === 'outfit') {
                const person = owners.find(item => item.id === value.subjectId)
                const index = person?.outfits.findIndex(item => item.outfit.id === value.id && item.shared === value.shared) ?? -1
                outfitLimits[value.subjectId] = Math.max(outfitLimits[value.subjectId] ?? 8, index + 1)
            }
        }
        void tick().then(() => library?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView?.({ block: 'nearest' }))
    }
    function emptyEditor(kind: Editor['kind'], subjectId = ''): Editor {
        return { kind, id: '', subjectId, exists: false, name: '', originalName: '', aliases: '', note: '', appearance: '', clothing: '', state: '', shared: global || !subjectId, targetShared: global || !subjectId, attachToCard: false, globalRef: kind === 'outfit' && !global && !subjectId }
    }
    function selectIdentity(person: Owner) {
        const source = person.identity ?? session.data.draft?.subjects.find(subject => subject.id === person.id)
        setEditor({ ...emptyEditor('identity', person.id), id: person.id, exists: !!person.identity, name: source?.name ?? '', originalName: source?.name ?? '', aliases: source?.aliases.join(', ') ?? '', note: person.identity?.note ?? '', appearance: source?.appearance ?? '', attachToCard: person.identity?.attachToCard === true })
    }
    function selectOutfit(item: OutfitItem) {
        const outfit = item.outfit
        const globalRef = item.globalRef === true
        if (!outfit.subjectId) independentLimit = Math.max(independentLimit, independentOutfits.findIndex(value => value.id === outfit.id) + 1)
        const attachToCard = globalRef ? (session.bot.globalOutfits ?? []).some(ref => ref.id === outfit.id && ref.attachToCard === true) : item.shared && outfit.attachToCard === true
        setEditor({ ...emptyEditor('outfit', outfit.subjectId), id: outfit.id, exists: true, name: outfit.name, originalName: outfit.name, clothing: outfit.clothing, state: outfit.state, shared: item.shared, targetShared: item.shared, attachToCard, globalRef })
    }
    function navigate(action: () => void) {
        if (locked) return
        deleting = false
        if (dirty) pendingAction = action
        else action()
    }
    function discardAndContinue() { const action = pendingAction; pendingAction = null; action?.() }
    function togglePerson(id: string) {
        const isOpen = opened.includes(id) || (searchWords.length > 0 && !closedSearch.includes(id))
        opened = isOpen ? opened.filter(value => value !== id) : [...opened, id]
        closedSearch = isOpen ? [...closedSearch, id] : closedSearch.filter(value => value !== id)
    }
    function resetLimits() { personLimit = 12; independentLimit = 12; outfitLimits = {}; closedSearch = [] }
    function resetFilters() { query = ''; scope = 'all'; resetLimits() }
    function outfitBoundary(item: OutfitItem, direction: -1 | 1) {
        const siblings = (item.shared ? presets.outfits : localOutfits).filter(outfit => outfit.subjectId === item.outfit.subjectId)
        const target = siblings.findIndex(outfit => outfit.id === item.outfit.id) + direction
        return target < 0 || target >= siblings.length
    }
    async function run<T>(action: () => Promise<T>, onSuccess: (value: NonNullable<T>) => void, message: string) {
        if (locked) return
        const token = ++operation, currentSession = session
        busy = true; failed = false; feedback = ''
        try {
            const value = await action()
            if (token !== operation || currentSession !== session) return
            if (value === undefined || value === null || value === false) { failed = true; feedback = session.state.error || '저장하지 못했습니다. 입력 내용은 그대로 남아 있습니다.'; return }
            onSuccess(value as NonNullable<T>); feedback = message
        } catch (error) {
            if (token === operation && currentSession === session) { failed = true; feedback = error instanceof Error ? error.message : String(error) }
        } finally { if (token === operation && currentSession === session) busy = false }
    }
    function syncAttachment(attached: boolean) {
        if (!draft) return
        draft.attachToCard = attached
        baseline = JSON.stringify({ ...JSON.parse(baseline), attachToCard: attached })
    }
    function setAllCardAttachments(attached: boolean) {
        void run(() => session.setAllCardAttachments(attached), () => {
            if (draft?.exists && (draft.kind === 'identity' || draft.shared)) syncAttachment(attached)
        }, attached ? '모든 외형과 봇 공용 의상을 카드 첨부로 저장했습니다.' : '모든 카드 첨부를 해제했습니다.')
    }
    function setGlobalAttachment(input: HTMLInputElement) {
        if (!draft) return
        const id = draft.id, attached = input.checked
        input.checked = draft.attachToCard
        void run(() => session.setGlobalOutfitAttachment(id, attached), () => { if (draft?.id === id) syncAttachment(attached) },
            attached ? '이 봇의 카드 첨부로 저장했습니다.' : '카드 첨부를 해제했습니다.')
    }
    function save(asNew = false) {
        if (!draft || !valid || (draft.exists && asNew && !canCopy)) return
        const value = { ...draft }
        if (value.kind === 'identity') {
            const identity = { id: value.id, name: value.name.trim(), aliases: [...new Set(value.aliases.split(',').map(alias => alias.trim()).filter(Boolean))], note: value.note.trim(), appearance: value.appearance.trim(),
                ...(!asNew && owner?.identity?.outfitIds ? { outfitIds: [...owner.identity.outfitIds] } : {}),
                ...(!asNew && owner?.identity?.defaultOutfitId ? { defaultOutfitId: owner.identity.defaultOutfitId } : {}),
                ...(!global && value.attachToCard && !(asNew && value.exists) ? { attachToCard: true } : {}) }
            void run(() => global ? session.saveIdentity(identity, asNew || !value.id, true) : session.saveIdentity(identity, asNew || !value.id), id => {
                resetFilters()
                selectIdentity({ ...identity, id, identity: { ...identity, id }, outfits: [] })
            }, asNew ? '새 인물 프리셋으로 저장했습니다.' : '인물 프리셋을 저장했습니다.')
        } else if (value.globalRef) {
            const creating = asNew || !value.exists
            const outfit = { id: value.id, subjectId: '', name: value.name.trim(), clothing: value.clothing.trim(), state: value.state.trim() }
            const selected = selectedGlobalIds
            void run(async () => {
                const id = await session.saveOutfitPreset(outfit, true, creating, true)
                // A new global outfit made from this bot is selected for it right away.
                if (id && creating && !(await session.setBotGlobalOutfits([...selected, id]))) return undefined
                return id
            }, id => {
                resetFilters(); selectOutfit({ outfit: { ...outfit, id }, shared: true, globalRef: true })
            }, creating ? '글로벌 의상으로 저장하고 이 봇에서 쓰도록 선택했습니다.' : '글로벌 의상을 저장했습니다. 이 의상을 쓰는 모든 봇에 반영됩니다.')
        } else {
            const shared = asNew || !value.exists ? value.targetShared : value.shared
            const outfit = { id: value.id, subjectId: value.subjectId, name: value.name.trim(), clothing: value.clothing.trim(), state: value.state.trim(),
                ...(!global && shared && value.attachToCard && !(asNew && value.exists) ? { attachToCard: true } : {}) }
            void run(() => global ? session.saveOutfitPreset(outfit, shared, asNew || !value.exists, true) : session.saveOutfitPreset(outfit, shared, asNew || !value.exists), id => {
                resetFilters(); selectOutfit({ outfit: { ...outfit, id }, shared })
            }, asNew ? '새 의상 프리셋으로 저장했습니다.' : '의상 프리셋을 저장했습니다.')
        }
    }
    function selectFallback(subjectId: string) {
        const next = owners.find(person => person.id === subjectId) ?? owners[0]
        if (next) selectIdentity(next); else setEditor(null)
    }
    function remove() {
        if (!draft?.exists) return
        const value = { ...draft }
        const toGlobal = global || value.globalRef
        void run(() => value.kind === 'identity' ? (global ? session.removeIdentity(value.id, true) : session.removeIdentity(value.id)) : (toGlobal ? session.removeOutfit(value.id, true, true) : session.removeOutfit(value.id, value.shared)),
            () => selectFallback(value.subjectId), value.kind === 'identity' ? '인물과 해당 인물의 의상 프리셋을 삭제했습니다.' : '의상 프리셋을 삭제했습니다.')
    }
    function excludeFromBot() {
        if (!draft?.globalRef || dirty) return
        const id = draft.id
        void run(() => session.setBotGlobalOutfits(selectedGlobalIds.filter(value => value !== id)), () => selectFallback(''),
            '이 봇에서 제외했습니다. 글로벌 보관함과 인물 연결은 그대로 남습니다.')
    }
    function resetEditor() {
        if (!draft) return
        if (draft.kind === 'identity' && owner) selectIdentity(owner)
        else if (draft.kind === 'outfit' && draft.exists) {
            const source = draft.globalRef ? globalChoices : draft.shared ? presets.outfits : localOutfits
            const saved = source.find(item => item.id === draft!.id)
            if (saved) selectOutfit({ outfit: saved, shared: draft.shared, globalRef: draft.globalRef })
        } else setEditor(emptyEditor(draft.kind, draft.subjectId))
    }
    function switchLibrary(next: boolean) {
        navigate(() => {
            global = next; loreOpen = false; resetFilters(); opened = []
            const first = owners[0]
            if (first) selectIdentity(first); else setEditor(null)
        })
    }
    function openPicker() { navigate(() => { setEditor(null); picking = true; pickQuery = '' }) }
    function toggleGlobalOutfit(id: string, input: HTMLInputElement) {
        const selected = input.checked
        input.checked = selectedGlobalIds.includes(id)
        void run(() => session.setBotGlobalOutfits(selected ? [...selectedGlobalIds, id] : selectedGlobalIds.filter(value => value !== id)), () => {},
            selected ? '이 봇에서 쓸 의상에 추가했습니다.' : '이 봇에서 제외했습니다. 인물 연결은 다시 선택하면 복원됩니다.')
    }
    function copyAcrossLibraries() {
        if (!draft?.exists || dirty) return
        const item = draft
        void run(() => item.kind === 'identity'
            ? global ? session.importGlobalIdentity(item.id) : session.copyIdentityToGlobal(item.id)
            : global ? session.importGlobalOutfit(item.id) : session.copyOutfitToGlobal(item.id, item.shared), () => {},
            global ? (item.kind === 'identity' ? '이 봇에 반영했습니다. 이제 프롬프트를 작성할 때 AI가 이 인물을 알아봅니다.' : '현재 봇에 복사했습니다. 프리셋 보관함을 현재 봇으로 바꾸면 확인할 수 있습니다.') : '글로벌 보관함에 복사했습니다. 이후 수정은 복사본끼리 공유되지 않습니다.')
    }
    function pruneBlank() {
        void run(async () => { const count = await session.pruneBlankIdentities(); return count === undefined ? undefined : { count } },
            () => selectFallback(''), '내용이 비어 있던 인물 프리셋을 정리했습니다.')
    }
    function linkOutfits(ids: string[], defaultId = owner?.identity?.defaultOutfitId) {
        if (!owner?.identity) return
        const id = owner.id
        const selectedDefault = defaultId && ids.includes(defaultId) ? defaultId : undefined
        void run(() => global ? session.setIdentityOutfits(id, ids, selectedDefault, true) : session.setIdentityOutfits(id, ids, selectedDefault), () => {}, '사용할 의상을 저장했습니다.')
    }
    function toggleOutfit(id: string, input: HTMLInputElement) {
        const selected = input.checked
        input.checked = linkedIds.includes(id)
        linkOutfits(selected ? [...linkedIds, id] : linkedIds.filter(value => value !== id))
    }
    function movePerson(id: string, direction: -1 | 1) { return global ? session.moveIdentity(id, direction, true) : session.moveIdentity(id, direction) }
    function moveCostume(item: OutfitItem, direction: -1 | 1) { return global ? session.moveOutfit(item.outfit.id, item.shared, direction, true) : session.moveOutfit(item.outfit.id, item.shared, direction) }
</script>

<section class="presets" class:embedded={expanded} data-painter-presets>
    {#if !expanded}<h3 class="presets-heading">인물과 의상 프리셋 <span class="hint">인물 {presets.identities.length}명 / 의상 {localOutfits.length + catalog.outfits.length}개</span></h3>{/if}
    <div class="content">
        <div class="toolbar">
            <div class="toolbar-filters">
                <select class="library-select" aria-label="프리셋 보관함" value={global ? 'global' : 'bot'} disabled={locked} onchange={event => { const next = event.currentTarget.value === 'global'; event.currentTarget.value = global ? 'global' : 'bot'; switchLibrary(next) }}><option value="bot">현재 봇</option><option value="global">글로벌 보관함</option></select>
                <label class="search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="인물과 의상 검색" placeholder="이름, 별칭, 의상 검색" bind:value={query} oninput={resetLimits} /></label>
                {#if !global}<select class="scope-select" aria-label="의상 저장 범위" value={scope} onchange={event => { scope = event.currentTarget.value; resetLimits() }}><option value="all">모든 범위</option><option value="local">현재 챗만</option><option value="shared">봇 공용만</option></select>{/if}
            </div>
            <div class="toolbar-actions">
                <button type="button" disabled={locked} onclick={() => navigate(() => setEditor(emptyEditor('identity')))}><UserPlus size={15} aria-hidden="true" />새 인물</button>
                <button type="button" disabled={locked} onclick={() => navigate(() => setEditor(emptyEditor('outfit')))}><Shirt size={15} aria-hidden="true" />새 공용 의상</button>
                {#if !global}
                    <div class="bulk" role="group" aria-label="카드 첨부 일괄 설정">
                        <button type="button" disabled={locked || !(session.bot.identities.length || session.bot.outfits.length || selectedGlobalIds.length)} onclick={() => setAllCardAttachments(true)}>모든 항목 첨부</button>
                        <button type="button" disabled={locked || !(session.bot.identities.length || session.bot.outfits.length || selectedGlobalIds.length)} onclick={() => setAllCardAttachments(false)}>모든 항목 미첨부</button>
                        <BardPainterHelp label="카드 첨부 일괄 설정">저장된 외형, 봇 공용 의상, 이 봇에서 쓰는 글로벌 의상 전체의 카드 첨부를 즉시 바꿉니다. 현재 챗 의상은 포함하지 않습니다.</BardPainterHelp>
                    </div>
                {:else}
                    <BardPainterHelp label="글로벌 보관함">모든 봇이 함께 쓰는 개인 보관함입니다. 글로벌 의상은 각 봇에서 선택해 사용하며, 여기서 수정하면 선택한 모든 봇에 반영됩니다. 인물은 봇으로 가져올 때 복사본이 만들어집니다.</BardPainterHelp>
                {/if}
            </div>
        </div>
        {#if !global && unreflectedIds.size}
            <div class="filter-note"><span class="hint">글로벌 보관함에 이 봇에 반영하지 않은 인물이 {unreflectedIds.size}명 있습니다. 반영한 인물만 프롬프트를 작성할 때 AI가 알아보고 저장된 외형을 넣습니다.</span><button type="button" class="text-button" disabled={locked} onclick={() => switchLibrary(true)}>글로벌 보관함 보기</button></div>
        {/if}
        {#if !global && blankCount}
            <div class="filter-note"><span class="hint">외형, 식별 메모, 의상과 로어 연결이 모두 없는 인물이 {blankCount}명 있습니다. AI가 쓸 정보가 없어 같은 이름의 프리셋을 가릴 수 있습니다.</span><button type="button" class="text-button" disabled={locked} onclick={() => navigate(pruneBlank)}><Eraser size={15} aria-hidden="true" />빈 인물 정리</button></div>
        {/if}
        {#if query || scope !== 'all'}<div class="filter-note"><span class="hint">인물 {folders.length}명 검색됨</span><button type="button" class="text-button" onclick={resetFilters}>검색과 필터 초기화</button></div>{/if}
        {#if pendingAction}
            <div class="confirmation" role="alert">
                <p>저장하지 않은 변경 내용이 있습니다.</p>
                <div class="actions"><button type="button" disabled={locked} onclick={discardAndContinue}>변경 버리고 계속</button><button type="button" disabled={locked} onclick={() => pendingAction = null}>계속 편집</button></div>
            </div>
        {/if}
        <div class="workspace">
            <nav class="library" aria-label="인물별 프리셋 목록" bind:this={library}>
                {#if scope !== 'local'}
                    <section class="group independent" aria-label="공용 의상">
                        <div class="group-heading">
                            <h3>{global ? '공용 의상' : '이 봇의 공용 의상'}</h3><span class="count">{independentOutfits.length}</span>
                            {#if !global}<button type="button" class="text-button pick-button" disabled={locked} aria-pressed={picking} onclick={openPicker}><ListChecks size={15} aria-hidden="true" />글로벌에서 선택</button>{/if}
                        </div>
                        {#each matchingIndependent.slice(0, independentLimit) as outfit (outfit.id)}
                            {@const globalRef = isGlobalRef(outfit.id)}
                            {@const selected = draft?.kind === 'outfit' && draft.id === outfit.id && draft.shared}
                            <div class="row" class:selected>
                                <button type="button" class="row-name inline" disabled={locked} aria-label={`${outfit.name} 공용 의상 편집`} aria-pressed={selected} onclick={() => navigate(() => selectOutfit({ outfit, shared: true, globalRef }))}><span>{outfit.name}</span>{#if !global && !globalRef}<span class="tag">봇 전용</span>{/if}</button>
                            </div>
                        {:else}
                            {#if !query}<p class="hint empty">{global ? '새 공용 의상을 만들어 보관하세요.' : '글로벌 의상을 선택하거나 새 공용 의상을 만드세요.'}</p>{/if}
                        {/each}
                        {#if matchingIndependent.length > independentLimit}<button type="button" class="text-button" onclick={() => independentLimit += 12}>공용 의상 더 보기 ({matchingIndependent.length - independentLimit}개)</button>{/if}
                    </section>
                {/if}
                <section class="group" aria-label="인물">
                    <div class="group-heading"><h3>인물</h3><span class="count">{presets.identities.length}</span></div>
                    {#each folders.slice(0, personLimit) as person (person.id)}
                        {@const isOpen = opened.includes(person.id) || (searchWords.length > 0 && !closedSearch.includes(person.id))}
                        {@const index = presets.identities.findIndex(item => item.id === person.id)}
                        <div class="person" data-painter-person={person.id}>
                            <div class="row owner-row" class:selected={draft?.kind === 'identity' && draft.subjectId === person.id}>
                                <button type="button" class="icon-button" aria-label={`${person.name} 의상 ${isOpen ? '접기' : '펼치기'}`} aria-expanded={isOpen} onclick={() => togglePerson(person.id)}>{#if isOpen}<ChevronDown size={15} aria-hidden="true" />{:else}<ChevronRight size={15} aria-hidden="true" />{/if}</button>
                                <button type="button" class="row-name" disabled={locked} aria-label={`${person.name} 외형 편집`} aria-pressed={draft?.kind === 'identity' && draft.subjectId === person.id} onclick={() => navigate(() => selectIdentity(person))}>
                                    <span class="name-line"><strong>{person.name}</strong>{#if person.identity && !person.identity.appearance.trim()}<span class="tag">외형 없음</span>{/if}{#if global && unreflectedIds.has(person.id)}<span class="tag warn">이 봇에 미반영</span>{/if}</span><span class="hint">{person.aliases.join(', ') || `${person.outfits.length}개 의상`}</span>
                                </button>
                                {#if person.identity}<div class="reorder"><button type="button" class="icon-button" aria-label={`${person.name} 위로`} title="인물 위로" disabled={locked || index === 0} onclick={() => run(() => movePerson(person.id, -1), () => {}, '인물 순서를 바꿨습니다.')}><ArrowUp size={14} aria-hidden="true" /></button><button type="button" class="icon-button" aria-label={`${person.name} 아래로`} title="인물 아래로" disabled={locked || index === presets.identities.length - 1} onclick={() => run(() => movePerson(person.id, 1), () => {}, '인물 순서를 바꿨습니다.')}><ArrowDown size={14} aria-hidden="true" /></button></div>{/if}
                            </div>
                            {#if isOpen}
                                <div class="children">
                                    {#each person.outfits.slice(0, outfitLimits[person.id] ?? 8) as item (`${item.shared}:${item.outfit.id}`)}
                                        <div class="row outfit-row" class:selected={draft?.kind === 'outfit' && draft.id === item.outfit.id && draft.shared === item.shared} data-painter-outfit={item.outfit.id}>
                                            <button type="button" class="row-name inline" disabled={locked} aria-label={`${item.outfit.name} 의상 편집`} aria-pressed={draft?.kind === 'outfit' && draft.id === item.outfit.id && draft.shared === item.shared} onclick={() => navigate(() => selectOutfit(item))}><span>{item.outfit.name}</span>{#if person.identity?.defaultOutfitId === item.outfit.id}<span class="tag accent">기본</span>{/if}<span class="tag">{global ? '글로벌' : item.globalRef ? '글로벌' : item.shared ? '봇 공용' : '현재 챗'}</span></button>
                                            {#if !item.globalRef && item.outfit.subjectId}<div class="reorder"><button type="button" class="icon-button" aria-label={`${item.outfit.name} 위로`} title="같은 저장 범위에서 위로" disabled={locked || outfitBoundary(item, -1)} onclick={() => run(() => moveCostume(item, -1), () => {}, '의상 순서를 바꿨습니다.')}><ArrowUp size={14} aria-hidden="true" /></button><button type="button" class="icon-button" aria-label={`${item.outfit.name} 아래로`} title="같은 저장 범위에서 아래로" disabled={locked || outfitBoundary(item, 1)} onclick={() => run(() => moveCostume(item, 1), () => {}, '의상 순서를 바꿨습니다.')}><ArrowDown size={14} aria-hidden="true" /></button></div>{/if}
                                        </div>
                                    {:else}<p class="hint empty">{query || scope !== 'all' ? '조건에 맞는 의상이 없습니다.' : '연결된 의상이 없습니다.'}</p>{/each}
                                    {#if person.outfits.length > (outfitLimits[person.id] ?? 8)}<button type="button" class="text-button" onclick={() => outfitLimits[person.id] = (outfitLimits[person.id] ?? 8) + 8}>의상 더 보기 ({person.outfits.length - (outfitLimits[person.id] ?? 8)}개)</button>{/if}
                                </div>
                            {/if}
                        </div>
                    {:else}<p class="hint empty">{query || scope !== 'all' ? '검색 결과가 없습니다. 검색어나 저장 범위를 바꿔 주세요.' : '새 인물을 등록하고 외형과 의상을 저장하세요.'}</p>{/each}
                    {#if folders.length > personLimit}<button type="button" class="text-button" onclick={() => personLimit += 12}>인물 더 보기 ({folders.length - personLimit}명)</button>{/if}
                </section>
            </nav>
            <div class="editor-pane">
                {#if picking}
                    <div class="editor-heading">
                        <h3>이 봇에서 쓸 글로벌 의상</h3><span class="count">{selectedGlobalIds.filter(id => globalChoices.some(item => item.id === id)).length} / {globalChoices.length}</span>
                        <BardPainterHelp label="글로벌 의상 선택">글로벌 보관함의 공용 의상 중 이 봇에서 쓸 것만 고릅니다. 선택한 의상만 각 인물의 사용할 의상 목록에 나타납니다. 선택은 즉시 저장되며, 해제해도 인물 연결은 남아 다시 선택하면 복원됩니다.</BardPainterHelp>
                    </div>
                    <fieldset disabled={locked} class="picker">
                        <label class="search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="글로벌 의상 검색" placeholder="의상 이름, 프롬프트 검색" bind:value={pickQuery} /></label>
                        <div class="option-grid">
                            {#each pickMatches as outfit (outfit.id)}
                                <label class="option"><input type="checkbox" aria-label={`${outfit.name} 이 봇에서 사용`} checked={selectedGlobalIds.includes(outfit.id)} onchange={event => toggleGlobalOutfit(outfit.id, event.currentTarget)} /><span class="option-text"><span>{outfit.name}</span><span class="hint">{outfit.clothing}</span></span></label>
                            {:else}<p class="hint empty">{globalChoices.length ? '검색 결과가 없습니다.' : '글로벌 의상이 없습니다. 새 공용 의상을 만들거나, 봇 전용 의상을 글로벌에 복사하세요.'}</p>{/each}
                        </div>
                    </fieldset>
                {:else if draft}
                    <div class="editor-heading">
                        <h3>{draft.kind === 'identity' ? (draft.exists ? draft.originalName : '새 인물') : (draft.exists ? draft.originalName : draft.globalRef ? '새 공용 의상' : '새 의상')}</h3>
                        <span class="tag">{scopeLabel}</span>{#if dirty}<span class="tag warn">저장 안 됨</span>{/if}
                        <BardPainterHelp label="편집 범위">
                            {#if draft.kind === 'identity'}{global ? '다른 봇으로 가져올 수 있습니다.' : '같은 봇의 모든 챗에서 사용할 수 있습니다.'} 새 이름으로 저장하면 외형과 별칭만 복사하며, 의상은 원래 인물에 남습니다.
                            {:else if global}글로벌 의상을 수정하면 이 의상을 선택한 모든 봇에 반영됩니다. 카드로 내보낸 복사본은 바뀌지 않습니다.
                            {:else if draft.globalRef}글로벌 보관함의 원본을 수정합니다. 이 의상을 선택한 모든 봇에 반영됩니다.
                            {:else if !draft.subjectId}카드에서 가져왔거나 예전에 봇에 저장한 봇 전용 의상입니다. 글로벌에 복사하면 다른 봇에서도 선택할 수 있습니다.
                            {:else}{draft.exists ? `덮어쓰기는 원본(${draft.shared ? '봇 공용' : '현재 챗'})을 수정합니다. 이름이나 저장 범위를 바꾸면 별도 프리셋으로 저장할 수 있습니다.` : '현재 챗에서만 쓰거나, 같은 봇의 모든 챗에서 사용할 수 있습니다.'}{/if}
                        </BardPainterHelp>
                        {#if draft.subjectId && draft.kind === 'identity' && draft.exists}<button type="button" class="text-button push" disabled={locked} onclick={() => navigate(() => setEditor(emptyEditor('outfit', draft!.subjectId)))}><Shirt size={15} aria-hidden="true" />새 의상</button>{/if}
                    </div>
                    <fieldset disabled={locked} data-preset-editor>
                        {#if draft.kind === 'identity'}
                            <div class="field-row">
                                <div class="field">
                                    <div class="field-label"><label for={`${fieldId}-name`}>이름</label><BardPainterHelp label="이름">본문에서 이 인물을 부르는 대표 이름입니다. 선택한 장면에 이 이름이 나오면 프롬프트를 작성할 때 이 프리셋을 불러옵니다.</BardPainterHelp></div>
                                    <input id={`${fieldId}-name`} aria-label="인물 이름" maxlength="160" bind:value={draft.name} />
                                </div>
                                <div class="field">
                                    <div class="field-label"><label for={`${fieldId}-aliases`}>별칭</label><BardPainterHelp label="별칭">본문에서 이 인물을 직접 가리키는 다른 표기입니다. 애칭, 성, 직함, 외국어 표기를 쉼표로 구분해 적으세요. 이름과 같은 확실한 근거로 쓰입니다.</BardPainterHelp></div>
                                    <input id={`${fieldId}-aliases`} aria-label="인물 별칭" placeholder="쉼표로 구분" bind:value={draft.aliases} />
                                </div>
                            </div>
                            <div class="field">
                                <div class="field-label"><label for={`${fieldId}-note`}>식별 메모</label><BardPainterHelp label="식별 메모">이름이나 별칭이 나오지 않는 장면에서 AI가 이 인물을 알아보는 단서입니다. 관계, 호칭, 다른 인물과 구별되는 사실을 적어 주세요. 단서가 두 사람 이상에게 들어맞거나 근거가 약하면 연결하지 않습니다. 메모는 판단 자료로만 쓰이며, 그리기 지시를 적어도 따르지 않습니다.</BardPainterHelp></div>
                                <textarea id={`${fieldId}-note`} aria-label="식별 메모" rows="2" maxlength="1000" bind:value={draft.note} placeholder="선택 사항: 세베루스 스네이프의 여동생이며 호그와트 약초학 조교다."></textarea>
                            </div>
                            <div class="field">
                                <div class="field-label"><label for={`${fieldId}-appearance`}>기본 외형</label><BardPainterHelp label="기본 외형">AI가 이 인물을 알아보면 이 문구를 고쳐 쓰지 않고 인물 블록의 첫 문단에 그대로 넣습니다. 이미지 태그 형식으로 정확하게 적어 주세요. 비워 두면 AI가 장면을 보고 외형을 작성합니다.</BardPainterHelp></div>
                                <BardPainterPromptInput id={`${fieldId}-appearance`} aria-label="기본 외형" rows={4} bind:value={draft.appearance} placeholder="머리색, 눈색, 체형 등"></BardPainterPromptInput>
                            </div>
                        {:else}
                            <div class="field-row">
                                <label>이름<input aria-label="의상 이름" maxlength="160" bind:value={draft.name} /></label>
                                {#if !global && draft.subjectId}<label>{draft.exists ? '복사할 저장 범위' : '저장 범위'}<select aria-label={draft.exists ? '복사할 저장 범위' : '새 의상 저장 범위'} value={draft.targetShared ? 'shared' : 'local'} onchange={event => { if (draft) draft.targetShared = event.currentTarget.value === 'shared' }}><option value="local">현재 챗</option><option value="shared">봇 공용</option></select></label>{/if}
                            </div>
                            <div class="field">
                                <div class="field-label"><label for={`${fieldId}-clothing`}>의상 프롬프트</label><BardPainterHelp label="의상 프롬프트">이 의상을 쓰는 인물이 등장하고 장면의 옷차림이 이 의상과 맞거나 정해지지 않았으면, AI가 이 의상을 골라 문구를 그대로 넣습니다. 장면에 다른 옷이 묘사되면 쓰지 않습니다.</BardPainterHelp></div>
                                <BardPainterPromptInput id={`${fieldId}-clothing`} aria-label="의상 프롬프트" rows={4} bind:value={draft.clothing} placeholder="의상, 색상, 소재, 장신구 등"></BardPainterPromptInput>
                            </div>
                            <div class="field">
                                <div class="field-label"><label for={`${fieldId}-state`}>의상 상태</label><BardPainterHelp label="의상 상태">의상과 함께 불러올 상태입니다. 장면에서 새로 생긴 일시적 상태는 AI가 이 문구 뒤에 덧붙입니다.</BardPainterHelp></div>
                                <BardPainterPromptInput id={`${fieldId}-state`} aria-label="의상 상태" rows={2} bind:value={draft.state} placeholder="선택 사항: 젖음, 찢어짐 등"></BardPainterPromptInput>
                            </div>
                        {/if}
                    </fieldset>
                    <div class="save-bar">
                        {#if draft.exists}<button type="button" class="primary" disabled={locked || !valid || !dirty} onclick={() => save(false)}>덮어쓰기</button><button type="button" disabled={locked || !canCopy} title={!canCopy ? '다른 이름을 입력해 주세요. 인물 의상은 저장 범위를 바꿔 복사할 수도 있습니다.' : undefined} onclick={() => save(true)}>새 이름으로 저장</button>
                        {:else}<button type="button" class="primary" disabled={locked || !valid} onclick={() => save(!draft!.id)}>저장</button>{/if}
                        <button type="button" disabled={locked || !dirty} onclick={() => navigate(resetEditor)}>되돌리기</button>
                        {#if !global && (draft.kind === 'identity' || (draft.exists ? draft.shared : draft.targetShared))}
                            <span class="attach">
                                {#if draft.globalRef}
                                    <label class="check"><input type="checkbox" aria-label="봇에 첨부" checked={draft.attachToCard} disabled={locked || !draft.exists} onchange={event => setGlobalAttachment(event.currentTarget)} />봇에 첨부</label>
                                {:else}
                                    <label class="check"><input type="checkbox" aria-label="봇에 첨부" disabled={locked} bind:checked={draft.attachToCard} />봇에 첨부</label>
                                {/if}
                                <BardPainterHelp label="봇에 첨부">{draft.globalRef ? '선택 즉시 저장됩니다. 카드를 내보낼 때 이 의상의 현재 내용이 카드에 복사됩니다.' : '체크한 뒤 저장하면 CHARX, PNG, JSON 카드에 포함됩니다.'} {draft.kind === 'identity' ? '의상은 각각 따로 첨부해야 합니다.' : draft.subjectId ? '이 인물의 기본 외형도 첨부로 저장해야 의상이 포함됩니다.' : '공용 의상은 독립된 프리셋으로 포함됩니다.'} 복사본은 첨부 해제로 시작합니다.</BardPainterHelp>
                            </span>
                        {:else if !global}
                            <span class="attach hint">카드 첨부 불가<BardPainterHelp label="카드 첨부">현재 챗 의상은 개인 데이터입니다. 카드에 넣으려면 봇 공용으로 복사한 뒤 첨부를 선택하세요.</BardPainterHelp></span>
                        {/if}
                    </div>
                    {#if draft.exists}
                        <div class="actions secondary-actions">
                            {#if !draft.globalRef}<button type="button" disabled={locked || dirty || (global && draft.kind === 'identity' && !unreflectedIds.has(draft.id))} title={dirty ? '편집 내용을 먼저 저장하세요.' : undefined} onclick={copyAcrossLibraries}>{global ? (draft.kind === 'outfit' ? '현재 봇으로 가져오기' : unreflectedIds.has(draft.id) ? '이 봇에 반영' : '이 봇에 반영됨') : '글로벌에 복사'}</button>{/if}
                            {#if !global && draft.kind === 'identity'}<button type="button" disabled={locked || dirty} title={dirty ? '편집 내용을 먼저 저장하세요.' : undefined} onclick={() => loreOpen = true}>로어 연결</button><span class="count">{(session.loreEntries ?? []).filter(item => item.identityId === draft!.id).length}개 연결</span>{/if}
                            {#if draft.globalRef}<button type="button" disabled={locked || dirty} title={dirty ? '편집 내용을 먼저 저장하세요.' : undefined} onclick={excludeFromBot}>이 봇에서 제외</button>{/if}
                            {#if draft.kind === 'identity'}<BardPainterHelp label="보관함 간 복사">{global ? '현재 봇으로 가져오면 인물은 복사하고, 연결된 공용 의상은 복사하지 않고 이 봇에서 쓰도록 선택합니다.' : '글로벌에 복사하면 외형과 연결된 의상을 함께 가져갑니다. 이미 글로벌에 있는 의상은 복사하지 않고 연결합니다.'} 로어 연결은 복사하지 않습니다.</BardPainterHelp>{/if}
                            <button type="button" class="delete-button push" disabled={locked} onclick={() => { deleting = true; pendingAction = null }}>삭제</button>
                        </div>
                    {/if}
                    {#if deleting}
                        <div class="confirmation" role="alert">
                            <p>{#if draft.kind === 'identity'}「{draft.originalName}」의 외형과 {global ? '글로벌 보관함에 저장한' : '이 봇의 모든 챗에 저장한'} 이 인물의 의상 프리셋을 삭제합니다. 다른 인물도 사용하는 공용 의상은 유지됩니다.{:else if draft.globalRef}글로벌 보관함에서 「{draft.originalName}」을 삭제합니다. 이 의상을 선택한 다른 봇에서도 사라집니다. 이 봇에서만 빼려면 '이 봇에서 제외'를 누르세요.{:else}「{draft.originalName}」({global ? '글로벌' : draft.shared ? '봇 공용' : '현재 챗'}) 의상 프리셋을 삭제합니다.{/if} 기존 프롬프트와 삽화는 유지됩니다.{dirty ? ' 저장하지 않은 편집 내용도 버립니다.' : ''}</p>
                            <div class="actions"><button type="button" class="delete-button" disabled={locked} onclick={remove}>삭제 확인</button><button type="button" disabled={locked} onclick={() => deleting = false}>삭제 취소</button></div>
                        </div>
                    {/if}
                    {#if draft.kind === 'identity' && draft.exists}
                        <fieldset disabled={locked} class="outfit-links" aria-label="사용할 의상">
                            <div class="links-heading">
                                <h4>사용할 의상</h4><span class="count">{linkedIds.length}</span>
                                <BardPainterHelp label="사용할 의상">선택 즉시 저장됩니다. 같은 의상을 여러 인물이 사용할 수 있습니다. 프롬프트를 작성할 때 AI는 이 목록에서 장면에 맞는 의상을 고르며, 옷차림이 정해지지 않은 장면에서는 기본 의상을 먼저 씁니다. {global ? '' : '목록에는 이 봇의 공용 의상만 나타납니다. 다른 글로벌 의상은 \'글로벌에서 선택\'으로 추가하세요.'}</BardPainterHelp>
                                <label class="default-select">기본 의상<select aria-label="기본 의상" value={owner?.identity?.defaultOutfitId ?? ''} disabled={!linkedIds.length} onchange={event => { const id = event.currentTarget.value; event.currentTarget.value = owner?.identity?.defaultOutfitId ?? ''; linkOutfits(linkedIds, id) }}><option value="">지정하지 않음</option>{#each catalog.outfits.filter(item => linkedIds.includes(item.id)) as outfit (outfit.id)}<option value={outfit.id}>{outfit.name}</option>{/each}</select></label>
                            </div>
                            <div class="option-grid">
                            {#each catalog.outfits as outfit (outfit.id)}
                                <label class="option"><input type="checkbox" aria-label={`${outfit.name} 사용`} checked={linkedIds.includes(outfit.id)} onchange={event => toggleOutfit(outfit.id, event.currentTarget)} /><span class="option-text"><span>{outfit.name}</span></span></label>
                            {:else}<p class="hint empty">{global ? '새 공용 의상을 만들면 여기에서 선택할 수 있습니다.' : '이 봇에서 쓸 공용 의상이 없습니다.'}{#if !global}<button type="button" class="text-button" onclick={openPicker}>글로벌에서 선택</button>{/if}</p>{/each}
                            </div>
                        </fieldset>
                    {/if}
                {:else}<div class="editor-empty"><h3>인물별로 외형과 의상을 정리하세요</h3><p class="hint">새 인물을 등록한 뒤 해당 인물의 의상을 추가할 수 있습니다.</p></div>{/if}
                <p class:error={failed} class="feedback" role="status" aria-live="polite">{busy ? '저장 중…' : feedback}</p>
            </div>
        </div>
    </div>
</section>
{#if !global && draft?.kind === 'identity' && draft.exists}
    <BardPainterLorePicker {session} identityId={draft.id} identityName={draft.originalName} bind:open={loreOpen} disabled={locked} />
{/if}

<style>
    .presets { container-type: inline-size; min-width: 0; color: var(--color-textcolor); border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); background: var(--color-darkbg); }
    .presets.embedded { display: flex; flex-direction: column; height: 100%; min-height: 0; border: 0; background: transparent; }
    .presets.embedded > .content { flex: 1; min-height: 0; padding: 0; }
    .presets-heading { padding: .65rem; font-weight: 600; }
    .content { display: flex; flex-direction: column; gap: .6rem; padding: .65rem; min-width: 0; }
    .toolbar { display: flex; flex-wrap: wrap; gap: .4rem .75rem; align-items: center; padding-bottom: .6rem; border-bottom: 1px solid var(--color-darkborderc); }
    .toolbar-filters { display: flex; flex: 1 1 22rem; gap: .4rem; min-width: 0; }
    .toolbar-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; }
    .bulk { display: flex; align-items: center; gap: .25rem; padding-left: .5rem; border-left: 1px solid var(--color-darkborderc); }
    .library-select { flex: 0 0 auto; width: auto; }
    .scope-select { flex: 0 0 auto; width: auto; }
    .search { position: relative; flex: 1; flex-direction: row; align-items: center; min-width: 8rem; }
    .search :global(svg) { position: absolute; left: .55rem; color: var(--color-textcolor2); pointer-events: none; }
    .search input { padding-left: 1.9rem; }
    label { display: flex; flex-direction: column; gap: .25rem; font-size: .8rem; color: var(--color-textcolor2); min-width: 0; }
    label > :global(input), label > :global(select), label > :global(textarea), label > :global(div) { color: var(--color-textcolor); }
    input, select, textarea { width: 100%; min-width: 0; border: 1px solid var(--color-darkborderc); background: var(--color-bgcolor); color: var(--color-textcolor); border-radius: calc(var(--risu-radius-sm) * 1.2); padding: .4rem .55rem; min-height: 2.1rem; font-size: .85rem; }
    textarea { display: block; resize: vertical; line-height: 1.5; font-family: inherit; }
    textarea::placeholder, input::placeholder { color: var(--color-textcolor2); opacity: .8; }
    .field { display: flex; flex-direction: column; gap: .25rem; min-width: 0; }
    .field-label { display: flex; flex-wrap: wrap; align-items: center; gap: 0 .15rem; min-height: 1.5rem; }
    input[type="checkbox"] { flex-shrink: 0; width: 1rem; min-height: 1rem; height: 1rem; padding: 0; accent-color: var(--color-primary); }
    button { display: inline-flex; align-items: center; justify-content: center; gap: .3rem; min-height: 2.1rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-sm) * 1.2); padding: .3rem .65rem; font-size: .8rem; white-space: nowrap; }
    button:hover:not(:disabled) { background: var(--color-darkbutton); }
    button:disabled, fieldset:disabled { opacity: .55; }
    button:disabled { cursor: default; }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .workspace { display: grid; grid-template-columns: minmax(14rem, 19rem) minmax(0, 1fr); min-height: 23rem; gap: 1rem; }
    .embedded .workspace { flex: 1; min-height: 0; grid-template-rows: minmax(0, 1fr); }
    .library { overflow: auto; max-height: min(62vh, 40rem); min-width: 0; padding: 0 .4rem 0 0; scrollbar-gutter: stable; border-right: 1px solid var(--color-darkborderc); }
    .embedded .library, .embedded .editor-pane { max-height: none; }
    .group + .group { margin-top: .6rem; padding-top: .6rem; border-top: 1px solid var(--color-darkborderc); }
    .group-heading, .editor-heading, .links-heading { display: flex; align-items: center; flex-wrap: wrap; gap: .3rem .4rem; min-width: 0; }
    .group-heading { padding: 0 .25rem .3rem; }
    .group-heading h3 { font-size: .78rem; font-weight: 600; color: var(--color-textcolor2); }
    .count { font-size: .72rem; font-variant-numeric: tabular-nums; color: var(--color-textcolor2); }
    .pick-button { margin-left: auto; }
    .row { display: flex; align-items: center; gap: .1rem; border-radius: calc(var(--risu-radius-sm) * 1.2); min-width: 0; }
    .row:hover { background: color-mix(in srgb, var(--color-darkbutton) 55%, transparent); }
    .row.selected { background: var(--color-selected); }
    .row-name { display: flex; flex: 1; flex-direction: column; align-items: flex-start; min-width: 0; text-align: left; border: 0; padding: .3rem .4rem; gap: 0; white-space: normal; }
    .row-name:hover:not(:disabled) { background: transparent; }
    .row-name.inline { flex-direction: row; align-items: center; gap: .35rem; }
    .row-name > * { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row-name.inline > span:first-child { flex: 1; min-width: 0; }
    .row-name strong { font-weight: 600; font-size: .85rem; overflow: hidden; text-overflow: ellipsis; }
    .name-line { display: flex; align-items: center; gap: .3rem; min-width: 0; }
    .tag { flex-shrink: 0; padding: .05rem .35rem; border-radius: var(--risu-radius-sm); background: var(--color-bgcolor); color: var(--color-textcolor2); font-size: .68rem; line-height: 1.5; white-space: nowrap; }
    .tag.accent { color: var(--color-primary); }
    .tag.warn { color: var(--color-danger); }
    .icon-button { flex-shrink: 0; width: 1.6rem; min-height: 1.7rem; padding: 0; border-color: transparent; color: var(--color-textcolor2); }
    .icon-button:hover:not(:disabled) { color: var(--color-textcolor); }
    .reorder { display: flex; flex-shrink: 0; opacity: 0; transition: opacity .12s ease-out; }
    .row:hover .reorder, .row:focus-within .reorder, .row.selected .reorder { opacity: 1; }
    .children { margin: .1rem 0 .3rem 1.1rem; padding-left: .4rem; border-left: 1px solid var(--color-darkborderc); }
    .outfit-row .row-name { font-size: .8rem; }
    .editor-pane { min-width: 0; overflow: auto; max-height: min(62vh, 40rem); padding: 0 .2rem .2rem 0; scrollbar-gutter: stable; }
    .editor-heading { padding-bottom: .55rem; }
    h3 { font-size: .95rem; font-weight: 600; margin: 0; overflow-wrap: anywhere; }
    .push { margin-left: auto; }
    fieldset { border: 0; margin: 0; padding: 0; min-width: 0; display: flex; flex-direction: column; gap: .6rem; }
    .field-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .6rem; }
    .field-row > :only-child { grid-column: 1 / -1; }
    .hint, .feedback { color: var(--color-textcolor2); font-size: .75rem; line-height: 1.5; overflow-wrap: anywhere; }
    .save-bar, .actions { display: flex; align-items: center; flex-wrap: wrap; gap: .35rem; }
    .save-bar { margin-top: .7rem; }
    .attach { display: inline-flex; align-items: center; flex-wrap: wrap; gap: .15rem; margin-left: auto; }
    .check { flex-direction: row; align-items: center; gap: .4rem; min-height: 2.1rem; color: var(--color-textcolor); font-size: .8rem; cursor: pointer; }
    .secondary-actions { margin-top: .5rem; padding-top: .5rem; border-top: 1px solid var(--color-darkborderc); }
    .primary { background: var(--color-primary); color: var(--color-accenttext); border-color: var(--color-primary); }
    .delete-button { color: var(--color-danger); }
    .text-button { border-color: transparent; padding: .25rem .4rem; min-height: 1.8rem; color: var(--color-textcolor2); }
    .text-button:hover:not(:disabled) { color: var(--color-textcolor); }
    .confirmation { padding: .6rem; background: var(--color-bgcolor); border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-sm) * 1.2); font-size: .8rem; line-height: 1.5; }
    .confirmation p { margin: 0 0 .5rem; }
    .editor-pane > .confirmation { margin-top: .6rem; }
    .feedback { margin-top: .5rem; }
    .feedback:empty { display: none; }
    .feedback.error { color: var(--color-danger); }
    .filter-note { display: flex; gap: .5rem; align-items: center; }
    .empty { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem; padding: .3rem .4rem; }
    .editor-empty { padding: 1.2rem .2rem; }
    .outfit-links { margin-top: .9rem; padding-top: .7rem; border-top: 1px solid var(--color-darkborderc); gap: .45rem; }
    .outfit-links h4 { margin: 0; font-size: .85rem; font-weight: 600; }
    .default-select { flex-direction: row; align-items: center; gap: .4rem; margin-left: auto; white-space: nowrap; }
    .default-select select { width: auto; max-width: 14rem; }
    .option-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 10.5rem), 1fr)); gap: .3rem; max-height: 16rem; overflow: auto; }
    .picker .option-grid { max-height: none; grid-template-columns: repeat(auto-fill, minmax(min(100%, 14rem), 1fr)); }
    .option { flex-direction: row; align-items: center; gap: .45rem; min-height: 2.2rem; padding: .3rem .5rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-sm) * 1.2); color: var(--color-textcolor); font-size: .8rem; cursor: pointer; }
    .option:has(input:checked) { border-color: color-mix(in srgb, var(--color-primary) 60%, var(--color-darkborderc)); background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
    .option-text { display: flex; flex-direction: column; min-width: 0; }
    .option-text > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    @container (max-width: 760px) {
        .toolbar-filters { flex-basis: 100%; }
    }
    @container (max-width: 640px) {
        .workspace { grid-template-columns: minmax(0, 1fr); gap: .8rem; min-height: 0; }
        .embedded .workspace { display: flex; flex-direction: column; overflow: auto; }
        .library { max-height: 15rem; border-right: 0; border-bottom: 1px solid var(--color-darkborderc); padding: 0 0 .5rem; }
        .embedded .library { flex-shrink: 0; max-height: 15rem; }
        .editor-pane, .embedded .editor-pane { flex-shrink: 0; max-height: none; overflow: visible; }
        .toolbar-filters { flex-wrap: wrap; }
        .search { flex-basis: 100%; order: -1; }
        .bulk { padding-left: 0; border-left: 0; }
    }
    @container (max-width: 420px) {
        .field-row { grid-template-columns: minmax(0, 1fr); }
        .attach { margin-left: 0; }
    }
    @media (pointer: coarse) { button { min-height: 2.75rem; } .icon-button { width: 2.3rem; min-height: 2.75rem; } .reorder { opacity: 1; } }
</style>
