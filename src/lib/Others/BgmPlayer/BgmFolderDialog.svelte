<script lang="ts">
    import { onMount } from 'svelte'
    import { FolderPlusIcon, XIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    import { bgmFoldersAvailable, listBgmFolders, locateBgmFile, saveBgmFolders, scanBgmFolder, type BgmFolder } from 'src/ts/bgm/folderApi'

    interface Props {
        open: boolean
        /** False when only managing folders (no slot to add to). */
        canAdd: boolean
        onAdd: (items: Array<{ folderId: string; relPath: string }>) => void
    }

    let { open = $bindable(), canAdd, onAdd }: Props = $props()

    const text = language.bgm
    const MAX_VISIBLE_FILES = 400
    const available = bgmFoldersAvailable()

    let folders = $state<BgmFolder[]>([])
    let loadError = $state('')
    let newPath = $state('')
    let folderError = $state('')
    let saving = $state(false)
    let activeFolderId = $state('')
    let files = $state<string[]>([])
    let truncated = $state(false)
    let scanning = $state(false)
    let filter = $state('')
    let selected = $state<Set<string>>(new Set())
    let pastedPath = $state('')
    let pathMessage = $state('')

    const filtered = $derived.by(() => {
        const query = filter.trim().toLowerCase()
        return query ? files.filter(file => file.toLowerCase().includes(query)) : files
    })

    function describe(error: unknown) {
        return text.loadFailed.replace('{error}', error instanceof Error ? error.message : String(error))
    }

    async function loadFolders() {
        try {
            folders = await listBgmFolders()
            loadError = ''
            if (!folders.some(folder => folder.id === activeFolderId)) await openFolder(folders[0]?.id ?? '')
        } catch (error) {
            loadError = describe(error)
        }
    }

    async function openFolder(folderId: string) {
        activeFolderId = folderId
        files = []
        truncated = false
        selected = new Set()
        filter = ''
        if (!folderId || !canAdd) return
        scanning = true
        try {
            const result = await scanBgmFolder(folderId)
            if (activeFolderId !== folderId) return
            files = result.files
            truncated = result.truncated
        } catch (error) {
            loadError = describe(error)
        } finally {
            scanning = false
        }
    }

    async function save(next: Array<{ id?: string; path: string; name?: string }>) {
        saving = true
        folderError = ''
        try {
            const result = await saveBgmFolders(next)
            if ('errors' in result) {
                const reason = result.errors[0]?.reason ?? 'missing'
                folderError = text.folderErrors[reason]
                return false
            }
            folders = result.folders
            return true
        } catch (error) {
            folderError = describe(error)
            return false
        } finally {
            saving = false
        }
    }

    async function registerFolder() {
        const path = newPath.trim().replace(/^"(.*)"$/, '$1')
        if (!path) return
        if (await save([...folders, { path }])) {
            newPath = ''
            await openFolder(folders.at(-1)?.id ?? '')
        }
    }

    async function removeFolder(folderId: string) {
        if (await save(folders.filter(folder => folder.id !== folderId))) {
            if (activeFolderId === folderId) await openFolder(folders[0]?.id ?? '')
        }
    }

    function toggle(file: string) {
        const next = new Set(selected)
        if (next.has(file)) next.delete(file)
        else next.add(file)
        selected = next
    }

    function addSelected() {
        onAdd([...selected].map(relPath => ({ folderId: activeFolderId, relPath })))
        open = false
    }

    async function addPastedPath() {
        const path = pastedPath.trim().replace(/^"(.*)"$/, '$1')
        if (!path) return
        try {
            const located = await locateBgmFile(path)
            if (!located) {
                pathMessage = text.pathOutside
                return
            }
            onAdd([located])
            open = false
        } catch (error) {
            pathMessage = describe(error)
        }
    }

    onMount(() => {
        if (available) void loadFolders()
    })
</script>

<ShDialog bind:open size="lg" tier="base" closeOnEscape ariaLabel={text.folderDialogTitle} bodyClass="bgm-folder-body">
    {#snippet title()}{text.folderDialogTitle}{/snippet}
    {#snippet description()}{text.foldersHelp}{/snippet}

    {#if !available}
        <p class="bgm-folder-muted">{text.folderUnavailableWeb}</p>
    {:else}
        {#if loadError}<p class="bgm-folder-error" role="alert">{loadError}</p>{/if}

        <section class="bgm-folder-section">
            {#if folders.length}
                <ul class="bgm-folder-list">
                    {#each folders as folder (folder.id)}
                        <li class="bgm-folder-row" class:is-active={canAdd && folder.id === activeFolderId}>
                            <button type="button" class="bgm-folder-pick" disabled={!canAdd} onclick={() => openFolder(folder.id)}>
                                <span class="bgm-folder-name">{folder.name}</span>
                                <span class="bgm-folder-path">{folder.path}</span>
                            </button>
                            <button type="button" class="bgm-folder-icon" aria-label={text.removeFolder} disabled={saving} onclick={() => removeFolder(folder.id)}><XIcon size={15} /></button>
                        </li>
                    {/each}
                </ul>
            {:else}
                <p class="bgm-folder-muted">{text.noFolders}</p>
            {/if}
            <form class="bgm-folder-add" onsubmit={(event) => { event.preventDefault(); void registerFolder() }}>
                <input class="bgm-folder-input" bind:value={newPath} placeholder={text.folderPathPlaceholder} spellcheck="false" />
                <button type="submit" class="bgm-folder-button" disabled={saving || !newPath.trim()}><FolderPlusIcon size={15} />{text.addFolderButton}</button>
            </form>
            {#if folderError}<p class="bgm-folder-error" role="alert">{folderError}</p>{/if}
        </section>

        {#if canAdd && activeFolderId}
            <section class="bgm-folder-section">
                <input class="bgm-folder-input" bind:value={filter} placeholder={text.filterPlaceholder} spellcheck="false" />
                {#if scanning}
                    <p class="bgm-folder-muted">…</p>
                {:else if !files.length}
                    <p class="bgm-folder-muted">{text.noFiles}</p>
                {:else}
                    <ul class="bgm-file-list">
                        {#each filtered.slice(0, MAX_VISIBLE_FILES) as file (file)}
                            <li>
                                <label class="bgm-file-row">
                                    <input type="checkbox" checked={selected.has(file)} onchange={() => toggle(file)} />
                                    <span title={file}>{file}</span>
                                </label>
                            </li>
                        {/each}
                    </ul>
                    {#if truncated}<p class="bgm-folder-muted">{text.scanTruncated}</p>{/if}
                {/if}
            </section>
        {/if}

        {#if canAdd && folders.length}
            <form class="bgm-folder-add" onsubmit={(event) => { event.preventDefault(); void addPastedPath() }}>
                <input class="bgm-folder-input" bind:value={pastedPath} placeholder={text.pastePath} spellcheck="false" oninput={() => pathMessage = ''} />
                <button type="submit" class="bgm-folder-button" disabled={!pastedPath.trim()}>{text.add}</button>
            </form>
            {#if pathMessage}<p class="bgm-folder-error" role="alert">{pathMessage}</p>{/if}
        {/if}
    {/if}

    {#snippet footer()}
        {#if canAdd && available}
            <button type="button" class="bgm-folder-button is-primary" disabled={!selected.size} onclick={addSelected}>
                {text.addSelected.replace('{count}', String(selected.size))}
            </button>
        {/if}
    {/snippet}
</ShDialog>

<style>
    .bgm-folder-section { display: flex; flex-direction: column; gap: 8px; }
    .bgm-folder-section + .bgm-folder-section { margin-top: 16px; }
    .bgm-folder-list, .bgm-file-list {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--color-darkborderc);
        border-radius: var(--risu-radius-md);
        overflow: hidden;
    }
    .bgm-file-list { max-height: 320px; overflow-y: auto; }
    .bgm-folder-row { display: flex; align-items: center; gap: 4px; padding-right: 6px; }
    .bgm-folder-row + .bgm-folder-row, .bgm-file-list li + li { border-top: 1px solid var(--color-darkborderc); }
    .bgm-folder-row.is-active { background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
    .bgm-folder-pick { display: flex; flex-direction: column; align-items: flex-start; flex: 1; min-width: 0; padding: 8px 12px; text-align: left; }
    .bgm-folder-pick:disabled { cursor: default; }
    .bgm-folder-name { font-weight: 600; }
    .bgm-folder-path { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--color-textcolor2); }
    .bgm-folder-icon { display: grid; place-items: center; width: 30px; height: 30px; flex-shrink: 0; border-radius: var(--risu-radius-md); color: var(--color-textcolor2); }
    .bgm-folder-icon:hover:not(:disabled) { color: var(--color-textcolor); background: var(--color-selected); }
    .bgm-folder-add { display: flex; gap: 8px; margin-top: 8px; }
    .bgm-folder-input {
        flex: 1;
        min-width: 0;
        min-height: 34px;
        padding: 6px 10px;
        border: 1px solid var(--color-darkborderc);
        border-radius: var(--risu-radius-md);
        background: var(--color-bgcolor);
        color: var(--color-textcolor);
    }
    .bgm-folder-input::placeholder { color: var(--color-textcolor2); }
    .bgm-folder-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 34px;
        padding: 0 12px;
        border-radius: var(--risu-radius-md);
        background: var(--color-darkbutton);
        color: var(--color-textcolor);
        white-space: nowrap;
    }
    .bgm-folder-button:hover:not(:disabled) { background: var(--color-selected); }
    .bgm-folder-button:disabled { opacity: 0.5; }
    .bgm-folder-button.is-primary { color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 16%, transparent); }
    .bgm-file-row { display: flex; align-items: center; gap: 10px; padding: 7px 12px; cursor: pointer; }
    .bgm-file-row:hover { background: var(--color-selected); }
    .bgm-file-row input { accent-color: var(--color-primary); flex-shrink: 0; }
    .bgm-file-row span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bgm-folder-muted { font-size: 13px; color: var(--color-textcolor2); }
    .bgm-folder-error { font-size: 13px; color: var(--color-danger, var(--color-draculared)); }
    .bgm-folder-input:focus-visible, .bgm-folder-button:focus-visible, .bgm-folder-icon:focus-visible, .bgm-folder-pick:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 1px;
    }
</style>
