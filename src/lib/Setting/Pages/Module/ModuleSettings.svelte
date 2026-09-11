<script lang="ts">
    import { registerSettingsBack } from "src/ts/setting/settingsBack";
    import { language } from "src/lang";
    import SettingPage from "src/lib/UI/GUI/SettingPage.svelte";
    
    import { DBState } from 'src/ts/stores.svelte';
    import ModuleMenu from "src/lib/Setting/Pages/Module/ModuleMenu.svelte";
    import { exportModule, importModule, refreshModules, type RisuModule } from "src/ts/process/modules";
    import { SquarePen, TrashIcon, Globe, PlusIcon, HardDriveUpload, Waypoints, UsersRoundIcon, ArrowLeftIcon } from "@lucide/svelte";
    import { v4 } from "uuid";
    import { alertConfirm, notifySuccess } from "src/ts/alert";
    import TextInput from "src/lib/UI/GUI/TextInput.svelte";
    import { onDestroy, onMount } from "svelte";
    import { importMCPModule } from "src/ts/process/mcp/mcp";
    import { convertModuleToCharacter } from "src/ts/interchangeability";
    import { checkCharOrder, requestImmediateSave } from "src/ts/globalApi.svelte";
    import CollectionOrganizerList from "src/lib/UI/CollectionOrganizerList.svelte";
    import ShButton from "src/lib/UI/GUI/ShButton.svelte";
    import ShDialog from "src/lib/UI/GUI/ShDialog.svelte";
    import { normalizePersonaEnabledModules } from "src/ts/storage/database.svelte";
    import { assignCollectionItem, normalizeCollectionOrganizerState } from "src/ts/collectionOrganizer";
    let tempModule:RisuModule = $state({
        name: '',
        description: '',
        id: v4(),
    })
    function returnToModules() {
        if (mode === 0) return false
        mode = 0
        return true
    }
    onMount(() => registerSettingsBack(returnToModules))

    let mode = $state(0)
    let selectedModuleFolder = $state<string | null | undefined>(undefined)
    let personaAssignmentOpen = $state(false)
    let personaAssignmentModuleId = $state('')
    let personaSearch = $state('')
    const organizerModuleItems = $derived(DBState.db.modules.map((module) => ({
        id: module.id,
        title: module.name,
        detail: module.description,
    })))

    function personaOptions(){
        const options:{ id:string, name:string, scope:string }[] = []
        const seen = new Set<string>()
        for(const persona of DBState.db.personas){
            if(!persona.id || seen.has(persona.id)) continue
            seen.add(persona.id)
            options.push({ id: persona.id, name: persona.name, scope: language.globalPersonaScope })
        }
        for(const character of DBState.db.characters){
            for(const persona of character.personas ?? []){
                if(!persona.id || seen.has(persona.id)) continue
                seen.add(persona.id)
                options.push({ id: persona.id, name: persona.name, scope: `${language.character}: ${character.name}` })
            }
        }
        return options
    }

    function normalizeAssignments(){
        DBState.db.personaEnabledModules = normalizePersonaEnabledModules(
            DBState.db.personaEnabledModules,
            [
                ...DBState.db.personas,
                ...DBState.db.characters.flatMap((character) => character.personas ?? []),
            ],
            DBState.db.modules.map((module) => module.id),
        )
    }

    function openPersonaAssignments(moduleId:string){
        normalizeAssignments()
        personaAssignmentModuleId = moduleId
        personaSearch = ''
        personaAssignmentOpen = true
    }

    function isAssignedToPersona(personaId:string){
        return DBState.db.personaEnabledModules?.[personaId]?.includes(personaAssignmentModuleId) ?? false
    }

    function togglePersonaAssignment(personaId:string){
        const assignments = { ...(DBState.db.personaEnabledModules ?? {}) }
        const moduleIds = [...(assignments[personaId] ?? [])]
        const index = moduleIds.indexOf(personaAssignmentModuleId)
        if(index >= 0) moduleIds.splice(index, 1)
        else moduleIds.push(personaAssignmentModuleId)
        if(moduleIds.length > 0) assignments[personaId] = moduleIds
        else delete assignments[personaId]
        DBState.db.personaEnabledModules = assignments
        normalizeAssignments()
    }

    function filteredPersonaOptions(){
        const search = personaSearch.trim().toLocaleLowerCase()
        if(!search) return personaOptions()
        return personaOptions().filter((persona) =>
            persona.name.toLocaleLowerCase().includes(search)
            || persona.scope.toLocaleLowerCase().includes(search)
        )
    }

    function assignmentModuleName(){
        return DBState.db.modules.find((module) => module.id === personaAssignmentModuleId)?.name ?? ''
    }

    function assignModuleToFolder(moduleId:string, folderId:string | null | undefined){
        if(typeof folderId !== 'string' || !DBState.db.collectionOrganizers) return
        const moduleIds = DBState.db.modules.map((module) => module.id)
        const current = normalizeCollectionOrganizerState(DBState.db.collectionOrganizers.modules, moduleIds)
        DBState.db.collectionOrganizers = {
            ...DBState.db.collectionOrganizers,
            modules: assignCollectionItem(current, moduleId, folderId),
        }
        void requestImmediateSave()
    }

    async function importModulesToSelectedFolder(importer:() => Promise<unknown>){
        const previousIds = new Set(DBState.db.modules.map((module) => module.id))
        await importer()
        for(const module of DBState.db.modules){
            if(!previousIds.has(module.id)) assignModuleToFolder(module.id, selectedModuleFolder)
        }
    }

    function removeModules(moduleIds:readonly string[]){
        const moduleIdsToDelete = new Set(moduleIds)
        DBState.db.enabledModules = DBState.db.enabledModules.filter((moduleId) => !moduleIdsToDelete.has(moduleId))
        DBState.db.modules = DBState.db.modules.filter((module) => !moduleIdsToDelete.has(module.id))
        if(DBState.db.collectionOrganizers){
            DBState.db.collectionOrganizers = {
                ...DBState.db.collectionOrganizers,
                modules: normalizeCollectionOrganizerState(
                    DBState.db.collectionOrganizers.modules,
                    DBState.db.modules.map((module) => module.id),
                ),
            }
        }
        normalizeAssignments()
        void requestImmediateSave()
    }

    async function deleteModules(moduleIds:string[]){
        const existingCount = DBState.db.modules.filter((module) => moduleIds.includes(module.id)).length
        if(!existingCount) return false
        if(!await alertConfirm(language.collectionOrganizer.deleteSelectedConfirm.replace('{}', String(existingCount)))) return false
        removeModules(moduleIds)
        notifySuccess(language.collectionOrganizer.deleteSelectedDone.replace('{}', String(existingCount)))
        return true
    }

    onDestroy(() => {
        refreshModules()
    })
</script>
{#snippet backButton()}
    <ShButton
        variant="ghost"
        size="icon-sm"
        aria-label={language.moduleBackToList}
        title={language.moduleBackToList}
        onclick={returnToModules}
    ><ArrowLeftIcon size={18}/></ShButton>
{/snippet}
{#if mode === 0}
    <SettingPage resizable title={language.modules} description={language.collectionOrganizer.description}>

    <CollectionOrganizerList
        managerLayout
        kind="modules"
        items={organizerModuleItems}
        collectionLabel={language.modules}
        onDeleteItems={deleteModules}
        bind:selectedFolderId={selectedModuleFolder}
    >
        {#snippet toolbar(_selectedFolderId)}
            <div class="flex items-center gap-1">
                <ShButton variant="outline" size="icon-sm" aria-label={language.createModule} onclick={() => {
                    tempModule = { name: '', description: '', id: v4() }
                    mode = 1
                }}><PlusIcon /></ShButton>
                <ShButton variant="outline" size="icon-sm" aria-label="MCP" onclick={() => importModulesToSelectedFolder(importMCPModule)}><Waypoints /></ShButton>
                <ShButton variant="outline" size="icon-sm" aria-label={language.importModule} onclick={() => importModulesToSelectedFolder(importModule)}><HardDriveUpload /></ShButton>
            </div>
        {/snippet}

        {#snippet itemContent(moduleId)}
            {@const moduleIndex = DBState.db.modules.findIndex((module) => module.id === moduleId)}
            {#if moduleIndex >= 0}
                {@const rmodule = DBState.db.modules[moduleIndex]}
                <div class="module-item-header text-left">
                    <div class="module-item-title font-bold">
                        <div class="module-item-name">
                            {#if rmodule.mcp}
                                <Waypoints size={18} class="shrink-0" />
                            {/if}
                            <span class="block min-w-0">{rmodule.name}</span>
                        </div>
                        <div class="module-item-description">
                            <span class="text-sm text-textcolor2">{rmodule.description || 'No description provided'}</span>
                        </div>
                    </div>
                    <div class="module-item-actions">
                        <ShButton
                            variant="outline"
                            size="icon-xs"
                            aria-label={language.enableGlobal}
                            title={language.enableGlobal}
                            onclick={async (e) => {
                            e.stopPropagation()
                            if(DBState.db.enabledModules.includes(rmodule.id)){
                                DBState.db.enabledModules.splice(DBState.db.enabledModules.indexOf(rmodule.id), 1)
                            }
                            else{
                                DBState.db.enabledModules.push(rmodule.id)
                            }
                            DBState.db.enabledModules = DBState.db.enabledModules
                        }}>
                            <span class="module-activation-icon" class:module-activation-icon--active={DBState.db.enabledModules.includes(rmodule.id)}><Globe size={18}/></span>
                        </ShButton>
                        <ShButton
                            variant="outline"
                            size="icon-xs"
                            aria-label={language.managePersonaModules}
                            title={language.managePersonaModules}
                            onclick={(e) => {
                                e.stopPropagation()
                                openPersonaAssignments(rmodule.id)
                            }}
                        >
                            <UsersRoundIcon size={18}/>
                        </ShButton>
                        {#if !rmodule.mcp}
                            <ShButton variant="outline" size="icon-xs" aria-label={language.edit} title={language.edit} onclick={async (e) => {
                                e.stopPropagation()
                                tempModule = rmodule
                                mode = 2
                            }}>
                                <SquarePen size={18}/>
                            </ShButton>
                        {:else}
                            <ShButton variant="outline" size="icon-xs" aria-label={language.edit} disabled>
                                <SquarePen size={18}/>
                            </ShButton>
                        {/if}
                        <ShButton variant="destructive" size="icon-xs" aria-label={language.remove} title={language.remove} onclick={async (e) => {
                            e.stopPropagation()
                            const d = await alertConfirm(`${language.removeConfirm}` + rmodule.name)
                            if(d){
                                removeModules([rmodule.id])
                                notifySuccess(language.moduleDeleted)
                            }
                        }}>
                            <TrashIcon size={18}/>
                        </ShButton>
                    </div>
                </div>
            {/if}
        {/snippet}
    </CollectionOrganizerList>

    </SettingPage>
{:else if mode === 1}
    <SettingPage title={language.createModule} leading={backButton}>
    <ModuleMenu bind:currentModule={tempModule}/>
    <ShButton variant="outline" size="xs" className="mt-6 self-start" onclick={() => {
        DBState.db.modules.push(tempModule)
        assignModuleToFolder(tempModule.id, selectedModuleFolder)
        notifySuccess(language.moduleCreated)
        mode = 0
    }}>{language.createModule}</ShButton>
    </SettingPage>
{:else if mode === 2}
    <SettingPage title={language.editModule} leading={backButton}>
    <ModuleMenu bind:currentModule={tempModule}/>
    {#if tempModule.name !== ''}
      <div class="module-editor-actions">
        <button type="button" class="module-editor-action" onclick={() => exportModule(tempModule)}>
            {language.download}
        </button>
        <button type="button" class="module-editor-action" onclick={() => {
            const char = convertModuleToCharacter(tempModule)
            DBState.db.characters.push(char)
            checkCharOrder()
            notifySuccess(language.successfullyConverted)
        }}>{language.convertToCharacter}</button>
      </div>
    {/if}
    </SettingPage>
{/if}

<ShDialog
    bind:open={personaAssignmentOpen}
    size="lg"
    tier="base"
    closeOnEscape={true}
    closeOnOutsideClick={true}
    ariaLabel={language.personaModuleAssignments}
>
    {#snippet title()}{language.personaModuleAssignments}: {assignmentModuleName()}{/snippet}
    {#snippet description()}{language.personaModuleAssignmentsDescription}{/snippet}

    <div class="flex flex-col gap-3">
        <label for="persona-module-search" class="sr-only">{language.searchPersonas}</label>
        <TextInput
            id="persona-module-search"
            fullwidth={true}
            placeholder={language.searchPersonas}
            bind:value={personaSearch}
        />
        {#if filteredPersonaOptions().length === 0}
            <p class="py-4 text-center text-sm text-textcolor2">{language.noPersonasFound}</p>
        {:else}
            <div class="max-h-[55vh] overflow-y-auto rounded-md border border-darkborderc divide-y divide-darkborderc">
                {#each filteredPersonaOptions() as persona (persona.id)}
                    <label class="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-selected/30 focus-within:bg-selected/30">
                        <input
                            type="checkbox"
                            class="size-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-borderc/50"
                            checked={isAssignedToPersona(persona.id)}
                            onchange={() => togglePersonaAssignment(persona.id)}
                        />
                        <span class="min-w-0 grow">
                            <span class="block truncate text-sm font-medium text-textcolor">{persona.name}</span>
                            <span class="block truncate text-xs text-textcolor2">{persona.scope}</span>
                        </span>
                    </label>
                {/each}
            </div>
        {/if}
    </div>
</ShDialog>

<style>
    .module-editor-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: .5rem; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--settings-border, var(--color-darkborderc)); }
    .module-editor-action {
        min-height: 3rem;
        padding: .72rem 1.15rem;
        border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 48%, var(--risu-theme-darkborderc));
        border-radius: .62rem;
        background: color-mix(in srgb, var(--risu-theme-primary) 62%, var(--risu-theme-bgcolor));
        color: var(--risu-theme-textcolor);
        font-size: .96rem;
        font-weight: 700;
        letter-spacing: -.01em;
        transition: background-color 180ms ease, box-shadow 180ms ease;
    }
    .module-editor-action:hover { background: color-mix(in srgb, var(--risu-theme-primary) 72%, var(--risu-theme-bgcolor)); }
    .module-editor-action:focus-visible { outline: 2px solid color-mix(in srgb, var(--risu-theme-textcolor) 74%, var(--risu-theme-primary)); outline-offset: -3px; }
    .module-item-header {
        height: 100%;
        display: flex;
        flex-wrap: nowrap;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
    }

    .module-item-title {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        gap: .3rem;
        flex: 1 1 10rem;
        min-width: 0;
        overflow-wrap: anywhere;
    }

    .module-item-actions {
        display: flex;
        flex-wrap: nowrap;
        justify-content: flex-end;
        gap: .25rem;
        align-items: center;
        flex-shrink: 0;
        min-width: 0;
        max-width: 100%;
        margin-left: auto;
    }

    .module-item-actions :global(button) {
        flex-shrink: 0;
    }

    .module-item-name {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: .5rem;
    }

    .module-activation-icon {
        display: inline-flex;
        color: var(--risu-theme-textcolor2);
        transition: color 180ms ease, filter 180ms ease;
    }

    .module-activation-icon--active {
        color: var(--color-info);
        filter: drop-shadow(0 0 .28rem color-mix(in srgb, var(--color-info) 75%, transparent));
    }

    .module-item-description {
        min-width: 0;
        font-weight: 400;
        overflow-wrap: anywhere;
    }
</style>
