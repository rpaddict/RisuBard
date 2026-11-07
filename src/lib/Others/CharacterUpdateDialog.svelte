<script lang="ts">
    import { RefreshCwIcon, ChevronRightIcon, SearchIcon, FileUpIcon, XIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import ShSelect from 'src/lib/UI/GUI/ShSelect.svelte'
    import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte'
    import { lineDiff } from 'src/ts/storage/externalChangeDiff'
    import { summarizePlan, type UpdateItem, type UpdateSide } from 'src/ts/characterUpdate'
    import {
        editableText, isEditable, loreFolderNames, updateGroupOf, updateGroupOrder, updateItemName, updateSearchText,
        updateSubgroupOf, updateValueText, type UpdateGroupId,
    } from 'src/ts/characterUpdateView'
    import {
        characterUpdateDialog as dialog, backToCharacterUpdateTargets, chooseCharacterUpdate, chooseCharacterUpdateMany,
        loadCharacterUpdateBaseFile, reviewCharacterUpdate, selectCharacterUpdateTarget, setCharacterUpdateChoice,
        setCharacterUpdateEdit, type UpdatePick,
    } from 'src/ts/characterUpdateFlow.svelte'

    const text = $derived(language.characterUpdate)
    const request = $derived(dialog.request)
    const isModule = $derived(request?.kind === 'module')
    const plan = $derived(dialog.plan)
    const counts = $derived(plan ? summarizePlan(plan, dialog.choices) : null)
    const toDecide = $derived(plan ? plan.items.filter(item => item.choice === null) : [])
    const editCount = $derived(Object.values(dialog.choices).filter(pick => pick === 'edit').length)
    const otherValue = $derived(request?.others.some(other => other.id === dialog.target) ? dialog.target : '')

    let query = $state('')
    let opened = $state<Record<string, boolean>>({})
    // Section open state the user set; unset sections follow their size.
    let sectionOpen = $state<Record<string, boolean>>({})

    $effect(() => {
        // A new comparison starts with the first item to decide open.
        const first = dialog.plan?.items.find(item => item.choice === null)
        opened = first ? { [first.id]: true } : {}
        sectionOpen = {}
    })

    function fieldLabel(field: string) {
        return text.fields[field] ?? field
    }

    // Built once per comparison: 'search' reads every value.
    const searchIndex = $derived.by(() => {
        const index = new Map<string, string>()
        for (const item of plan?.items ?? []) index.set(item.id, updateSearchText(item, fieldLabel(item.field)))
        return index
    })

    function matching(source: UpdateItem[]) {
        const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
        if (!words.length) return source
        return source.filter(item => {
            const haystack = searchIndex.get(item.id) ?? ''
            return words.every(word => haystack.includes(word))
        })
    }

    const visible = $derived(matching(dialog.showAll ? plan?.items ?? [] : toDecide))
    // Matches among items decided automatically, offered when the decide view finds none.
    const hiddenMatches = $derived(!dialog.showAll && query.trim() && !visible.length ? matching(plan?.items ?? []).length : 0)

    type Sub = { id: string, label: string, items: UpdateItem[] }
    type Section = { id: UpdateGroupId, items: UpdateItem[], subs: Sub[] }

    const sections = $derived.by(() => {
        const folders = dialog.folders.size ? dialog.folders : loreFolderNames()
        const byGroup = new Map<UpdateGroupId, Section>()
        for (const item of visible) {
            const group = updateGroupOf(item)
            let section = byGroup.get(group)
            if (!section) byGroup.set(group, section = { id: group, items: [], subs: [] })
            section.items.push(item)
            const sub = updateSubgroupOf(item, folders, text.fields)
            let bucket = section.subs.find(entry => entry.id === sub.id)
            if (!bucket) section.subs.push(bucket = { id: sub.id, label: sub.label, items: [] })
            bucket.items.push(item)
        }
        return updateGroupOrder.map(id => byGroup.get(id)).filter((section): section is Section => !!section)
    })

    function subLabel(section: Section, sub: Sub) {
        if (sub.label) return sub.label
        if (section.id === 'lore') return sub.id === 'settings' ? text.loreSettingsGroup : text.loreRootGroup
        return ''
    }

    function isOpen(id: string, size: number) {
        // Searching opens everything it found; otherwise big sections start folded.
        return sectionOpen[id] ?? (query.trim() !== '' || size <= 20)
    }

    function toggleSection(id: string, size: number) {
        sectionOpen = { ...sectionOpen, [id]: !isOpen(id, size) }
    }

    function toggle(id: string) {
        opened = { ...opened, [id]: !opened[id] }
    }

    function pickOf(item: UpdateItem): UpdatePick | null {
        return dialog.choices[item.id] ?? item.choice
    }

    function pick(item: UpdateItem, value: UpdatePick) {
        setCharacterUpdateChoice(item.id, value)
        if (value === 'edit') opened = { ...opened, [item.id]: true }
    }

    function unresolvedIn(items: UpdateItem[]) {
        return items.filter(item => !pickOf(item)).length
    }

    function chooseScope(items: UpdateItem[], side: UpdateSide) {
        chooseCharacterUpdateMany(items.map(item => item.id), side)
    }

    const summaryKeys = ['update', 'mine', 'added', 'removed', 'mineOnly', 'conflict', 'differs'] as const
</script>

{#snippet diffView(before: string, after: string, minus: string, plus: string)}
    <div class="diff" role="group" aria-label="{minus} → {plus}">
        <div class="diff-legend">
            <span class="del">− {minus}</span>
            <span class="add">+ {plus}</span>
        </div>
        {#if !before && !after}
            <p class="note pad">{text.absent}</p>
        {:else}
            <pre>{#each lineDiff(before, after) as line}{#if line.type === 'skip'}<span class="skip">⋯ {language.externalChangeSkipped(Number(line.text))}</span>{:else}<span class={line.type}>{line.type === 'add' ? '+ ' : line.type === 'del' ? '− ' : '  '}{line.text}</span>{/if}{/each}</pre>
        {/if}
    </div>
{/snippet}

{#snippet scopeButtons(items: UpdateItem[], label: string)}
    <span class="scope" role="group" aria-label={label}>
        <button type="button" onclick={() => chooseScope(items, 'mine')}>{text.scopeMine}</button>
        <button type="button" onclick={() => chooseScope(items, 'theirs')}>{text.scopeTheirs}</button>
    </span>
{/snippet}

{#snippet itemView(item: UpdateItem)}
    {@const current = pickOf(item)}
    {@const name = updateItemName(item)}
    {@const editable = isEditable(item)}
    <li class="item" class:pending={!current}>
        <div class="item-row">
            <button type="button" class="item-head" aria-expanded={!!opened[item.id]} onclick={() => toggle(item.id)}>
                <ChevronRightIcon size={14} class="chevron {opened[item.id] ? 'open' : ''}" />
                {#if !current}<span class="pending-dot" title={text.pendingMark}></span>{/if}
                {#if item.key}<span class="item-name">{name || text.unnamed}</span>{:else}<span class="field">{fieldLabel(item.field)}</span>{/if}
                <span class="status {item.status}">{text.status[item.status]}</span>
            </button>
            <span class="choice" role="radiogroup" aria-label={name || fieldLabel(item.field)}>
                <button type="button" role="radio" aria-checked={current === 'mine'} class:on={current === 'mine'} onclick={() => pick(item, 'mine')}>{text.keepMine}</button>
                <button type="button" role="radio" aria-checked={current === 'theirs'} class:on={current === 'theirs'} onclick={() => pick(item, 'theirs')}>{text.takeTheirs}</button>
                {#if editable}
                    <button type="button" role="radio" aria-checked={current === 'edit'} class:on={current === 'edit'} onclick={() => pick(item, 'edit')}>{text.editOwn}</button>
                {/if}
            </span>
        </div>
        {#if opened[item.id]}
            <div class="detail">
                {#if item.baseKnown && item.theirs !== undefined}
                    <h4>{text.authorChange}</h4>
                    {#if updateValueText(item.base) === updateValueText(item.theirs)}
                        <p class="note">{text.authorUnchanged}</p>
                    {:else}
                        {@render diffView(updateValueText(item.base), updateValueText(item.theirs), text.oldSource, text.newSource)}
                    {/if}
                {/if}
                <h4>{text.mineVsTheirs}</h4>
                {@render diffView(updateValueText(item.mine), updateValueText(item.theirs), text.mineSide, text.theirsSide)}
                {#if current === 'edit'}
                    <div class="editor">
                        <div class="editor-head">
                            <h4>{text.editHeading}</h4>
                            <span class="editor-actions">
                                <button type="button" onclick={() => setCharacterUpdateEdit(item.id, editableText(item, 'mine'))}>{text.editFromMine}</button>
                                <button type="button" onclick={() => setCharacterUpdateEdit(item.id, editableText(item, 'theirs'))}>{text.editFromTheirs}</button>
                            </span>
                        </div>
                        <textarea
                            aria-label={text.editHeading}
                            rows={Math.min(16, Math.max(5, (dialog.edits[item.id] ?? '').split('\n').length + 1))}
                            value={dialog.edits[item.id] ?? ''}
                            oninput={(event) => setCharacterUpdateEdit(item.id, event.currentTarget.value)}
                        ></textarea>
                    </div>
                {/if}
            </div>
        {/if}
    </li>
{/snippet}

<ShDialog
    open={!!request}
    size={dialog.step === 'review' ? 'xl' : 'lg'}
    tier="top"
    closable={false}
    closeOnOutsideClick={false}
    closeOnEscape={false}
    ariaLabel={text.title}
>
    {#snippet title()}
        <span class="title"><RefreshCwIcon size={20} />{dialog.step === 'review' ? text.reviewTitle(dialog.targetName) : isModule ? text.moduleTitle : text.title}</span>
    {/snippet}
    {#snippet description()}
        {#if request}
            {dialog.step === 'review' ? text.reviewDescription : isModule ? text.moduleDescription(request.incomingName) : text.description(request.incomingName)}
        {/if}
    {/snippet}

    {#if request && dialog.step === 'choose'}
        <div class="body">
            <h3>{isModule ? text.moduleCandidates : text.candidates}</h3>
            <div class="candidates" role="radiogroup" aria-label={text.candidates}>
                {#each request.candidates as candidate (candidate.id)}
                    <button
                        type="button"
                        role="radio"
                        aria-checked={dialog.target === candidate.id}
                        class="candidate"
                        class:selected={dialog.target === candidate.id}
                        disabled={dialog.busy}
                        onclick={() => selectCharacterUpdateTarget(candidate.id)}
                    >
                        <span class="dot" aria-hidden="true"></span>
                        <span class="candidate-main">
                            <strong>{candidate.name || text.unnamed}</strong>
                            <span class="meta">
                                <span class="badge {candidate.reason}">{isModule && candidate.reason === 'lineage' ? text.moduleLineage : text.reasons[candidate.reason]}</span>
                                {#if candidate.sameCreator && candidate.reason !== 'content'}<span class="badge">{text.sameCreator}</span>{/if}
                                <span>{isModule ? text.loreEntries(candidate.count) : text.chats(candidate.count)}</span>
                            </span>
                        </span>
                    </button>
                {/each}
            </div>
            {#if request.others.length}
                <label class="other">
                    <span>{isModule ? text.moduleOther : text.other}</span>
                    <ShSelect value={otherValue} ariaLabel={isModule ? text.moduleOther : text.other} onchange={(event) => { if (event.currentTarget.value) selectCharacterUpdateTarget(event.currentTarget.value) }}>
                        <OptionInput value="">{isModule ? text.moduleOtherPlaceholder : text.otherPlaceholder}</OptionInput>
                        {#each request.others as other (other.id)}
                            <OptionInput value={other.id}>{other.name || text.unnamed}</OptionInput>
                        {/each}
                    </ShSelect>
                </label>
            {/if}
            {#if dialog.error}<p class="note danger" role="alert">{dialog.error}</p>{/if}
        </div>
    {:else if request && plan && counts}
        <div class="body">
            {#if dialog.baseSource.kind === 'none'}
                <div class="notice">
                    <p>{text.noBase}</p>
                    <ShButton size="sm" variant="outline" disabled={dialog.busy} onclick={() => loadCharacterUpdateBaseFile()}><FileUpIcon size={16} />{text.loadBaseFile}</ShButton>
                </div>
            {:else if dialog.baseSource.kind === 'file'}
                <div class="base-file">
                    <span>{text.baseFromFile(dialog.baseSource.name ?? '')}</span>
                    <button type="button" class="link" disabled={dialog.busy} onclick={() => loadCharacterUpdateBaseFile()}>{text.loadOtherBaseFile}</button>
                </div>
            {/if}

            {#if plan.items.length}
                <ul class="summary">
                    {#each summaryKeys as key}
                        {#if counts[key]}<li class="chip {key}">{text.summary[key]} <b>{counts[key]}</b></li>{/if}
                    {/each}
                    {#if editCount}<li class="chip edit">{text.summaryEdited} <b>{editCount}</b></li>{/if}
                </ul>

                <div class="toolbar">
                    <label class="search">
                        <SearchIcon size={16} aria-hidden="true" />
                        <input type="search" bind:value={query} placeholder={text.searchPlaceholder} aria-label={text.searchPlaceholder} />
                        {#if query}<button type="button" class="clear" aria-label={text.clearSearch} onclick={() => { query = '' }}><XIcon size={14} /></button>{/if}
                    </label>
                    <span class="view" role="radiogroup" aria-label={text.viewLabel}>
                        <button type="button" role="radio" aria-checked={!dialog.showAll} class:on={!dialog.showAll} onclick={() => { dialog.showAll = false }}>{text.viewDecide(toDecide.length)}</button>
                        <button type="button" role="radio" aria-checked={dialog.showAll} class:on={dialog.showAll} onclick={() => { dialog.showAll = true }}>{text.viewAll(plan.items.length)}</button>
                    </span>
                </div>

                <div class="decide-bar">
                    {#if toDecide.length}
                        <strong class:done={counts.unresolved === 0}>{text.decideCount(counts.unresolved)}</strong>
                    {:else}
                        <span class="note">{text.nothingToDecide}</span>
                    {/if}
                    {#if visible.length}
                        <span class="bulk">
                            <span class="bulk-label">{query.trim() ? text.bulkFound(visible.length) : text.bulkShown(visible.length)}</span>
                            {@render scopeButtons(visible, text.bulkShown(visible.length))}
                        </span>
                    {/if}
                </div>

                {#if !visible.length}
                    <div class="empty">
                        <p class="note">{query.trim() ? text.noMatches : text.nothingToDecide}</p>
                        {#if hiddenMatches}<button type="button" class="link" onclick={() => { dialog.showAll = true }}>{text.showHiddenMatches(hiddenMatches)}</button>{/if}
                    </div>
                {/if}

                {#each sections as section (section.id)}
                    {@const sectionKey = `g:${section.id}`}
                    {@const sectionShown = isOpen(sectionKey, section.items.length)}
                    {@const left = unresolvedIn(section.items)}
                    <section class="group">
                        <div class="group-head">
                            <button type="button" class="group-toggle" aria-expanded={sectionShown} onclick={() => toggleSection(sectionKey, section.items.length)}>
                                <ChevronRightIcon size={16} class="chevron {sectionShown ? 'open' : ''}" />
                                <span class="group-name">{text.groups[section.id]}</span>
                                <span class="count">{section.items.length}</span>
                                {#if left}<span class="left">{text.leftCount(left)}</span>{/if}
                            </button>
                            {@render scopeButtons(section.items, text.groups[section.id])}
                        </div>
                        {#if sectionShown}
                            {#each section.subs as sub (sub.id)}
                                {@const label = subLabel(section, sub)}
                                {#if label && (section.subs.length > 1 || sub.id.startsWith('folder:'))}
                                    {@const subKey = `s:${section.id}:${sub.id}`}
                                    {@const subShown = isOpen(subKey, sub.items.length)}
                                    {@const subLeft = unresolvedIn(sub.items)}
                                    <div class="sub">
                                        <div class="sub-head">
                                            <button type="button" class="group-toggle" aria-expanded={subShown} onclick={() => toggleSection(subKey, sub.items.length)}>
                                                <ChevronRightIcon size={14} class="chevron {subShown ? 'open' : ''}" />
                                                <span class="sub-name">{label}</span>
                                                <span class="count">{sub.items.length}</span>
                                                {#if subLeft}<span class="left">{text.leftCount(subLeft)}</span>{/if}
                                            </button>
                                            {@render scopeButtons(sub.items, label)}
                                        </div>
                                        {#if subShown}
                                            <ul class="items">{#each sub.items as item (item.id)}{@render itemView(item)}{/each}</ul>
                                        {/if}
                                    </div>
                                {:else}
                                    <ul class="items">{#each sub.items as item (item.id)}{@render itemView(item)}{/each}</ul>
                                {/if}
                            {/each}
                        {/if}
                    </section>
                {/each}
            {:else}
                <p class="note">{isModule ? text.moduleNoChanges : text.noChanges}</p>
            {/if}

            <p class="note foot">{isModule ? text.moduleBackupNote : text.backupNote}</p>
            {#if dialog.targetBusy}<p class="note danger" role="alert">{text.busy}</p>{/if}
            {#if dialog.error}<p class="note danger" role="alert">{dialog.error}</p>{/if}
        </div>
    {/if}

    {#snippet footer()}
        {#if dialog.step === 'choose'}
            <ShButton variant="ghost" disabled={dialog.busy} onclick={() => chooseCharacterUpdate('cancel')}>{text.cancel}</ShButton>
            <ShButton variant="outline" disabled={dialog.busy} onclick={() => chooseCharacterUpdate('new')}>{isModule ? text.installNewModule : text.installNew}</ShButton>
            <ShButton variant="primary" disabled={dialog.busy || !dialog.target} onclick={() => reviewCharacterUpdate()}>{text.next}</ShButton>
        {:else}
            <!-- No "install as new" here: it would sit where "Next" was, so a double click would pick it. -->
            <ShButton variant="outline" onclick={() => backToCharacterUpdateTargets()}>{text.back}</ShButton>
            <ShButton variant="primary" disabled={!counts || counts.unresolved > 0 || dialog.targetBusy || dialog.busy} onclick={() => chooseCharacterUpdate('update')}>{text.update}</ShButton>
        {/if}
    {/snippet}
</ShDialog>

<style>
    .title { display: inline-flex; align-items: center; gap: .5rem; }
    .title :global(svg) { color: var(--color-primary); flex: 0 0 auto; }
    .body { display: grid; gap: .75rem; min-width: 0; }
    h3 { margin: 0; font-size: .8rem; font-weight: 600; color: var(--color-textcolor2); }
    h4 { margin: .35rem 0 .25rem; font-size: .76rem; font-weight: 600; color: var(--color-textcolor2); }
    .candidates { display: grid; gap: .4rem; }
    .candidate { display: flex; align-items: center; gap: .7rem; width: 100%; padding: .65rem .8rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 1.3); text-align: left; color: var(--color-textcolor); background: color-mix(in srgb, var(--color-darkbutton) 35%, transparent); }
    .candidate:hover { border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-darkborderc)); }
    .candidate.selected { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, transparent); }
    .dot { flex: 0 0 auto; width: 1rem; height: 1rem; border-radius: 999px; border: 2px solid var(--color-textcolor2); }
    .candidate.selected .dot { border-color: var(--color-primary); box-shadow: inset 0 0 0 3px var(--color-bgcolor, transparent); background: var(--color-primary); }
    .candidate-main { display: grid; gap: .25rem; min-width: 0; }
    .candidate-main strong { font-size: .98rem; overflow-wrap: anywhere; }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; font-size: .78rem; color: var(--color-textcolor2); }
    .badge { padding: .08rem .45rem; border-radius: 999px; border: 1px solid var(--color-darkborderc); }
    .badge.realm, .badge.lineage { color: var(--color-success); border-color: color-mix(in srgb, var(--color-success) 45%, var(--color-darkborderc)); }
    .other { display: grid; gap: .35rem; font-size: .8rem; font-weight: 600; color: var(--color-textcolor2); }
    .notice { display: grid; justify-items: start; gap: .55rem; padding: .7rem .85rem; border-radius: calc(var(--risu-radius-lg) * 1.2); border: 1px solid color-mix(in srgb, var(--color-warning, var(--color-primary)) 45%, var(--color-darkborderc)); background: color-mix(in srgb, var(--color-warning, var(--color-primary)) 10%, transparent); }
    .notice p { margin: 0; font-size: .85rem; line-height: 1.55; color: var(--color-textcolor); }
    .base-file { display: flex; flex-wrap: wrap; align-items: baseline; gap: .6rem; font-size: .84rem; color: var(--color-textcolor); }
    .summary { display: flex; flex-wrap: wrap; gap: .4rem; margin: 0; padding: 0; list-style: none; }
    .chip { padding: .2rem .6rem; border-radius: 999px; font-size: .8rem; color: var(--color-textcolor2); border: 1px solid var(--color-darkborderc); }
    .chip b { color: var(--color-textcolor); margin-left: .15rem; font-variant-numeric: tabular-nums; }
    .chip.conflict, .chip.differs { color: var(--color-warning, var(--color-danger)); border-color: color-mix(in srgb, var(--color-warning, var(--color-danger)) 45%, var(--color-darkborderc)); }
    .chip.edit { color: var(--color-primary); border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-darkborderc)); }
    .toolbar { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
    .search { flex: 1 1 16rem; display: flex; align-items: center; gap: .45rem; min-height: 2.5rem; padding: 0 .7rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 1.1); background: var(--color-bgcolor); color: var(--color-textcolor2); }
    .search:focus-within { border-color: var(--color-primary); }
    .search input { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: var(--color-textcolor); font-size: .9rem; }
    .search input::placeholder { color: var(--color-textcolor2); }
    .search input::-webkit-search-cancel-button { display: none; }
    .clear { display: inline-flex; padding: .2rem; border-radius: calc(var(--risu-radius-sm) * 1.2); color: var(--color-textcolor2); }
    .clear:hover { color: var(--color-textcolor); }
    .view, .choice, .scope { display: inline-flex; flex: 0 0 auto; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); overflow: hidden; }
    .view button, .choice button, .scope button { min-height: 2.25rem; padding: .2rem .7rem; font-size: .8rem; color: var(--color-textcolor2); white-space: nowrap; }
    .scope button { min-height: 1.9rem; padding: .1rem .55rem; font-size: .76rem; }
    .view button + button, .choice button + button, .scope button + button { border-left: 1px solid var(--color-darkborderc); }
    .view button:hover, .choice button:hover, .scope button:hover { color: var(--color-textcolor); background: color-mix(in srgb, var(--color-selected) 35%, transparent); }
    .view button.on, .choice button.on { color: var(--color-textcolor); background: color-mix(in srgb, var(--color-primary) 22%, transparent); font-weight: 600; }
    .decide-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; }
    .decide-bar strong { font-size: .92rem; color: var(--color-warning, var(--color-danger)); font-variant-numeric: tabular-nums; }
    .decide-bar strong.done { color: var(--color-success); }
    .bulk { display: inline-flex; align-items: center; gap: .5rem; }
    .bulk-label { font-size: .78rem; color: var(--color-textcolor2); }
    .group { display: grid; gap: .25rem; padding-top: .35rem; border-top: 1px solid var(--color-darkborderc); }
    .group-head, .sub-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .4rem; }
    .group-toggle { display: inline-flex; align-items: center; gap: .45rem; min-height: 2.25rem; padding: .2rem .35rem; border-radius: calc(var(--risu-radius-lg) * 0.8); color: var(--color-textcolor); text-align: left; }
    .group-toggle:hover { background: color-mix(in srgb, var(--color-selected) 35%, transparent); }
    .group-toggle :global(.chevron), .item-head :global(.chevron) { flex: 0 0 auto; transition: transform .15s ease; color: var(--color-textcolor2); }
    .group-toggle :global(.chevron.open), .item-head :global(.chevron.open) { transform: rotate(90deg); }
    .group-name { font-size: .95rem; font-weight: 650; }
    .sub { display: grid; gap: .2rem; margin-left: 1.1rem; }
    .sub-name { font-size: .86rem; font-weight: 600; }
    .count { font-size: .76rem; color: var(--color-textcolor2); font-variant-numeric: tabular-nums; }
    .left { font-size: .74rem; color: var(--color-warning, var(--color-danger)); font-variant-numeric: tabular-nums; }
    .items { display: grid; margin: 0 0 .25rem 1.1rem; padding: 0; list-style: none; }
    .item { padding: .2rem .25rem; border-bottom: 1px solid color-mix(in srgb, var(--color-darkborderc) 60%, transparent); min-width: 0; }
    .item:last-child { border-bottom: 0; }
    .pending-dot { flex: 0 0 auto; width: .45rem; height: .45rem; border-radius: 999px; background: var(--color-warning, var(--color-danger)); }
    .item-row { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; }
    .item-head { flex: 1 1 14rem; display: flex; align-items: center; gap: .4rem; min-width: 0; min-height: 2.25rem; padding: .2rem .45rem; border-radius: calc(var(--risu-radius-lg) * 0.8); color: var(--color-textcolor); text-align: left; font-size: .88rem; }
    .item-head:hover { background: color-mix(in srgb, var(--color-selected) 35%, transparent); }
    .field { flex: 0 0 auto; font-weight: 600; }
    .item-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-textcolor); }
    .status { flex: 0 0 auto; margin-left: auto; font-size: .74rem; color: var(--color-textcolor2); }
    .status.conflict, .status.differs { color: var(--color-warning, var(--color-danger)); }
    .status.added, .status.update { color: var(--color-success); }
    .status.removed { color: var(--color-danger); }
    .detail { margin: .1rem .2rem .45rem 1.4rem; }
    .diff { border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); overflow: hidden; }
    .diff-legend { display: flex; gap: 1rem; padding: .3rem .6rem; font-size: .72rem; border-bottom: 1px solid var(--color-darkborderc); color: var(--color-textcolor2); }
    pre { margin: 0; max-height: 18rem; overflow: auto; padding: .4rem 0; font-size: .78rem; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
    pre span { display: block; padding: 0 .6rem; }
    .add { color: var(--color-success); }
    pre .add { background: color-mix(in srgb, var(--color-success) 12%, transparent); }
    .del { color: var(--color-danger); }
    pre .del { background: color-mix(in srgb, var(--color-danger) 12%, transparent); }
    pre .same { color: var(--color-textcolor2); }
    pre .skip { color: var(--color-textcolor2); font-style: italic; opacity: .75; }
    .editor { display: grid; gap: .3rem; margin-top: .35rem; }
    .editor-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .4rem; }
    .editor-actions { display: inline-flex; gap: .6rem; }
    .editor-actions button { font-size: .76rem; color: var(--color-primary); text-decoration: underline; text-underline-offset: 3px; }
    textarea { width: 100%; padding: .55rem .65rem; border: 1px solid var(--color-darkborderc); border-radius: var(--risu-radius-lg); background: var(--color-bgcolor); color: var(--color-textcolor); font-size: .84rem; line-height: 1.5; resize: vertical; }
    textarea:focus { outline: none; border-color: var(--color-primary); }
    .link { justify-self: start; font-size: .82rem; color: var(--color-primary); text-decoration: underline; text-underline-offset: 3px; }
    .note { margin: 0; color: var(--color-textcolor2); font-size: .85rem; line-height: 1.5; }
    .note.pad { padding: .5rem .6rem; }
    .empty { display: grid; justify-items: center; gap: .35rem; padding: .75rem 0; }
    .empty .link { justify-self: center; }
    .note.foot { padding-top: .5rem; border-top: 1px solid var(--color-darkborderc); font-size: .8rem; }
    .note.danger { color: var(--color-danger); }
</style>
