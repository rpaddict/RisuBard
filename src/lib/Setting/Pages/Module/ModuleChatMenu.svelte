<script lang="ts">
    import { CircleCheckIcon, GlobeIcon, MessageSquareIcon, Waypoints } from '@lucide/svelte'
    import { language } from 'src/lang'
    import CollectionOrganizerList from 'src/lib/UI/CollectionOrganizerList.svelte'
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import { DBState, ReloadGUIPointer, selectedCharID } from 'src/ts/stores.svelte'
    import { requestImmediateSave } from 'src/ts/globalApi.svelte'
    import { checkPersonaBinded } from 'src/ts/util'

    interface Props {
        close?: (moduleId: string) => void
        alertMode?: boolean
    }

    let { close = () => {}, alertMode = false }: Props = $props()
    let open = $state(true)
    const copy = $derived(language.chatModuleActivation)
    const character = $derived(DBState.db.characters[$selectedCharID])
    const persona = $derived((character ? checkPersonaBinded() : null)
        ?? DBState.db.personas?.[DBState.db.selectedPersona ?? 0])
    const items = $derived(DBState.db.modules.map((module) => ({
        id: module.id, title: module.name, detail: module.description,
    })))

    function toggleModule(moduleId: string, scope: 'global' | 'character') {
        if (alertMode || (scope === 'character' && !character)) return
        if (scope === 'global') {
            const ids = DBState.db.enabledModules ?? []
            DBState.db.enabledModules = ids.includes(moduleId)
                ? ids.filter((id) => id !== moduleId) : [...ids, moduleId]
        } else {
            const ids = character.modules ?? []
            character.modules = ids.includes(moduleId)
                ? ids.filter((id) => id !== moduleId) : [...ids, moduleId]
        }
        $ReloadGUIPointer += 1
        void requestImmediateSave()
    }
</script>

<ShDialog
    bind:open
    onOpenChange={(value) => { if (!value) close('') }}
    size="xl"
    tier={alertMode ? 'alert' : 'base'}
    closeOnEscape={true}
    closeAriaLabel={language.close}
    contentClass="chat-module-dialog overflow-hidden"
    bodyClass="flex min-h-0 flex-1 flex-col overflow-hidden"
    contentStyle="width: min(72rem, calc(100vw - 2rem)); max-width: calc(100vw - 2rem); height: min(52rem, calc(100dvh - 2rem)); max-height: calc(100dvh - 2rem);"
>
    {#snippet title()}{language.modules}{/snippet}
    {#snippet description()}{alertMode ? copy.selectDescription : copy.description}{/snippet}

    <CollectionOrganizerList managerLayout kind="modules" {items} collectionLabel={language.modules}>
        {#snippet itemContent(moduleId)}
            {@const module = DBState.db.modules.find((item) => item.id === moduleId)}
            {#if module}
                {@const globalEnabled = DBState.db.enabledModules?.includes(moduleId) ?? false}
                {@const characterEnabled = character?.modules?.includes(moduleId) ?? false}
                {@const personaEnabled = (persona?.id && DBState.db.personaEnabledModules?.[persona.id]?.includes(moduleId)) || persona?.embeddedModule?.id === moduleId}
                <div class="chat-module-row">
                    <div class="chat-module-copy">
                        <div class="chat-module-name">
                            {#if module.mcp}<Waypoints size={18}/>{/if}
                            <strong>{module.name}</strong>
                        </div>
                        {#if module.description}<p>{module.description}</p>{/if}
                        {#if !alertMode && personaEnabled}
                            <p class="chat-module-inherited">{copy.personaEnabled}</p>
                        {/if}
                    </div>
                    {#if alertMode}
                        <ShButton variant="outline" size="icon" aria-label={copy.selectModule.replace('{0}', module.name)} onclick={() => close(moduleId)}><CircleCheckIcon size={22}/></ShButton>
                    {:else}
                        <div class="chat-module-scopes">
                            <div class="chat-module-scope">
                                <button type="button" class="chat-module-toggle" class:active={globalEnabled}
                                    aria-label={module.name + ': ' + copy.global} aria-pressed={globalEnabled}
                                    title={copy.globalHint} onclick={() => toggleModule(moduleId, 'global')}>
                                    <GlobeIcon size={19.2}/>
                                </button>
                            </div>
                            <div class="chat-module-scope">
                                <button type="button" class="chat-module-toggle" class:active={characterEnabled}
                                    aria-label={module.name + ': ' + copy.chat} aria-pressed={characterEnabled} disabled={!character}
                                    title={character ? copy.chatHint : copy.noChat} onclick={() => toggleModule(moduleId, 'character')}>
                                    <MessageSquareIcon size={19.2}/>
                                </button>
                            </div>
                        </div>
                    {/if}
                </div>
            {/if}
        {/snippet}
    </CollectionOrganizerList>
</ShDialog>

<style>
    .chat-module-row { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; min-width: 0; height: 100%; }
    .chat-module-copy { flex: 1 1 10rem; min-width: 0; overflow-wrap: anywhere; }
    .chat-module-name { display: flex; align-items: center; gap: .4rem; }
    .chat-module-copy p { margin: .3rem 0 0; font-size: .85rem; color: var(--color-textcolor2); }
    .chat-module-copy .chat-module-inherited { color: var(--color-info); }
    .chat-module-scopes { display: flex; flex: 0 0 auto; gap: .5rem; margin-left: auto; }
    .chat-module-scope { display: flex; align-items: center; }
    .chat-module-toggle { display: flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; flex: 0 0 auto; padding: 0; border: 1px solid var(--color-darkborderc); border-radius: .4rem; color: var(--color-textcolor2); background: var(--color-darkbg); cursor: pointer; }
    .chat-module-toggle.active { color: var(--color-accenttext); background: var(--color-primary); border-color: var(--color-primary); }
    .chat-module-toggle:hover { border-color: var(--color-info); }
    .chat-module-toggle:focus-visible { outline: 2px solid var(--color-info); outline-offset: 2px; }
    .chat-module-toggle:disabled { opacity: .45; cursor: not-allowed; }
</style>
