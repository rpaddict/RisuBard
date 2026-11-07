<script lang="ts">
    import { onDestroy, untrack } from 'svelte';
    import { getCustomBackground, getEmotion } from "../../ts/util";
    
    import { DBState, risuBardGalleryOpen } from 'src/ts/stores.svelte';
    import { CharEmotion, selectedCharID, openModuleListStore } from "../../ts/stores.svelte";
    import { v4 } from 'uuid';
    import ResizeBox from './ResizeBox.svelte'
    import DefaultChatScreen from "./DefaultChatScreen.svelte";
    import defaultWallpaper from '../../etc/bg.jpg'
    import ChatList from "../Others/ChatList.svelte";
    import TransitionImage from "./TransitionImage.svelte";
    import BackgroundDom from "./BackgroundDom.svelte";
    import SideBarArrow from "../UI/GUI/SideBarArrow.svelte";
    import ModuleChatMenu from "../Setting/Pages/Module/ModuleChatMenu.svelte";
    import RisuBardSaveSlotsDialog from '../SideBars/RisuBardSaveSlotsDialog.svelte';
    import RisuBardGallery from '../SideBars/RisuBardGallery.svelte';
    import { ensureChatHydrated } from 'src/ts/storage/chatStorage';
    import { alertConfirm, notifyInfo, notifySuccess } from 'src/ts/alert';
    import { changeChatTo, createChatCopyName, forageStorage, requestImmediateSave, trackChatForSave } from 'src/ts/globalApi.svelte';
    import { completeMemoryWikiFork } from 'src/ts/risubard/memoryWikiFork';
    import { countChatTurns, createMemorySaveSlot, deleteMemorySaveSlot, latestChatMessageId, listMemorySaveSlots, prepareMemorySaveLoad, shouldConfirmMemorySaveLoad, type MemorySaveSlotSummary } from 'src/ts/risubard/memorySaveSlots';
    import { autoSaveId, normalizeAutosaveInterval, normalizeAutosaveRetention, obsoleteAutosaveIds, quickSaveId, shouldCreateAutosave } from 'src/ts/risubard/memorySavePolicy';
    import { isWikiGenerating } from 'src/ts/risubard/wikiGenerationState';
    import { resolveChatTextSurface } from 'src/ts/gui/textTheme';
    import { chatGenKey, generationStates } from 'src/ts/process/generationState';
    import { activateWikiEmbeddings, activateHistoricalSourceEmbeddings, refreshHistoricalSourceEmbeddings, stopHistoricalSourceEmbeddings, wikiEmbeddingRuntime } from 'src/ts/risubard/wikiEmbeddingService';
    import { resolveRisuBardChatSettings } from 'src/ts/risubard/risuBardSettings';
    import { RISUBARD_MEMORY_UPDATED_EVENT, type RisuBardMemoryUpdatedDetail } from 'src/ts/risubard/memoryEvents';
    let openChatList = $state(false)
    let openModuleList = $state(false)
    let saveSlotsOpen = $state(false)
    let saveSlotsMode = $state<'save' | 'load'>('load')
    let savingSlot = $state(false)
    let currentCharacter = $derived(
        $selectedCharID >= 0 ? DBState.db.characters[$selectedCharID] : undefined
    )
    let galleryCharacter = $derived(
        currentCharacter?.type === 'character' ? currentCharacter : undefined
    )

    onDestroy(() => { wikiEmbeddingRuntime.stop(); stopHistoricalSourceEmbeddings() })

    $effect(() => {
        const characterId = currentCharacter?.chaId
        const chatId = currentCharacter?.chats[currentCharacter.chatPage]?.id
        const settings = DBState.db
        if (!characterId || !chatId) {
            wikiEmbeddingRuntime.stop()
            stopHistoricalSourceEmbeddings()
            return
        }
        activateWikiEmbeddings(characterId, chatId, settings)
        const chat = currentCharacter?.chats[currentCharacter.chatPage]
        const resolved = resolveRisuBardChatSettings(settings, chat?.risuBardSettings, currentCharacter?.risuBardPinnedSettings)
        const messageCount = chat?.message.length
        if (chat && !chat._placeholder && resolved.risuBardHistoricalSourceMatchLimit > 0) {
            activateHistoricalSourceEmbeddings(characterId, chatId, settings)
            if (!chat.isStreaming && messageCount) untrack(() => refreshHistoricalSourceEmbeddings(characterId, chatId, settings, chat.message))
        } else stopHistoricalSourceEmbeddings()
        const refresh = (event: Event) => {
            const detail = (event as CustomEvent<RisuBardMemoryUpdatedDetail>).detail
            if (detail?.characterId === characterId && detail.chatId === chatId) {
                wikiEmbeddingRuntime.refresh()
            }
        }
        window.addEventListener(RISUBARD_MEMORY_UPDATED_EVENT, refresh)
        return () => {
            window.removeEventListener(RISUBARD_MEMORY_UPDATED_EVENT, refresh)
        }
    })

    function openSaveSlots(mode: 'save' | 'load'): void {
        if(savingSlot) return
        saveSlotsMode = mode
        saveSlotsOpen = true
    }

    async function saveCurrentChat(
        saveId?: string,
        overwrite = saveId !== undefined,
        options: { silent?: boolean } = {},
    ): Promise<MemorySaveSlotSummary> {
        const character = currentCharacter
        if(savingSlot || !character) throw new Error('현재 채팅을 저장할 수 없습니다.')
        const chatIdx = character.chatPage
        savingSlot = true
        try {
            if(character.chats[chatIdx]?._placeholder){
                await ensureChatHydrated(character.chats, chatIdx, character.chaId)
            }
            const chat = character.chats[chatIdx]
            if(!chat || chat._placeholder){
                throw new Error('채팅 전체 내용을 불러오지 못했습니다.')
            }
            if(chat.isStreaming){
                throw new Error('응답 생성이 끝난 뒤 채팅을 저장해 주세요.')
            }
            if(!character.chaId || !chat.id){
                throw new Error('채팅 저장에는 안정적인 캐릭터와 채팅 ID가 필요합니다.')
            }
            const saved = await createMemorySaveSlot({
                characterId: character.chaId,
                chat,
                saveId: saveId ?? v4(),
                overwrite,
                fetchImpl: fetch,
                createAuth: () => forageStorage.createAuth(),
            })
            if(!options.silent){
                notifySuccess('채팅, 변수와 Memory Wiki를 저장했습니다.')
            }
            return saved
        }
        finally {
            savingSlot = false
        }
    }

    async function currentSaveSlots(
        characterId: string,
        chatId: string,
    ): Promise<MemorySaveSlotSummary[]> {
        return listMemorySaveSlots({
            characterId,
            sourceChatId: chatId,
            fetchImpl: fetch,
            createAuth: () => forageStorage.createAuth(),
        })
    }

    async function quickSaveCurrentChat(): Promise<void> {
        const character = currentCharacter
        const chat = character?.chats[character.chatPage]
        if(!character?.chaId || !chat?.id || chat._placeholder || savingSlot) return
        const saveId = quickSaveId(chat.id)
        const slots = await currentSaveSlots(character.chaId, chat.id)
        await saveCurrentChat(
            saveId,
            slots.some((slot) => slot.saveId === saveId),
            { silent: true },
        )
        notifySuccess('퀵세이브를 저장했습니다.')
    }

    async function quickLoadCurrentChat(): Promise<void> {
        const character = currentCharacter
        const chat = character?.chats[character.chatPage]
        if(!character?.chaId || !chat?.id || chat._placeholder || savingSlot) return
        const saveId = quickSaveId(chat.id)
        const slots = await currentSaveSlots(character.chaId, chat.id)
        const quickSlot = slots.find((slot) => slot.saveId === saveId)
        if(!quickSlot){
            notifyInfo('아직 퀵세이브 파일이 없습니다.')
            return
        }
        if(shouldConfirmMemorySaveLoad(latestChatMessageId(chat.message), [quickSlot])
            && !await alertConfirm('저장하지 않은 채팅은 사라집니다. 퀵로드할까요?')) return
        await loadSavedChat(saveId)
    }

    async function autosaveCurrentChat(
        characterId: string,
        chatId: string,
        turnCount: number,
        interval: number,
        retention: number,
    ): Promise<void> {
        const character = currentCharacter
        const chat = character?.chats[character.chatPage]
        if(!character || character.chaId !== characterId || chat?.id !== chatId
            || chat._placeholder || chat.isStreaming || savingSlot) return
        const previousTurn = chat.risuBardLastAutosaveTurn
        chat.risuBardLastAutosaveTurn = turnCount
        try {
            const slots = await currentSaveSlots(characterId, chatId)
            if(savingSlot) {
                chat.risuBardLastAutosaveTurn = previousTurn
                return
            }
            const saveId = autoSaveId(chatId, turnCount, interval, retention)
            await saveCurrentChat(
                saveId,
                slots.some((slot) => slot.saveId === saveId),
                { silent: true },
            )
            for (const obsoleteId of obsoleteAutosaveIds(
                slots.map((slot) => slot.saveId),
                chatId,
                retention,
            )) {
                await deleteMemorySaveSlot({
                    characterId,
                    saveId: obsoleteId,
                    fetchImpl: fetch,
                    createAuth: () => forageStorage.createAuth(),
                })
            }
            await requestImmediateSave()
        }
        catch(error){
            chat.risuBardLastAutosaveTurn = previousTurn
            console.warn('[RisuBard autosave]', error)
        }
    }

    async function loadSavedChat(saveId: string, asNewChat = false): Promise<void> {
        const character = currentCharacter
        if(!character?.chaId) return
        const chatIdx = character.chatPage
        if(character.chats[chatIdx]?._placeholder){
            await ensureChatHydrated(character.chats, chatIdx, character.chaId)
        }
        const currentChat = character.chats[chatIdx]
        if(!currentChat?.id || currentChat._placeholder){
            throw new Error('현재 채팅 전체 내용을 불러오지 못했습니다.')
        }
        if(currentChat.isStreaming){
            throw new Error('응답 생성이 끝난 뒤 저장 파일을 불러와 주세요.')
        }
        const destinationChatId = asNewChat ? v4() : currentChat.id
        const prepared = await prepareMemorySaveLoad({
            characterId: character.chaId,
            saveId,
            currentChat,
            destinationChatId,
            fetchImpl: fetch,
            createAuth: () => forageStorage.createAuth(),
        })
        const loadedChat = prepared.chat
        loadedChat.id = destinationChatId
        loadedChat.isStreaming = false
        delete loadedChat.activeStreamingDisplayOptimizationMode
        delete loadedChat._placeholder
        if(asNewChat){
            loadedChat.name = createChatCopyName(loadedChat.name, 'Copy')
            character.chats.unshift(loadedChat)
        }
        else {
            character.chats[chatIdx] = loadedChat
        }
        character.chats = character.chats
        try {
            // Chat bodies are stored by ID: send only the loaded chat, not the
            // whole database (a full write re-encodes and uploads every bot).
            trackChatForSave(character.chaId, destinationChatId)
            await requestImmediateSave({ rejectOnFailure: true })
        }
        catch(error){
            if(asNewChat){
                character.chats.splice(0, 1)
            }
            else {
                character.chats[chatIdx] = currentChat
            }
            character.chats = character.chats
            await completeMemoryWikiFork({
                characterId: character.chaId,
                destinationChatId,
                forkToken: prepared.forkToken,
                action: 'discard',
                fetchImpl: fetch,
                createAuth: () => forageStorage.createAuth(),
            }).catch(() => undefined)
            await requestImmediateSave({
                forceFullWrite: true,
                rejectOnFailure: true,
            })
            throw error
        }
        await completeMemoryWikiFork({
            characterId: character.chaId,
            destinationChatId,
            forkToken: prepared.forkToken,
            action: 'finalize',
            fetchImpl: fetch,
            createAuth: () => forageStorage.createAuth(),
        })
        changeChatTo(asNewChat ? 0 : chatIdx)
        saveSlotsOpen = false
        notifySuccess('스토리 불러오기 완료', { duration: 3000 })
    }

    $effect(() => {
        if ($openModuleListStore) {
            openModuleList = true
            openModuleListStore.set(false)
        }
    })

    $effect(() => {
        const character = currentCharacter
        const chat = character?.chats[character.chatPage]
        if(!character?.chaId || !chat?.id || chat._placeholder || chat.isStreaming
            || savingSlot || $isWikiGenerating
            || $generationStates.has(chatGenKey(chat.id))) return
        const turnCount = countChatTurns(chat.message)
        const interval = normalizeAutosaveInterval(DBState.db.risuBardAutosaveInterval)
        const retention = normalizeAutosaveRetention(DBState.db.risuBardAutosaveRetention)
        if(shouldCreateAutosave(
            turnCount,
            interval,
            chat.risuBardLastAutosaveTurn,
        )) {
            void autosaveCurrentChat(
                character.chaId,
                chat.id,
                turnCount,
                interval,
                retention,
            )
        }
    })

    const wallPaper = `background: url(${defaultWallpaper})`
    const chatTextSurface = $derived(resolveChatTextSurface(DBState.db.colorScheme, DBState.db))
    const externalStyles = $derived(chatTextSurface.active ?
            ("background: " + chatTextSurface.background + ';\n')
        +   (DBState.db.textBorder ? "text-shadow: -1px -1px 0 var(--color-shadow), 1px -1px 0 var(--color-shadow), -1px 1px 0 var(--color-shadow), 1px 1px 0 var(--color-shadow);" : '')
        +   (DBState.db.textScreenRounded ? "border-radius: var(--risu-radius-4xl); padding: 1rem;" : '')
        +   (DBState.db.textScreenBorder ? `border: 0.3rem solid ${DBState.db.textScreenBorder};` : '') : '')
    let bgImg= $state('')
    let lastBg = $state('')
    $effect.pre(() => {
        (async () =>{
            if(DBState.db.customBackground !== lastBg){
                lastBg = DBState.db.customBackground
                bgImg = await getCustomBackground(DBState.db.customBackground)
            }
        })()
    });
</script>

{#snippet chatChrome()}
    <SideBarArrow />
{/snippet}

{#snippet chatViewport(customStyle: string)}
    {#if $risuBardGalleryOpen && galleryCharacter}
        <div
            data-gallery-scroll
            class="h-full w-full overflow-y-auto overscroll-y-contain relative default-chat-screen"
        >
            <RisuBardGallery
                chara={galleryCharacter}
                {customStyle}
                onClose={() => risuBardGalleryOpen.set(false)}
            />
        </div>
    {:else}
        <DefaultChatScreen {customStyle} bind:openChatList bind:openModuleList onSaveChat={() => openSaveSlots('save')} onOpenChatLoad={() => openSaveSlots('load')} onQuickSave={quickSaveCurrentChat} onQuickLoad={quickLoadCurrentChat} {savingSlot}/>
    {/if}
{/snippet}

<div class="relative flex h-full min-h-0 min-w-0 w-full" data-chat-dock-workspace>
{#if DBState.db.theme === 'waifu'}
    <div class="grow flex-1 h-full min-h-0 min-w-0 flex justify-center relative overflow-hidden" style="{bgImg.length < 4 ? wallPaper : bgImg}">
        {@render chatChrome()}
        <BackgroundDom />
        {#if $selectedCharID >= 0}
            {#if DBState.db.characters[$selectedCharID].viewScreen !== 'none'}
                <div class="h-full mr-10 flex justify-end halfw" style:width="{42 * (DBState.db.waifuWidth2 / 100)}rem">
                    <TransitionImage classType="waifu" src={getEmotion(DBState.db, $CharEmotion, 'plain')}/>
                </div>
            {/if}
        {/if}
        <div class="h-full w-2xl" style:width="{42 * (DBState.db.waifuWidth / 100)}rem" class:halfwp={$selectedCharID >= 0 && DBState.db.characters[$selectedCharID].viewScreen !== 'none'}>
            {@render chatViewport(`${externalStyles}backdrop-filter: blur(4px);`)}
        </div>
    </div>
{:else if DBState.db.theme === 'waifuMobile'}
    <div class="grow flex-1 h-full min-h-0 min-w-0 relative overflow-hidden" style={bgImg.length < 4 ? wallPaper : bgImg}>
        {@render chatChrome()}
        <BackgroundDom />
        <div class="w-full absolute z-10 bottom-0 left-0"
            class:per33={$selectedCharID >= 0 && DBState.db.characters[$selectedCharID].viewScreen !== 'none'}
            class:h-full={!($selectedCharID >= 0 && DBState.db.characters[$selectedCharID].viewScreen !== 'none')}
        >
            {@render chatViewport(`${externalStyles}backdrop-filter: blur(4px);`)}
        </div>
        {#if $selectedCharID >= 0}
            {#if DBState.db.characters[$selectedCharID].viewScreen !== 'none'}
                <div class="h-full w-full absolute bottom-0 left-0 max-w-full">
                    <TransitionImage classType="mobile" src={getEmotion(DBState.db, $CharEmotion, 'plain')}/>
                </div>
            {/if}
        {/if}
    </div>
{:else}
    <div class="grow flex-1 h-full min-h-0 min-w-0 relative justify-center flex overflow-hidden">
        {@render chatChrome()}
        <BackgroundDom />
        <div style={bgImg} class="h-full w-full" class:max-w-6xl={DBState.db.classicMaxWidth}>
            {#if $selectedCharID >= 0}
                {#if DBState.db.characters[$selectedCharID].viewScreen !== 'none' && (!(DBState.db.characters[$selectedCharID] as import('src/ts/storage/database.svelte').character).inlayViewScreen)}
                    <ResizeBox />
                {/if}
            {/if}
            {@render chatViewport(externalStyles)}
        </div>
    </div>
{/if}
</div>
{#if openChatList}
    <ChatList close={() => {openChatList = false}}/>
{:else if openModuleList}
    <ModuleChatMenu close={() => {openModuleList = false}}/>
{/if}

{#if currentCharacter?.chaId}
    <RisuBardSaveSlotsDialog
        open={saveSlotsOpen}
        bind:mode={saveSlotsMode}
        characterId={currentCharacter.chaId}
        characterName={currentCharacter.name}
        currentChatId={currentCharacter.chats[currentCharacter.chatPage]?.id}
        currentChatName={currentCharacter.chats[currentCharacter.chatPage]?.name}
        currentLatestMessageId={latestChatMessageId(
            currentCharacter.chats[currentCharacter.chatPage]?.message ?? []
        )}
        onOpenChange={(open) => { saveSlotsOpen = open }}
        onLoad={loadSavedChat}
        onSave={saveCurrentChat}
    />
{/if}

<style>
    .halfw{
        max-width: calc(50% - 5rem);
    }
    .halfwp{
        max-width: calc(50% - 5rem);
    }
    .per33{
        height: 33.333333%;
    }
</style>
