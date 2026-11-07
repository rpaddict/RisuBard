<script lang="ts">
    import { FileWarningIcon, ChevronRightIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import { externalChangeReview, chooseExternalChangeDecision } from 'src/ts/storage/externalChangeReview.svelte'
    import { lineDiff } from 'src/ts/storage/externalChangeDiff'

    const pending = $derived(externalChangeReview.pending)
    const hasErrors = $derived((pending?.errors.length ?? 0) > 0)
    let opened = $state<Record<string, boolean>>({})

    $effect(() => {
        // Show the first difference without an extra click.
        const first = pending?.changes[0]
        opened = first ? { [first.fields[0] ? `${first.id}:f:${first.fields[0].field}` : `${first.id}:l:0`]: true } : {}
    })

    const kindLabels = $derived<Record<string, string>>({
        character: language.externalChangeCharacter,
        lorebook: language.externalChangeLorebook,
        settings: language.externalChangeSettings,
        secrets: language.externalChangeSecrets,
        preset: language.externalChangePreset,
        module: language.externalChangeModule,
        persona: language.externalChangePersona,
        chat: language.externalChangeChat,
        file: language.externalChangeFile,
    })
    const statusLabels = $derived<Record<string, string>>({
        added: language.externalChangeAdded,
        removed: language.externalChangeRemoved,
        changed: language.externalChangeModified,
    })

    function toggle(key: string) {
        opened = { ...opened, [key]: !opened[key] }
    }
</script>

{#snippet diffView(before: string, after: string)}
    <div class="diff" role="group" aria-label="{language.externalChangeAppSide} → {language.externalChangeFileSide}">
        <div class="diff-legend">
            <span class="del">− {language.externalChangeAppSide}</span>
            <span class="add">+ {language.externalChangeFileSide}</span>
        </div>
        <pre>{#each lineDiff(before, after) as line}{#if line.type === 'skip'}<span class="skip">⋯ {language.externalChangeSkipped(Number(line.text))}</span>{:else}<span class={line.type}>{line.type === 'add' ? '+ ' : line.type === 'del' ? '− ' : '  '}{line.text}</span>{/if}{/each}</pre>
    </div>
{/snippet}

{#snippet item(key: string, label: string, kind: 'field' | 'add' | 'del' | 'mod', before: string, after: string)}
    <li class="item {kind}">
        <button type="button" class="item-head" aria-expanded={!!opened[key]} onclick={() => toggle(key)}>
            <ChevronRightIcon size={14} class="chevron {opened[key] ? 'open' : ''}" />
            <span class="item-label">{label}</span>
        </button>
        {#if opened[key]}
            {@render diffView(before, after)}
        {/if}
    </li>
{/snippet}

<ShDialog
    open={!!pending}
    size="xl"
    tier="top"
    closable={false}
    closeOnOutsideClick={false}
    closeOnEscape={false}
    ariaLabel={language.externalChangeReviewTitle}
>
    {#snippet title()}
        <span class="title"><FileWarningIcon size={20} />{language.externalChangeReviewTitle}</span>
    {/snippet}
    {#snippet description()}
        {language.externalChangeReviewDesc}
    {/snippet}

    {#if pending}
        <div class="review">
            {#each pending.errors as error (error.path)}
                <section class="entity invalid" role="alert">
                    <code>{error.path}</code>
                    <p>{error.error}</p>
                </section>
            {/each}
            {#if hasErrors}<p class="note danger">{language.externalChangeInvalid}</p>{/if}

            {#each pending.changes as change (change.kind + change.id)}
                <section class="entity">
                    <header>
                        <span class="badge">{kindLabels[change.kind] ?? change.kind}</span>
                        {#if change.name}<strong>{change.name}</strong>{/if}
                        <code>{change.path}</code>
                    </header>
                    {#if change.status && !change.fields.length && !change.lore}
                        <p class="note {change.status === 'removed' ? 'danger' : ''}">{statusLabels[change.status]}</p>
                    {/if}
                    {#if change.fields.length}
                        <h3>{language.externalChangeFields}</h3>
                        <ul>
                            {#each change.fields as field (field.field)}
                                {@render item(`${change.id}:f:${field.field}`, field.field, 'field', field.before, field.after)}
                            {/each}
                        </ul>
                    {/if}
                    {#if change.lore}
                        {#if change.lore.changed.length}
                            <h3>{language.externalChangeLoreChanged}</h3>
                            <ul>
                                {#each change.lore.changed as lore, index (lore.id)}
                                    {@render item(`${change.id}:l:${index}`, lore.name, 'mod', lore.before ?? '', lore.after ?? '')}
                                {/each}
                            </ul>
                        {/if}
                        {#if change.lore.added.length}
                            <h3>{language.externalChangeLoreAdded}</h3>
                            <ul>
                                {#each change.lore.added as lore (lore.id)}
                                    {@render item(`${change.id}:a:${lore.id}`, lore.name, 'add', '', lore.after ?? '')}
                                {/each}
                            </ul>
                        {/if}
                        {#if change.lore.removed.length}
                            <h3>{language.externalChangeLoreRemoved}</h3>
                            <ul>
                                {#each change.lore.removed as lore (lore.id)}
                                    {@render item(`${change.id}:r:${lore.id}`, lore.name, 'del', lore.before ?? '', '')}
                                {/each}
                            </ul>
                        {/if}
                    {/if}
                </section>
            {/each}

            {#if !pending.changes.length && !hasErrors}
                <p class="note">{language.externalChangeNoDetails}</p>
            {/if}

            <div class="choices">
                <p>{language.externalChangeKeepHint}</p>
                <p>{pending.reloadOnAccept ? language.externalChangeAcceptReloadHint : language.externalChangeAcceptHint}</p>
            </div>
            {#if externalChangeReview.error}
                <p class="note danger" role="alert">{language.externalChangeFailed}: {externalChangeReview.error}</p>
            {/if}
        </div>
    {/if}

    {#snippet footer()}
        <ShButton variant="outline" disabled={externalChangeReview.busy} onclick={() => chooseExternalChangeDecision('keep')}>
            {language.externalChangeKeep}
        </ShButton>
        <ShButton variant="primary" disabled={externalChangeReview.busy || hasErrors} onclick={() => chooseExternalChangeDecision('accept')}>
            {language.externalChangeAccept}
        </ShButton>
    {/snippet}
</ShDialog>

<style>
    .title { display: inline-flex; align-items: center; gap: .5rem; }
    .title :global(svg) { color: var(--color-warning, var(--color-primary)); flex: 0 0 auto; }
    .review { display: grid; gap: .75rem; }
    .entity { display: grid; gap: .5rem; padding: .75rem .9rem; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-xl); background: color-mix(in srgb, var(--color-darkbutton) 40%, transparent); min-width: 0; }
    .entity.invalid { border-color: color-mix(in srgb, var(--color-danger) 50%, var(--color-darkborderc)); }
    .entity.invalid p { margin: 0; color: var(--color-danger); font-size: .85rem; overflow-wrap: anywhere; }
    header { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem; min-width: 0; }
    header strong { color: var(--color-textcolor); font-size: 1rem; }
    code { color: var(--color-textcolor2); font-size: .75rem; overflow-wrap: anywhere; }
    .badge { padding: .1rem .45rem; border-radius: 999px; font-size: .72rem; color: var(--color-textcolor2); border: 1px solid var(--color-darkborderc); }
    h3 { margin: .25rem 0 0; font-size: .78rem; font-weight: 600; color: var(--color-textcolor2); }
    ul { display: grid; gap: .25rem; margin: 0; padding: 0; list-style: none; }
    .item-head { display: flex; align-items: center; gap: .35rem; width: 100%; min-height: 2rem; padding: .2rem .4rem; border-radius: calc(var(--risu-radius-lg) * 0.8); color: var(--color-textcolor); text-align: left; font-size: .88rem; }
    .item-head:hover { background: color-mix(in srgb, var(--color-selected) 35%, transparent); }
    .item-head :global(.chevron) { transition: transform .15s ease; color: var(--color-textcolor2); }
    .item-head :global(.chevron.open) { transform: rotate(90deg); }
    .item-label { min-width: 0; overflow-wrap: anywhere; }
    .item.add .item-label { color: var(--color-success); }
    .item.del .item-label { color: var(--color-danger); }
    .diff { margin: .25rem 0 .35rem 1.2rem; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); overflow: hidden; }
    .diff-legend { display: flex; gap: 1rem; padding: .3rem .6rem; font-size: .72rem; border-bottom: 1px solid var(--color-darkborderc); color: var(--color-textcolor2); }
    pre { margin: 0; max-height: 18rem; overflow: auto; padding: .4rem 0; font-size: .78rem; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
    pre span { display: block; padding: 0 .6rem; }
    .add { color: var(--color-success); }
    pre .add { background: color-mix(in srgb, var(--color-success) 12%, transparent); }
    .del { color: var(--color-danger); }
    pre .del { background: color-mix(in srgb, var(--color-danger) 12%, transparent); }
    pre .same { color: var(--color-textcolor2); }
    pre .skip { color: var(--color-textcolor2); font-style: italic; opacity: .75; }
    .note { margin: 0; color: var(--color-textcolor2); font-size: .85rem; }
    .note.danger { color: var(--color-danger); }
    .choices { display: grid; gap: .25rem; padding-top: .25rem; border-top: 1px solid var(--color-darkborderc); }
    .choices p { margin: 0; font-size: .8rem; color: var(--color-textcolor2); line-height: 1.5; }
</style>
