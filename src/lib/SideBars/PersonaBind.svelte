<script lang="ts">
    import { DBState, selectedCharID } from "src/ts/stores.svelte";
    import { language } from "src/lang";
    import { getCurrentChat } from "src/ts/storage/database.svelte";
    import { alertConfirmMulti, alertSelect, notifySuccess } from "src/ts/alert";
    import { PinIcon, PinOffIcon } from "@lucide/svelte";
    import { openPersonaManager, personaSelectCallback } from "src/ts/stores.svelte";
    import { v4 } from "uuid";
    import ShButton from "../UI/GUI/ShButton.svelte";
    import type { Chat } from "src/ts/storage/database.svelte";
    import { getCharImage } from "src/ts/characters";
    import { getEffectivePersona, resolvePersonaById, type PersonaSelection } from "src/ts/personaScopes";
    import ShDropdownMenu from "../UI/GUI/ShDropdownMenu.svelte";
    import ShDropdownMenuTrigger from "../UI/GUI/ShDropdownMenuTrigger.svelte";
    import ShDropdownMenuContent from "../UI/GUI/ShDropdownMenuContent.svelte";
    import ShDropdownMenuItem from "../UI/GUI/ShDropdownMenuItem.svelte";
    import ShDropdownMenuSeparator from "../UI/GUI/ShDropdownMenuSeparator.svelte";
    import ShDropdownMenuSwitchItem from "../UI/GUI/ShDropdownMenuSwitchItem.svelte";

    interface Props {
        bindingTarget?: Pick<Chat, 'bindedPersona'>;
        onBindingChange?: () => void;
        /** Sidebar minimal mode: a thumbnail button whose menu holds every action. */
        minimal?: boolean;
    }

    let { bindingTarget, onBindingChange = () => {}, minimal = false }: Props = $props();

    let currentChat = $derived(DBState.db.characters[$selectedCharID]?.chats?.[DBState.db.characters[$selectedCharID]?.chatPage])
    let target = $derived(bindingTarget ?? currentChat)

    let boundPersona = $derived.by(() => {
        const id = target?.bindedPersona
        if (!id) return null
        return resolvePersonaById(DBState.db, DBState.db.characters[$selectedCharID], id)
    })
    let displaySelection = $derived(boundPersona ?? getEffectivePersona(
        DBState.db,
        DBState.db.characters[$selectedCharID],
        target,
    ))
    let displayPersona = $derived(displaySelection?.persona)
    let isPersonaBound = $derived(!!boundPersona)
    let pinPersonaOnNewChat = $state(DBState.db.pinPersonaOnNewChat ?? true)

    function toggleNewChatPersonaPin() {
        pinPersonaOnNewChat = !pinPersonaOnNewChat
        DBState.db.pinPersonaOnNewChat = pinPersonaOnNewChat
    }

    function bindPersona(selection: PersonaSelection) {
        const chat = target ?? getCurrentChat()
        if (!chat) return
        const persona = selection.persona
        if (!persona.id) persona.id = v4()
        // Binding is chat-only; changing the global persona would leak it into other bots.
        chat.bindedPersona = persona.id
        onBindingChange()
        notifySuccess(language.personaBindedSuccess)
    }

    function unbindPersona() {
        const chat = target ?? getCurrentChat()
        if (!chat) return
        chat.bindedPersona = ''
        onBindingChange()
        notifySuccess(language.personaUnbindedSuccess)
    }

    function choosePersonaToBind() {
        personaSelectCallback.set(bindPersona)
        openPersonaManager.set(true)
    }

    function bindCurrentPersona() {
        const current = getEffectivePersona(DBState.db, DBState.db.characters[$selectedCharID])
        if (current) bindPersona(current)
    }

    async function handlePersonaBindClick() {
        if (isPersonaBound) {
            const sel = await alertConfirmMulti(
                language.personaBindingLabel,
                [
                    language.personaBindChange,
                    { label: language.personaBindUnbind, variant: 'destructive' },
                ]
            )
            if (sel === 0) {
                choosePersonaToBind()
            } else if (sel === 1) {
                unbindPersona()
            }
        } else {
            const sel = parseInt(await alertSelect([
                language.personaBindCurrent,
                language.personaSelectOther,
                language.cancel
            ]))
            if (sel === 0) {
                bindCurrentPersona()
            } else if (sel === 1) {
                choosePersonaToBind()
            }
        }
    }
</script>

{#if minimal}
<ShDropdownMenu>
    <ShDropdownMenuTrigger>
        {#snippet child({ props })}
            <button
                {...props}
                type="button"
                data-persona-binding-minimal
                data-bound={isPersonaBound}
                class={`persona-thumb risu-button-lift relative size-10 shrink-0 overflow-hidden rounded-md border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-borderc/50 ${isPersonaBound
                    ? 'border-binding-border bg-binding'
                    : 'border-darkborderc bg-darkbutton opacity-75 hover:opacity-100'}`}
                title={`${language.personaBindingLabel}: ${displayPersona?.name ?? 'User'}`}
                aria-label={`${language.personaBindingLabel}: ${displayPersona?.name ?? 'User'}`}
            >
                {#if displayPersona?.icon}
                    {#await getCharImage(displayPersona.icon, 'plain') then personaImage}
                        <img src={personaImage} alt="" class="size-full object-cover object-top" />
                    {/await}
                {:else}
                    <span class="flex size-full items-center justify-center text-base font-semibold text-textcolor">
                        {(displayPersona?.name ?? 'User').trim().charAt(0) || '?'}
                    </span>
                {/if}
                {#if isPersonaBound}
                    <span class="absolute right-0 bottom-0 flex size-4 items-center justify-center rounded-tl-md bg-binding-border text-binding-text">
                        <PinIcon size={10} />
                    </span>
                {/if}
            </button>
        {/snippet}
    </ShDropdownMenuTrigger>
    <ShDropdownMenuContent class="w-64 max-w-[calc(100vw-2rem)]">
        <div class="px-2 pt-1 pb-1.5">
            <div class="text-[11px] text-textcolor2">{language.personaBindingLabel}</div>
            <div class="flex min-w-0 items-baseline gap-1 text-sm">
                <span class="truncate font-semibold">{displayPersona?.name ?? 'User'}</span>
                {#if displayPersona?.note}
                    <span class="truncate text-xs text-textcolor2">({displayPersona.note})</span>
                {/if}
            </div>
        </div>
        <ShDropdownMenuSeparator />
        {#if isPersonaBound}
            <ShDropdownMenuItem onSelect={choosePersonaToBind}>{language.personaBindChange}</ShDropdownMenuItem>
            <ShDropdownMenuItem variant="destructive" onSelect={unbindPersona}>{language.personaBindUnbind}</ShDropdownMenuItem>
        {:else}
            <ShDropdownMenuItem onSelect={bindCurrentPersona}>{language.personaBindCurrent}</ShDropdownMenuItem>
            <ShDropdownMenuItem onSelect={choosePersonaToBind}>{language.personaSelectOther}</ShDropdownMenuItem>
        {/if}
        <ShDropdownMenuSeparator />
        <ShDropdownMenuSwitchItem checked={pinPersonaOnNewChat} onCheckedChange={toggleNewChatPersonaPin}>
            {language.pinPersonaOnNewChat}
        </ShDropdownMenuSwitchItem>
    </ShDropdownMenuContent>
</ShDropdownMenu>
{:else}
<div class="text-[11px] text-textcolor2 mt-4 px-1">{language.personaBindingLabel}</div>
<div class="flex gap-1 mt-1 items-stretch">
    <ShButton
        variant={isPersonaBound ? 'binding' : 'default'}
        className={`flex-1 min-w-0 justify-start ${isPersonaBound
            ? ''
            : 'text-textcolor2 opacity-75 hover:opacity-100'}`}
        onclick={handlePersonaBindClick}
    >
        {#if displayPersona?.icon}
            {#await getCharImage(displayPersona.icon, 'plain') then personaImage}
                <img src={personaImage} alt="" class="size-8 shrink-0 rounded-lg object-cover object-top" />
            {/await}
        {/if}
        {#if isPersonaBound}
            <PinIcon size={16} class="shrink-0" />
        {:else}
            <PinOffIcon size={16} class="shrink-0" />
        {/if}
        <span class="truncate">{displayPersona?.name ?? 'User'}</span>
        {#if displayPersona?.note}
            <span class="truncate text-xs opacity-60">({displayPersona.note})</span>
        {/if}
    </ShButton>
    <ShButton
        data-pin-persona-on-new-chat
        size="icon"
        variant={pinPersonaOnNewChat ? 'binding' : 'default'}
        className="shrink-0"
        onclick={toggleNewChatPersonaPin}
        title={language.pinPersonaOnNewChat}
        aria-label={language.pinPersonaOnNewChat}
        aria-pressed={pinPersonaOnNewChat}
    >
        {#if pinPersonaOnNewChat}
            <PinIcon size={16} />
        {:else}
            <PinOffIcon size={16} />
        {/if}
    </ShButton>
</div>
{/if}
