<script lang="ts">
    import type { HTMLTextareaAttributes } from 'svelte/elements'
    import { tokenizePromptEmphasis, emphasisAppearance } from 'src/ts/bardPainter/emphasis'
    import { DBState } from 'src/ts/stores.svelte'
    import { normalizeTagAutocompleteSettings } from 'src/ts/tagAutocomplete/settings'
    import { tagAutocomplete } from 'src/ts/tagAutocomplete/action'

    type InputEvent = Event & { currentTarget: EventTarget & HTMLTextAreaElement }
    let { value = $bindable(''), input = $bindable<HTMLTextAreaElement>(), oninput, onscroll, ...attributes }:
        Omit<HTMLTextareaAttributes, 'value'> & { value?: string; input?: HTMLTextAreaElement } = $props()
    let parts = $derived(tokenizePromptEmphasis(value).map(part => ({ ...part, ...emphasisAppearance(part.weight) })))
    let tagSettings = $derived(normalizeTagAutocompleteSettings(DBState.db.tagAutocomplete))
    let viewport = $state({ left: 1, top: 1, width: 0, height: 0, x: 0, y: 0 })
    let metrics = $state('')

    function syncViewport() {
        if (!input) return
        viewport = { left: input.clientLeft, top: input.clientTop,
            width: input.clientWidth, height: input.clientHeight, x: input.scrollLeft, y: input.scrollTop }
        // Callers restyle the textarea (a larger font in subject blocks), so the highlight copies its text metrics.
        const style = getComputedStyle(input)
        metrics = ['font', 'line-height', 'letter-spacing', 'word-spacing', 'padding']
            .map(name => `${name}: ${style.getPropertyValue(name)}`).join('; ')
    }
    $effect(() => {
        if (!input) return
        const observer = new ResizeObserver(syncViewport)
        observer.observe(input)
        syncViewport()
        return () => observer.disconnect()
    })
    function edit(event: InputEvent) {
        value = event.currentTarget.value
        oninput?.(event)
        syncViewport()
    }
</script>

<div class="prompt-input">
    <div class="mirror" data-prompt-mirror aria-hidden="true"
        style:left={`${viewport.left}px`} style:top={`${viewport.top}px`}
        style:width={`${viewport.width}px`} style:height={`${viewport.height}px`}>
        <div class="content" class:nowrap={attributes.wrap === 'off'} data-prompt-content style={metrics}
            style:transform={`translate(${-viewport.x}px, ${-viewport.y}px)`}>{#each parts as part}<span data-weight={part.weight} data-tone={part.tone} style:background-color={part.tone === 'neutral' ? 'transparent' : `color-mix(in srgb, var(--color-prompt-${part.tone}) ${part.opacity * 100}%, transparent)`}>{part.text}</span>{/each}{'\u200b'}</div>
    </div>
    <textarea {...attributes} bind:this={input} {value} oninput={edit} use:tagAutocomplete={tagSettings}
        onscroll={event => { syncViewport(); onscroll?.(event) }}></textarea>
</div>

<style>
    .prompt-input { position: relative; width: 100%; min-width: 0; background: var(--color-bgcolor); border-radius: calc(var(--risu-radius-lg) * 0.8); }
    textarea, .content { box-sizing: border-box; padding: .6rem; font: inherit; line-height: 1.55; letter-spacing: inherit; tab-size: 8; white-space: pre-wrap; overflow-wrap: break-word; word-break: normal; }
    textarea { position: relative; display: block; width: 100%; min-width: 0; min-height: 4rem; margin: 0; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.8); background: transparent; color: var(--color-textcolor); resize: vertical; }
    textarea:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .mirror { position: absolute; overflow: hidden; pointer-events: none; color: transparent; }
    .content { min-height: 100%; }
    .content.nowrap, textarea[wrap='off'] { white-space: pre; overflow-wrap: normal; }
    @media (forced-colors: active) { .mirror { display: none; } }
</style>
