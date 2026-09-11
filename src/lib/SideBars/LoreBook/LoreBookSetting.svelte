<script lang="ts">
    import { DBState } from 'src/ts/stores.svelte';
    import { language } from "../../../lang";
    import { SunIcon, LinkIcon } from "@lucide/svelte";
    import { exportLoreBook, importLoreBook } from "../../../ts/process/lorebook.svelte";
    import NumberInput from "../../UI/GUI/NumberInput.svelte";
    import ShSelect from "../../UI/GUI/ShSelect.svelte";
    import ShSwitch from "../../UI/GUI/ShSwitch.svelte";
    import OptionInput from "../../UI/GUI/OptionInput.svelte";
    import SolarBoldIcon from "../../UI/Icons/SolarBoldIcon.svelte";
    import LoreBookList from "./LoreBookList.svelte";
    import LoreBookWorkspaceDialog from "./LoreBookWorkspaceDialog.svelte";
    import BardLoreSearchPreview from "./BardLoreSearchPreview.svelte";
    import BardLoreAnalysisPanel from "./BardLoreAnalysisPanel.svelte";
    import Help from "src/lib/Others/Help.svelte";
    import { selectedCharID } from "src/ts/stores.svelte";
    import type { character, loreBook } from "src/ts/storage/database.svelte";
    import {
        applyMaterializedBardLoreEntries,
        createBardLoreSettings,
        materializeBardLoreEntries,
        upgradeLegacyLorebook,
        type BardLoreEntry,
        type BardLoreKind,
    } from "src/ts/lorebook/bardLore";
    import { ensureLorebookIds } from 'src/ts/lorebook/workspaceOperations';
    import { applyBardLoreAnalysisSettings, normalizeBardLoreAnalysisDefaults } from 'src/ts/lorebook/bardLoreAnalysisSettings';
    import {
        coreLorebookScopeKey,
        createCharacterLocalActivationBinding,
        createLorebookOwnerBinding,
        ensureStableLorebookOwnerId,
        loremasterDisabledBackupKey,
        readLoremasterDisabledBackups,
        resolveCharacterGlobalLoreLabel,
    } from './loreBookWorkspaceConnections';
    import { v4 as createUuid } from 'uuid';
    import { alertConfirm, alertError, notifySuccess } from 'src/ts/alert';
    import { downloadFile } from 'src/ts/globalApi.svelte';
    import { selectFileByDom } from 'src/ts/util';
    import {
        cleanseBardLoreMetadata,
        exportBardLoreMetadata,
        importBardLoreMetadata,
    } from 'src/ts/lorebook/bardLorePortable';

    let submenu = $state(0)
    let workspaceOpen = $state(false)
    let loreView = $state<'legacy' | 'bard'>('legacy')
    let viewedCharacterId = $state('')
    const bardFieldWeightKeys = ['name', 'keys', 'aliases', 'tags', 'facets', 'summary', 'content'] as const
    const bardRouterKinds: BardLoreKind[] = ['system', 'character', 'location', 'faction', 'item', 'event', 'concept', 'other']

    function routerAliases(value: string): string[] {
        return [...new Set(value.split(/[,\n]/u).map((item) => item.trim()).filter(Boolean))]
    }
    let bardActive = $derived(
        submenu === 0
        && DBState.db.characters[$selectedCharID]?.bardLore?.mode === 'bard'
    )
    let bardView = $derived(
        submenu === 0
        && loreView === 'bard'
        && Boolean(DBState.db.characters[$selectedCharID]?.bardLore)
    )
    let bardEntries = $derived.by(() => {
        const character = DBState.db.characters[$selectedCharID]
        return character?.bardLore
            ? materializeBardLoreEntries(character.bardLore, character.globalLore ?? [])
            : []
    })

    function applyBardEntries(owner: character, next: BardLoreEntry[]) {
        if (!owner.bardLore) return
        const applied = applyMaterializedBardLoreEntries(owner.bardLore, owner.globalLore ?? [], next)
        owner.globalLore = applied.legacyEntries
        owner.bardLore = applied.state
    }

    function applyLegacyEntries(owner: character, next: loreBook[]) {
        const withIds = owner.bardLore ? ensureLorebookIds(next, createUuid) : next
        owner.globalLore = withIds
        if (!owner.bardLore) return
        const applied = applyMaterializedBardLoreEntries(
            owner.bardLore,
            withIds,
            materializeBardLoreEntries(owner.bardLore, withIds),
        )
        owner.globalLore = applied.legacyEntries
        owner.bardLore = applied.state
    }
    $effect(() => {
        const character = DBState.db.characters[$selectedCharID]
        if (!character || viewedCharacterId === character.chaId) return
        viewedCharacterId = character.chaId
        loreView = character.bardLore?.mode === 'bard' ? 'bard' : 'legacy'
    })
    let activeBinding = $derived.by(() => {
        const character = DBState.db.characters[$selectedCharID]
        if (submenu === 0) {
            const chat = character.chats[character.chatPage]
            if (bardView && character.bardLore) {
                return {
                    ...createLorebookOwnerBinding(
                        character,
                        bardEntries,
                        (owner, next) => applyBardEntries(owner, next as BardLoreEntry[]),
                        (owner) => DBState.db.characters.includes(owner),
                    ),
                    scopeKey: coreLorebookScopeKey({ kind: 'character', chaId: character.chaId }),
                    scopeLabel: `${character.name}의 ${language.lorebookWorkspace.bardLore}`,
                    localActivation: createCharacterLocalActivationBinding(
                        character,
                        chat,
                        DBState.db.localActivationInGlobalLorebook,
                        () => DBState.db.characters,
                    ),
                }
            }
            return {
                ...createLorebookOwnerBinding(
                    character,
                    character.globalLore,
                    (owner, next) => applyLegacyEntries(owner, next),
                    (owner) => DBState.db.characters.includes(owner),
                ),
                scopeKey: coreLorebookScopeKey({ kind: 'character', chaId: character.chaId }),
                scopeLabel: `${character.name} · ${language.character}`,
                localActivation: createCharacterLocalActivationBinding(
                    character,
                    chat,
                    DBState.db.localActivationInGlobalLorebook,
                    () => DBState.db.characters,
                ),
            }
        }
        const chat = character.chats[character.chatPage]
        return {
            ...createLorebookOwnerBinding(
                chat,
                chat.localLore,
                (owner, next) => { owner.localLore = next },
                (owner) => DBState.db.characters.includes(character) && character.chats.includes(owner),
            ),
            scopeKey: coreLorebookScopeKey({
                kind: 'chat',
                chaId: character.chaId,
                chatId: ensureStableLorebookOwnerId(chat, createUuid),
            }),
            scopeLabel: `${character.name} · ${chat.name || language.Chat}`,
            localActivation: undefined,
        }
    })
    let activeLoremasterBackups = $derived.by(() => {
        const character = DBState.db.characters[$selectedCharID]
        const key = submenu === 0
            ? loremasterDisabledBackupKey({ kind: 'character', chaId: character.chaId })
            : loremasterDisabledBackupKey({
                kind: 'chat',
                chaId: character.chaId,
                chatId: ensureStableLorebookOwnerId(
                    character.chats[character.chatPage],
                    createUuid,
                ),
            })
        return key
            ? readLoremasterDisabledBackups(DBState.db.pluginCustomStorage, key)
            : undefined
    })
    let activeChildLabelResolver = $derived(
        submenu === 1
            ? (id: string) => resolveCharacterGlobalLoreLabel(
                DBState.db.characters[$selectedCharID].globalLore,
                id,
            )
            : undefined
    )

    function isAllCharacterLoreAlwaysActive() {
        const globalLore = DBState.db.characters[$selectedCharID].globalLore;
        return globalLore && globalLore.every((book) => book.alwaysActive);
    }

    function isAllChatLoreAlwaysActive() {
        const localLore = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].localLore;
        return localLore && localLore.every((book) => book.alwaysActive);
    }

    function toggleCharacterLoreAlwaysActive() {
        const globalLore = DBState.db.characters[$selectedCharID].globalLore;

        if (!globalLore) return;
        
        const allActive = globalLore.every((book) => book.alwaysActive);
        
        globalLore.forEach((book) => {
            book.alwaysActive = !allActive;
        });
    }

    function toggleChatLoreAlwaysActive() {
        const localLore = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].localLore;

        if (!localLore) return;

        const allActive = localLore.every((book) => book.alwaysActive);

        localLore.forEach((book) => {
            book.alwaysActive = !allActive;
        });
    }

    function viewLegacyLore() {
        loreView = 'legacy'
    }

    function ensureBardLore() {
        const character = DBState.db.characters[$selectedCharID]
        const withIds = ensureLorebookIds(character.globalLore ?? [], createUuid)
        if (withIds.some((entry, index) => entry !== character.globalLore[index])) {
            character.globalLore = withIds
        }
        if (!character.bardLore) {
            character.bardLore = upgradeLegacyLorebook(
                character.globalLore ?? [],
                createUuid,
                applyBardLoreAnalysisSettings(
                    createBardLoreSettings(),
                    normalizeBardLoreAnalysisDefaults(DBState.db.risuBardGrimoireAnalysisDefaults),
                ),
            )
            character.bardLore.mode = 'legacy'
        }
        return character.bardLore
    }

    function viewBardLore() {
        ensureBardLore()
        loreView = 'bard'
    }

    function setBardLoreActive(event: Event & { currentTarget: HTMLInputElement }) {
        const character = DBState.db.characters[$selectedCharID]
        const bardLore = ensureBardLore()
        bardLore.mode = event.currentTarget.checked ? 'bard' : 'legacy'
    }

    function bardLoreMetadataFileName(name: string): string {
        const safeName = name.trim().replace(/[<>:"/\\|?*.,]+/g, '_') || 'character'
        return `${safeName}.bard-lore-metadata.json`
    }

    async function exportBardLoreOverlay() {
        const character = DBState.db.characters[$selectedCharID]
        const bardLore = ensureBardLore()
        await downloadFile(
            bardLoreMetadataFileName(character.name),
            exportBardLoreMetadata(bardLore, character.globalLore, character.name),
        )
        notifySuccess(language.lorebookWorkspace.bardPortableExportSuccess)
    }

    async function importBardLoreOverlay() {
        try {
            const files = await selectFileByDom(['json'])
            if (!files?.[0]) return
            const character = DBState.db.characters[$selectedCharID]
            const result = importBardLoreMetadata(
                ensureBardLore(),
                character.globalLore,
                await files[0].text(),
                createUuid,
            )
            character.bardLore = result.state
            notifySuccess(language.lorebookWorkspace.bardPortableImportSuccess(
                result.report.applied,
                result.report.createdDerived,
                result.report.skipped,
                result.report.unresolvedLinks,
            ))
        } catch (error) {
            await alertError(`${language.lorebookWorkspace.bardPortableImportFailed}\n${error instanceof Error ? error.message : String(error)}`)
        }
    }

    async function cleanseBardLoreOverlay() {
        if (!await alertConfirm(language.lorebookWorkspace.bardPortableCleanseConfirm)) return
        const character = DBState.db.characters[$selectedCharID]
        cleanseBardLoreMetadata(character)
        loreView = 'legacy'
        notifySuccess(language.lorebookWorkspace.bardPortableCleanseSuccess)
    }
</script>

<div data-lorebook-sidebar-layout class="flex w-full flex-col">
<nav data-lorebook-primary-tabs class="my-2 flex w-full gap-1 rounded-lg bg-selected/25 p-1" aria-label={language.loreBook}>
    <button onclick={() => {
        submenu = 0
    }} class="min-h-9 flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-selected/40" class:bg-selected={submenu === 0} aria-pressed={submenu === 0} title={language.globalLoreInfo}>
        <span>{language.character}</span>
    </button>
    <button onclick={() => {
        submenu = 1
    }} class="min-h-9 flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-selected/40" class:bg-selected={submenu === 1} aria-pressed={submenu === 1} title={language.localLoreInfo}>
        <span>{language.Chat}</span>
    </button>
    <button onclick={() => {
        submenu = 2
    }} class="min-h-9 flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-selected/40" class:bg-selected={submenu === 2} aria-pressed={submenu === 2}>
        <span>{language.settings}</span>
    </button>
</nav>
{#if submenu === 0}
    <div class="mb-2 flex w-full gap-1 rounded-lg bg-selected/25 p-1" data-bard-lore-mode>
        <button
            data-bard-lore-view="legacy"
            class="min-h-9 flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-selected/40"
            class:bg-selected={!bardView}
            aria-pressed={!bardView}
            onclick={viewLegacyLore}
        >{language.lorebookWorkspace.legacyLoreEditor}</button>
        <button
            data-bard-lore-view="bard"
            class="min-h-9 flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-selected/40"
            class:bg-selected={bardView}
            aria-pressed={bardView}
            onclick={viewBardLore}
        >{language.lorebookWorkspace.bardLoreEditor}</button>
    </div>
{/if}
{#if submenu !== 2}
    <button
        data-lorebook-workspace-open
        class="mt-2 mb-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-info px-4 py-2.5 font-semibold text-on-info shadow-sm transition-colors hover:bg-info/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info active:bg-info/75"
        aria-label={language.lorebookWorkspace.openScope(activeBinding.scopeLabel)}
        title={language.lorebookWorkspace.open}
        onclick={() => { workspaceOpen = true }}
    >
        <SolarBoldIcon name="notebook" size={20} />
        <span>{bardView ? language.lorebookWorkspace.openBardLore : language.lorebookWorkspace.editor}</span>
    </button>
    {#if !bardView}
        <LoreBookList {submenu} />
    {:else}
        <div class="bard-activation-card" data-bard-lore-active data-active={bardActive}>
            <div class="bard-activation-copy">
                <span class="bard-status-dot" aria-hidden="true"></span>
                <div>
                    <strong>{bardActive
                        ? language.lorebookWorkspace.bardLoreEnabled
                        : language.lorebookWorkspace.bardLoreDisabled}</strong>
                    <p>{bardActive
                        ? language.lorebookWorkspace.bardLoreEnabledDescription
                        : language.lorebookWorkspace.bardLoreDisabledDescription}</p>
                </div>
            </div>
            <label class="bard-switch">
                <span>{language.lorebookWorkspace.bardUseForGeneration}</span>
                <input
                    type="checkbox"
                    role="switch"
                    checked={bardActive}
                    aria-label={language.lorebookWorkspace.bardUseForGeneration}
                    onchange={setBardLoreActive}
                />
                <span class="bard-switch-track" aria-hidden="true"><span></span></span>
            </label>
        </div>
        <p class="mt-1 text-sm text-textcolor2">{language.lorebookWorkspace.bardLoreDescription}</p>
        <section class="lore-settings-card bard-portable-card" data-bard-lore-portable>
            <header class="lore-settings-card-header">
                <strong>{language.lorebookWorkspace.bardPortableData}</strong>
                <p>{language.lorebookWorkspace.bardPortableDescription}</p>
            </header>
            <div class="bard-portable-actions">
                <button type="button" onclick={() => void exportBardLoreOverlay()}>{language.lorebookWorkspace.bardPortableExport}</button>
                <button type="button" onclick={() => void importBardLoreOverlay()}>{language.lorebookWorkspace.bardPortableImport}</button>
                <button type="button" class="danger" onclick={() => void cleanseBardLoreOverlay()}>{language.lorebookWorkspace.bardPortableCleanse}</button>
            </div>
        </section>
        <BardLoreAnalysisPanel
            entries={bardEntries}
            settings={DBState.db.characters[$selectedCharID].bardLore!.settings}
            analysisRun={DBState.db.characters[$selectedCharID].bardLore!.analysisRun}
            onChange={(next) => applyBardEntries(DBState.db.characters[$selectedCharID], next)}
            onSettingsChange={(next) => { DBState.db.characters[$selectedCharID].bardLore!.settings = next }}
            onAnalysisRunChange={(next) => { DBState.db.characters[$selectedCharID].bardLore!.analysisRun = next }}
        />
        <BardLoreSearchPreview
            entries={bardEntries}
            settings={DBState.db.characters[$selectedCharID].bardLore!.settings}
            character={DBState.db.characters[$selectedCharID]}
        />
    {/if}
    {#if DBState.db.bulkEnabling && !bardView}
        <div class="text-textcolor2 mt-2 flex">
            <button onclick={() => {
                toggleCharacterLoreAlwaysActive()
            }} class="hover:text-textcolor cursor-pointer flex items-center gap-1">
                {#if isAllCharacterLoreAlwaysActive()}
                    <SunIcon />
                {:else}
                    <LinkIcon />
                {/if}
                <span class="text-xs">{language.character}</span>
            </button>
            <button onclick={() => {
                toggleChatLoreAlwaysActive()
            }} class="hover:text-textcolor ml-2 cursor-pointer flex items-center gap-1">
                {#if isAllChatLoreAlwaysActive()}
                    <SunIcon />
                {:else}
                    <LinkIcon />
                {/if}
                <span class="text-xs">{language.Chat}</span>
            </button>
        </div>
    {/if}
{:else}
    <div data-lorebook-settings class="flex w-full flex-col gap-3">
        {#if DBState.db.characters[$selectedCharID].bardLore}
            <section class="lore-settings-card">
                <header class="lore-settings-card-header">
                    <strong>{language.lorebookWorkspace.bardBudget}</strong>
                    <p>{language.lorebookWorkspace.bardBudgetDescription}</p>
                </header>
                <div class="lore-settings-grid">
                    <label data-lorebook-setting-field class="lore-setting-field">
                        <span>{language.lorebookWorkspace.bardTargetTokens}</span>
                        <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.targetTokens} />
                    </label>
                    <label data-lorebook-setting-field class="lore-setting-field">
                        <span>{language.lorebookWorkspace.bardMaximumTokens}</span>
                        <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.maximumTokens} />
                    </label>
                    <label data-lorebook-setting-field class="lore-setting-field">
                        <span>{language.lorebookWorkspace.bardMaxEntries}</span>
                        <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.maxEntries} />
                    </label>
                    <label data-lorebook-setting-field class="lore-setting-field">
                        <span>{language.lorebookWorkspace.bardContextMessages}</span>
                        <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.contextMessages} />
                    </label>
                </div>
                <details class="lore-settings-disclosure">
                    <summary>{language.lorebookWorkspace.bardAdvancedRetrieval}</summary>
                    <div class="lore-settings-grid">
                        <label data-lorebook-setting-field class="lore-setting-field">
                            <span>{language.lorebookWorkspace.bardMaxLinkDepth}</span>
                            <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.maxLinkDepth} />
                        </label>
                        <label data-lorebook-setting-field class="lore-setting-field">
                            <span>{language.lorebookWorkspace.bardMinimumSparseScore}</span>
                            <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.minimumSparseScore} />
                        </label>
                        <label data-lorebook-setting-field class="lore-setting-field">
                            <span>{language.lorebookWorkspace.bardDirectMatchScore}</span>
                            <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.directMatchScore} />
                        </label>
                        <label data-lorebook-setting-field class="lore-setting-field">
                            <span>{language.lorebookWorkspace.bardLinkScore}</span>
                            <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.linkScore} />
                        </label>
                        <label data-lorebook-setting-field class="lore-setting-field">
                            <span>{language.lorebookWorkspace.bardLinkScoreDecay}</span>
                            <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.linkScoreDecay} />
                        </label>
                        <label data-lorebook-setting-field class="lore-setting-field">
                            <span>{language.lorebookWorkspace.bardMinimumTermLength}</span>
                            <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.minimumTermLength} />
                        </label>
                        <label data-lorebook-setting-field class="lore-setting-field">
                            <span>{language.lorebookWorkspace.bardRouterDefaultCount}</span>
                            <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.router.defaultResultCount} />
                        </label>
                        <label data-lorebook-setting-field class="lore-setting-field">
                            <span>{language.lorebookWorkspace.bardRouterAmbientCount}</span>
                            <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.router.ambientResultCount} />
                        </label>
                        <div data-lorebook-setting-row class="lore-setting-row">
                            <span>{language.lorebookWorkspace.bardCjkPartialMatching}</span>
                            <ShSwitch bind:checked={DBState.db.characters[$selectedCharID].bardLore.settings.cjkPartialMatching} />
                        </div>
                        <strong class="lore-settings-subtitle">{language.lorebookWorkspace.bardFieldWeights}</strong>
                        {#each bardFieldWeightKeys as field}
                            <label data-lorebook-setting-field class="lore-setting-field">
                                <span>{field}</span>
                                <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.fieldWeights[field]} />
                            </label>
                        {/each}
                        <strong class="lore-settings-subtitle">{language.lorebookWorkspace.bardRouterLexicon}</strong>
                        <label data-lorebook-setting-field class="lore-setting-field">
                            <span>{language.lorebookWorkspace.bardRouterFilterFacets}</span>
                            <textarea
                                data-bard-lore-router-filter-facets
                                rows="2"
                                value={DBState.db.characters[$selectedCharID].bardLore.settings.router.filterFacetKeys.join(', ')}
                                onchange={(event) => { DBState.db.characters[$selectedCharID].bardLore!.settings.router.filterFacetKeys = routerAliases(event.currentTarget.value) }}
                            ></textarea>
                        </label>
                        {#each DBState.db.characters[$selectedCharID].bardLore.settings.router.facetVocabulary as facet, index}
                            <label data-lorebook-setting-field class="lore-setting-field">
                                <span>{language.lorebookWorkspace.bardRouterFacetVocabulary} · {facet.key}={facet.value}</span>
                                <textarea
                                    data-bard-lore-router-facet-vocabulary={index}
                                    rows="2"
                                    value={facet.aliases.join(', ')}
                                    onchange={(event) => {
                                        DBState.db.characters[$selectedCharID].bardLore!.settings.router.facetVocabulary[index] = {
                                            ...facet,
                                            aliases: routerAliases(event.currentTarget.value),
                                        }
                                    }}
                                ></textarea>
                            </label>
                        {/each}
                        {#each bardRouterKinds as kind}
                            <label data-lorebook-setting-field class="lore-setting-field">
                                <span>{kind}</span>
                                <textarea
                                    data-bard-lore-router-kind={kind}
                                    rows="2"
                                    value={DBState.db.characters[$selectedCharID].bardLore.settings.router.kindAliases[kind].join(', ')}
                                    onchange={(event) => { DBState.db.characters[$selectedCharID].bardLore!.settings.router.kindAliases[kind] = routerAliases(event.currentTarget.value) }}
                                ></textarea>
                            </label>
                        {/each}
                        {#each ['scene', 'list', 'describe', 'arbitrary'] as intent}
                            <label data-lorebook-setting-field class="lore-setting-field">
                                <span>{intent}</span>
                                <textarea
                                    data-bard-lore-router-intent={intent}
                                    rows="2"
                                    value={DBState.db.characters[$selectedCharID].bardLore.settings.router.intentAliases[intent as 'scene' | 'list' | 'describe' | 'arbitrary'].join(', ')}
                                    onchange={(event) => { DBState.db.characters[$selectedCharID].bardLore!.settings.router.intentAliases[intent as 'scene' | 'list' | 'describe' | 'arbitrary'] = routerAliases(event.currentTarget.value) }}
                                ></textarea>
                            </label>
                        {/each}
                    </div>
                </details>
                <details class="lore-settings-disclosure">
                    <summary>{language.lorebookWorkspace.bardAnalysisSettings}</summary>
                    <div class="lore-settings-grid">
                        <label data-lorebook-setting-field class="lore-setting-field">
                            <span>{language.lorebookWorkspace.bardAnalysisBatchEntries}</span>
                            <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.analysisBatchEntries} />
                        </label>
                        <label data-lorebook-setting-field class="lore-setting-field">
                            <span>{language.lorebookWorkspace.bardAnalysisInputTokens}</span>
                            <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.analysisInputTokens} />
                        </label>
                        <label data-lorebook-setting-field class="lore-setting-field">
                            <span>{language.lorebookWorkspace.bardAnalysisOutputTokens}</span>
                            <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.analysisOutputTokens} />
                        </label>
                        <label data-lorebook-setting-field class="lore-setting-field">
                            <span>{language.lorebookWorkspace.bardAnalysisLinkedDepth}</span>
                            <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.analysisLinkedDepth} />
                        </label>
                        <label data-lorebook-setting-field class="lore-setting-field">
                            <span>{language.lorebookWorkspace.bardAnalysisTemperature}</span>
                            <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].bardLore.settings.analysisTemperature} />
                        </label>
                    </div>
                </details>
            </section>
        {/if}

        <section class="lore-settings-card lore-settings-card--quiet">
            {#if DBState.db.characters[$selectedCharID].loreSettings}
                <div data-lorebook-setting-row class="lore-setting-row">
                    <span class="lore-setting-row-label">{language.useGlobalSettings} <Help key="useGlobalSettings"/></span>
                    <ShSwitch checked={false} onCheckedChange={(checked) => {
                        if (checked) DBState.db.characters[$selectedCharID].loreSettings = undefined
                    }} />
                </div>
                <div data-lorebook-setting-row class="lore-setting-row">
                    <span class="lore-setting-row-label">{language.recursiveScanning} <Help key="recursiveScanning"/></span>
                    <ShSwitch bind:checked={DBState.db.characters[$selectedCharID].loreSettings.recursiveScanning} />
                </div>
                {#if DBState.db.characters[$selectedCharID].loreSettings.recursiveScanning}
                    <label data-lorebook-setting-field class="lore-setting-field">
                        <span class="lore-setting-row-label">{language.maxRecursionSteps} <Help key="maxRecursionSteps"/></span>
                        <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].loreSettings.maxRecursionSteps} />
                    </label>
                {/if}
                <div data-lorebook-setting-field class="lore-setting-field">
                    <span class="lore-setting-row-label">{language.lorebookMatchingMode} <Help key="lorebookMatchingMode"/></span>
                    <ShSelect className="w-full" bind:value={DBState.db.characters[$selectedCharID].loreSettings.matchingMode}>
                        <OptionInput value="partial">{language.partialMatching}</OptionInput>
                        <OptionInput value="whitespace">{language.fullWordMatching}</OptionInput>
                        <OptionInput value="word-boundary">{language.wordBoundaryMatching}</OptionInput>
                    </ShSelect>
                </div>
                <label data-lorebook-setting-field class="lore-setting-field">
                    <span class="lore-setting-row-label">{language.loreBookDepth} <Help key="loreBookDepth"/></span>
                    <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].loreSettings.scanDepth} />
                </label>
                <label data-lorebook-setting-field class="lore-setting-field">
                    <span class="lore-setting-row-label">{language.loreBookToken} <Help key="loreBookToken"/></span>
                    <NumberInput fullwidth min={0} bind:value={DBState.db.characters[$selectedCharID].loreSettings.tokenBudget} />
                </label>
            {:else}
                <div data-lorebook-setting-row class="lore-setting-row">
                    <span class="lore-setting-row-label">{language.useGlobalSettings} <Help key="useGlobalSettings"/></span>
                    <ShSwitch checked={true} onCheckedChange={(checked) => {
                        if (!checked) {
                            DBState.db.characters[$selectedCharID].loreSettings = {
                                tokenBudget: DBState.db.loreBookToken,
                                scanDepth: DBState.db.loreBookDepth,
                                recursiveScanning: false,
                                maxRecursionSteps: 0,
                                fullWordMatching: false,
                                matchingMode: 'partial'
                            }
                        }
                    }} />
                </div>
            {/if}
        </section>
    </div>
{/if}

<LoreBookWorkspaceDialog
    bind:open={workspaceOpen}
    entries={activeBinding.entries}
    scopeKey={activeBinding.scopeKey}
    scopeLabel={activeBinding.scopeLabel}
    legacyDisabledBackups={activeLoremasterBackups}
    resolveChildLabel={activeChildLabelResolver}
    localActivation={activeBinding.localActivation}
    bardMode={bardView}
    bardSettings={bardView ? DBState.db.characters[$selectedCharID].bardLore?.settings : undefined}
    bardAnalysisRun={bardView ? DBState.db.characters[$selectedCharID].bardLore?.analysisRun : undefined}
    onBardAnalysisRunChange={bardView
        ? (next) => { DBState.db.characters[$selectedCharID].bardLore!.analysisRun = next }
        : undefined}
    onChange={activeBinding.onChange}
    onImport={bardView ? importBardLoreOverlay : () => importLoreBook(submenu === 0 ? 'global' : 'local')}
    onExport={bardView ? exportBardLoreOverlay : () => exportLoreBook(submenu === 0 ? 'global' : 'local')}
/>
</div>

<style>
    [data-lorebook-sidebar-layout] { min-width: 0; }
    .lore-settings-card {
        min-width: 0;
        padding: .8rem;
        border: 1px solid var(--color-darkborderc);
        border-radius: .65rem;
        background: color-mix(in srgb, var(--color-darkbg) 94%, var(--color-selected) 6%);
    }
    .lore-settings-card--quiet {
        padding: .75rem .15rem 0;
        border-width: 1px 0 0;
        border-radius: 0;
        background: transparent;
    }
    .lore-settings-card-header strong { display: block; color: var(--color-textcolor); font-size: .86rem; }
    .lore-settings-card-header p { margin: .2rem 0 0; color: var(--color-textcolor2); font-size: .72rem; line-height: 1.45; }
    .lore-settings-grid { display: flex; min-width: 0; flex-direction: column; gap: .7rem; padding-top: .75rem; }
    .lore-setting-field { display: flex; min-width: 0; width: 100%; flex-direction: column; gap: .28rem; }
    .lore-setting-field > span,
    .lore-setting-row-label { min-width: 0; padding: 0 .2rem; color: var(--color-textcolor2); font-size: .69rem; line-height: 1.35; }
    .lore-setting-row { display: flex; min-width: 0; min-height: 2.5rem; align-items: center; justify-content: space-between; gap: .75rem; }
    .lore-setting-row > span { min-width: 0; color: var(--color-textcolor); font-size: .82rem; line-height: 1.35; }
    .lore-setting-row > .lore-setting-row-label { color: var(--color-textcolor); }
    .lore-settings-disclosure { margin-top: .7rem; border-top: 1px solid color-mix(in srgb, var(--color-darkborderc) 65%, transparent); }
    .lore-settings-disclosure summary { padding: .7rem .15rem .1rem; color: var(--color-textcolor); cursor: pointer; font-size: .8rem; font-weight: 650; }
    .lore-settings-disclosure summary:hover { color: var(--color-primary); }
    .lore-settings-subtitle { margin-top: .1rem; padding: .2rem; color: var(--color-textcolor); font-size: .78rem; }
    .bard-portable-card { margin-top: .75rem; }
    .bard-portable-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem; padding-top: .75rem; }
    .bard-portable-actions button {
        min-height: 2.4rem;
        padding: .5rem .65rem;
        border: 1px solid var(--color-darkborderc);
        border-radius: .5rem;
        background: color-mix(in srgb, var(--color-selected) 28%, transparent);
        color: var(--color-textcolor);
        font-size: .76rem;
        font-weight: 650;
    }
    .bard-portable-actions button:hover { background: color-mix(in srgb, var(--color-selected) 48%, transparent); }
    .bard-portable-actions button.danger { grid-column: 1 / -1; color: var(--color-danger); }
    .bard-activation-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: .85rem;
        margin: .65rem 0;
        padding: .8rem .85rem;
        border: 1px solid var(--color-darkborderc);
        border-radius: .7rem;
        background: color-mix(in srgb, var(--color-darkbg) 92%, var(--color-selected) 8%);
    }
    .bard-activation-card[data-active='true'] {
        border-color: color-mix(in srgb, var(--color-info) 55%, var(--color-darkborderc));
        background: color-mix(in srgb, var(--color-info) 9%, var(--color-darkbg));
    }
    .bard-activation-copy { display: flex; min-width: 0; align-items: flex-start; gap: .65rem; }
    .bard-activation-copy strong { display: block; font-size: .85rem; }
    .bard-activation-copy p { margin: .18rem 0 0; color: var(--color-textcolor2); font-size: .72rem; line-height: 1.45; }
    .bard-status-dot { flex: 0 0 auto; width: .58rem; height: .58rem; margin-top: .3rem; border-radius: 50%; background: var(--color-textcolor2); box-shadow: 0 0 0 .22rem color-mix(in srgb, var(--color-textcolor2) 16%, transparent); }
    .bard-activation-card[data-active='true'] .bard-status-dot { background: var(--color-info); box-shadow: 0 0 0 .22rem color-mix(in srgb, var(--color-info) 20%, transparent); }
    .bard-switch { display: grid; flex: 0 0 auto; grid-template-columns: auto auto; align-items: center; gap: .55rem; color: var(--color-textcolor); cursor: pointer; font-size: .74rem; font-weight: 650; }
    .bard-switch input { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
    .bard-switch-track { position: relative; width: 2.6rem; height: 1.45rem; border: 1px solid var(--color-darkborderc); border-radius: 999px; background: color-mix(in srgb, var(--color-textcolor2) 22%, var(--color-darkbg)); transition: background 160ms ease, border-color 160ms ease; }
    .bard-switch-track span { position: absolute; top: .17rem; left: .18rem; width: .98rem; height: .98rem; border-radius: 50%; background: var(--color-textcolor); box-shadow: 0 .08rem .2rem color-mix(in srgb, var(--color-darkbg) 35%, transparent); transition: transform 160ms ease; }
    .bard-switch input:checked + .bard-switch-track { border-color: var(--color-info); background: var(--color-info); }
    .bard-switch input:checked + .bard-switch-track span { transform: translateX(1.12rem); background: var(--color-on-info); }
    .bard-switch input:focus-visible + .bard-switch-track { outline: 2px solid var(--color-info); outline-offset: 2px; }
    @media (max-width: 34rem) {
        .bard-activation-card { align-items: stretch; flex-direction: column; }
        .bard-switch { justify-content: space-between; }
    }
</style>
