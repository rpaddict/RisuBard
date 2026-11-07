<script lang="ts">
    import { language } from 'src/lang'
    import { tooltip } from 'src/ts/gui/tooltip'
    import { collectCbsVariables } from 'src/ts/gui/cbsConditionView'
    import { buildCbsVariableRows, type CbsVariableContext, type CbsVariableTarget } from 'src/ts/gui/cbsVariableEditor'

    let { source, context }: { source: string; context?: CbsVariableContext } = $props()
    const id = $props.id()
    const labels = $derived(language.cbsEditor)
    const references = $derived(collectCbsVariables(source))
    let allVariables = $state(false)
    let query = $state('')
    let target = $state<CbsVariableTarget>('chat')
    let drafts = $state<Record<string, string>>({})
    let errorName = $state('')
    let revision = $state(0)
    const effectiveTarget = $derived(context?.hasChat ? target : 'default')
    const rows = $derived.by(() => {
        revision
        return buildCbsVariableRows(references, context)
    })
    const visibleRows = $derived(rows.filter(row => (allVariables || row.reads + row.writes > 0) && row.name.toLowerCase().includes(query.toLowerCase())))

    $effect(() => {
        context?.key
        effectiveTarget
        drafts = {}
        errorName = ''
    })

    function apply(name: string) {
        if (!context || !Object.hasOwn(drafts, name)) return
        if (!context.apply(name, drafts[name], effectiveTarget)) { errorName = name; return }
        const next = { ...drafts }
        delete next[name]
        drafts = next
        errorName = ''
        revision++
    }
</script>

<div class="variable-list" data-cbs-variable-list>
    <div class="variable-header">
        <h3>{labels.variables} <span>{references.length}</span></h3>
        <button type="button" class="help" aria-label={labels.variableHelp} use:tooltip={labels.variableHelp}>?</button>
    </div>
    <div class="variable-panel">
        <div class="variable-controls">
            {#if context}
                <span class="owner" title={context.label}>{context.label}</span>
                <select data-cbs-variable-target aria-label={labels.target} value={effectiveTarget}
                    onchange={(event) => { target = event.currentTarget.value as CbsVariableTarget }} use:tooltip={labels.targetHelp}>
                    {#if context.hasChat}<option value="chat">{labels.currentChat}</option>{/if}
                    <option value="default">{labels.characterDefault}</option>
                </select>
                <label><input type="checkbox" bind:checked={allVariables} />{labels.allVariables}</label>
            {/if}
            <input class="search" aria-label={labels.searchVariables} placeholder={labels.searchVariables} bind:value={query} />
        </div>
        <div class="variable-rows">
            {#each visibleRows as row, index (row.name)}
                <div class="variable-row">
                    <code use:tooltip={`${labels.origins[row.origin]}${row.defaultValue !== undefined ? ` · ${labels.characterDefault}: ${row.defaultValue}` : ''}${row.templateValue !== undefined ? ` · ${labels.templateDefault}: ${row.templateValue}` : ''}`}>${row.name}</code>
                    {#if context}
                        <input
                            data-cbs-variable={row.name}
                            aria-label={`${row.name} · ${effectiveTarget === 'chat' ? labels.currentChat : labels.characterDefault}`}
                            aria-invalid={errorName === row.name}
                            placeholder={labels.origins.unset}
                            value={Object.hasOwn(drafts, row.name) ? drafts[row.name] : (effectiveTarget === 'chat' ? row.value : row.defaultValue) ?? ''}
                            list={`${id}-values-${index}`}
                            oninput={(event) => { drafts = { ...drafts, [row.name]: event.currentTarget.value }; errorName = '' }}
                            onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); apply(row.name) } }}
                        />
                        <datalist id={`${id}-values-${index}`}>
                            {#each row.values as value}<option {value}></option>{/each}
                        </datalist>
                        <button type="button" data-cbs-variable-apply={row.name} aria-label={`${labels.applyVariable} ${row.name}`}
                            disabled={!Object.hasOwn(drafts, row.name)}
                            use:tooltip={errorName === row.name ? labels.saveFailed : labels.applyVariable}
                            onclick={() => apply(row.name)}>{errorName === row.name ? '!' : '✓'}</button>
                    {:else}
                        <span class="observed-values" use:tooltip={labels.observedValues}>{row.values.map(value => JSON.stringify(value)).join(' · ') || '—'}</span>
                    {/if}
                </div>
            {:else}
                <span class="empty">{labels.noVariables}</span>
            {/each}
        </div>
    </div>
</div>

<style>
    .variable-list { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; overflow: auto; font-size: .73rem; }
    .variable-header { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; padding: .4rem .6rem 0; }
    h3 { margin: 0; font: inherit; font-weight: 600; }
    h3 span { margin-left: .3rem; color: var(--color-textcolor2); font-variant-numeric: tabular-nums; font-weight: 400; }
    .help { width: 1.2rem; height: 1.2rem; padding: 0; border: 1px solid var(--color-darkborderc); border-radius: 50%; color: var(--color-textcolor2); cursor: help; }
    .variable-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .variable-controls { display: grid; flex-shrink: 0; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: .4rem; padding: .4rem .6rem; border-bottom: 1px solid var(--color-darkborderc); }
    .owner { grid-column: 1 / -1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-textcolor2); }
    .variable-controls label { display: flex; align-items: center; gap: .25rem; white-space: nowrap; }
    .search { grid-column: 1 / -1; width: 100%; }
    input:not([type='checkbox']), select { min-width: 0; padding: .2rem .35rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-sm) * 0.8); color: var(--color-textcolor); background: var(--color-darkbg); font: inherit; }
    .variable-rows { flex: 1; min-height: 3rem; overflow: auto; overscroll-behavior: contain; padding: .25rem .6rem; }
    .variable-row { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) 1.5rem; align-items: center; gap: .4rem; padding: .2rem 0; }
    code { overflow-wrap: anywhere; font-size: .74rem; }
    button { padding: .15rem; border: 0; background: transparent; color: var(--color-textcolor); cursor: pointer; }
    button:disabled { opacity: .25; cursor: default; }
    input:focus-visible, select:focus-visible, button:focus-visible { outline: 1px solid var(--color-borderc); outline-offset: 1px; }
    .observed-values { grid-column: span 2; overflow-wrap: anywhere; color: var(--color-textcolor2); }
    .empty { color: var(--color-textcolor2); }
    @container cbs-variables (max-width: 210px) {
        .variable-controls { grid-template-columns: minmax(0, 1fr); }
        .variable-row { grid-template-columns: minmax(0, 1fr) 1.5rem; gap: .2rem; }
        .variable-row code { grid-column: 1 / -1; }
    }
</style>
