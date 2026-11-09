<script lang="ts">
    import { DBState, selectedCharID, openPresetList, presetSelectCallback } from "src/ts/stores.svelte";
    import { language } from "src/lang";
    import { changeToPreset, getCurrentChat } from "src/ts/storage/database.svelte";
    import { alertConfirmMulti, alertSelect, notifySuccess } from "src/ts/alert";
    import { ChevronDownIcon, PinIcon, PinOffIcon, SlidersHorizontalIcon } from "@lucide/svelte";
    import { v4 } from "uuid";
    import ShButton from "../UI/GUI/ShButton.svelte";
    import ShSwitch from "../UI/GUI/ShSwitch.svelte";
    import Help from "../Others/Help.svelte";
    import type { Chat } from "src/ts/storage/database.svelte";
    import ShDropdownMenu from "../UI/GUI/ShDropdownMenu.svelte";
    import ShDropdownMenuTrigger from "../UI/GUI/ShDropdownMenuTrigger.svelte";
    import ShDropdownMenuContent from "../UI/GUI/ShDropdownMenuContent.svelte";
    import ShDropdownMenuItem from "../UI/GUI/ShDropdownMenuItem.svelte";
    import ShDropdownMenuSeparator from "../UI/GUI/ShDropdownMenuSeparator.svelte";
    import ShDropdownMenuSwitchItem from "../UI/GUI/ShDropdownMenuSwitchItem.svelte";

    interface Props {
        bindingTarget?: Pick<Chat, 'bindedBotPreset' | 'usePromptPresetParams'>;
        onBindingChange?: () => void;
        /** Sidebar minimal mode: one button whose menu holds every action. */
        minimal?: boolean;
    }

    let { bindingTarget, onBindingChange = () => {}, minimal = false }: Props = $props();

    let currentChat = $derived(DBState.db.characters[$selectedCharID]?.chats?.[DBState.db.characters[$selectedCharID]?.chatPage])
    let target = $derived(bindingTarget ?? currentChat)

    let paramsExpanded = $state(false);
    let promptParamsOn = $derived(target?.usePromptPresetParams === true);

    let boundPresetIndex = $derived.by(() => {
        const id = target?.bindedBotPreset
        if (!id) return -1
        return DBState.db.botPresets.findIndex(p => p.id === id)
    })
    let isPresetBound = $derived(boundPresetIndex >= 0)
    let displayPreset = $derived(
        isPresetBound
            ? DBState.db.botPresets[boundPresetIndex]
            : DBState.db.botPresets[DBState.db.botPresetsId]
    )

    // Data-sync (옵션 A): when entering a chat whose bindedBotPreset resolves
    // to a valid preset, flip the global active preset so the rest of the
    // codebase — which only reads db.botPresetsId — automatically uses the
    // bound one. No-op when no binding or when already active.
    $effect(() => {
        if (!bindingTarget && boundPresetIndex >= 0 && DBState.db.botPresetsId !== boundPresetIndex) {
            changeToPreset(boundPresetIndex)
        }
    })

    function bindPreset(presetIndex: number) {
        const chat = target ?? getCurrentChat()
        if (!chat) return
        const preset = DBState.db.botPresets[presetIndex]
        if (!preset) return
        if (!preset.id) preset.id = v4()
        chat.bindedBotPreset = preset.id
        onBindingChange()
        notifySuccess(language.promptBindedSuccess)
    }

    function unbindPreset() {
        const chat = target ?? getCurrentChat()
        if (!chat) return
        chat.bindedBotPreset = ''
        onBindingChange()
        notifySuccess(language.promptUnbindedSuccess)
    }

    function choosePresetToBind() {
        presetSelectCallback.set(bindPreset)
        openPresetList.set(true)
    }

    function setPromptParams(value: boolean) {
        if (!target) return
        target.usePromptPresetParams = value
        onBindingChange()
    }

    async function handlePresetBindClick() {
        if (isPresetBound) {
            const sel = await alertConfirmMulti(
                language.promptBindingLabel,
                [
                    language.promptBindChange,
                    { label: language.promptBindUnbind, variant: 'destructive' },
                ]
            )
            if (sel === 0) {
                choosePresetToBind()
            } else if (sel === 1) {
                unbindPreset()
            }
        } else {
            const sel = parseInt(await alertSelect([
                language.promptBindCurrent,
                language.presetSelectOther,
                language.cancel
            ]))
            if (sel === 0) {
                bindPreset(DBState.db.botPresetsId)
            } else if (sel === 1) {
                choosePresetToBind()
            }
        }
    }
</script>

{#if minimal}
<ShDropdownMenu>
    <ShDropdownMenuTrigger>
        {#snippet child({ props })}
            <ShButton
                {...props}
                data-prompt-binding-minimal
                variant={isPresetBound ? 'binding' : 'default'}
                className={`min-w-0 flex-1 justify-start ${isPresetBound ? '' : 'text-textcolor2 opacity-75 hover:opacity-100'}`}
                title={`${language.promptBindingLabel}: ${displayPreset?.name ?? language.none}`}
            >
                {#if isPresetBound}
                    <PinIcon size={16} class="shrink-0" />
                {:else}
                    <PinOffIcon size={16} class="shrink-0" />
                {/if}
                <span class="truncate">{displayPreset?.name ?? language.none}</span>
                {#if promptParamsOn}
                    <SlidersHorizontalIcon size={14} class="ml-auto shrink-0 opacity-80" />
                {/if}
            </ShButton>
        {/snippet}
    </ShDropdownMenuTrigger>
    <ShDropdownMenuContent class="w-64 max-w-[calc(100vw-2rem)]">
        <div class="px-2 pt-1 pb-1.5">
            <div class="text-[11px] text-textcolor2">{language.promptBindingLabel}</div>
            <div class="truncate text-sm font-semibold">{displayPreset?.name ?? language.none}</div>
        </div>
        <ShDropdownMenuSeparator />
        {#if isPresetBound}
            <ShDropdownMenuItem onSelect={choosePresetToBind}>{language.promptBindChange}</ShDropdownMenuItem>
            <ShDropdownMenuItem variant="destructive" onSelect={unbindPreset}>{language.promptBindUnbind}</ShDropdownMenuItem>
        {:else}
            <ShDropdownMenuItem onSelect={() => bindPreset(DBState.db.botPresetsId)}>{language.promptBindCurrent}</ShDropdownMenuItem>
            <ShDropdownMenuItem onSelect={choosePresetToBind}>{language.presetSelectOther}</ShDropdownMenuItem>
        {/if}
        {#if target}
            <ShDropdownMenuSeparator />
            <ShDropdownMenuSwitchItem checked={promptParamsOn} onCheckedChange={setPromptParams}>
                {language.promptPresetParamsUse}
            </ShDropdownMenuSwitchItem>
        {/if}
    </ShDropdownMenuContent>
</ShDropdownMenu>
{:else}
<div class="text-[11px] text-textcolor2 mt-4 px-1">{language.promptBindingLabel}</div>
<div class="flex gap-1 mt-1 items-stretch">
    <ShButton
        variant={isPresetBound ? 'binding' : 'default'}
        className={`flex-1 min-w-0 justify-start ${isPresetBound
            ? ''
            : 'text-textcolor2 opacity-75 hover:opacity-100'}`}
        onclick={handlePresetBindClick}
    >
        {#if isPresetBound}
            <PinIcon size={16} class="shrink-0" />
        {:else}
            <PinOffIcon size={16} class="shrink-0" />
        {/if}
        <span class="truncate">{displayPreset?.name ?? language.none}</span>
    </ShButton>
    <ShButton
        size="icon"
        variant={promptParamsOn ? 'binding' : 'default'}
        className="shrink-0"
        onclick={() => { paramsExpanded = !paramsExpanded }}
        title={language.promptPresetParamsUse}
    >
        {#if promptParamsOn}
            <SlidersHorizontalIcon size={16} />
        {:else}
            <ChevronDownIcon size={16} class={`transition-transform${paramsExpanded ? ' rotate-180' : ''}`} />
        {/if}
    </ShButton>
</div>
{#if paramsExpanded && target}
    <div class="flex flex-col gap-1 mt-1 pl-2 border-l border-selected">
        <div class="w-full flex items-center justify-between gap-2 min-h-10 rounded-md px-1">
            <span class="min-w-0">{language.promptPresetParamsUse} <Help key="promptPresetParams" name={language.promptPresetParamsUse}/></span>
            <ShSwitch
                className="shrink-0"
                checked={promptParamsOn}
                onCheckedChange={(v) => { if (target) { target.usePromptPresetParams = v; onBindingChange() } }}
            />
        </div>
    </div>
{/if}
{/if}
