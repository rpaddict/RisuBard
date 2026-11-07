<script lang="ts">
    // Body of a single request-status toast. Rendered as a sonner custom toast
    // (one per generationId). Subscribes to the shared store and reads its own
    // entry by id, so it re-renders live on each timer tick without the driver
    // re-issuing the toast. Final left-bar design — see
    // .agent/notes/request-status-toast-infra.md and the workspace mockup.
    //
    // Layout (left color bar = phase):
    //   row1: ●dot  phase(bold)  [kind chip]  elapsed ........ output N (right)
    //   row2: model · think N · tok/s   (dim detail; 0/empty hidden)
    //   row3+: cache/search/tool badges (future)
    import { onMount } from 'svelte'
    import { requestStatuses, isTerminalPhase, clearStatus, type RequestPhase, type RequestKind, type RequestInjectionItem, type RequestInjectionKind } from 'src/ts/status/requestStatus'
    import { language } from 'src/lang'
    import { ChevronDownIcon, ChevronUpIcon, RotateCwIcon, XIcon } from '@lucide/svelte'
    import { toast } from 'svelte-sonner'
    import { requestPurposeLabels } from 'src/ts/requestPurpose'
    import { DBState } from 'src/ts/stores.svelte'

    let { id }: { id: string } = $props()

    const entry = $derived($requestStatuses.get(id))
    const injectionManifest = $derived(entry && entry.injectionManifest)
    const rs = language.requestStatus

    // Collapse is one shared, persisted flag: folding any toast folds every
    // later one too. Failed toasts ignore the opacity setting.
    const collapsed = $derived(DBState.db.requestStatusCollapsed === true)
    const failed = $derived(!!entry && (entry.phase === 'failed' || !!entry.error))
    const opacity = $derived(failed ? 1 : Math.min(100, Math.max(10, DBState.db.requestStatusOpacity ?? 100)) / 100)
    const hoverOpaque = $derived(DBState.db.requestStatusHoverOpaque !== false)
    function toggleCollapsed(): void {
        DBState.db.requestStatusCollapsed = !collapsed
    }

    // Live elapsed clock: tick while the entry is non-terminal.
    let now = $state(Date.now())
    onMount(() => {
        const t = setInterval(() => { now = Date.now() }, 200)
        return () => clearInterval(t)
    })

    const PHASE_LABEL: Record<RequestPhase, string> = {
        connecting: rs?.connecting ?? 'Connecting…',
        thinking:   rs?.thinking ?? 'Thinking…',
        responding: rs?.responding ?? 'Responding…',
        retrying:   rs?.retrying ?? 'Retrying…',
        stalled:    rs?.stalled ?? 'Stalled…',
        background: rs?.background ?? 'In background…',
        done:       rs?.done ?? 'Done',
        failed:     rs?.failed ?? 'Failed',
        aborted:    rs?.aborted ?? 'Cancelled',
    }
    const KIND_LABEL: Record<RequestKind, string> = {
        main:      rs?.kindMain ?? 'Main',
        translate: rs?.kindTranslate ?? 'Translate',
        memory:    rs?.kindMemory ?? 'Memory',
        emotion:   rs?.kindEmotion ?? 'Emotion',
        sub:       rs?.kindSub ?? 'Sub',
    }

    // Accent bar / phase text color by phase.
    function accentClass(phase: RequestPhase): string {
        if (phase === 'done') return 'rs-accent-success'
        if (phase === 'failed') return 'rs-accent-danger'
        if (phase === 'stalled' || phase === 'aborted') return 'rs-accent-muted'
        return 'rs-accent-primary'
    }
    function phaseColor(phase: RequestPhase): string {
        if (phase === 'done') return 'text-success'
        if (phase === 'failed') return 'text-draculared'
        if (phase === 'stalled' || phase === 'aborted') return 'text-textcolor2'
        return 'text-primary'
    }

    function fmt(n: number): string {
        if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
        return String(n)
    }
    function elapsedStr(e: NonNullable<typeof entry>): string {
        // Once terminal, freeze at the recorded end time (endStatus sets endedAt);
        // otherwise tick live. lastChunkAt is NOT used — non-streaming paths never
        // update it, which made completed elapsed read 0.
        const end = isTerminalPhase(e.phase) ? (e.endedAt ?? now) : now
        return ((Math.max(0, end - e.startedAt)) / 1000).toFixed(1) + 's'
    }

    // Right-side single number: output tokens once any arrive, else thinking.
    const right = $derived.by(() => {
        const e = entry
        if (!e) return null
        if (e.responseTokens > 0) return { label: rs?.outputTokens ?? 'out', value: fmt(e.responseTokens) }
        if (e.thinkingTokens > 0) return { label: rs?.thinkingTokensLabel ?? 'think', value: fmt(e.thinkingTokens) }
        return null
    })

    // Second-row detail: model · think (when both present) · tok/s. Empty parts dropped.
    const detail = $derived.by(() => {
        const e = entry
        if (!e) return ''
        const parts: string[] = [e.label]
        if (e.responseTokens > 0 && e.thinkingTokens > 0) parts.push(`${rs?.thinkingTokensLabel ?? 'think'} ${fmt(e.thinkingTokens)}`)
        if (e.tokPerSec > 0) parts.push(`${Math.round(e.tokPerSec)} ${rs?.tokensPerSec ?? 'tok/s'}`)
        return parts.join(' · ')
    })

    // Collapsed summary: estimated/actual input plus thinking and output so far.
    const totalTokens = $derived.by(() => {
        const e = entry
        if (!e) return 0
        return (injectionManifest?.totalTokens ?? 0) + e.thinkingTokens + e.responseTokens
    })

    const spinning = $derived(entry ? !isTerminalPhase(entry.phase) && entry.phase !== 'stalled' : false)

    function injectionLabel(item: RequestInjectionItem): string {
        const labels: Record<RequestInjectionKind, string> = {
            systemPrompt: rs?.injectionKinds?.systemPrompt ?? 'System prompt',
            jailbreak: rs?.injectionKinds?.jailbreak ?? 'Jailbreak',
            globalNote: rs?.injectionKinds?.globalNote ?? 'Global note',
            authorNote: rs?.injectionKinds?.authorNote ?? "Author's note",
            character: rs?.injectionKinds?.character ?? 'Character',
            persona: rs?.injectionKinds?.persona ?? 'Persona',
            lorebook: rs?.injectionKinds?.lorebook ?? 'Lorebook',
            grimoire: rs?.injectionKinds?.grimoire ?? 'Grimoire',
            grimoireRequired: rs?.injectionKinds?.grimoireRequired ?? 'Grimoire (required)',
            wiki: rs?.injectionKinds?.wiki ?? 'BardWiki',
            memory: rs?.injectionKinds?.memory ?? 'Memory',
            exampleDialogue: rs?.injectionKinds?.exampleDialogue ?? 'Example dialogue',
            chatHistory: rs?.injectionKinds?.chatHistory ?? 'Chat history',
            instruction: rs?.injectionKinds?.instruction ?? 'Instruction',
            tool: rs?.injectionKinds?.tool ?? 'Tool result',
            other: rs?.injectionKinds?.other ?? 'Other context',
        }
        const label = labels[item.kind]
        if (!item.name) return label
        if (item.kind === 'lorebook') return `${label} “${item.name}”`
        if (item.kind === 'grimoire' || item.kind === 'grimoireRequired') return `${label} ${item.name}`
        return `${label} · ${item.name}`
    }

    function dismiss(): void {
        clearStatus(id)
        toast.dismiss(`req:${id}`)
    }

</script>

{#if entry}
    <!-- sonner skips its default chrome for custom-component toasts
         (data-styled=false), so apply the app toast look + left accent bar. -->
    <div class="rs-card {accentClass(entry.phase)}" class:rs-hover-opaque={hoverOpaque}
         class:rs-collapsed={collapsed} style:opacity={opacity}>
        <div class="rs-body">
            <div class="rs-row1">
                <span class="rs-dot" class:rs-dot-success={entry.phase === 'done'}
                      class:rs-dot-danger={entry.phase === 'failed'}
                      class:rs-dot-muted={entry.phase === 'stalled' || entry.phase === 'aborted'}
                      class:rs-breathe={spinning}></span>

                {#if entry.phase === 'retrying'}
                    <RotateCwIcon size={14} class="text-primary rs-spin shrink-0" />
                {/if}

                <span class="rs-phase {phaseColor(entry.phase)}">{PHASE_LABEL[entry.phase]}</span>
                <span class="rs-chip">{entry.purpose ? requestPurposeLabels[entry.purpose] : KIND_LABEL[entry.kind]}</span>
                {#if !collapsed}
                    <span class="rs-elapsed">{elapsedStr(entry)}</span>

                    {#if entry.retryAttempt}
                        <span class="rs-retry">#{entry.retryAttempt}</span>
                    {/if}
                {/if}
                <span class="rs-actions">
                    {#if collapsed}
                        {#if totalTokens > 0}<span class="rs-right">{rs?.totalTokens ?? 'total'} <b>{fmt(totalTokens)}</b></span>{/if}
                    {:else if right}
                        <span class="rs-right">{right.label} <b>{right.value}</b></span>
                    {/if}
                    <button class="rs-close" type="button" aria-expanded={!collapsed}
                            aria-label={collapsed ? (rs?.expand ?? 'Expand') : (rs?.collapse ?? 'Collapse')}
                            title={collapsed ? (rs?.expand ?? 'Expand') : (rs?.collapse ?? 'Collapse')}
                            onclick={toggleCollapsed}>
                        {#if collapsed}<ChevronDownIcon size={14} />{:else}<ChevronUpIcon size={14} />{/if}
                    </button>
                    <button class="rs-close" type="button" aria-label={rs?.close ?? 'Close'} onclick={dismiss}><XIcon size={14} /></button>
                </span>
            </div>

            {#if entry.error}
                <div class="rs-detail rs-error truncate">{entry.error} · {entry.label}</div>
            {:else if detail && !collapsed}
                <div class="rs-detail truncate">{detail}</div>
            {/if}

            {#if !collapsed && injectionManifest && injectionManifest.items.length > 0}
                <section class="rs-context" aria-label={rs?.injectedContext ?? 'Injected context'}>
                    <div class="rs-context-head">
                        <span>{rs?.injectedContext ?? 'Injected context'}</span>
                        <strong>{injectionManifest.estimated !== false ? (rs?.estimatedInputTokens ?? 'Estimated input') : (rs?.totalInputTokens ?? 'Total input')} {injectionManifest.totalTokens.toLocaleString()} {rs?.tokenUnit ?? 'tokens'}</strong>
                    </div>
                    <ul>
                        {#each injectionManifest.items as item (`${item.kind}:${item.name ?? ''}`)}
                            <li>
                                <span title={injectionLabel(item)}>{injectionLabel(item)}</span>
                                <b>≈{item.tokens.toLocaleString()}</b>
                            </li>
                        {/each}
                    </ul>
                </section>
            {/if}

            {#each collapsed ? [] : entry.badges as badge (badge.key)}
                <div class="rs-badge-row"
                     class:rs-badge-success={badge.tone === 'success'}
                     class:rs-badge-warn={badge.tone === 'warn'}>
                    {badge.text}
                </div>
            {/each}
        </div>
    </div>
{/if}

<style>
    .rs-card {
        display: flex;
        width: min(400px, calc(100vw - 32px));
        background: var(--risu-theme-darkbg);
        color: var(--risu-theme-textcolor);
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: var(--risu-radius-lg);
        overflow: hidden;
        font-size: 0.875rem;
    }
    /* left accent bar via left border */
    .rs-card { border-left-width: 4px; transition: opacity .15s ease; }
    .rs-card.rs-hover-opaque:hover,
    .rs-card.rs-hover-opaque:focus-within { opacity: 1 !important; }
    .rs-collapsed .rs-body { padding-top: 7px; padding-bottom: 7px; }
    .rs-accent-primary { border-left-color: var(--risu-theme-primary); }
    .rs-accent-success { border-left-color: var(--risu-theme-success); }
    .rs-accent-danger  { border-left-color: var(--risu-theme-draculared); }
    .rs-accent-muted   { border-left-color: var(--risu-theme-textcolor2); }

    .rs-body { flex: 1; min-width: 0; padding: 10px 13px; }
    .rs-row1 { display: flex; align-items: center; gap: 8px; }

    .rs-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
        background: var(--risu-theme-primary); }
    .rs-dot-success { background: var(--risu-theme-success); }
    .rs-dot-danger  { background: var(--risu-theme-draculared); }
    .rs-dot-muted   { background: var(--risu-theme-textcolor2); }
    .rs-breathe { animation: rs-breathe 1.5s ease-in-out infinite; }
    @keyframes rs-breathe {
        0%,100% { transform: scale(.7); opacity: .5; }
        50% { transform: scale(1.15); opacity: 1; }
    }
    :global(.rs-spin) { animation: rs-spin 1s linear infinite; }
    @keyframes rs-spin { to { transform: rotate(360deg); } }

    .rs-phase { font-weight: 600; }
    .rs-chip {
        font-size: 11px; padding: 1px 7px; border-radius: 999px; flex-shrink: 0;
        background: var(--risu-theme-selected); color: var(--risu-theme-textcolor);
    }
    .rs-elapsed { font-size: 12px; color: var(--risu-theme-textcolor2); font-variant-numeric: tabular-nums; }
    .rs-retry { font-size: 12px; color: var(--risu-theme-textcolor2); }
    .rs-actions { margin-left: auto; display: flex; align-items: center; gap: 6px; }
    .rs-right { font-size: 12px; color: var(--risu-theme-textcolor2); white-space: nowrap; }
    .rs-right b { color: var(--risu-theme-textcolor); font-weight: 600; font-variant-numeric: tabular-nums; }
    .rs-close { display: grid; place-items: center; width: 22px; height: 22px; border-radius: calc(var(--risu-radius-sm) * 1.25);
        color: var(--risu-theme-textcolor2); transition: color .15s ease, background .15s ease; }
    .rs-close:hover { color: var(--risu-theme-textcolor); background: var(--risu-theme-selected); }
    .rs-close:focus-visible { outline: 2px solid var(--risu-theme-primary); outline-offset: 1px; }

    .rs-detail { font-size: 12px; color: var(--risu-theme-textcolor2); margin-top: 3px; }
    .rs-error { color: var(--risu-theme-draculared); }
    .truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .rs-context { margin-top: 9px; padding-top: 8px; border-top: 1px solid var(--risu-theme-darkborderc); }
    .rs-context-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
        color: var(--risu-theme-textcolor2); font-size: 11px; letter-spacing: .01em; }
    .rs-context-head strong { color: var(--risu-theme-textcolor); font-weight: 600; white-space: nowrap;
        font-variant-numeric: tabular-nums; }
    .rs-context ul { max-height: 156px; margin: 6px 0 0; padding: 0 2px 0 0; overflow-y: auto; list-style: none; }
    .rs-context li { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline;
        gap: 14px; min-height: 23px; padding: 3px 0; font-size: 12px; }
    .rs-context li + li { border-top: 1px solid color-mix(in srgb, var(--risu-theme-darkborderc) 60%, transparent); }
    .rs-context li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--risu-theme-textcolor2); }
    .rs-context li b { color: var(--risu-theme-textcolor); font-weight: 500; font-variant-numeric: tabular-nums; }

    .rs-badge-row { font-size: 12px; color: var(--risu-theme-textcolor2); margin-top: 5px; }
    .rs-badge-success { color: var(--color-success); }
    .rs-badge-warn { color: var(--color-warning); }
</style>
