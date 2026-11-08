<script lang="ts">
    import { PlusIcon, TrashIcon, LinkIcon, CodeXmlIcon, PowerIcon, PowerOffIcon, ShieldIcon, RefreshCwIcon, DownloadIcon, SaveIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import SettingPage from "src/lib/UI/GUI/SettingPage.svelte";
    import { alertConfirm, alertMd, alertSelect, notifyError, notifySuccess } from "src/ts/alert";
    import { TriangleAlert } from '@lucide/svelte';

    import { DBState, hotReloading } from "src/ts/stores.svelte";
    import { checkPluginUpdate, createBlankPlugin, customProviderStore, importPlugin, loadPlugins, pluginProviderOwners, pluginV2, updatePlugin } from "src/ts/plugins/plugins.svelte";
    import { downloadFile, requestImmediateSave } from "src/ts/globalApi.svelte";
    import { customV3ProviderMetaStore, resetPluginPermission } from "src/ts/plugins/apiV3/v3.svelte";
    import TextInput from "src/lib/UI/GUI/TextInput.svelte";
    import NumberInput from "src/lib/UI/GUI/NumberInput.svelte";
    import SelectInput from "src/lib/UI/GUI/SelectInput.svelte";
    import OptionInput from "src/lib/UI/GUI/OptionInput.svelte";
    import CheckInput from "src/lib/UI/GUI/CheckInput.svelte";
    import TextAreaInput from "src/lib/UI/GUI/TextAreaInput.svelte";
    import { hotReloadPluginFiles } from "src/ts/plugins/apiV3/developMode";
    import CollectionOrganizerList from "src/lib/UI/CollectionOrganizerList.svelte";
    import ShButton from "src/lib/UI/GUI/ShButton.svelte";
    import ShAlert from "src/lib/UI/GUI/ShAlert.svelte";
    import ShBadge from "src/lib/UI/GUI/ShBadge.svelte";
    import ShDialog from "src/lib/UI/GUI/ShDialog.svelte";
    import { assignCollectionItem, normalizeCollectionOrganizerState } from "src/ts/collectionOrganizer";

    let showParams = $state<string[]>([])
    let updatingPlugins = $state<string[]>([])
    let selectedPluginFolder = $state<string | null | undefined>(undefined)
    let pluginCodeEditorOpen = $state(false)
    let pluginCodeName = $state('')
    let pluginCodeDraft = $state('')
    let applyingPluginCode = $state(false)
    const pluginStatusOptions = $derived([
        { value: 'enabled', label: language.collectionOrganizer.enabledStatus },
        { value: 'disabled', label: language.collectionOrganizer.disabledStatus },
    ])
    const organizerPluginItems = $derived((DBState.db.plugins ?? []).map((plugin) => ({
        id: plugin.name,
        title: plugin.displayName ?? plugin.name,
        detail: [
            plugin.name,
            plugin.versionOfPlugin,
            plugin.version ? `API V${plugin.version}` : '',
        ].filter(Boolean).join(' '),
        status: plugin.enabled ? 'enabled' : 'disabled',
    })))

    async function installPluginUpdate(plugin: (typeof DBState.db.plugins)[number]) {
        if (updatingPlugins.includes(plugin.name)) return
        updatingPlugins = [...updatingPlugins, plugin.name]
        try {
            if (await updatePlugin(plugin)) notifySuccess(language.pluginUpdateSuccess)
            else notifyError(language.pluginUpdateFailed)
        } finally {
            updatingPlugins = updatingPlugins.filter((name) => name !== plugin.name)
        }
    }

    function assignPluginToFolder(pluginName: string, folderId: string | null | undefined) {
        if (typeof folderId !== 'string' || !DBState.db.collectionOrganizers) return
        const pluginNames = (DBState.db.plugins ?? []).map((plugin) => plugin.name)
        const current = normalizeCollectionOrganizerState(DBState.db.collectionOrganizers.plugins, pluginNames)
        DBState.db.collectionOrganizers = {
            ...DBState.db.collectionOrganizers,
            plugins: assignCollectionItem(current, pluginName, folderId),
        }
        void requestImmediateSave()
    }

    async function importPluginsToSelectedFolder(importer: () => Promise<unknown>) {
        const previousNames = new Set((DBState.db.plugins ?? []).map((plugin) => plugin.name))
        await importer()
        for (const plugin of DBState.db.plugins ?? []) {
            if (!previousNames.has(plugin.name)) assignPluginToFolder(plugin.name, selectedPluginFolder)
        }
    }

    async function removePlugins(pluginNames: readonly string[]) {
        const pluginNamesToDelete = new Set(pluginNames)
        const providerNamesToDelete = new Set(
            [...pluginProviderOwners.entries()]
                .filter(([, pluginName]) => pluginNamesToDelete.has(pluginName))
                .map(([providerName]) => providerName),
        )
        for (const providerName of providerNamesToDelete) {
            pluginV2.providers.delete(providerName)
            pluginV2.providerOptions.delete(providerName)
            pluginProviderOwners.delete(providerName)
        }
        customProviderStore.update((providerNames) => providerNames.filter((providerName) => !providerNamesToDelete.has(providerName)))
        for (let index = customV3ProviderMetaStore.length - 1; index >= 0; index--) {
            const providerName = customV3ProviderMetaStore[index].id.replace(/^pluginmodel:::/, '')
            if (providerNamesToDelete.has(providerName)) customV3ProviderMetaStore.splice(index, 1)
        }
        if (providerNamesToDelete.has(DBState.db.currentPluginProvider)) DBState.db.currentPluginProvider = ""
        DBState.db.plugins = (DBState.db.plugins ?? []).filter((plugin) => !pluginNamesToDelete.has(plugin.name))
        if (DBState.db.collectionOrganizers) {
            DBState.db.collectionOrganizers = {
                ...DBState.db.collectionOrganizers,
                plugins: normalizeCollectionOrganizerState(
                    DBState.db.collectionOrganizers.plugins,
                    DBState.db.plugins.map((plugin) => plugin.name),
                ),
            }
        }
        await requestImmediateSave()
        await loadPlugins()
    }

    async function deletePlugins(pluginNames: string[]) {
        const existingCount = (DBState.db.plugins ?? []).filter((plugin) => pluginNames.includes(plugin.name)).length
        if (!existingCount) return false
        if (!await alertConfirm(language.collectionOrganizer.deleteSelectedConfirm.replace('{}', String(existingCount)))) return false
        await removePlugins(pluginNames)
        notifySuccess(language.collectionOrganizer.deleteSelectedDone.replace('{}', String(existingCount)))
        return true
    }

    function openPluginCodeEditor(plugin: (typeof DBState.db.plugins)[number]) {
        pluginCodeName = plugin.name
        pluginCodeDraft = plugin.script ?? ''
        pluginCodeEditorOpen = true
    }

    function pluginCodeFilename(name: string) {
        const safeName = name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim() || 'plugin'
        return `${safeName}.js`
    }

    function pluginCodeDisplayName() {
        const plugin = (DBState.db.plugins ?? []).find((candidate) => candidate.name === pluginCodeName)
        return plugin?.displayName ?? plugin?.name ?? pluginCodeName
    }

    async function applyPluginCode() {
        if (applyingPluginCode || !pluginCodeDraft.trim()) return
        const original = (DBState.db.plugins ?? []).find((plugin) => plugin.name === pluginCodeName)
        if (!original) return
        const source = pluginCodeDraft
        const previousRealArg = { ...original.realArg }
        applyingPluginCode = true
        try {
            const applied = await importPlugin(source, {
                isUpdate: true,
                originalPluginName: pluginCodeName,
            })
            if (!applied) return

            const updatedIndex = (DBState.db.plugins ?? []).findIndex((plugin) => plugin.name === pluginCodeName)
            if (updatedIndex < 0) return
            const updated = DBState.db.plugins[updatedIndex]
            const restoredRealArg = { ...updated.realArg }
            for (const key of Object.keys(updated.arguments ?? {})) {
                if (key in previousRealArg) restoredRealArg[key] = previousRealArg[key]
            }
            const plugins = [...(DBState.db.plugins ?? [])]
            plugins[updatedIndex] = {
                ...original,
                ...updated,
                enabled: original.enabled,
                realArg: restoredRealArg,
            }
            DBState.db.plugins = plugins
            await loadPlugins()
            void requestImmediateSave()
            notifySuccess(language.pluginCodeApplied)
            pluginCodeEditorOpen = false
        } finally {
            applyingPluginCode = false
        }
    }
</script>

<SettingPage resizable title={language.plugin} description={language.collectionOrganizer.description}>
<ShAlert variant="warning" className="mb-4">
    {#snippet icon()}<TriangleAlert />{/snippet}
    {language.pluginWarn}
</ShAlert>

<CollectionOrganizerList
    managerLayout
    kind="plugins"
    items={organizerPluginItems}
    collectionLabel={language.plugin}
    statusOptions={pluginStatusOptions}
    onDeleteItems={deletePlugins}
    bind:selectedFolderId={selectedPluginFolder}
>
    {#snippet toolbar(_selectedFolderId)}
        <div class="flex items-center gap-1 text-textcolor2">
            <ShButton variant="outline" size="icon-sm" aria-label={language.import} onclick={() => importPluginsToSelectedFolder(() => importPlugin())}><PlusIcon /></ShButton>
            <ShButton variant="outline" size="icon-sm" aria-label="Plugin developer tools" onclick={async () => {
                const v = parseInt(await alertSelect([
                    'Import plugin with hot reload',
                    'Download plugin template',
                    language.cancel,
                ]))
                if (v === 0) await importPluginsToSelectedFolder(hotReloadPluginFiles)
                if (v === 1) {
                    const a = document.createElement('a')
                    a.href = '/plugin_start.7z'
                    a.download = 'plugin_starter.7z'
                    document.body.appendChild(a)
                    a.click()
                    a.remove()
                }
            }}><CodeXmlIcon /></ShButton>
        </div>
    {/snippet}

    {#snippet itemContent(pluginName)}
        {@const i = (DBState.db.plugins ?? []).findIndex((plugin) => plugin.name === pluginName)}
        {#if i >= 0}
            {@const plugin = DBState.db.plugins[i]}
            {@const visibleArgumentCount = Object.keys(plugin.arguments ?? {}).filter((arg) => !arg.startsWith('hidden_')).length}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            class="plugin-item-header"
            role="button"
            tabindex="0"
            aria-expanded={showParams.includes(plugin.name)}
            aria-controls={`plugin-arguments-${i}`}
            onclick={() => {
            if(showParams.includes(plugin.name)){
                showParams.splice(showParams.indexOf(plugin.name),1)
            }
            else{
                showParams.push(plugin.name)
            }
            showParams = showParams
        }}
            onkeydown={(event) => {
                if(event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                if(showParams.includes(plugin.name)) showParams.splice(showParams.indexOf(plugin.name), 1)
                else showParams.push(plugin.name)
                showParams = showParams
            }}
        >
            <div class="plugin-item-title">
                <div class="plugin-item-name font-bold">
                    <span>{plugin.displayName ?? plugin.name}</span>
                    <span class="plugin-setting-count">{visibleArgumentCount} {language.settings}</span>
                {#if hotReloading.includes(plugin.name)}
                        <ShBadge variant="warning">Hot</ShBadge>
                {/if}
                </div>
                <div class="plugin-item-meta mt-1">
                    <ShBadge variant={plugin.enabled ? 'success' : 'secondary'}>
                        {plugin.enabled
                            ? language.collectionOrganizer.enabledStatus
                            : language.collectionOrganizer.disabledStatus}
                    </ShBadge>
                    <ShBadge variant="outline">API V{plugin.version}</ShBadge>
                    {#if plugin.versionOfPlugin}<span>v{plugin.versionOfPlugin}</span>{/if}
                    <span>{plugin.name}</span>
                </div>
            </div>
            <div class="plugin-item-actions">
            <div class="plugin-utility-actions">
            {#if plugin.version === 2 || plugin.version === "2.1"}
                <ShButton variant="outline" size="icon" aria-label={language.pluginV2Warning} title={language.pluginV2Warning} onclick={(e) => {
                    e.stopPropagation()
                    alertMd(language.pluginV2Warning);
                }} >
                    <TriangleAlert />
                </ShButton>
            {/if}

            {#if plugin.customLink}
                {#each plugin.customLink as link}
                    {#if typeof link.link === "string" && (link.link.startsWith("http://") || link.link.startsWith("https://"))}
                        <a
                            href={link.link}
                            target="_blank"
                            rel="nofollow noopener noreferrer"
                            class="plugin-icon-link text-textcolor2 hover:text-textcolor cursor-pointer"
                            aria-label={link.hoverText}
                            title={link.hoverText}
                            onclick={(e) => e.stopPropagation()}
                        >
                            <LinkIcon></LinkIcon>
                        </a>
                    {/if}
                {/each}
            {/if}

            {#if plugin.updateURL}
                {#await checkPluginUpdate(plugin) then updateInfo}
                    {#if updateInfo}
                        <ShButton
                            variant="success"
                            size="icon"
                            aria-label={language.pluginUpdateFoundInstallIt}
                            title={language.pluginUpdateFoundInstallIt}
                            disabled={updatingPlugins.includes(plugin.name)}
                            onclick={async (e) => {
                                e.stopPropagation()
                                const v = await alertConfirm(
                                    language.pluginUpdateFoundInstallIt
                                );
                                if (v) {
                                    await installPluginUpdate(plugin)
                                }
                            }}
                        >
                            <RefreshCwIcon class={updatingPlugins.includes(plugin.name) ? 'animate-spin' : ''} />
                        </ShButton>
                    {/if}
                {/await}
            {/if}
            </div>

            <div class="plugin-action-column">
            <ShButton
                variant="outline"
                size="icon"
                aria-label={(plugin.enabled
                    ? language.collectionOrganizer.disableItem
                    : language.collectionOrganizer.enableItem).replace('{}', plugin.displayName ?? plugin.name)}
                title={(plugin.enabled
                    ? language.collectionOrganizer.disableItem
                    : language.collectionOrganizer.enableItem).replace('{}', plugin.displayName ?? plugin.name)}
                onclick={async (e) => {
                    e.stopPropagation()
                    plugin.enabled = !plugin.enabled
                    DBState.db.plugins[i] = plugin
                    loadPlugins()
                    void requestImmediateSave()
                    e.preventDefault()
                }}
            >
                <span class="plugin-activation-icon" class:plugin-activation-icon--active={plugin.enabled}>
                    {#if plugin.enabled}<PowerIcon />{:else}<PowerOffIcon />{/if}
                </span>
            </ShButton>

            <ShButton
                variant="outline"
                size="icon"
                aria-label={language.resetPluginPermission}
                title={language.resetPluginPermission}
                onclick={async (e) => {
                    e.stopPropagation()
                    const v = await alertConfirm(
                        language.resetPluginPermissionConfirm.replace("{}", plugin.displayName ?? plugin.name)
                    )
                    if (v) {
                        await resetPluginPermission(plugin.name)
                        notifySuccess(language.resetPluginPermissionDone.replace("{}", plugin.displayName ?? plugin.name))
                    }
                }}
            >
                <ShieldIcon />
            </ShButton>
            </div>

            <div class="plugin-action-column plugin-action-column--end">
            <ShButton
                variant="outline"
                size="icon"
                data-plugin-code-editor={plugin.name}
                aria-label={language.editPluginCode}
                title={language.editPluginCode}
                onclick={(e) => {
                    e.stopPropagation()
                    openPluginCodeEditor(plugin)
                }}
            >
                <CodeXmlIcon />
            </ShButton>

            <ShButton
                variant="destructive"
                size="icon"
                aria-label={language.remove}
                title={language.remove}
                onclick={async (e) => {
                    e.stopPropagation()
                    const v = await alertConfirm(
                        language.removeConfirm +
                            (plugin.displayName ?? plugin.name),
                    );
                    if (v) {
                        await removePlugins([plugin.name])
                    }
                }}
            >
                <TrashIcon />
            </ShButton>
            </div>
            </div>
        </div>
        {#if plugin.version === 1}
            <ShAlert variant="warning" className="mt-2">
                {language.pluginVersionWarn
                    .replace("{{plugin_version}}", "API V1")
                    .replace("{{required_version}}", "API V3")}
            </ShAlert>
            <!--List up args-->
        {:else if Object.keys(plugin.arguments).filter((i) => !i.startsWith("hidden_")).length > 0 && showParams.includes(plugin.name)}
            <div id={`plugin-arguments-${i}`} class="plugin-arguments flex flex-col mt-2 rounded-md border border-darkborderc bg-darkbg/50 p-3">
                {#each Object.keys(plugin.arguments) as arg}
                    {#if !arg.startsWith("hidden_")}
                        {#if typeof(plugin?.argMeta?.[arg]?.divider) === 'string'}
                            {#if plugin?.argMeta?.[arg]?.divider}
                                <div class="plugin-argument-divider mt-6">
                                    <div aria-hidden="true" class="min-w-2 flex-1 border-t border-darkborderc"></div>
                                    <span class="min-w-0 px-2 text-center text-sm text-textarea">{plugin?.argMeta?.[arg]?.divider}</span>
                                    <div aria-hidden="true" class="min-w-2 flex-1 border-t border-darkborderc"></div>
                                </div>
                            {:else}
                                <div aria-hidden="true" class="w-full border-t border-darkborderc mt-6"></div>
                            {/if}
                        {/if}
                        <span class="mb-2 mt-6">{plugin?.argMeta?.[arg]?.name || arg}</span>
                        {#if plugin?.argMeta?.[arg]?.description}
                            <span class="mb-2 text-sm text-textcolor2">{plugin?.argMeta?.[arg]?.description}</span>
                        {/if}
                        {#if Array.isArray(plugin.arguments[arg])}
                            <SelectInput
                                className="mt-2 mb-4 min-w-0 w-full max-w-full"
                                bind:value={
                                    DBState.db.plugins[i].realArg[arg] as string
                                }
                            >
                                {#each plugin.arguments[arg] as a}
                                    <OptionInput value={a}>{a}</OptionInput>
                                {/each}
                            </SelectInput>
                        {:else if plugin.arguments[arg] === "string"}

                            {#if plugin?.argMeta?.[arg]?.textarea}
                                <TextAreaInput
                                    className="mt-2 min-w-0 w-full max-w-full"
                                    bind:value={
                                        DBState.db.plugins[i].realArg[arg] as string
                                    }
                                    placeholder={plugin?.argMeta?.[arg]?.placeholder}
                                />
                            {:else if plugin?.argMeta?.[arg]?.radio}
                                {#each plugin?.argMeta?.[arg]?.radio?.split(",") as radioOption}
                                    <CheckInput
                                        className="min-w-0 w-full max-w-full"
                                        check={DBState.db.plugins[i].realArg[arg] === (radioOption.split('|').at(-1))}
                                        onChange={(e) => {
                                            if(e){
                                                DBState.db.plugins[i].realArg[arg] = (radioOption.split('|').at(-1))
                                            }
                                        }}
                                        margin={false}
                                        name={radioOption.split('|').at(0)}
                                    />
                                {/each}
                            {:else}
                                <TextInput
                                    className="mt-2 min-w-0 w-full max-w-full"
                                    bind:value={
                                        DBState.db.plugins[i].realArg[arg] as string
                                    }
                                    placeholder={plugin?.argMeta?.[arg]?.placeholder}
                                />
                            {/if}
                        {:else if plugin.arguments[arg] === "int"}
                            {#if plugin?.argMeta?.[arg]?.checkbox}
                                <CheckInput
                                    className="min-w-0 w-full max-w-full"
                                    check={DBState.db.plugins[i].realArg[arg] === '1'}
                                    onChange={(e) => {
                                        DBState.db.plugins[i].realArg[arg] = e ? '1' : '0'
                                    }}
                                    margin={false}
                                    name={
                                        plugin?.argMeta?.[arg]?.checkbox === '1' ? language.enable : plugin?.argMeta?.[arg]?.checkbox
                                    }
                                />
                            {:else if plugin?.argMeta?.[arg]?.radio}
                                {#each plugin?.argMeta?.[arg]?.radio?.split(",") as radioOption}
                                    <CheckInput
                                        className="min-w-0 w-full max-w-full"
                                        check={DBState.db.plugins[i].realArg[arg] === parseInt(radioOption.split('|').at(-1))}
                                        onChange={(e) => {
                                            if(e){
                                                DBState.db.plugins[i].realArg[arg] = parseInt(radioOption.split('|').at(-1))
                                            }
                                        }}
                                        margin={false}
                                        name={radioOption.split('|').at(0)}
                                    />
                                {/each}
                            {:else}
                                <NumberInput
                                    className="mt-2 min-w-0 w-full max-w-full"
                                    bind:value={
                                        DBState.db.plugins[i].realArg[arg] as number
                                    }
                                    placeholder={plugin?.argMeta?.[arg]?.placeholder}
                                />
                            {/if}
                        {/if}
                    {/if}
                {/each}
            </div>
        {/if}
        {/if}
    {/snippet}
</CollectionOrganizerList>
</SettingPage>

<ShDialog
    bind:open={pluginCodeEditorOpen}
    size="xl"
    tier="base"
    resizable={true}
    closeOnEscape={true}
    closeOnOutsideClick={false}
    contentClass="plugin-code-dialog"
    bodyClass="min-h-0 flex-1"
    ariaLabel={language.editPluginCode}
>
    {#snippet title()}<span class="inline-flex items-center gap-2"><CodeXmlIcon size={20} />{pluginCodeDisplayName()}</span>{/snippet}

    <textarea
        class="plugin-code-editor"
        data-plugin-code-editor-input
        bind:value={pluginCodeDraft}
        spellcheck={false}
        aria-label={language.pluginCode}
    ></textarea>

    {#snippet footer()}
        <div class="flex w-full flex-col gap-2 sm:flex-row">
            <ShButton className="flex-1" variant="success" disabled={applyingPluginCode || !pluginCodeDraft.trim()} onclick={applyPluginCode}>
                <SaveIcon /> {language.apply}
            </ShButton>
            <ShButton className="flex-1" variant="soft-primary" onclick={() => downloadFile(pluginCodeFilename(pluginCodeName), pluginCodeDraft)}>
                <DownloadIcon /> {language.download}
            </ShButton>
        </div>
    {/snippet}
</ShDialog>

<style>
    .plugin-item-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
    }

    .plugin-item-title {
        flex: 1 1 12rem;
        min-width: 0;
        overflow-wrap: anywhere;
    }

    .plugin-item-name,
    .plugin-item-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: .4rem;
        min-width: 0;
    }

    .plugin-setting-count {
        border: 1px solid var(--settings-border, var(--color-darkborderc));
        border-radius: calc(var(--risu-radius-sm) * 1.4);
        padding: .1rem .35rem;
        color: var(--risu-theme-textcolor2);
        font-size: .7rem;
        font-weight: 600;
    }

    .plugin-item-meta {
        color: var(--risu-theme-textcolor2);
        font-size: .72rem;
        font-weight: 450;
    }

    /* Plugin rows carry two action columns, so their grid columns need more room than module rows. */
    :global([data-collection-organizer-list="plugins"]) { --collection-item-min: 22rem; }

    /* The power button already shows the enabled state; touch, narrow and short screens keep the name only. */
    @media (pointer: coarse), (max-width: 640px), (max-height: 640px) {
        .plugin-item-meta { display: none; }
    }

    /* Narrow item columns: the name takes its own line and every action lines up in one row beneath it. */
    @container collection-items (max-width: 520px) {
        .plugin-item-title { flex-basis: 100%; }
        .plugin-item-actions .plugin-action-column { flex-direction: row; }
    }

    .plugin-item-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 0.45rem;
        min-width: 0;
        max-width: 100%;
        margin-left: auto;
    }

    .plugin-item-actions :global(button),
    .plugin-item-actions a {
        flex-shrink: 0;
    }

    .plugin-utility-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: .35rem;
    }

    .plugin-action-column {
        display: flex;
        flex-direction: column;
        gap: .35rem;
    }

    .plugin-action-column--end {
        margin-left: .15rem;
    }

    .plugin-activation-icon {
        display: inline-flex;
        color: var(--risu-theme-textcolor2);
        transition: color 180ms ease, filter 180ms ease;
    }

    .plugin-activation-icon--active {
        color: var(--color-info);
        filter: drop-shadow(0 0 .28rem color-mix(in srgb, var(--color-info) 75%, transparent));
    }

    .plugin-icon-link {
        display: inline-flex;
        width: 2.5rem;
        height: 2.5rem;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--settings-border, var(--color-darkborderc));
        border-radius: var(--risu-radius-md);
        transition: background-color 180ms ease, color 180ms ease;
    }

    .plugin-icon-link:hover,
    .plugin-icon-link:focus-visible {
        background: color-mix(in srgb, var(--risu-theme-textcolor) 8%, transparent);
        outline: none;
    }

    .plugin-arguments {
        min-width: 0;
        overflow-wrap: anywhere;
    }

    .plugin-argument-divider {
        display: flex;
        align-items: center;
        min-width: 0;
    }

    :global(.plugin-code-dialog) {
        width: min(92vw, 70rem);
        height: min(86vh, 54rem);
        max-width: calc(100vw - 2rem);
        overflow: hidden;
    }

    .plugin-code-editor {
        width: 100%;
        height: 100%;
        min-height: 24rem;
        resize: none;
        border: 1px solid var(--settings-border, var(--color-darkborderc));
        border-radius: var(--settings-radius, var(--risu-radius-xl));
        background: var(--color-darkbg);
        padding: .85rem;
        color: var(--risu-theme-textcolor);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: .8rem;
        line-height: 1.5;
        outline: none;
        tab-size: 4;
    }

    .plugin-code-editor:focus-visible {
        border-color: var(--color-borderc);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-borderc) 35%, transparent);
    }
</style>
