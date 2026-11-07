<script lang="ts">
    import { BookOpenIcon, CopyIcon, LockKeyholeIcon, PlusIcon } from '@lucide/svelte'
    import { v4 as uuidv4 } from 'uuid'
    import { language } from 'src/lang'
    import type { WikiPromptPreset, WikiPromptStage } from 'src/ts/risubard/wikiPromptPreset'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import RisuBardWikiPromptBlock from './RisuBardWikiPromptBlock.svelte'

    let {
        preset,
        onTouch = () => {},
        onHelp = () => {},
        onDuplicate = () => {},
    }: {
        preset: WikiPromptPreset
        onTouch?: () => void
        onHelp?: () => void
        onDuplicate?: () => void
    } = $props()

    const optionalBuiltinIds = new Set(['default-character-equipment', 'default-length-compression'])

    function displayName(id: string, name: string): string {
        return language.risuBardWikiPrompt.blockNames[id as keyof typeof language.risuBardWikiPrompt.blockNames] ?? name
    }

    function move(index: number, direction: -1 | 1) {
        const destination = index + direction
        const block = preset.blocks[index]
        const target = preset.blocks[destination]
        if (!block || !target || block.readonly || target.type === 'injection') return
        ;[preset.blocks[index], preset.blocks[destination]] = [target, block]
        onTouch()
    }

    function remove(index: number) {
        if (preset.blocks[index]?.type !== 'text' || preset.blocks[index].readonly) return
        preset.blocks.splice(index, 1)
        onTouch()
    }

    function addBlock(target: WikiPromptStage) {
        if (preset.builtin) return
        const injectionAt = preset.blocks.findIndex((block) => block.type === 'injection')
        preset.blocks.splice(injectionAt < 0 ? preset.blocks.length : injectionAt, 0, {
            id: uuidv4(),
            type: 'text',
            name: language.risuBardWikiPrompt.newBlock,
            target,
            enabled: true,
            readonly: false,
            analysisMode: 'all',
            content: '',
        })
        onTouch()
    }
</script>

<div class="wiki-v1" data-risubard-wiki-prompt-v1>
    {#if preset.builtin}
        <div class="readonly-note" role="note">
            <LockKeyholeIcon size={16} />
            <span>{language.risuBardWikiPrompt.builtinReadonly}</span>
            <ShButton size="sm" variant="outline" onclick={onDuplicate}><CopyIcon size={14} />{language.presetDuplicate}</ShButton>
        </div>
    {/if}

    <div class="block-stack" oninput={onTouch} onchange={onTouch}>
        {#each preset.blocks as block, index (block.id)}
            <RisuBardWikiPromptBlock
                bind:block={preset.blocks[index]}
                displayName={displayName(block.id, block.name)}
                canRemove={!block.readonly && block.type === 'text' && block.id !== 'main-wiki-guide'}
                canToggle={preset.builtin && optionalBuiltinIds.has(block.id)}
                moveUp={() => move(index, -1)}
                moveDown={() => move(index, 1)}
                onRemove={() => remove(index)}
            />
        {/each}
    </div>

    <div class="add-actions">
        {#if !preset.builtin}
            <ShButton variant="outline" onclick={() => addBlock('both')}><PlusIcon size={16} />{language.risuBardWikiPrompt.addBlock}</ShButton>
            <ShButton variant="outline" onclick={() => addBlock('response')}><PlusIcon size={16} />{language.risuBardWikiPrompt.addResponseBlock}</ShButton>
        {/if}
        <ShButton variant="ghost" className="help" onclick={onHelp}><BookOpenIcon size={16} />{language.risuBardWikiPrompt.promptingHelp}</ShButton>
    </div>
</div>

<style>
    .wiki-v1 { display: flex; flex-direction: column; gap: .75rem; margin-top: 1rem; }
    .readonly-note { display: flex; flex-wrap: wrap; align-items: center; gap: .55rem; padding: .7rem .9rem; border: 1px solid var(--settings-border, var(--risu-theme-darkborderc)); border-radius: var(--settings-radius, var(--risu-radius-xl)); color: var(--risu-theme-textcolor2); font-size: .82rem; }
    .readonly-note span { flex: 1 1 14rem; min-width: 0; }
    .block-stack { overflow: hidden; border: 1px solid var(--settings-border, var(--risu-theme-darkborderc)); border-radius: var(--settings-radius, var(--risu-radius-xl)); background: var(--settings-surface, var(--risu-theme-bgcolor)); }
    .add-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
    .add-actions :global(.help) { margin-left: auto; }
</style>
