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
    import { changeUserPersona } from "src/ts/persona";

    interface Props {
        bindingTarget?: Pick<Chat, 'bindedPersona'>;
        onBindingChange?: () => void;
    }

    let { bindingTarget, onBindingChange = () => {} }: Props = $props();

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

    function bindPersona(selection: PersonaSelection) {
        const chat = target ?? getCurrentChat()
        if (!chat) return
        const persona = selection.persona
        if (!persona.id) persona.id = v4()
        if (selection.scope === 'global') changeUserPersona(selection.index)
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
                personaSelectCallback.set(bindPersona)
                openPersonaManager.set(true)
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
                const current = getEffectivePersona(DBState.db, DBState.db.characters[$selectedCharID])
                if (current) bindPersona(current)
            } else if (sel === 1) {
                personaSelectCallback.set(bindPersona)
                openPersonaManager.set(true)
            }
        }
    }
</script>

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
</div>
