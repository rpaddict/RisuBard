<script lang="ts">
    import { RotateCcwIcon, TriangleAlertIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { alertConfirm, notifySuccess } from 'src/ts/alert'
    import type { PromptItem } from 'src/ts/process/prompt'
    import { getPromptV2TextSource } from 'src/ts/promptV2'
    import {
        normalizeAssistantPromptOverrides,
        resolveAssistantPrompt,
        setAssistantPromptOverride,
        type AssistantPromptKey,
    } from 'src/ts/risubard/assistantPrompts'
    import { DBState } from 'src/ts/stores.svelte'
    import SettingPage from 'src/lib/UI/GUI/SettingPage.svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import PromptV2BlockEditor from './PromptPreset/PromptV2BlockEditor.svelte'

    const text = language.risuBardAssistantPrompt

    const groups: { label: string; keys: AssistantPromptKey[] }[] = [
        { label: text.promptAssistant, keys: ['promptAssistant', 'promptAssistantSelect'] },
        { label: text.characterAssistant, keys: ['characterAssistant', 'characterAssistantPlayer'] },
    ]

    // Drops stale or malformed entries saved by older versions.
    DBState.db.risuBardAssistantPrompts = normalizeAssistantPromptOverrides(DBState.db.risuBardAssistantPrompts)

    let selectedKey = $state<AssistantPromptKey>('promptAssistant')
    let editorVersion = $state(0)
    let blockEditor: PromptV2BlockEditor | undefined = $state()

    const overrides = $derived(DBState.db.risuBardAssistantPrompts ?? {})
    const selectedItem = $derived<PromptItem>({
        type: 'plain',
        type2: 'normal',
        role: 'system',
        name: text.prompts[selectedKey].name,
        text: resolveAssistantPrompt(overrides, selectedKey),
    })

    function isModified(key: AssistantPromptKey): boolean {
        return typeof overrides[key] === 'string'
    }

    function select(key: AssistantPromptKey) {
        blockEditor?.flushPendingText()
        selectedKey = key
    }

    function replace(key: AssistantPromptKey, item: PromptItem) {
        const source = getPromptV2TextSource(item)
        if (!source) return
        DBState.db.risuBardAssistantPrompts ??= {}
        setAssistantPromptOverride(DBState.db.risuBardAssistantPrompts, key, source.source)
    }

    async function resetSelected() {
        const key = selectedKey
        if (!isModified(key) || !await alertConfirm(text.resetConfirm)) return
        delete DBState.db.risuBardAssistantPrompts?.[key]
        editorVersion++
        notifySuccess(text.resetDone)
    }
</script>

<SettingPage title={text.title} description={text.description} fullWidth={true}>
    <div data-risubard-assistant-prompt-workspace class="assistant-prompt-workspace">
        <nav class="prompt-list" aria-label={text.title}>
            {#each groups as group (group.label)}
                <div class="group">
                    <span class="group-label">{group.label}</span>
                    {#each group.keys as key (key)}
                        <button
                            type="button"
                            class:selected={key === selectedKey}
                            aria-current={key === selectedKey ? 'true' : undefined}
                            onclick={() => select(key)}
                        >
                            <span class="name">{text.prompts[key].name}</span>
                            {#if isModified(key)}<span class="modified">{text.modified}</span>{/if}
                        </button>
                    {/each}
                </div>
            {/each}
        </nav>

        <section class="editor-pane">
            <header class="editor-toolbar">
                <div class="editor-info">
                    <p>{text.prompts[selectedKey].help}</p>
                    <p class="muted">{text.sentAsIs}</p>
                </div>
                <ShButton size="sm" variant="outline" onclick={resetSelected} disabled={!isModified(selectedKey)}>
                    <RotateCcwIcon size={14} />{text.resetDefault}
                </ShButton>
            </header>
            <p class="warning"><TriangleAlertIcon size={14} />{text.tagWarning}</p>
            <div class="editor-host">
                {#key `${selectedKey}:${editorVersion}`}
                    <PromptV2BlockEditor
                        bind:this={blockEditor}
                        item={selectedItem}
                        definitions={[]}
                        previewValues={{}}
                        simple
                        lockName
                        conditions={false}
                        onReplace={(item) => replace(selectedKey, item)}
                        onOpenToggleSetup={() => {}}
                    />
                {/key}
            </div>
        </section>
    </div>
</SettingPage>

<style>
    .assistant-prompt-workspace { display: grid; min-height: 36rem; height: 100%; grid-template-columns: minmax(12rem, 15rem) minmax(0, 1fr); overflow: hidden; border: 1px solid var(--color-darkborderc); border-radius: .9rem; background: var(--color-darkbg); }
    .prompt-list { display: flex; min-width: 0; flex-direction: column; gap: .75rem; overflow-y: auto; padding: .65rem; border-right: 1px solid var(--color-darkborderc); }
    .group { display: grid; gap: .2rem; }
    .group-label { padding: 0 .6rem .2rem; color: var(--color-textcolor2); font-size: .7rem; font-weight: 650; }
    .prompt-list button { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: .5rem; border-radius: .45rem; padding: .55rem .6rem; text-align: left; font-size: .85rem; }
    .prompt-list button:hover, .prompt-list button.selected { background: color-mix(in srgb, var(--color-selected) 34%, transparent); }
    .prompt-list .name { min-width: 0; overflow-wrap: anywhere; }
    .modified { flex-shrink: 0; padding: .1rem .4rem; border-radius: 999px; color: var(--color-binding-text); background: var(--color-binding); font-size: .65rem; font-weight: 650; }
    .editor-pane { display: flex; min-width: 0; min-height: 0; flex-direction: column; }
    .editor-toolbar { display: flex; flex-shrink: 0; align-items: flex-start; justify-content: space-between; gap: .75rem; padding: .65rem .75rem; border-bottom: 1px solid var(--color-darkborderc); }
    .editor-info { display: grid; min-width: 0; gap: .15rem; }
    .editor-info p { margin: 0; font-size: .8rem; line-height: 1.45; }
    .muted { color: var(--color-textcolor2); }
    .warning { display: flex; flex-shrink: 0; align-items: flex-start; gap: .4rem; margin: 0; padding: .5rem .75rem; border-bottom: 1px solid var(--color-darkborderc); color: var(--risu-theme-warning); background: var(--risu-theme-warning-bg); font-size: .75rem; line-height: 1.45; }
    .warning :global(svg) { flex-shrink: 0; margin-top: .1rem; }
    .editor-host { min-height: 0; flex: 1; }
    @media (max-width: 760px) {
        .assistant-prompt-workspace { min-height: 0; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto; align-content: start; overflow-y: auto; }
        .prompt-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); overflow: visible; border-right: 0; border-bottom: 1px solid var(--color-darkborderc); }
        .editor-host { min-height: 32rem; }
        .editor-toolbar { flex-direction: column; }
    }
</style>
