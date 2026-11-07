<script lang="ts">
    import { XIcon } from '@lucide/svelte'
    import { v4 } from 'uuid'
    import { language } from '../../lang'
    import { DBState, selectedCharID } from 'src/ts/stores.svelte'
    import { changeUserPersona } from 'src/ts/persona'
    import { requestImmediateSave } from 'src/ts/globalApi.svelte'
    import { getCharacterPersonas, getEffectivePersona, type PersonaSelection } from 'src/ts/personaScopes'

    interface Props {
        close?: () => void
        onSelect?: ((selection: PersonaSelection) => void) | null
    }

    let { close = () => {}, onSelect = null }: Props = $props()
    const currentCharacter = $derived(DBState.db.characters[$selectedCharID])
    const currentChat = $derived(currentCharacter?.chats?.[currentCharacter.chatPage])
    const effective = $derived(getEffectivePersona(DBState.db, currentCharacter, currentChat))

    function choose(selection: PersonaSelection): void {
        selection.persona.id ??= v4()
        if (onSelect) {
            onSelect(selection)
        } else if (selection.scope === 'global') {
            changeUserPersona(selection.index)
        } else if (currentChat) {
            currentChat.bindedPersona = selection.persona.id
        }
        void requestImmediateSave()
        close()
    }
</script>

<div class="risu-modal-overlay absolute w-full h-full z-40 bg-overlay/50 flex justify-center items-center">
    <div data-skin-part="modal" class="risu-modal-surface bg-darkbg p-4 break-any rounded-md flex flex-col max-w-full w-96 max-h-full overflow-y-auto">
        <div class="risu-modal-header flex items-center text-textcolor mb-4">
            <h2 class="mt-0 mb-0 font-bold">{language.persona}</h2>
            <div class="grow flex justify-end">
                <button class="risu-modal-close text-textcolor2 hover:text-primary mr-2 cursor-pointer items-center" onclick={close}>
                    <XIcon size={24}/>
                </button>
            </div>
        </div>

        {#if currentCharacter && getCharacterPersonas(currentCharacter).length > 0}
            <div class="persona-group-label">{language.settingsWorkspace.personaManager.characterGroup}</div>
            {#each getCharacterPersonas(currentCharacter) as persona, i}
                <button
                    onclick={() => choose({ persona, index: i, scope: 'character' })}
                    class="persona-row"
                    class:bg-selected={effective?.scope === 'character' && effective.index === i}
                >
                    <span class="font-medium">{persona.name}</span>
                    {#if persona.note}<span class="opacity-75"> / {persona.note}</span>{/if}
                </button>
            {/each}
        {/if}

        <div class="persona-group-label">{language.settingsWorkspace.personaManager.globalGroup}</div>
        {#each DBState.db.personas as persona, i}
            <button
                onclick={() => choose({ persona, index: i, scope: 'global' })}
                class="persona-row"
                class:bg-selected={effective?.scope === 'global' && effective.index === i}
            >
                <span class="font-medium">{persona.name}</span>
                {#if persona.note}<span class="opacity-75"> / {persona.note}</span>{/if}
            </button>
        {/each}
    </div>
</div>

<style>
    .break-any { word-break: normal; overflow-wrap: anywhere; }
    .persona-group-label { margin-top: .5rem; padding: .45rem .5rem; color: var(--color-textcolor2); font-size: .7rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
    .persona-row { display: flex; align-items: center; width: 100%; padding: .6rem .5rem; border-top: 1px solid var(--color-darkborderc); color: var(--color-textcolor); text-align: left; cursor: pointer; }
</style>
