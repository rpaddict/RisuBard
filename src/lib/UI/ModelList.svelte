<script lang="ts">

    import { DBState } from 'src/ts/stores.svelte';
    import { getHordeModels } from "src/ts/horde/getModels";
    import { language } from "src/lang";
    import { getModelInfo, getModelList } from 'src/ts/model/modellist';
    import { ArrowLeft, ChevronRight, TriangleAlert } from "@lucide/svelte";
    import ShButton from "./GUI/ShButton.svelte";
    import ShSwitch from "./GUI/ShSwitch.svelte";

    interface Props {
        value?: string;
        onChange?: (v:string) => void;
        onclick?: (event: MouseEvent & {
            currentTarget: EventTarget & HTMLDivElement;
        }) => any
        blankable?: boolean
        excludesPrefix?: string
        compact?: boolean
        label?: string
        disabled?: boolean
        blankLabel?: string
    }

    let { value = $bindable(""), onChange = (v) => {}, onclick, blankable, excludesPrefix, compact, label, disabled = false, blankLabel }: Props = $props();
    let openOptions = $state(false)
    let showUnrec = $state(false)
    const TAB_KEY = 'risubard.modelList.lastTab'
    function readLastTab(): 'base' | 'plugin' {
        try { return localStorage.getItem(TAB_KEY) === 'plugin' ? 'plugin' : 'base' } catch { return 'base' }
    }
    function setTab(tab: 'base' | 'plugin'){
        activeTab = tab
        try { localStorage.setItem(TAB_KEY, tab) } catch {}
    }
    let activeTab = $state<'base' | 'plugin'>(readLastTab())
    let expandedGroups = $state<Set<string>>(new Set())

    function changeModel(name:string){
        value = name
        openOptions = false
        onChange(name)
    }
    function toggleGroup(name:string){
        const next = new Set(expandedGroups)
        next.has(name) ? next.delete(name) : next.add(name)
        expandedGroups = next
    }
    function notExcluded(id:string){
        return !excludesPrefix || !id.startsWith(excludesPrefix)
    }

    let recProviders = $derived(getModelList({ recommendedOnly: true, groupedByProvider: true }))
    let recIds = $derived(new Set(recProviders.flatMap(g => g.models.map(m => m.id))))
    let providers = $derived(getModelList({ recommendedOnly: !showUnrec, groupedByProvider: true }))
    let pluginModels = $derived(providers.find(g => g.providerName === 'Plugins')?.models ?? [])
    let hasPlugins = $derived(pluginModels.length > 0)
</script>

{#snippet modelRow(id:string, name:string, unrec:boolean)}
    <button class="shrink-0 w-full flex items-center gap-1 text-left px-3 py-1.5 text-sm hover:bg-selected rounded" onclick={() => changeModel(id)}>
        {#if showUnrec}
            <span class="shrink-0 w-4 flex items-center justify-center">
                {#if unrec}<TriangleAlert size={12} class="text-warning" />{/if}
            </span>
        {/if}
        <span class="truncate">{name}</span>
    </button>
{/snippet}

{#snippet groupHeader(key:string, label:string, unrec:boolean)}
    <button class="shrink-0 w-full flex items-center gap-1 px-3 py-1.5 text-sm font-medium hover:bg-selected rounded" onclick={() => toggleGroup(key)}>
        {#if showUnrec}
            <span class="shrink-0 w-4 flex items-center justify-center">
                {#if unrec}<TriangleAlert size={12} class="text-warning" />{/if}
            </span>
        {/if}
        <span class="truncate flex-1 text-left">{label}</span>
        <ChevronRight size={14} class={`transition-transform shrink-0${expandedGroups.has(key) ? ' rotate-90' : ''}`} />
    </button>
{/snippet}

{#snippet providerList(groups:{providerName:string, models:{id:string, name:string}[]}[])}
    {#each groups as group}
        {#if group.providerName === 'Plugins'}
            <!-- plugins live under their own tab -->
        {:else if group.providerName === '@as-is'}
            {#each group.models.filter(m => notExcluded(m.id)) as model}
                {@render modelRow(model.id, model.name, !recIds.has(model.id))}
            {/each}
        {:else}
            {@render groupHeader(group.providerName, group.providerName, false)}
            {#if expandedGroups.has(group.providerName)}
                <div class="pl-4 flex flex-col">
                    {#each group.models.filter(m => notExcluded(m.id)) as model}
                        {@render modelRow(model.id, model.name, !recIds.has(model.id))}
                    {/each}
                </div>
            {/if}
        {/if}
    {/each}
{/snippet}

{#if openOptions}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="risu-modal-overlay fixed top-0 w-full h-full left-0 bg-overlay/50 z-50 flex justify-center items-center" role="button" tabindex="0" onclick={() => {
        openOptions = false
    }}>
        <div data-skin-part="modal" class="risu-modal-surface w-96 max-w-full max-h-full overflow-x-hidden bg-bgcolor p-4 flex flex-col" role="button" tabindex="0" onclick={(e)=>{
            e.stopPropagation()
            onclick?.(e)
        }}>
            <div class="shrink-0 flex items-center gap-3 mb-3">
                <button
                    class="flex items-center justify-center p-2 rounded-lg hover:bg-selected transition-colors shrink-0"
                    onclick={() => {
                        openOptions = false
                    }}
                    title="Back"
                >
                    <ArrowLeft size={20} />
                </button>
                <h1 class="font-bold text-xl flex-1">{language.model}</h1>
            </div>

            {#if hasPlugins}
                <div class="shrink-0 flex w-full rounded-md border border-selected mb-2">
                    <button class="p-1.5 flex-1 text-sm" class:bg-selected={activeTab === 'base'} onclick={() => { setTab('base') }}>{language.modelTabBuiltin}</button>
                    <button class="p-1.5 flex-1 text-sm" class:bg-selected={activeTab === 'plugin'} onclick={() => { setTab('plugin') }}>{language.modelTabPlugin}</button>
                </div>
            {:else}
                <div class="shrink-0 border-t-1 border-y-selected mb-2"></div>
            {/if}

            <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col">
                {#if hasPlugins && activeTab === 'plugin'}
                    {#each pluginModels as model}
                        {@render modelRow(model.id, model.name, false)}
                    {/each}
                {:else}
                    {@render providerList(providers)}

                    {#if DBState?.db.customModels?.length > 0}
                        {@render groupHeader('__custom', language.customModels, false)}
                        {#if expandedGroups.has('__custom')}
                            <div class="pl-4 flex flex-col">
                                {#each DBState.db.customModels as model}
                                    {@render modelRow(model.id, model.name ?? "Unnamed", false)}
                                {/each}
                            </div>
                        {/if}
                    {/if}

                    {#if blankable}
                        {@render modelRow('', blankLabel ?? language.none, false)}
                    {/if}

                    {#if showUnrec}
                        {@render groupHeader('Horde', 'Horde', true)}
                        {#if expandedGroups.has('Horde')}
                            <div class="pl-4 flex flex-col">
                                {#await getHordeModels()}
                                    <div class="px-3 py-1.5 text-sm text-textcolor2">Loading...</div>
                                {:then models}
                                    {@render modelRow('horde:::auto', 'Auto Model', true)}
                                    {#each models as model}
                                        {@render modelRow('horde:::' + model.name, model.name.trim(), true)}
                                    {/each}
                                {/await}
                            </div>
                        {/if}
                    {/if}
                {/if}
            </div>

            {#if !(hasPlugins && activeTab === 'plugin')}
                <div class="shrink-0 border-t border-selected mt-2 pt-2 flex items-center justify-between gap-2 px-1">
                    <span class="text-sm text-textcolor2">{language.showUnrecommended}</span>
                    <ShSwitch className="shrink-0" bind:checked={showUnrec} />
                </div>
            {/if}
        </div>
    </div>

{/if}

{#if compact}
    <ShButton className={`w-full min-w-0 justify-start${disabled ? ' opacity-50 pointer-events-none' : ''}`} onclick={() => { if(!disabled){ openOptions = true } }}>
        <span class="truncate">{(blankable && !value && blankLabel) ? blankLabel : (getModelInfo(value)?.shortName || getModelInfo(value)?.name || language.none)}</span>
    </ShButton>
{:else}
    <button onclick={() => { if(!disabled){ openOptions = true } }} class:opacity-50={disabled} class:pointer-events-none={disabled}
        class="mt-4 drop-shadow-lg p-3 flex justify-center items-center ml-2 mr-2 rounded-lg bg-darkbutton mb-4 border-darkborderc border">
            {(blankable && !value && blankLabel) ? blankLabel : (getModelInfo(value)?.fullName || language.none)}
    </button>
{/if}
