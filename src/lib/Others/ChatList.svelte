<script>
    import { language } from "../../lang";
    
    import { DBState } from 'src/ts/stores.svelte';
    import { newChatModelDefaults } from 'src/ts/storage/database.svelte';
    import { createUniqueDisplayName } from 'src/ts/displayName';
    import { ReloadGUIPointer, selectedCharID } from "../../ts/stores.svelte";
    import { DownloadIcon, SquarePenIcon, HardDriveUploadIcon, PlusIcon, TrashIcon, XIcon } from "@lucide/svelte";
    import { exportChat, importChat } from "../../ts/characters";
    import { findCharacterbyId } from "../../ts/util";
    import TextInput from "../UI/GUI/TextInput.svelte";
    import { changeChatTo, requestImmediateSave } from "src/ts/globalApi.svelte";
    import { v4 } from "uuid";
    import { deleteCharacterChats } from "src/ts/risubard/chatListActions";

    let editMode = $state(false)
    /** @type {{close?: any}} */
    let { close = () => {} } = $props();

    function activateOnKey(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.click()
    }

    function commitChatName(index) {
        const chats = DBState.db.characters[$selectedCharID].chats
        const chat = chats[index]
        if (!chat) return
        chat.name = createUniqueDisplayName(chat.name, chats, chat.id)
    }
</script>

<div class="risu-modal-overlay absolute w-full h-full z-40 bg-overlay/50 flex justify-center items-center">
    <div data-skin-part="modal" class="risu-modal-surface bg-darkbg p-4 break-any rounded-md flex flex-col max-w-full w-72 max-h-full overflow-y-auto">
        <div class="risu-modal-header flex items-center text-textcolor mb-4">
            <h2 class="mt-0 mb-0">{language.chatList}</h2>
            <div class="grow flex justify-end">
                <button class="risu-modal-close text-textcolor2 hover:text-primary mr-2 cursor-pointer items-center" onclick={close}>
                    <XIcon size={24}/>
                </button>
            </div>
        </div>
        {#each DBState.db.characters[$selectedCharID].chats as chat, i}
            <button onclick={() => {
                if(!editMode){
                    changeChatTo(i)
                    close()
                }
            }} class="flex items-center text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2 cursor-pointer" class:bg-selected={i === DBState.db.characters[$selectedCharID].chatPage}>
                {#if editMode}
                    <TextInput bind:value={DBState.db.characters[$selectedCharID].chats[i].name} onchange={() => commitChatName(i)} padding={false}/>
                {:else}
                    <span>{chat.name}</span>
                {/if}
                <div class="grow flex justify-end">
                    <div class="text-textcolor2 hover:text-primary mr-2 cursor-pointer" role="button" tabindex="0" aria-label="챗 내보내기" onclick={async (e) => {
                        e.stopPropagation()
                        exportChat(i)
                    }} onkeydown={activateOnKey}>
                        <DownloadIcon size={18}/>
                    </div>
                    <div class="text-textcolor2 hover:text-danger/80 cursor-pointer" role="button" tabindex="0" aria-label="챗 삭제" onclick={async (e) => {
                        e.stopPropagation()
                        // Same safeguards as the sidebar: painter work, gallery and the next chat.
                        if (chat.id) await deleteCharacterChats(DBState.db.characters[$selectedCharID], [chat.id])
                    }} onkeydown={activateOnKey}>
                        <TrashIcon size={18}/>
                    </div>
                </div>
            </button>
        {/each}
        <div class="flex mt-2 items-center">
            <button class="text-textcolor2 hover:text-primary cursor-pointer mr-1" onclick={() => {
                const character = DBState.db.characters[$selectedCharID]
                const currentChat = character.chats[character.chatPage]
                const len = character.chats.length
                let chats = character.chats
                const newChat = {
                    message:[], note:'', name:createUniqueDisplayName(`New Chat ${len + 1}`, chats), localLore:[], fmIndex: -1, id: v4(),
                    ...newChatModelDefaults(character, currentChat)
                }
                chats.unshift(newChat)
                DBState.db.characters[$selectedCharID].chats = chats
                changeChatTo(0)
                void requestImmediateSave()
                close()
            }}>
                <PlusIcon/>
            </button>
            <button class="text-textcolor2 hover:text-primary mr-2 cursor-pointer" onclick={() => {
                importChat()
            }}>
                <HardDriveUploadIcon size={18}/>
            </button>
            <button class="text-textcolor2 hover:text-primary cursor-pointer" onclick={() => {
                editMode = !editMode
            }}>
                <SquarePenIcon size={18}/>
            </button>
        </div>
    </div>
</div>

<style>
    .break-any{
        word-break: normal;
        overflow-wrap: anywhere;
    }
</style>
