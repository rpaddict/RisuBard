<script lang="ts">
    import { getModuleToggles } from "src/ts/process/modules";
    import { DBState, selectedCharID } from "src/ts/stores.svelte";
    import { parseToggleSyntax, type sidebarToggle, type sidebarToggleGroup } from "src/ts/util";
    import { language } from "src/lang";
    import type { PromptItem } from "src/ts/process/prompt";
    import type { character } from "src/ts/storage/database.svelte";
    import { ensureChatOwnsToggleValues, fillMissingPinnedToggleValues, getActivePromptOverlayTemplate, getActivePromptOverlayToggleTemplate, getCurrentChat, pinToggleValuesToChat, resetPinnedToggleValues, saveTogglesToChat } from "src/ts/storage/database.svelte";
    import { getToggleValueDifferences } from "src/ts/storage/togglePresetBaseline";
    import { alertConfirmMulti, alertTogglePresets, notifySuccess } from "src/ts/alert";
    import { tooltip } from "src/ts/gui/tooltip";
    import { PinIcon, FolderHeartIcon, RotateCcwIcon } from "@lucide/svelte";
    import ShAccordion from '../UI/GUI/ShAccordion.svelte'
    import ShButton from "../UI/GUI/ShButton.svelte";
    import ShSwitch from "../UI/GUI/ShSwitch.svelte";
    import Help from "../Others/Help.svelte";
    import SelectInput from "../UI/GUI/SelectInput.svelte";
    import OptionInput from "../UI/GUI/OptionInput.svelte";
    import TextAreaInput from '../UI/GUI/TextAreaInput.svelte'
    import TextInput from "../UI/GUI/TextInput.svelte";
    import ShDropdownMenu from "../UI/GUI/ShDropdownMenu.svelte";
    import ShDropdownMenuTrigger from "../UI/GUI/ShDropdownMenuTrigger.svelte";
    import ShDropdownMenuContent from "../UI/GUI/ShDropdownMenuContent.svelte";
    import ShDropdownMenuItem from "../UI/GUI/ShDropdownMenuItem.svelte";
    import ShDropdownMenuSeparator from "../UI/GUI/ShDropdownMenuSeparator.svelte";
    import type { Snippet } from "svelte";

    interface Props {
        chara?: character
        noContainer?: boolean
        /** Sidebar minimal mode: the pin control joins `leading` in one row and its side buttons move into its menu. */
        minimal?: boolean
        leading?: Snippet
    }

    let { chara = $bindable(), noContainer, minimal = false, leading }: Props = $props();

    let currentChat = $derived(DBState.db.characters[$selectedCharID]?.chats?.[DBState.db.characters[$selectedCharID]?.chatPage])
    let isPinned = $derived(!DBState.db.disableToggleBinding && !!currentChat?.useLocallySetGlobalVariables)
    let toggleVariableTarget = $derived(
        isPinned && currentChat?.GLGlobalVariables
            ? currentChat.GLGlobalVariables
            : DBState.db.globalChatVariables
    )
    let pinnedPresetName = $derived(currentChat?.togglePresetBaseline?.name ?? language.togglePinManualName)

    async function pinToChat() {
        const chat = getCurrentChat()
        if (!chat) return
        // Every chat owns its values, so the pin only sets the reset baseline.
        if (chat.useLocallySetGlobalVariables) {
            const choice = await alertConfirmMulti(language.toggleBindingLabel, [language.togglePinOverwrite])
            if (choice === 0) {
                pinToggleValuesToChat(chat)
                notifySuccess(language.togglePinSaved)
            }
        } else {
            saveTogglesToChat()
            notifySuccess(language.togglePinSaved)
        }
    }

    function overwritePin() {
        const chat = getCurrentChat()
        if (!chat) return
        if (chat.useLocallySetGlobalVariables) pinToggleValuesToChat(chat)
        else saveTogglesToChat()
        notifySuccess(language.togglePinSaved)
    }

    async function openPresetList() {
        await alertTogglePresets()
    }

    function resetToPinnedPreset() {
        const chat = getCurrentChat()
        if (!chat?.togglePresetBaseline) return
        resetPinnedToggleValues(chat)
        notifySuccess(language.togglePinResetDone)
    }

    const jailbreakToggleToken = '{{jbtoggled}}'
    const usesJailbreakToggle = (value?: string) =>
        typeof value === 'string' && value.includes(jailbreakToggleToken)
    const templateUsesJailbreakToggle = (template: PromptItem[]) =>
        template.some(item => {
            if (item.type === 'jailbreak') {
                return true
            }
            if ('text' in item && usesJailbreakToggle(item.text)) {
                // plain, jailbreak, cot
                return true
            }
            if ('innerFormat' in item && usesJailbreakToggle(item.innerFormat)) {
                // persona, description, lorebook, postEverything, memory
                return true
            }
            if ('defaultText' in item && usesJailbreakToggle(item.defaultText)) {
                // author note
                return true
            }
            return false
        })

    let hasJailbreakPrompt = $derived.by(() => {
        const template = getActivePromptOverlayTemplate()
        if (!template) {
            return (DBState.db.jailbreak ?? '').trim().length > 0
        }
        return templateUsesJailbreakToggle(template)
    })

    let groupedToggles = $derived.by(() => {
        // Track chat/module changes so the toggle list re-derives on chat switch
        const _char = DBState.db.characters[$selectedCharID]
        void _char?.chats?.[_char?.chatPage]?.modules
        void _char?.modules
        void DBState.db.enabledModules
        void DBState.db.moduleIntergration

        const ungrouped = parseToggleSyntax(
            getActivePromptOverlayToggleTemplate() + '\n' +
            getModuleToggles() + '\n' +
            ((DBState.db?.characters?.[$selectedCharID] as character)?.customModuleToggle ?? '')
        )

        let groupOpen = false
        // group toggles together between group ... groupEnd
        return ungrouped.reduce<sidebarToggle[]>((acc, toggle) => {
            if (toggle.type === 'group') {
                groupOpen = true
                acc.push(toggle)
            } else if (toggle.type === 'groupEnd') {
                groupOpen = false
            } else if (groupOpen) {
                (acc.at(-1) as sidebarToggleGroup).children.push(toggle)
            } else {
                acc.push(toggle)
            }
            return acc
        }, [])
    })

    function collectToggleKeys(items: sidebarToggle[]): string[] {
        return items.flatMap((toggle) => {
            if(toggle.type === 'group'){
                return collectToggleKeys(toggle.children)
            }
            return toggle.key ? [`toggle_${toggle.key}`] : []
        })
    }

    function flattenToggles(items: sidebarToggle[]): sidebarToggle[] {
        return items.flatMap((toggle) => toggle.type === 'group'
            ? flattenToggles(toggle.children)
            : [toggle])
    }

    let toggleDefinitions = $derived(new Map(
        flattenToggles(groupedToggles)
            .filter((toggle) => toggle.key)
            .map((toggle) => [`toggle_${toggle.key}`, toggle]),
    ))

    // An unset value shows as off (switch) or the first option (select), and the
    // select binding writes "0" on mount, so those must not count as changes.
    function shownToggleValue(key: string, value: string): string {
        const toggle = toggleDefinitions.get(key)
        if (toggle?.type === 'select') return value || '0'
        if (toggle && !toggle.type) return value === '1' ? '1' : '0'
        return value
    }

    let dirtyDifferences = $derived(getToggleValueDifferences(
        currentChat?.togglePresetBaseline,
        currentChat?.GLGlobalVariables ?? {},
    ).filter(({ key, baselineValue, currentValue }) =>
        shownToggleValue(key, baselineValue) !== shownToggleValue(key, currentValue)))
    let dirtyKeys = $derived(new Set(dirtyDifferences.map(({ key }) => key)))

    function isToggleDirty(toggle: sidebarToggle): boolean {
        return !!toggle.key && dirtyKeys.has(`toggle_${toggle.key}`)
    }

    // Minimal mode lays switches, selects and short text inputs out as equal-width
    // grid cells; groups, long text, captions and dividers keep a full row.
    type MinimalCell =
        | { kind: 'toggle', toggle: sidebarToggle }
        | { kind: 'jailbreak' }
        | { kind: 'hypa' }
    type MinimalSegment =
        | { kind: 'grid', cells: MinimalCell[] }
        | { kind: 'full', toggle: sidebarToggle }

    function isGridToggle(toggle: sidebarToggle): boolean {
        return toggle.type === 'select' || toggle.type === 'text' || toggle.type === undefined
    }

    function segmentToggles(items: sidebarToggle[], leading: MinimalCell[] = [], trailing: MinimalCell[] = []): MinimalSegment[] {
        const segments: MinimalSegment[] = []
        let cells: MinimalCell[] = []
        const flush = () => {
            if (cells.length > 0) segments.push({ kind: 'grid', cells })
            cells = []
        }
        items.forEach((toggle, index) => {
            if (toggle.type === 'groupEnd') return
            if (toggle.type === 'group' && toggle.children.length === 0) return
            if (isGridToggle(toggle)) {
                cells.push({ kind: 'toggle', toggle })
                return
            }
            // Same rule as the full layout: no repeated identical dividers.
            const previous = items[index - 1]
            if (toggle.type === 'divider' && previous?.type === 'divider' && previous.value === toggle.value) return
            flush()
            segments.push({ kind: 'full', toggle })
        })
        cells.push(...trailing)
        flush()
        // App-level switches (jailbreak) join the first switch row instead of
        // sitting alone above a leading group.
        if (leading.length > 0) {
            const firstGrid = segments.find((segment) => segment.kind === 'grid')
            if (firstGrid?.kind === 'grid') firstGrid.cells.unshift(...leading)
            else segments.unshift({ kind: 'grid', cells: [...leading] })
        }
        return segments
    }

    let showHypaToggle = $derived(!!(DBState.db.showMenuHypaMemoryModal && DBState.db.hypaV3))
    let hypaChecked = $derived(currentChat?.supaMemory ?? chara?.supaMemory ?? false)

    function toggleHypaMemory() {
        const char = DBState.db.characters[$selectedCharID]
        const chat = char?.chats?.[char.chatPage]
        if (!chat) return
        chat.supaMemory = !(chat.supaMemory ?? char.supaMemory ?? false)
    }

    let minimalSegments = $derived(segmentToggles(
        groupedToggles,
        hasJailbreakPrompt ? [{ kind: 'jailbreak' }] : [],
        showHypaToggle ? [{ kind: 'hypa' }] : [],
    ))

    function visibleToggleValue(key: string, value: string): string {
        const toggle = toggleDefinitions.get(key)
        if (toggle?.type === 'select') {
            return toggle.options[Number(value)] ?? value
        }
        return value
    }

    let dirtyTooltip = $derived(dirtyDifferences.map(({ key, currentValue }) => {
        const toggle = toggleDefinitions.get(key)
        const label = toggle?.value || key.replace(/^toggle_/, '')
        return `[${label}] = "${visibleToggleValue(key, currentValue)}"`
    }).join('\n'))

    $effect(() => {
        const chat = currentChat
        const keys = collectToggleKeys(groupedToggles)
        if(DBState.db.disableToggleBinding || !chat) return
        ensureChatOwnsToggleValues(chat)
        if(!chat.useLocallySetGlobalVariables) return
        fillMissingPinnedToggleValues(chat, keys)
    })

</script>

{#snippet dirtyDot(dirty: boolean)}
    {#if dirty}
        <span class="toggle-cell-dirty-dot" title={language.togglePinDirtyNote} aria-hidden="true"></span>
    {/if}
{/snippet}

{#snippet chip(label: string, checked: boolean, onToggle: () => void, dirty: boolean = false)}
    <div class="relative min-w-0" data-toggle-cell="switch">
        <ShButton
            variant={checked ? 'binding' : 'default'}
            className={`w-full min-w-0 px-2 text-sm ${checked ? '' : 'text-textcolor2'}`}
            aria-pressed={checked}
            title={label}
            onclick={onToggle}
        >
            <span class="truncate">{label}</span>
        </ShButton>
        {@render dirtyDot(dirty)}
    </div>
{/snippet}

{#snippet minimalCell(cell: MinimalCell)}
    {#if cell.kind === 'jailbreak'}
        {@render chip(language.jailbreakToggle, !!DBState.db.jailbreakToggle, () => { DBState.db.jailbreakToggle = !DBState.db.jailbreakToggle })}
    {:else if cell.kind === 'hypa'}
        {@render chip(language.ToggleHypaMemory, hypaChecked, toggleHypaMemory)}
    {:else}
        {@const toggle = cell.toggle}
        {#if toggle.type === 'select'}
            <div class="relative flex min-w-0 flex-col gap-0.5" data-toggle-cell="select">
                <span class="truncate px-1 text-[11px] text-textcolor2" title={toggle.value}>{toggle.value}</span>
                <SelectInput className="w-full" ariaLabel={toggle.value} bind:value={
                    () => toggleVariableTarget[`toggle_${toggle.key}`] || '0',
                    (value) => toggleVariableTarget[`toggle_${toggle.key}`] = value
                }>
                    {#each toggle.options as option, i}
                        <OptionInput value={i.toString()}>{option}</OptionInput>
                    {/each}
                </SelectInput>
                {@render dirtyDot(isToggleDirty(toggle))}
            </div>
        {:else if toggle.type === 'text'}
            <div class="relative flex min-w-0 flex-col gap-0.5" data-toggle-cell="text">
                <span class="truncate px-1 text-[11px] text-textcolor2" title={toggle.value}>{toggle.value}</span>
                <TextInput className="w-full min-w-0" bind:value={toggleVariableTarget[`toggle_${toggle.key}`]} />
                {@render dirtyDot(isToggleDirty(toggle))}
            </div>
        {:else if toggle.key}
            {@render chip(
                toggle.value ?? '',
                toggleVariableTarget[`toggle_${toggle.key}`] === '1',
                () => { toggleVariableTarget[`toggle_${toggle.key}`] = toggleVariableTarget[`toggle_${toggle.key}`] === '1' ? '0' : '1' },
                isToggleDirty(toggle),
            )}
        {/if}
    {/if}
{/snippet}

{#snippet minimalToggles(segments: MinimalSegment[])}
    {#each segments as segment}
        {#if segment.kind === 'grid'}
            <div class="mt-2 grid w-full grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] items-end gap-1" data-toggle-grid>
                {#each segment.cells as cell}
                    {@render minimalCell(cell)}
                {/each}
            </div>
        {:else}
            {@const toggle = segment.toggle}
            {#if toggle.type === 'group'}
                <div data-skin-part="toggle-group" class="w-full mt-2">
                    <ShAccordion variant="group" class="w-full" name={toggle.value}>
                        {@render minimalToggles(segmentToggles((toggle as sidebarToggleGroup).children))}
                    </ShAccordion>
                </div>
            {:else if toggle.type === 'textarea'}
                <div class="relative mt-2 flex w-full flex-col gap-0.5" data-toggle-cell="textarea">
                    <span class="truncate px-1 text-[11px] text-textcolor2" title={toggle.value}>{toggle.value}</span>
                    <TextAreaInput className="w-full" height='20' bind:value={toggleVariableTarget[`toggle_${toggle.key}`]} />
                    {@render dirtyDot(isToggleDirty(toggle))}
                </div>
            {:else if toggle.type === 'caption'}
                <div class="w-full mt-1 text-xs text-textcolor2">
                    {toggle.value}
                </div>
            {:else if toggle.type === 'divider'}
                <div class="w-full min-h-5 flex gap-2 mt-2 items-center justify-end">
                    {#if toggle.value}
                        <span class="shrink-0">{toggle.value}</span>
                    {/if}
                    <hr class="border-t border-darkborderc m-0 grow" />
                </div>
            {/if}
        {/if}
    {/each}
{/snippet}

{#snippet sep()}
    <div class="w-full mt-0.5 -mb-1.5 border-t border-darkborderc/20"></div>
{/snippet}

{#snippet toggles(items: sidebarToggle[], reverse: boolean = false)}
    {#each items as toggle, index}
        {#if index > 0
            && toggle.type !== 'divider' && items[index - 1]?.type !== 'divider'
            && toggle.type !== 'caption' && items[index - 1]?.type !== 'caption'
            && !(toggle.type === 'group' && items[index - 1]?.type === 'group')}
            {@render sep()}
        {/if}
        {#if toggle.type === 'group' && toggle.children.length > 0}
            <div data-skin-part="toggle-group" class="w-full mt-1">
                <ShAccordion variant="group" class="w-full" name={toggle.value}>
                    {@render toggles((toggle as sidebarToggleGroup).children, reverse)}
                </ShAccordion>
            </div>
        {:else if toggle.type === 'select'}
            <div class="w-full flex gap-2 mt-2 items-center justify-between min-h-10 rounded-md px-1 transition-colors" class:toggle-row--dirty={isToggleDirty(toggle)}>
                <span class="min-w-0 break-words">{toggle.value}</span>
                <SelectInput className="w-32 shrink-0" bind:value={
                    () => toggleVariableTarget[`toggle_${toggle.key}`] || '0',
                    (value) => toggleVariableTarget[`toggle_${toggle.key}`] = value
                }>
                    {#each toggle.options as option, i}
                        <OptionInput value={i.toString()}>{option}</OptionInput>
                    {/each}
                </SelectInput>
            </div>
        {:else if toggle.type === 'text'}
            <div class="w-full flex gap-2 mt-2 items-center justify-between min-h-10 rounded-md px-1 transition-colors" class:toggle-row--dirty={isToggleDirty(toggle)}>
                <span class="min-w-0 break-words">{toggle.value}</span>
                <TextInput className="w-32 shrink-0" bind:value={toggleVariableTarget[`toggle_${toggle.key}`]} />
            </div>
        {:else if toggle.type === 'textarea'}
            <div class="w-full flex gap-2 mt-2 items-start justify-between min-h-10 rounded-md px-1 transition-colors" class:toggle-row--dirty={isToggleDirty(toggle)}>
                <span class="min-w-0 break-words mt-1.5">{toggle.value}</span>
                <TextAreaInput className="w-32 shrink-0" height='20' bind:value={toggleVariableTarget[`toggle_${toggle.key}`]} />
            </div>
        {:else if toggle.type === 'caption'}
            <div class="w-full mt-1 text-xs text-textcolor2">
                {toggle.value}
            </div>
        {:else if toggle.type === 'divider'}
            <!-- Prevent multiple dividers appearing in a row -->
            {#if index === 0 || items[index - 1]?.type !== 'divider' || items[index - 1]?.value !== toggle.value}
                <div class="w-full min-h-5 flex gap-2 mt-2 items-center" class:justify-end={!reverse}>
                    {#if toggle.value}
                        <span class="shrink-0">{toggle.value}</span>
                    {/if}
                    <hr class="border-t border-darkborderc m-0 grow" />
                </div>
            {/if}
        {:else}
            <div class="w-full flex gap-2 mt-2 items-center justify-between min-h-10 rounded-md px-1 transition-colors" class:toggle-row--dirty={isToggleDirty(toggle)}>
                <span class="min-w-0 break-words">{toggle.value}</span>
                <ShSwitch
                    className="shrink-0"
                    checked={toggleVariableTarget[`toggle_${toggle.key}`] === '1'}
                    onCheckedChange={(checked) => {
                        toggleVariableTarget[`toggle_${toggle.key}`] = checked ? '1' : '0'
                    }}
                />
            </div>
        {/if}
    {/each}
{/snippet}

{#if minimal}
<div data-sidebar-binding-row class="mt-3 flex items-stretch gap-1">
    {@render leading?.()}
    {#if !DBState.db.disableToggleBinding}
        <ShDropdownMenu>
            <ShDropdownMenuTrigger>
                {#snippet child({ props })}
                    <ShButton
                        {...props}
                        data-toggle-binding-minimal
                        variant={isPinned ? 'binding' : 'default'}
                        className={`min-w-0 flex-1 justify-start ${isPinned ? '' : 'text-textcolor2 opacity-75 hover:opacity-100'}`}
                        title={isPinned && dirtyDifferences.length > 0
                            ? `${language.toggleBindingLabel}: ${pinnedPresetName}\n\n${language.togglePinDirtyNote}\n${dirtyTooltip}`
                            : `${language.toggleBindingLabel}: ${isPinned ? pinnedPresetName : language.togglePinLabel}`}
                    >
                        <PinIcon size={16} class="shrink-0" />
                        <span class="truncate">{isPinned ? pinnedPresetName : language.togglePinLabel}</span>
                        {#if isPinned && dirtyDifferences.length > 0}
                            <span class="shrink-0 tabular-nums">({dirtyDifferences.length})</span>
                        {/if}
                    </ShButton>
                {/snippet}
            </ShDropdownMenuTrigger>
            <ShDropdownMenuContent align="end" class="w-64 max-w-[calc(100vw-2rem)]">
                <div class="px-2 pt-1 pb-1.5">
                    <div class="text-[11px] text-textcolor2">{language.toggleBindingLabel}</div>
                    <div class="flex min-w-0 items-baseline gap-1 text-sm">
                        <span class="truncate font-semibold">{isPinned ? pinnedPresetName : language.togglePinLabel}</span>
                        {#if isPinned && dirtyDifferences.length > 0}
                            <span class="shrink-0 text-xs text-textcolor2 tabular-nums">({dirtyDifferences.length})</span>
                        {/if}
                    </div>
                </div>
                <ShDropdownMenuSeparator />
                {#if isPinned}
                    <ShDropdownMenuItem onSelect={overwritePin}><PinIcon />{language.togglePinOverwrite}</ShDropdownMenuItem>
                    <ShDropdownMenuItem onSelect={resetToPinnedPreset} disabled={dirtyDifferences.length === 0}><RotateCcwIcon />{language.togglePinReset}</ShDropdownMenuItem>
                {:else}
                    <ShDropdownMenuItem onSelect={overwritePin}><PinIcon />{language.togglePinToChat}</ShDropdownMenuItem>
                {/if}
                <ShDropdownMenuItem onSelect={openPresetList}><FolderHeartIcon />{language.togglePresetList}</ShDropdownMenuItem>
            </ShDropdownMenuContent>
        </ShDropdownMenu>
    {/if}
</div>
{:else if !DBState.db.disableToggleBinding}
<div class="text-[11px] text-textcolor2 mt-4 px-1">{language.toggleBindingLabel}</div>
<div class="flex gap-1 mt-1 items-stretch">
    {#if isPinned}
        <span class="flex-1 min-w-0 flex" use:tooltip={dirtyDifferences.length > 0 ? `${language.togglePinManage}\n\n${language.togglePinDirtyNote}\n${dirtyTooltip}` : language.togglePinManage}>
            <ShButton variant="binding" className="w-full min-w-0" onclick={pinToChat}>
                <PinIcon size={16} />
                <span class="truncate">{pinnedPresetName}</span>
                {#if dirtyDifferences.length > 0}
                    <span class="shrink-0 tabular-nums">({dirtyDifferences.length})</span>
                {/if}
            </ShButton>
        </span>
        <span use:tooltip={language.togglePinReset}>
            <ShButton size="icon" onclick={resetToPinnedPreset} disabled={dirtyDifferences.length === 0} aria-label={language.togglePinReset}>
                <RotateCcwIcon size={16} />
            </ShButton>
        </span>
    {:else}
        <span class="flex-1 min-w-0 flex" use:tooltip={language.togglePinToChat}>
            <ShButton className="w-full" onclick={pinToChat}>
                <PinIcon size={16} class="shrink-0" />
                <span class="truncate">{language.togglePinLabel}</span>
            </ShButton>
        </span>
    {/if}
    <span use:tooltip={language.togglePresetList}>
        <ShButton size="icon" onclick={openPresetList}>
            <FolderHeartIcon size={16} />
        </ShButton>
    </span>
</div>
{/if}

<style>
    /* Changed from the pinned baseline: a quiet "modified" mark, not an error. */
    .toggle-cell-dirty-dot {
        position: absolute;
        top: -2px;
        right: -2px;
        width: 8px;
        height: 8px;
        border-radius: 9999px;
        background: var(--color-binding-border);
        box-shadow: 0 0 0 2px var(--color-bgcolor);
        pointer-events: none;
    }
    .toggle-row--dirty {
        background: color-mix(in srgb, var(--color-binding) 45%, transparent);
        box-shadow: inset 3px 0 0 var(--color-binding-border);
    }
</style>

{#if !noContainer && groupedToggles.length > 4}
    <div class="h-48 border-darkborderc p-2 border rounded-sm flex flex-col items-start mt-2 overflow-y-auto">
        {#if hasJailbreakPrompt}
            <div class="w-full flex gap-2 mt-2 items-center justify-between min-h-10 rounded-md px-1">
                <span class="min-w-0 break-words">{language.jailbreakToggle}</span>
                <ShSwitch className="shrink-0" bind:checked={DBState.db.jailbreakToggle} />
            </div>
            {@render sep()}
        {/if}
        {@render toggles(groupedToggles, true)}
        {#if chara && DBState.db.showMenuHypaMemoryModal && DBState.db.hypaV3}
            <div class="w-full flex mt-2 items-center justify-between gap-2 min-h-10 rounded-md px-1">
                <span class="flex items-center gap-1">
                    <span>{language.ToggleHypaMemory}</span>
                    <Help key="toggleHypaMemory" />
                </span>
                <ShSwitch
                    checked={DBState.db.characters[$selectedCharID]?.chats?.[DBState.db.characters[$selectedCharID]?.chatPage]?.supaMemory ?? chara.supaMemory ?? false}
                    onCheckedChange={() => {
                        const char = DBState.db.characters[$selectedCharID]
                        const chat = char?.chats?.[char.chatPage]
                        if (!chat) return
                        chat.supaMemory = !(chat.supaMemory ?? char.supaMemory ?? false)
                    }}
                />
            </div>
        {/if}
    </div>
{:else if minimal}
    {@render minimalToggles(minimalSegments)}
{:else}
    {#if hasJailbreakPrompt}
        <div class="w-full flex gap-2 mt-2 items-center justify-between min-h-10 rounded-md px-1">
            <span class="min-w-0 break-words">{language.jailbreakToggle}</span>
            <ShSwitch className="shrink-0" bind:checked={DBState.db.jailbreakToggle} />
        </div>
        {#if groupedToggles.length > 0}
            {@render sep()}
        {/if}
    {/if}
    {@render toggles(groupedToggles)}
    {#if DBState.db.showMenuHypaMemoryModal && DBState.db.hypaV3}
        <div class="w-full flex mt-2 items-center justify-between gap-2 min-h-10 rounded-md px-1">
            <span class="flex items-center gap-1">
                <span>{language.ToggleHypaMemory}</span>
                <Help key="toggleHypaMemory" />
            </span>
            <ShSwitch
                checked={DBState.db.characters[$selectedCharID]?.chats?.[DBState.db.characters[$selectedCharID]?.chatPage]?.supaMemory ?? chara.supaMemory ?? false}
                onCheckedChange={() => {
                    const char = DBState.db.characters[$selectedCharID]
                    const chat = char?.chats?.[char.chatPage]
                    if (!chat) return
                    chat.supaMemory = !(chat.supaMemory ?? char.supaMemory ?? false)
                }}
            />
        </div>
    {/if}
{/if}
