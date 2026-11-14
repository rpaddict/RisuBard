<script lang="ts">
    import { BookOpenIcon, ChevronDownIcon, ChevronUpIcon, LockKeyholeIcon, Trash2Icon } from '@lucide/svelte'
    import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
    import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte'
    import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import TextAreaInput from 'src/lib/UI/GUI/TextAreaInput.svelte'
    import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
    import { language } from 'src/lang'
    import type { WikiPromptBlock } from 'src/ts/risubard/wikiPromptPreset'

    let {
        block = $bindable(),
        onRemove,
        moveUp,
        moveDown,
        displayName,
        onHelp,
        canRemove = block.type === 'text' && block.id !== 'main-wiki-guide',
        canToggle = false,
        onToggle = () => {},
    }: {
        block: WikiPromptBlock
        onRemove: () => void
        moveUp: () => void
        moveDown: () => void
        displayName: string
        onHelp?: () => void
        canRemove?: boolean
        canToggle?: boolean
        onToggle?: () => void
    } = $props()

    function setRole(value: string) {
        if (value === 'user' || value === 'bot') block.role = value
        else delete block.role
    }

    $effect(() => {
        if (block.type === 'text' && typeof block.content !== 'string') {
            block.content = ''
        }
    })
</script>

<article
    data-wiki-prompt-block
    data-readonly={block.readonly}
    class:locked={block.readonly}
>
    <header>
        <div class="block-title">
            {#if block.readonly}<LockKeyholeIcon size={15} />{/if}
            {#if block.readonly || block.type !== 'text'}
                <strong class:critical={block.type === 'core-ref'}>{displayName}</strong>
            {:else}
                <TextInput bind:value={block.name} fullwidth />
            {/if}
        </div>
        {#if !block.readonly}
            <div class="block-actions">
                <ShButton variant="ghost" size="icon-sm" onclick={moveUp} aria-label={language.risuBardWikiPrompt.moveUp}>
                    <ChevronUpIcon size={16} />
                </ShButton>
                <ShButton variant="ghost" size="icon-sm" onclick={moveDown} aria-label={language.risuBardWikiPrompt.moveDown}>
                    <ChevronDownIcon size={16} />
                </ShButton>
                {#if canRemove}
                    <ShButton variant="destructive" size="icon-sm" onclick={onRemove} aria-label={language.risuBardWikiPrompt.remove}>
                        <Trash2Icon size={15} />
                    </ShButton>
                {/if}
            </div>
        {/if}
    </header>

    {#if block.readonly}
        {#if block.type !== 'text'}
            <p class="locked-copy">
                {block.type === 'injection'
                    ? language.risuBardWikiPrompt.lockedInjectionDescription
                    : language.risuBardWikiPrompt.lockedCoreDescription}
            </p>
        {/if}
        {#if canToggle}
            <div class="block-options">
                <CheckInput bind:check={block.enabled} name={language.risuBardWikiPrompt.enabled} onChange={onToggle} />
            </div>
        {/if}
        <TextAreaInput
            bind:value={block.content}
            fullwidth
            height="24"
            autocomplete="off"
            readonly={block.readonly}
            resizable
            actionBar={false}
        />
    {:else}
        <div class="block-options">
            <CheckInput bind:check={block.enabled} name={language.risuBardWikiPrompt.enabled} />
            <div class="target-controls">
                {#if onHelp}
                    <ShButton variant="outline" size="sm" onclick={onHelp}>
                        <BookOpenIcon size={15} />
                        {language.risuBardWikiPrompt.promptingHelp}
                    </ShButton>
                {/if}
                <SelectInput bind:value={block.target} size="sm">
                    <OptionInput value="both">{language.risuBardWikiPrompt.stageBoth}</OptionInput>
                    <OptionInput value="analysis">{language.risuBardWikiPrompt.stageAnalysis}</OptionInput>
                    <OptionInput value="canonical-rewrite">{language.risuBardWikiPrompt.stageCanonicalRewrite}</OptionInput>
                    <OptionInput value="response">{language.risuBardWikiPrompt.stageResponse}</OptionInput>
                </SelectInput>
                {#if block.target !== 'response'}
                    <SelectInput
                        value={block.role ?? 'system'}
                        size="sm"
                        ariaLabel={language.role}
                        onchange={(event) => setRole(event.currentTarget.value)}
                    >
                        <OptionInput value="system">{language.systemPrompt}</OptionInput>
                        <OptionInput value="user">{language.user}</OptionInput>
                        <OptionInput value="bot">{language.character}</OptionInput>
                    </SelectInput>
                {/if}
            </div>
        </div>
        {#if block.target !== 'response' && (block.role === 'user' || block.role === 'bot')}
            <p class="role-hint">{language.risuBardWikiPrompt.roleMessageHint}</p>
        {/if}
        <TextAreaInput
            bind:value={block.content}
            fullwidth
            height="32"
            autocomplete="off"
            placeholder={language.risuBardWikiPrompt.blockPlaceholder}
            readonly={block.readonly}
            resizable
        />
    {/if}
</article>

<style>
    article {
        padding: 1rem;
        border-top: 1px solid var(--settings-border, var(--risu-theme-darkborderc));
        background: transparent;
    }

    article:first-child {
        border-top: 0;
    }

    article.locked {
        background: color-mix(in srgb, var(--risu-theme-darkbg) 82%, transparent);
    }

    header,
    .block-title,
    .block-actions,
    .block-options {
        display: flex;
        align-items: center;
    }

    .target-controls {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: .5rem;
    }

    header {
        justify-content: space-between;
        gap: .8rem;
    }

    .block-title {
        min-width: 0;
        flex: 1;
        gap: .5rem;
    }

    .block-title strong {
        font-size: .84rem;
        font-weight: 620;
    }

    .block-title strong.critical {
        color: var(--risu-theme-draculared);
    }

    .block-actions {
        gap: .25rem;
    }

    .block-options {
        justify-content: space-between;
        gap: .8rem;
        margin: .8rem 0;
    }

    .role-hint {
        margin: -.35rem 0 .7rem;
        color: var(--risu-theme-textcolor2);
        font-size: .75rem;
        line-height: 1.45;
    }

    .locked-copy {
        margin: .45rem 0 0 1.45rem;
        color: var(--risu-theme-textcolor2);
        font-size: .75rem;
        line-height: 1.45;
    }

    .locked-copy + :global(div) {
        margin-top: .65rem;
    }

    @media (max-width: 620px) {
        .block-options {
            align-items: flex-start;
            flex-direction: column;
        }

        .target-controls {
            width: 100%;
            flex-wrap: wrap;
            justify-content: flex-start;
        }
    }
</style>
