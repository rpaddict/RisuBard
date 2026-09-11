<script lang="ts">
    import { DynamicGUI, settingsOpen, sideBarStore, openPresetList, openModelPresetList, openModelProfileBrowser, openPersonaList, openPersonaManager, personaSelectCallback, openHypaV3PresetList, openThemePresetList, MobileGUI, loadedStore, alertStore, LoadingStatusState, bookmarkListOpen, popupStore, popUpEditorStore } from './ts/stores.svelte';
    import Sidebar from './lib/SideBars/Sidebar.svelte';
    import { DBState } from './ts/stores.svelte';
    import ChatScreen from './lib/ChatScreens/ChatScreen.svelte';
    import AlertComp from './lib/Others/AlertComp.svelte';
    import RealmPopUp from './lib/UI/Realm/RealmPopUp.svelte';
    import GridChars from './lib/Others/GridCatalog.svelte';
    import BookmarkList from './lib/Others/BookmarkList.svelte';
    import { showRealmInfoStore, importCharacterProcess } from './ts/characterCards';
    import { importPreset, getDatabase, setDatabase, nodeOnlyVer } from './ts/storage/database.svelte';
    import { readModule } from './ts/process/modules';
    import { alertClear, alertError, alertWait, notifySuccess } from './ts/alert';
    import { language } from './lang';
    import SavePopupIconComp from './lib/Others/SavePopupIcon.svelte';
    import Botpreset from './lib/Setting/botpreset.svelte';
    import Modelpreset from './lib/Setting/modelpreset.svelte';
    import ModelProfileBrowser from './lib/Setting/modelProfileBrowser.svelte';
    import Themepreset from './lib/Setting/themepreset.svelte';
    import ListedPersona from './lib/Setting/listedPersona.svelte';
    import PersonaManager from './lib/Others/PersonaManager.svelte';
    import ListedHypaV3Preset from './lib/Setting/listedHypaV3Preset.svelte';
    import MobileHeader from './lib/Mobile/MobileHeader.svelte';
    import MobileBody from './lib/Mobile/MobileBody.svelte';
    import MobileFooter from './lib/Mobile/MobileFooter.svelte';
    import { checkCharOrder } from './ts/globalApi.svelte';
    import { ArrowUpIcon, GlobeIcon, PlusIcon } from '@lucide/svelte';
    import { hypaV3ModalOpen, hypaV3ProgressStore } from "./ts/stores.svelte";
    import { assetViewerStore } from './ts/assetViewer.svelte';
    import AssetViewer from './lib/Others/AssetViewer.svelte';
    import HypaV3Modal from './lib/Others/HypaV3Modal.svelte';
    import HypaV3Progress from './lib/Others/HypaV3Progress.svelte';
    import PluginAlertModal from './lib/Others/PluginAlertModal.svelte';
    import PopupEditor from './lib/Others/PopupEditor.svelte';
    import UpdatePopup from './lib/Others/UpdatePopup.svelte';
    import BootBackupPrompt from './lib/Others/BootBackupPrompt.svelte';
    import PopupList from './lib/UI/PopupList.svelte';
    import LoadingOverlay from './lib/Others/LoadingOverlay.svelte';
    import LoadingActivity from './lib/Others/LoadingActivity.svelte';
    import Toaster from './lib/UI/GUI/Toaster.svelte';
    import RequestStatusToaster from './lib/UI/GUI/RequestStatusToaster.svelte';
    import sendSound from './etc/send.mp3'
    import { RISU_APP_INTERNAL_DRAG_TYPE, RISU_SIDEBAR_DRAG_TYPE } from './ts/dragTypes';

    let gridOpen = $state(false)
    let aprilFools = $state(new Date().getMonth() === 3 && new Date().getDate() === 1)
    let aprilFoolsPage = $state(0)
    let keepingSessionAlive = $state(false)
    let settingsComponentPromise: Promise<typeof import('./lib/Setting/Settings.svelte')> | undefined

    function loadSettings() {
        settingsComponentPromise ??= import('./lib/Setting/Settings.svelte')
        return settingsComponentPromise
    }

    const getMainDropEffect = (e:DragEvent): DataTransfer['dropEffect'] => {
        const types = Array.from(e.dataTransfer?.types ?? [])
        if(types.includes(RISU_SIDEBAR_DRAG_TYPE)){
            return 'none'
        }
        if(types.includes(RISU_APP_INTERNAL_DRAG_TYPE)){
            return 'none'
        }
        return types.includes('Files') ? 'copy' : 'none'
    }

    const markAppInternalDrag = (e:DragEvent) => {
        e.dataTransfer?.setData(RISU_APP_INTERNAL_DRAG_TYPE, 'true')
    }

</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<main class="flex bg-bgcolor w-full h-full max-w-100vw text-textcolor" ondragover={(e) => {
    const dropEffect = getMainDropEffect(e)
    e.preventDefault()
    e.dataTransfer.dropEffect = dropEffect
}} ondragstart={markAppInternalDrag} ondrop={async (e) => {
    const types = Array.from(e.dataTransfer.types ?? [])
    if (types.includes(RISU_APP_INTERNAL_DRAG_TYPE) || types.includes(RISU_SIDEBAR_DRAG_TYPE)) {
        e.preventDefault()
        return
    }
    const file = e.dataTransfer.files[0]
    if (!file) {
        e.preventDefault()
        return
    }
    e.preventDefault()
    const name = file.name.toLowerCase()

    try {
        if (name.endsWith('.risup')) {
            alertWait(language.fileDropImport.presetLoading(file.name))
            const data = new Uint8Array(await file.arrayBuffer())
            await importPreset({ name: file.name, data })
            notifySuccess(language.fileDropImport.presetSuccess, { description: file.name })
        } else if (name.endsWith('.risum')) {
            alertWait(language.fileDropImport.moduleLoading(file.name))
            const data = new Uint8Array(await file.arrayBuffer())
            const module = await readModule(Buffer.from(data))
            if (!module) return
            const db = getDatabase()
            db.modules.push(module)
            notifySuccess(language.fileDropImport.moduleSuccess, { description: file.name })
        } else if (name.endsWith('.js')) {
            alertWait(language.fileDropImport.pluginLoading(file.name))
            const source = Buffer.from(await file.arrayBuffer())
                .toString('utf-8').replace(/^\uFEFF/gm, '')
            const { importPlugin } = await import('./ts/plugins/plugins.svelte')
            const imported = await importPlugin(source)
            if (!imported) {
                if ($alertStore.type === 'wait') alertClear()
                return
            }
            notifySuccess(language.fileDropImport.pluginSuccess, { description: file.name })
        } else {
            await importCharacterProcess({ name: file.name, data: file })
            checkCharOrder()
        }
    } catch (cause) {
        console.error(cause)
        const reason = cause instanceof Error ? cause.message : String(cause)
        alertError(language.fileDropImport.failed(file.name, reason))
    }
}} onclick={() => {
    if(keepingSessionAlive){
        return
    }

    const aliveMode = DBState?.db?.keepSessionAlive
    switch(aliveMode){
        case 'pip':{

            break
        }
        case 'sound':{
            console.log("Starting silent audio to keep session alive")
            const silentAudio = new Audio(sendSound);
            silentAudio.loop = true;
            silentAudio.volume = 0.000001;
            silentAudio.play();
            keepingSessionAlive = true;
            break
        }
    }

}}>
    {#if aprilFools}

        <div class="bg-bgcolor w-full h-screen min-h-screen text-textcolor flex relative">
            <div class="w-full max-w-3xl mx-auto py-8 px-4 flex justify-center items-center">
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="flex flex-col w-full items-center text-textcolor2">
                    {#if aprilFoolsPage === 0}
                        <h1 class="text-3xl text-textcolor font-bold mb-6">What can I help you?</h1>
                        <div class="resize-none relative w-full bg-darkbg rounded-3xl h-[110px] mb-6 text-textcolor2" placeholder="Ask me" onkeydown={(e) => {
                            if(e.key === 'Enter'){
                                aprilFoolsPage = 1
                            }
                        }}>
                            <textarea class="absolute top-0 left-0 w-full placeholder:text-textcolor2 rounded-3xl h-full p-4 bg-transparent resize-none" placeholder="Ask me"></textarea>
                            <div class="absolute bottom-2 left-4 flex gap-1.5">
                                <button class="p-2 rounded-full border border-darkborderc">
                                    <PlusIcon size={18} class="text-textcolor2" />
                                </button>
                                <button class="p-2 rounded-full border border-darkborderc">
                                    <GlobeIcon size={18} class="text-textcolor2" />
                                </button>
                                
                            </div>
                            <div class="absolute bottom-2 right-4 flex">
                                <button class="p-2 rounded-full bg-primary text-accenttext">
                                    <ArrowUpIcon size={18} />
                                </button>
                            </div>
                        </div>
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <div class="flex gap-1.5" onclick={() => {
                            aprilFoolsPage = 1
                        }}>
                            <button class="rounded-full border border-darkborderc px-4 py-2">
                                <span class="text-textcolor2">🔍</span>
                                Search
                            </button>
                            <button class="rounded-full border border-darkborderc px-4 py-2">
                                <span class="text-textcolor2">🎮</span>
                                Games
                            </button>
                            <button class="rounded-full border border-darkborderc px-4 py-2">
                                <span class="text-textcolor2">🎨</span>
                                Roleplay
                            </button>
                            <button class="rounded-full border border-darkborderc px-4 py-2">
                                More
                            </button>
                        </div>
                    {:else}
                    <h1 class="text-3xl text-textcolor font-bold mb-6">
                        We do not have search results.
                    </h1>
                    <p class="text-textcolor2 mb-6">
                        <!-- svelte-ignore a11y_missing_attribute -->
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        Go to <a class="text-info cursor-pointer" onclick={() => {
                            aprilFoolsPage = 0
                            aprilFools = false
                        }}>
                            RisuBard
                        </a>
                    </p>

                    {/if}
                </div>
            </div>
            <span class="absolute top-4 left-4 font-bold text-textcolor2 text-md md:text-lg">RisyGTP-9</span>
        </div>
    {:else if !$loadedStore}
        <div class="w-full h-full flex justify-center items-center text-textcolor text-xl bg-darkbg flex-col">
            <img
                data-startup-logo="app"
                class="mb-2 w-[min(80vw,25rem)] rounded-xl border border-darkborderc object-cover shadow-lg"
                src="/assets/risubard-startup.webp" fetchpriority="high" decoding="sync"
                alt="RisuBard"
                width="500"
                height="300"
            />
            <span
                data-startup-version
                class="mb-5 text-sm font-semibold tracking-[0.18em] text-textcolor2"
            >v{nodeOnlyVer}</span>
            <div class="flex flex-row items-center">
                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-textcolor" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                <span>{language.startupLoading.title}</span>
            </div>

            <span class="text-sm mt-2 text-textcolor2">{LoadingStatusState.text || language.startupLoading.starting}</span>
        </div>
    {:else if $settingsOpen}
        {#await loadSettings()}
            <div class="w-full h-full flex justify-center items-center text-textcolor bg-darkbg">
                <span>Loading...</span>
            </div>
        {:then settingsModule}
            {@const Settings = settingsModule.default}
            <Settings />
        {/await}
    {:else if $MobileGUI}
        <div class="w-full h-full flex flex-col">
            <MobileHeader />
            <MobileBody />
            <MobileFooter />
        </div>
    {:else}
        {#if gridOpen}
            <GridChars endGrid={() => {gridOpen = false}} />
        {:else}
            <div
                data-responsive-sidebar-host
                class="top-0 w-full h-full left-0 z-30 flex flex-row items-center"
                class:fixed={$DynamicGUI && $sideBarStore}
                class:hidden={$DynamicGUI && !$sideBarStore}
                style:display={!$DynamicGUI ? 'contents' : undefined}
            >
                <!-- Keep one Sidebar instance mounted across the responsive breakpoint so portal dialogs retain state. -->
                <Sidebar openGrid={() => {gridOpen = true}} hidden={!$DynamicGUI && !$sideBarStore} />
            </div>
            <div class="flex h-full min-h-0 min-w-0 grow flex-col overflow-hidden">
                <ChatScreen />
            </div>
        {/if}
    {/if}
    <AlertComp />
    {#if $showRealmInfoStore}
        <RealmPopUp bind:openedData={$showRealmInfoStore} />
    {/if}
    {#if $openPresetList}
        <Botpreset close={() => {$openPresetList = false}} />
    {/if}
    {#if $openModelPresetList}
        <Modelpreset close={() => {$openModelPresetList = false}} />
    {/if}
    {#if $openModelProfileBrowser}
        <ModelProfileBrowser close={() => {$openModelProfileBrowser = false}} />
    {/if}
    {#if $openThemePresetList}
        <Themepreset close={() => {$openThemePresetList = false}} />
    {/if}
    {#if $openPersonaList}
        <ListedPersona close={() => {$openPersonaList = false; $personaSelectCallback = null}} onSelect={$personaSelectCallback} />
    {/if}
    {#if $openPersonaManager}
        <PersonaManager />
    {/if}
    {#if $openHypaV3PresetList}
        <ListedHypaV3Preset close={() => {$openHypaV3PresetList = false}} />
    {/if}
    {#if $bookmarkListOpen}
        <BookmarkList />
    {/if}
    {#if $hypaV3ModalOpen}
        <HypaV3Modal />
    {/if}
    <SavePopupIconComp />
    {#if $hypaV3ProgressStore.open}
        <HypaV3Progress />
    {/if}
    <PluginAlertModal />
    <LoadingOverlay />
    <LoadingActivity />
    <UpdatePopup />
    <BootBackupPrompt />
    {#if popupStore.children}
        <PopupList />
    {/if}
    {#if popUpEditorStore.open}
        <PopupEditor />
    {/if}
    {#if assetViewerStore.open}
        <AssetViewer />
    {/if}
    <Toaster />
    <RequestStatusToaster />
</main>
