<script lang="ts">
    import { onDestroy } from 'svelte'
    import { v4 } from 'uuid'
    import { BrushIcon, CheckIcon, DownloadIcon, LoaderCircleIcon, SparklesIcon, WandSparklesIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    import { alertConfirm } from 'src/ts/alert'
    import { downloadFile, globalFetch, requestImmediateSave } from 'src/ts/globalApi.svelte'
    import { requestChatData } from 'src/ts/process/request/request'
    import { getCurrentCharacter, type RisuPersona } from 'src/ts/storage/database.svelte'
    import { DBState } from 'src/ts/stores.svelte'
    import {
        buildPersonaPortraitImageRequest,
        buildPersonaPortraitMessages,
        emptyPersonaPortraitFields,
        parsePersonaPortraitFields,
        personaDescriptionHash,
        personaPainterIdentityFields,
        personaPortraitStyles,
        unzipPortraitPng,
        type PersonaPortraitFields,
    } from 'src/ts/bardPainter/personaPortrait'

    interface Props {
        open?: boolean
        persona: RisuPersona
        onAssign: (png: Uint8Array) => Promise<void>
    }

    interface Candidate { id: string; png: Uint8Array; url: string; seed: number }

    let { open = $bindable(false), persona, onAssign }: Props = $props()
    const copy = $derived(language.settingsWorkspace.personaManager.portrait)
    const fieldKeys = ['appearance', 'clothing', 'expression', 'composition'] as const

    let fields = $state<PersonaPortraitFields>(emptyPersonaPortraitFields())
    let styleId = $state('')
    let instruction = $state('')
    let sourceHash = $state('')
    let busy = $state<'prompt' | 'image' | null>(null)
    let error = $state('')
    let notice = $state('')
    let candidates = $state.raw<Candidate[]>([])
    let selectedId = $state('')
    let controller: AbortController | null = null
    let wasOpen = false

    const styles = $derived(personaPortraitStyles(DBState.db.bardPainterStyles))
    const style = $derived(styles.find(item => item.id === styleId)
        ?? styles.find(item => item.id === DBState.db.bardPainterDefaultStyleId)
        ?? styles[0])
    const selected = $derived(candidates.find(item => item.id === selectedId))
    const hasKey = $derived(Boolean(DBState.db.NAIApiKey?.trim()))
    const hasDescription = $derived(Boolean(persona.personaPrompt?.trim()))
    const hasPrompt = $derived(Boolean(fields.appearance.trim() || fields.clothing.trim() || fields.expression.trim()))
    const descriptionChanged = $derived(Boolean(sourceHash) && hasDescription && sourceHash !== personaDescriptionHash(persona.personaPrompt))

    function initialize() {
        const saved = persona.portraitPrompt
        error = ''
        notice = ''
        instruction = ''
        if (saved) {
            fields = { composition: saved.composition, appearance: saved.appearance, clothing: saved.clothing, expression: saved.expression }
            styleId = saved.styleId ?? ''
            sourceHash = saved.sourceHash ?? ''
            return
        }
        const identity = personaPainterIdentityFields(DBState.db.bardPainterLibrary, persona.name)
        fields = identity ?? emptyPersonaPortraitFields()
        styleId = ''
        sourceHash = ''
        if (identity) notice = copy.fromIdentity
    }

    function savePrompt() {
        persona.portraitPrompt = { ...$state.snapshot(fields), styleId: style.id, sourceHash, seed: persona.portraitPrompt?.seed }
        void requestImmediateSave()
    }

    function stop() {
        controller?.abort()
        controller = null
        busy = null
    }

    function clearCandidates() {
        for (const item of candidates) URL.revokeObjectURL(item.url)
        candidates = []
        selectedId = ''
    }

    const errorText = (cause: unknown) => cause instanceof Error && cause.message ? cause.message : copy.requestFailed

    async function requestPrompt(messages: ReturnType<typeof buildPersonaPortraitMessages>, fresh: boolean) {
        const current = new AbortController()
        controller = current
        busy = 'prompt'
        error = ''
        notice = ''
        try {
            const response = await requestChatData({
                formated: messages, bias: {}, currentChar: getCurrentCharacter() ?? undefined,
                useStreaming: false, noMultiGen: true, tools: [], disablePromptCache: true,
                logSource: 'other', logPurpose: 'bard-painter',
            }, DBState.db.bardPainterSettings?.modelSlot ?? 'model', current.signal)
            if (current.signal.aborted) return
            if (response.type !== 'success') {
                error = response.type === 'fail' && response.result.trim() ? response.result.trim() : copy.requestFailed
                return
            }
            fields = parsePersonaPortraitFields(response.result)
            if (fresh) sourceHash = personaDescriptionHash(persona.personaPrompt)
            instruction = ''
            savePrompt()
        } catch (cause) {
            if (!current.signal.aborted) error = errorText(cause)
        } finally {
            if (controller === current) { controller = null; busy = null }
        }
    }

    async function writePrompt() {
        if (busy) return
        if (!hasDescription) { error = copy.descriptionRequired; return }
        if (hasPrompt && !await alertConfirm(copy.overwriteConfirm)) return
        try {
            await requestPrompt(buildPersonaPortraitMessages({ name: persona.name, description: persona.personaPrompt, instruction }), true)
        } catch (cause) { error = errorText(cause) }
    }

    async function revisePrompt() {
        if (busy || !instruction.trim() || !fields.appearance.trim()) return
        try {
            await requestPrompt(buildPersonaPortraitMessages({
                name: persona.name, description: persona.personaPrompt, instruction, current: $state.snapshot(fields),
            }), false)
        } catch (cause) { error = errorText(cause) }
    }

    async function draw() {
        if (busy || !hasKey || !fields.appearance.trim()) return
        savePrompt()
        const current = new AbortController()
        controller = current
        busy = 'image'
        error = ''
        notice = ''
        try {
            const seed = crypto.getRandomValues(new Uint32Array(1))[0]
            const request = buildPersonaPortraitImageRequest($state.snapshot(fields), $state.snapshot(style), DBState.db.bardPainterSettings, seed)
            const response = await globalFetch(DBState.db.NAIImgUrl || 'https://image.novelai.net/ai/generate-image', {
                body: request, headers: { Authorization: `Bearer ${DBState.db.NAIApiKey}`, 'Content-Type': 'application/json' },
                rawResponse: true, logCategory: 'image', logSource: 'image', requestTimeoutMs: 180_000, abortSignal: current.signal,
            })
            if (current.signal.aborted) return
            if (!response.ok) {
                const detail = typeof response.data === 'string' ? response.data : new TextDecoder().decode(response.data)
                throw new Error(`이미지 생성 실패 (${response.status}): ${detail.slice(0, 500)}`)
            }
            const png = await unzipPortraitPng(new Uint8Array(response.data))
            if (current.signal.aborted) return
            const item: Candidate = { id: v4(), png, url: URL.createObjectURL(new Blob([new Uint8Array(png)], { type: 'image/png' })), seed }
            const kept = [item, ...candidates].slice(0, 12)
            for (const dropped of candidates.slice(11)) URL.revokeObjectURL(dropped.url)
            candidates = kept
            selectedId = item.id
        } catch (cause) {
            if (!current.signal.aborted) error = errorText(cause)
        } finally {
            if (controller === current) { controller = null; busy = null }
        }
    }

    async function assign() {
        const item = selected
        if (!item || busy) return
        error = ''
        try {
            await onAssign(item.png)
            if (persona.portraitPrompt) persona.portraitPrompt.seed = item.seed
            await requestImmediateSave()
            notice = copy.assigned
        } catch (cause) { error = errorText(cause) }
    }

    async function download() {
        const item = selected
        if (!item) return
        const name = (persona.name.trim() || 'persona').replace(/[\\/:*?"<>|]/g, '_')
        await downloadFile(`${name}-portrait.png`, item.png)
    }

    $effect(() => {
        if (open && !wasOpen) initialize()
        if (!open && wasOpen) { stop(); clearCandidates() }
        wasOpen = open
    })

    onDestroy(() => { stop(); clearCandidates() })
</script>

<ShDialog
    bind:open
    size="xl"
    tier="base"
    overlayClass="z-[45]"
    closeOnEscape={true}
    closeOnOutsideClick={busy === null}
    contentClass="persona-portrait-dialog z-[45]"
    bodyClass="min-h-0 overflow-y-auto"
    closeAriaLabel={copy.close}
>
    {#snippet title()}
        <span class="inline-flex items-center gap-2"><BrushIcon size={19} />{copy.title}</span>
    {/snippet}
    {#snippet description()}{copy.description(persona.name)}{/snippet}

    <div class="portrait-layout">
        <section data-persona-portrait-prompt class="prompt-panel">
            <div class="panel-head">
                <ShButton variant="soft-primary" size="sm" disabled={busy !== null || !hasDescription} onclick={writePrompt}>
                    {#if busy === 'prompt'}<LoaderCircleIcon size={15} class="animate-spin" />{:else}<SparklesIcon size={15} />{/if}
                    {hasPrompt ? copy.rewritePrompt : copy.writePrompt}
                </ShButton>
                {#if busy === 'prompt'}<span class="status">{copy.writing}</span>{/if}
            </div>
            {#if !hasDescription}
                <p class="hint">{copy.descriptionRequired}</p>
            {:else if descriptionChanged}
                <p class="hint warn">{copy.descriptionChanged}</p>
            {/if}
            {#each fieldKeys as key}
                <label class="field">
                    <span>{copy[key]}</span>
                    <textarea
                        data-persona-portrait-field={key}
                        rows={key === 'expression' || key === 'composition' ? 2 : 3}
                        spellcheck="false"
                        disabled={busy !== null}
                        bind:value={fields[key]}
                    ></textarea>
                </label>
            {/each}
            <label class="field">
                <span>{copy.style}</span>
                <select value={style.id} disabled={busy !== null} onchange={(event) => { styleId = event.currentTarget.value }}>
                    {#each styles as item (item.id)}
                        <option value={item.id}>{item.name}</option>
                    {/each}
                </select>
            </label>
            <div class="field">
                <span>{copy.instruction}</span>
                <div class="instruction-row">
                    <input
                        data-persona-portrait-instruction
                        bind:value={instruction}
                        placeholder={copy.instructionPlaceholder}
                        disabled={busy !== null}
                        onkeydown={(event) => { if (event.key === 'Enter' && !event.isComposing) void revisePrompt() }}
                    />
                    <ShButton variant="outline" size="sm" disabled={busy !== null || !instruction.trim() || !fields.appearance.trim()} onclick={revisePrompt}>
                        <WandSparklesIcon size={15} />{copy.revise}
                    </ShButton>
                </div>
            </div>
        </section>

        <section data-persona-portrait-result class="result-panel">
            <div class="preview" aria-busy={busy === 'image'}>
                {#if busy === 'image'}
                    <div class="preview-state"><LoaderCircleIcon size={28} class="animate-spin" /><span>{copy.drawing}</span></div>
                {:else if selected}
                    <img src={selected.url} alt={copy.title} />
                {:else}
                    <p class="preview-state">{copy.empty}</p>
                {/if}
            </div>
            {#if candidates.length > 1}
                <div class="thumbs" aria-label={copy.candidates}>
                    {#each candidates as item, index (item.id)}
                        <button
                            class="thumb"
                            class:selected={item.id === selectedId}
                            aria-label={copy.candidate(index + 1)}
                            aria-pressed={item.id === selectedId}
                            onclick={() => { selectedId = item.id }}
                        ><img src={item.url} alt="" /></button>
                    {/each}
                </div>
            {/if}
            <div class="result-actions">
                <ShButton variant="primary" size="sm" disabled={!selected || busy !== null} onclick={assign}><CheckIcon size={15} />{copy.assign}</ShButton>
                <ShButton variant="outline" size="sm" disabled={!selected} onclick={download}><DownloadIcon size={15} />{copy.download}</ShButton>
            </div>
            {#if candidates.length}<p class="hint">{copy.sessionOnly}</p>{/if}
        </section>
    </div>

    {#if error}<p class="message error" role="alert">{error}</p>{/if}
    {#if notice}<p class="message" role="status">{notice}</p>{/if}

    {#snippet footer()}
        <div class="portrait-footer">
            {#if !hasKey}<span class="hint">{copy.noKey}</span>{/if}
            {#if busy}
                <ShButton variant="ghost" size="sm" onclick={stop}>{copy.cancel}</ShButton>
            {/if}
            <ShButton data-persona-portrait-draw variant="primary" disabled={busy !== null || !hasKey || !fields.appearance.trim()} onclick={draw}>
                {#if busy === 'image'}<LoaderCircleIcon size={16} class="animate-spin" />{:else}<BrushIcon size={16} />{/if}
                {candidates.length ? copy.drawAgain : copy.draw}
            </ShButton>
        </div>
    {/snippet}
</ShDialog>

<style>
    .portrait-layout { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 1.25rem; align-items: start; }
    .prompt-panel, .result-panel { display: flex; min-width: 0; flex-direction: column; gap: .75rem; }
    .panel-head { display: flex; align-items: center; gap: .6rem; }
    .status { color: var(--color-textcolor2); font-size: .8rem; }
    .field { display: flex; min-width: 0; flex-direction: column; gap: .3rem; }
    .field > span { color: var(--color-textcolor2); font-size: .8rem; font-weight: 600; }
    .field textarea, .field select, .field input { width: 100%; min-width: 0; padding: .5rem .65rem; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); color: var(--color-textcolor); background: var(--color-surface-inset); font-size: .85rem; line-height: 1.45; }
    .field textarea { resize: vertical; font-family: var(--font-mono, ui-monospace, monospace); }
    .field textarea:focus, .field select:focus, .field input:focus { outline: none; border-color: var(--color-borderc); }
    .field textarea:disabled, .field select:disabled, .field input:disabled { opacity: .6; }
    .instruction-row { display: flex; gap: .5rem; align-items: center; }
    .instruction-row input { flex: 1 1 auto; }
    .preview { position: relative; width: 100%; aspect-ratio: 1 / 1; display: grid; place-items: center; overflow: hidden; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 1.3); background: var(--color-surface-inset); }
    .preview img { width: 100%; height: 100%; object-fit: cover; }
    .preview-state { display: flex; flex-direction: column; align-items: center; gap: .6rem; max-width: 16rem; padding: 1rem; color: var(--color-textcolor2); font-size: .85rem; text-align: center; }
    .thumbs { display: flex; flex-wrap: wrap; gap: .45rem; }
    .thumb { width: 3.25rem; height: 3.25rem; overflow: hidden; border: 2px solid transparent; border-radius: calc(var(--risu-radius-lg) * 0.9); background: var(--color-surface-inset); }
    .thumb.selected { border-color: var(--color-primary); }
    .thumb img { width: 100%; height: 100%; object-fit: cover; }
    .result-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
    .hint { margin: 0; color: var(--color-textcolor2); font-size: .8rem; }
    .hint.warn { color: var(--color-draculaorange, var(--color-textcolor)); }
    .message { margin: .75rem 0 0; color: var(--color-textcolor2); font-size: .85rem; }
    .message.error { color: var(--color-draculared); white-space: pre-wrap; overflow-wrap: anywhere; }
    .portrait-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: .6rem; width: 100%; }
    .portrait-footer .hint { margin-right: auto; }
    @media (max-width: 720px) {
        .portrait-layout { grid-template-columns: 1fr; }
    }
</style>
