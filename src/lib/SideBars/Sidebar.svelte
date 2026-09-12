<script lang="ts">
    import {
    CharEmotion,
    DynamicGUI,
    botMakerMode,
    selectedCharID,
    settingsOpen,
    sideBarClosing,
    sideBarStore,
    OpenRealmStore,
    PlaygroundStore,

    QuickSettings,

    additionalHamburgerMenu,

    leftBarCollapsed,
    openPersonaManager,
    characterVaultOpen,
    CharConfigSubMenu


  } from "../../ts/stores.svelte";
    import { setDatabase } from "../../ts/storage/database.svelte";
    import { DBState, MobileSideBar, risuBardGalleryOpen, SizeStore } from 'src/ts/stores.svelte';
    import BarIcon from "./BarIcon.svelte";
    import SidebarIndicator from "./SidebarIndicator.svelte";
    import {
    ShellIcon,
    Settings,
    ListIcon,
    LayoutGridIcon,
    FolderIcon,
    FolderOpenIcon,
    HomeIcon,
    User2Icon,
    ChevronsLeft,
    ArrowRight,
  } from "@lucide/svelte";
    import {
  addCharacter,
    changeChar,
    getCharImage,
  } from "../../ts/characters";
    import CharConfig from "./CharConfig.svelte";
    import { language } from "../../lang";
    import isEqual from "lodash/isEqual";
    import SidebarAvatar from "./SidebarAvatar.svelte";
    import ShSwitch from "../UI/GUI/ShSwitch.svelte";
    import { getCharacterIndexObject, makeAgoText, selectSingleFile } from "src/ts/util";
    import { checkCharOrder, getFileSrc, requestImmediateSave, saveAsset } from "src/ts/globalApi.svelte";
    import { alertInput, alertSelect } from "src/ts/alert";
    import SideChatList from "./SideChatList.svelte";

  import { sideBarSize } from "src/ts/gui/guisize";
  import {
    normalizeCharacterListSidebarWidth,
    normalizeCharacterSidebarWidth,
  } from 'src/ts/gui/sidebarLayout';
  import SidebarResizeHandle from './SidebarResizeHandle.svelte';
  import DevTool from "./DevTool.svelte";
    import QuickSettingsGui from "../Others/QuickSettingsGUI.svelte";
  import PluginDefinedIcon from "../Others/PluginDefinedIcon.svelte";
  import CharacterVaultDialog from "./CharacterVaultDialog.svelte";
  import ExternalEditModeButton from './ExternalEditModeButton.svelte';
  import ShButton from "../UI/GUI/ShButton.svelte";
  import ShDialog from "../UI/GUI/ShDialog.svelte";
  import SolarBoldIcon from '../UI/Icons/SolarBoldIcon.svelte';
  import SolarAssetIcon from '../UI/Icons/SolarAssetIcon.svelte';
  import shareIcon from 'src/assets/solar-bold/share-bold.svg';
  import magnifierBugIcon from 'src/assets/solar-bold/magnifier-bug-bold.svg';
  import characterVaultIdle from 'src/assets/character-vault/books1-idle.png';
  import characterVaultHover from 'src/assets/character-vault/books1-hover.gif';
  import { tooltip } from "src/ts/gui/tooltip";
  import {
    getCharacterVaultQuickAccess,
    isCharacterVaultNew,
    moveCharacterVaultSidebarCharacter,
    reorderCharacterVaultSidebarShortcuts,
  } from "src/ts/characterVault";
  import { getEffectivePersona } from "src/ts/personaScopes";
  import {
    findQuickInventoryFolderCard,
    resolveQuickInventoryCardDrop,
    type QuickInventoryCardTarget,
  } from './quickInventoryDrop';
  const isTouchDevice = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const touchDragEnabled = $derived(isTouchDevice && !DBState.db.disableMobileDragDrop);
    import { RISU_SIDEBAR_DRAG_TYPE } from "src/ts/dragTypes";

  let sideBarMode = $state(0);
  let editMode = $state(false);
  let menuMode = $state(0);
  let devTool = $state(false)
  let characterManageOpen = $state(false)
  let sidebarElement = $state<HTMLDivElement>()
  let characterListSidebarElement = $state<HTMLDivElement>()
  const characterListSidebarMaxWidth = $derived(Math.max(80, Math.min(240,
    ($SizeStore.w || window.innerWidth) - 320)))
  const characterListSidebarWidth = $derived(
    `${normalizeCharacterListSidebarWidth(DBState.db.characterListSidebarWidth, characterListSidebarMaxWidth)}px`
  )
  const sidebarMaxWidth = $derived(Math.max(0, ($SizeStore.w || window.innerWidth)
    - ($DynamicGUI ? 128 : 440)))
  const sidebarWidth = $derived(
    $selectedCharID >= 0 && Number.isFinite(DBState.db.characterSidebarWidth)
      ? `${normalizeCharacterSidebarWidth(DBState.db.characterSidebarWidth, sidebarMaxWidth)}px`
      : `min(${24 + 4 * $sideBarSize}rem, ${sidebarMaxWidth}px)`
  )
  $effect(() => {
    if ($selectedCharID < 0) characterManageOpen = false
  })
  const effectivePersona = $derived.by(() => {
    const character = DBState.db.characters[$selectedCharID]
    return getEffectivePersona(DBState.db, character, character?.chats?.[character.chatPage])
  })

  function reseter() {
    menuMode = 0;
    sideBarMode = 0;
    editMode = false;
    settingsOpen.set(false);
    CharEmotion.set({});
  }

  function selectCharacter(index: number) {
    changeChar(index, { reseter });
  }

  type sortTypeNormal = { type:'normal',id:string,img: string, index: number, name:string, isNew:boolean }
  type sortType =  sortTypeNormal|{type:'folder',folder:sortTypeNormal[],id:string, name:string, color:string, img?:string}
  let charImages: sortType[] = $state([]);
  const sidebarImageCache = new Map<string, Promise<string>>()

  function sidebarCharacterImage(image: string): Promise<string> {
    const key = `${DBState.db.hideAllImages ? 'hidden' : 'shown'}:${image}`
    const cached = sidebarImageCache.get(key)
    if (cached) return cached
    const request = getCharImage(image, 'plain').then((source) => source || '/none.webp')
    sidebarImageCache.set(key, request)
    return request
  }
  // Recently interacted characters for the home sidebar. Character-level
  // `lastInteraction` is already in memory (no chat hydration needed), so this
  // sort is cheap; the $derived is only read while on the home screen.
  let recentChars = $derived(
    DBState.db.characters
      .map((c, index) => ({ index, name: c.name, image: c.image, lastInteraction: c.lastInteraction ?? 0, trashTime: c.trashTime }))
      .filter((c) => !c.trashTime)
      .filter((c) => c.lastInteraction > 0)
      .sort((a, b) => b.lastInteraction - a.lastInteraction)
  );
  // Progressive reveal: render `recentVisible` items, "Load more" adds 10.
  // Avoids mounting hundreds of avatar components at once (no list virtualization).
  let recentVisible = $state(10);
  let IconRounded = $state(false)
  let openFolders:string[] = $state([])
  let currentDrag: DragData | null = $state(null)
  interface Props {
    openGrid?: any;
    hidden?: boolean;
  }

  let { openGrid = () => {}, hidden = false }: Props = $props();

  sideBarClosing.set(false)

  $effect(() => {
    let newCharImages: sortType[] = [];
    const idObject = getCharacterIndexObject()
    const folderById = new Map(DBState.db.characterOrder.flatMap((entry) =>
      typeof entry === 'string' ? [] : [[entry.id, entry] as const]
    ))
    for (const shortcut of getCharacterVaultQuickAccess(DBState.db)) {
      if(shortcut.kind === 'character'){
        const index = idObject[shortcut.id] ?? -1
        if(index !== -1){
          const cha = DBState.db.characters[index]
          newCharImages.push({
            img:cha.image ?? "",
            id: cha.chaId,
            index:index,
            type: "normal",
            name: cha.name,
            isNew: isCharacterVaultNew(DBState.db, cha.chaId)
          });
        }
      }
      else{
        const folder = folderById.get(shortcut.id)
        if (!folder) continue
        let folderCharImages: sortTypeNormal[] = []
        for(const id of folder.data){
          const index = idObject[id] ?? -1
          if(index !== -1){
            const cha = DBState.db.characters[index]
            folderCharImages.push({
              img:cha.image ?? "",
              id: cha.chaId,
              index:index,
              type: "normal",
              name: cha.name,
              isNew: isCharacterVaultNew(DBState.db, cha.chaId)
            });
          }
        }
        newCharImages.push({
          folder: folderCharImages,
          type: "folder",
          id: folder.id,
          name: folder.name,
          color: folder.color,
          img: folder.imgFile,
        });
      }
    }
    if (!isEqual(charImages, newCharImages)) {
      charImages = newCharImages;
    }
    if(IconRounded !== DBState.db.roundIcons){
      IconRounded = DBState.db.roundIcons
    }
  })


  function getFolderIndex(id:string){
    for(let i=0;i<DBState.db.characterOrder.length;i++){
      const data = DBState.db.characterOrder[i]
      if(typeof(data) !== 'string' && data.id === id){
        return i
      }
    }
    return -1
  }

  function scrollToActiveCharacter() {
    const selectedId = $selectedCharID
    if (selectedId === -1) return
    
    const characterId = DBState.db.characters[selectedId]?.chaId
    if (!characterId) return
    
    let targetFolderId: string | null = null
    
    for (const item of charImages) {
      if (item.type === 'folder') {
        const foundChar = item.folder.find(c => 
          DBState.db.characters[c.index]?.chaId === characterId
        )
        if (foundChar) {
          targetFolderId = item.id
          break
        }
      }
    }
    
    if (targetFolderId && !openFolders.includes(targetFolderId)) {
      openFolders.push(targetFolderId)
      openFolders = openFolders
    }
    
    setTimeout(() => {
      const activeElement = document.querySelector(`[data-char-id="${characterId}"]`)
      if (activeElement) {
        activeElement.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'start' 
        })
      }
    }, 100)
  }

  $effect(() => {
    if (typeof window === 'undefined') return
    
    const handler = () => {
      scrollToActiveCharacter()
    }
    
    window.addEventListener('scrollToActiveCharacter', handler)
    
    return () => {
      window.removeEventListener('scrollToActiveCharacter', handler)
    }
  })


  type DragEv = DragEvent & {
    currentTarget: EventTarget & HTMLDivElement;
  }
  type DragData =
    | { kind:'character', id:string, folder?:string }
    | { kind:'folder', id:string }
  type DropData = { index:number, folder?:string }

  const moveSidebarItem = (source:DragData, target:DropData) => {
    let changed = false
    if(target.folder){
      if(source.kind !== 'character') return false
      changed = moveCharacterVaultSidebarCharacter(
        DBState.db,
        source.id,
        target.folder,
        target.index
      )
      if(changed && !openFolders.includes(target.folder)){
        openFolders.push(target.folder)
        openFolders = openFolders
      }
    }
    else if(source.kind === 'character' && source.folder){
      changed = moveCharacterVaultSidebarCharacter(
        DBState.db,
        source.id,
        null,
        target.index
      )
    }
    else{
      changed = reorderCharacterVaultSidebarShortcuts(
        DBState.db,
        { kind: source.kind, id: source.id },
        target.index
      )
    }
    if(changed){
      checkCharOrder()
      void requestImmediateSave()
    }
    return changed
  }

  const avatarDragStart = (data:DragData, e:DragEv) => {
    e.dataTransfer.setData('text/plain', '');
    e.dataTransfer.setData(RISU_SIDEBAR_DRAG_TYPE, 'true');
    currentDrag = data
    const avatar = e.currentTarget.querySelector('.avatar')
    if(avatar){
      e.dataTransfer.setDragImage(avatar, 10, 10);
    }
  }

  let desktopDropTarget: HTMLDivElement | null = null

  const avatarDropFeedbackClasses = [
    'quick-inventory-drop-before',
    'quick-inventory-drop-after',
    'quick-inventory-drop-column',
    'quick-inventory-drop-inside',
  ]

  const avatarCardTargetFromElement = (target:HTMLElement):QuickInventoryCardTarget => ({
    kind: target.dataset.dragKind as 'character' | 'folder',
    id: target.dataset.dragId!,
    index: parseInt(target.dataset.dragIndex!),
    folder: target.dataset.dragFolder || undefined,
    folderLength: parseInt(target.dataset.folderLength ?? '0'),
  })

  const normalizeAvatarCardTarget = (
    source:DragData,
    target:HTMLElement,
    targetData:QuickInventoryCardTarget
  ) => {
    if(source.kind === 'folder' && targetData.folder){
      const folderCard = findQuickInventoryFolderCard(target)
      if(folderCard){
        return {
          target: folderCard,
          targetData: avatarCardTargetFromElement(folderCard),
        }
      }
    }
    return { target, targetData }
  }

  const resolveAvatarCardDrop = (
    source:DragData,
    target:HTMLElement,
    targetData:QuickInventoryCardTarget,
    clientX:number,
    clientY:number
  ) => {
    const columns = target.parentElement
      ? getComputedStyle(target.parentElement).gridTemplateColumns
        .split(' ')
        .filter(Boolean)
        .length
      : 1
    return resolveQuickInventoryCardDrop({
      sourceKind: source.kind,
      targetKind: targetData.kind,
      targetId: targetData.id,
      targetIndex: targetData.index,
      targetFolder: targetData.folder,
      targetFolderLength: targetData.folderLength,
      rect: target.getBoundingClientRect(),
      columnCount: columns,
      clientX,
      clientY,
    })
  }

  const clearAvatarDragFeedback = (e?: DragEv) => {
    if(e?.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)){
      return
    }
    const target = desktopDropTarget ?? e?.currentTarget
    target?.classList.remove(...avatarDropFeedbackClasses)
    if(desktopDropTarget === target){
      desktopDropTarget = null
    }
  }

  const clearCurrentDrag = () => {
    clearAvatarDragFeedback()
    currentDrag = null
  }

  $effect(() => {
    if (typeof window === 'undefined') return

    window.addEventListener('dragend', clearCurrentDrag)
    window.addEventListener('drop', clearCurrentDrag)
    window.addEventListener('blur', clearCurrentDrag)

    return () => {
      window.removeEventListener('dragend', clearCurrentDrag)
      window.removeEventListener('drop', clearCurrentDrag)
      window.removeEventListener('blur', clearCurrentDrag)
    }
  })

  const getCurrentSidebarDrag = (e:DragEvent) => {
    if(!currentDrag || !e.dataTransfer?.types.includes(RISU_SIDEBAR_DRAG_TYPE)){
      return null
    }
    return currentDrag
  }

  const avatarDragOver = (e:DragEv, targetData:QuickInventoryCardTarget) => {
    const drag = getCurrentSidebarDrag(e)
    if(!drag){
      return
    }
    const normalized = normalizeAvatarCardTarget(drag, e.currentTarget, targetData)
    const resolved = resolveAvatarCardDrop(
      drag,
      normalized.target,
      normalized.targetData,
      e.clientX,
      e.clientY
    )
    if(!resolved){
      return
    }
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if(desktopDropTarget !== normalized.target){
      clearAvatarDragFeedback()
      desktopDropTarget = normalized.target as HTMLDivElement
    }
    normalized.target.classList.remove(...avatarDropFeedbackClasses)
    if(resolved.mode === 'inside'){
      normalized.target.classList.add('quick-inventory-drop-inside')
      return
    }
    normalized.target.classList.add(resolved.placement.after
      ? 'quick-inventory-drop-after'
      : 'quick-inventory-drop-before')
    if(resolved.placement.axis === 'column'){
      normalized.target.classList.add('quick-inventory-drop-column')
    }
  }

  const avatarCardDrop = (targetData:QuickInventoryCardTarget, e:DragEv) => {
    const drag = getCurrentSidebarDrag(e)
    if(!drag){
      return
    }
    const normalized = normalizeAvatarCardTarget(drag, e.currentTarget, targetData)
    const resolved = resolveAvatarCardDrop(
      drag,
      normalized.target,
      normalized.targetData,
      e.clientX,
      e.clientY
    )
    if(resolved){
      avatarDrop(resolved.drop, e)
    }
  }

  const avatarDrop = (target:DropData, e:DragEv) => {
    const drag = getCurrentSidebarDrag(e)
    if(!drag){
      return
    }
    e.preventDefault()
    e.stopPropagation()
    try {
      moveSidebarItem(drag,target)
    } catch (error) {
      console.error('avatarDrop error:', error)
    } finally {
      clearCurrentDrag()
    }
  }

  const preventAll = (e:DragEvent) => {
    if(!getCurrentSidebarDrag(e)){
      return
    }
    e.preventDefault()
    e.stopPropagation()
    return false
  }

  // Touch long-press drag for mobile devices
  let touchDragState: {
    data: DragData
    element: HTMLElement
    ghost: HTMLElement | null
    highlighted: HTMLElement | null
  } | null = null
  let touchDragTimer = 0
  let touchStartPos = { x: 0, y: 0 }
  let suppressNextClick = false

  function selectPinnedCharacterOnMouse(event: PointerEvent, item: sortType) {
    if (isTouchDevice || item.type !== 'normal'
      || event.button !== 0 || suppressNextClick) return
    selectCharacter(item.index)
  }

  function onTouchDragStart(data: DragData, e: TouchEvent & { currentTarget: HTMLElement }) {
    const touch = e.touches[0]
    touchStartPos = { x: touch.clientX, y: touch.clientY }
    const el = e.currentTarget

    if (touchDragTimer) clearTimeout(touchDragTimer)
    touchDragTimer = window.setTimeout(() => {
      touchDragState = { data, element: el, ghost: null, highlighted: null }
      el.style.opacity = '0.4'
      try { navigator.vibrate?.(30) } catch {}

      const rect = el.getBoundingClientRect()
      const ghost = el.cloneNode(true) as HTMLElement
      ghost.style.cssText = `position:fixed;pointer-events:none;z-index:9999;opacity:0.7;width:${rect.width}px;left:${touch.clientX - rect.width / 2}px;top:${touch.clientY - rect.height / 2}px;`
      document.body.appendChild(ghost)
      touchDragState.ghost = ghost
    }, 400)
  }

  function onTouchDragMove(e: TouchEvent) {
    const touch = e.touches[0]

    if (!touchDragState) {
      const dx = Math.abs(touch.clientX - touchStartPos.x)
      const dy = Math.abs(touch.clientY - touchStartPos.y)
      if (dx > 8 || dy > 8) {
        if (touchDragTimer) { clearTimeout(touchDragTimer); touchDragTimer = 0 }
      }
      return
    }

    e.preventDefault()

    if (touchDragState.ghost) {
      const rect = touchDragState.element.getBoundingClientRect()
      touchDragState.ghost.style.left = `${touch.clientX - rect.width / 2}px`
      touchDragState.ghost.style.top = `${touch.clientY - rect.height / 2}px`
    }

    // Find drop target under finger
    if (touchDragState.ghost) touchDragState.ghost.style.display = 'none'
    const el = document.elementFromPoint(touch.clientX, touch.clientY)
    if (touchDragState.ghost) touchDragState.ghost.style.display = ''

    if (touchDragState.highlighted) {
      touchDragState.highlighted.classList.remove(
        'bg-success',
        ...avatarDropFeedbackClasses
      )
      touchDragState.highlighted = null
    }

    if (!el) return
    const spacer = el.closest('[data-spacer-index]') as HTMLElement | null
    let item = el.closest('[data-drag-index]') as HTMLElement | null
    if(touchDragState.data.kind === 'folder' && item?.dataset.dragFolder){
      item = findQuickInventoryFolderCard(item)
    }

    if (spacer) {
      spacer.classList.add('bg-success')
      touchDragState.highlighted = spacer
    } else if (item && item !== touchDragState.element) {
      const resolved = resolveAvatarCardDrop(
        touchDragState.data,
        item,
        avatarCardTargetFromElement(item),
        touch.clientX,
        touch.clientY
      )
      if(resolved?.mode === 'inside'){
        item.classList.add('quick-inventory-drop-inside')
      }
      else if(resolved){
        item.classList.add(resolved.placement.after
          ? 'quick-inventory-drop-after'
          : 'quick-inventory-drop-before')
        if(resolved.placement.axis === 'column'){
          item.classList.add('quick-inventory-drop-column')
        }
      }
      touchDragState.highlighted = resolved ? item : null
    }
  }

  function cleanupTouchDrag() {
    if (touchDragTimer) { clearTimeout(touchDragTimer); touchDragTimer = 0 }
    if (!touchDragState) return false
    touchDragState.element.style.opacity = ''
    if (touchDragState.highlighted) {
      touchDragState.highlighted.classList.remove(
        'bg-success',
        ...avatarDropFeedbackClasses
      )
    }
    if (touchDragState.ghost) touchDragState.ghost.remove()
    touchDragState = null
    return true
  }

  function onTouchDragEnd(e: TouchEvent) {
    if (touchDragTimer) { clearTimeout(touchDragTimer); touchDragTimer = 0 }
    if (!touchDragState) return

    const touch = e.changedTouches[0]

    if (touchDragState.ghost) touchDragState.ghost.style.display = 'none'
    const el = document.elementFromPoint(touch.clientX, touch.clientY)

    const spacer = el?.closest('[data-spacer-index]') as HTMLElement | null
    let item = el?.closest('[data-drag-index]') as HTMLElement | null
    if(touchDragState.data.kind === 'folder' && item?.dataset.dragFolder){
      item = findQuickInventoryFolderCard(item)
    }

    if (spacer) {
      const idx = parseInt(spacer.dataset.spacerIndex!)
      const folder = spacer.dataset.spacerFolder || undefined
      moveSidebarItem(touchDragState.data, { index: idx, folder })
    } else if (item && item !== touchDragState.element) {
      const resolved = resolveAvatarCardDrop(
        touchDragState.data,
        item,
        avatarCardTargetFromElement(item),
        touch.clientX,
        touch.clientY
      )
      if(resolved){
        moveSidebarItem(touchDragState.data, resolved.drop)
      }
    }

    cleanupTouchDrag()
    suppressNextClick = true
    requestAnimationFrame(() => { suppressNextClick = false })
  }

  function onTouchDragCancel() {
    cleanupTouchDrag()
  }

  function touchDragContainer(node: HTMLElement) {
    node.addEventListener('touchmove', onTouchDragMove, { passive: false })
    node.addEventListener('touchend', onTouchDragEnd)
    node.addEventListener('touchcancel', onTouchDragCancel)
    return {
      destroy() {
        node.removeEventListener('touchmove', onTouchDragMove)
        node.removeEventListener('touchend', onTouchDragEnd)
        node.removeEventListener('touchcancel', onTouchDragCancel)
      }
    }
  }
</script>
{#if DBState.db.menuSideBar}
<div
  class="h-full w-20 min-w-20 flex-col items-center bg-bgcolor text-textcolor shadow-lg relative rs-sidebar"
  class:editMode
  class:risu-sub-sidebar={$sideBarClosing}
  class:risu-sub-sidebar-close={$sideBarClosing}
  class:hidden={hidden}
  class:flex={!hidden}
>
<button
  class="flex items-center justify-center py-2 flex-col gap-1 w-full mt-4"
  class:text-textcolor2={!(
    $selectedCharID < 0 &&
    $PlaygroundStore === 0 &&
    !$settingsOpen
  )}
  onclick={() => {
    reseter();
    selectedCharID.set(-1)
    PlaygroundStore.set(0)
    OpenRealmStore.set(false)
  }}
>
  <HomeIcon />
  <span class="text-xs">{language.home}</span>
</button>
<button
  class="flex items-center justify-center py-2 flex-col gap-1 w-full"
  class:text-textcolor2={!$settingsOpen}
  onclick={() => {
    if ($settingsOpen) {
      reseter();
      settingsOpen.set(false);
    } else {
      reseter();
      settingsOpen.set(true);
    }
  }}
>
  <Settings />
  <span class="text-xs">{language.settings}</span>
</button>
<button
  class="flex items-center justify-center py-2 flex-col gap-1 w-full"
  class:text-textcolor2={!(
    $selectedCharID >= 0
  )}
  onclick={() => {
    reseter();
    openGrid();

  }}
>
  <User2Icon />
  <span class="text-xs">{language.character}</span>
</button>
<button
  class="flex items-center justify-center py-2 flex-col gap-1 w-full"
  class:text-textcolor2={!(
    $selectedCharID < 0 &&
    $PlaygroundStore !== 0
  )}
  onclick={() => {
    reseter();
    selectedCharID.set(-1)
    PlaygroundStore.set(1)
  }}
>
  <ShellIcon />
  <span class="text-xs">{language.playground.playground}</span>
</button>
</div>
{:else}
<div
  bind:this={characterListSidebarElement}
  data-character-list-sidebar
  class="character-list-sidebar h-full min-w-20 shrink-0 flex-col items-center bg-bgcolor text-textcolor shadow-lg relative rs-sidebar"
  style:width={characterListSidebarWidth}
  class:max-xs:hidden={$leftBarCollapsed}
  class:editMode
  class:risu-sub-sidebar={$sideBarClosing}
  class:risu-sub-sidebar-close={$sideBarClosing}
  class:hidden={hidden}
  class:flex={!hidden}
>
  <div data-character-sidebar-primary-actions class="character-sidebar-primary-actions">
  {#if !DBState.db.hamburgerButtonBottom}
  <div class="character-sidebar-menu-action">
  <button
    data-sidebar-options
    class="risu-button-lift flex h-10 min-h-10 w-[52px] min-w-[52px] cursor-pointer items-center justify-center self-center rounded-md bg-primary text-accenttext transition-colors hover:bg-primary/80"
    class:max-xs:hidden={$leftBarCollapsed}
    onclick={() => {
      menuMode = 1 - menuMode;
    }}><ListIcon />
  </button>
  {#if !DBState.db.hideLeftBarCollapseButton}
  <button
    class="hidden max-xs:flex h-8 min-h-8 w-14 min-w-14 cursor-pointer mt-2 items-center justify-center rounded-md border border-borderc text-textcolor transition-colors hover:border-primary hover:text-primary"
    aria-label="Collapse sidebar"
    onclick={() => leftBarCollapsed.set(true)}
  >
    <ChevronsLeft size={20} />
  </button>
  {/if}
  <div data-sidebar-options-divider class="w-full relative text-textcolor" class:max-xs:hidden={$leftBarCollapsed}>
    {#if menuMode === 1}
      <div class="absolute w-20 min-w-20 flex border-b-selected border-b bg-bgcolor flex-col items-center pt-2 rounded-b-md z-20 pb-2 max-h-[calc(100dvh-4rem)] overflow-x-hidden overflow-y-auto hamburger-menu">
        <BarIcon
        onClick={() => {
          if ($settingsOpen) {
            reseter();
            settingsOpen.set(false);
          } else {
            reseter();
            settingsOpen.set(true);
          }
        }}><Settings /></BarIcon
      >
      <div class="mt-2"></div>
      <BarIcon
        onClick={() => {
          reseter();
          selectedCharID.set(-1)
          PlaygroundStore.set(0)
          OpenRealmStore.set(false)
        }}><HomeIcon /></BarIcon>
      <div class="mt-2"></div>
      <BarIcon
        onClick={() => {
          reseter()
          if($selectedCharID === -1 && $PlaygroundStore !== 0){
            PlaygroundStore.set(0)
            return
          }
          selectedCharID.set(-1)
          PlaygroundStore.set(1)
        }}
      ><ShellIcon /></BarIcon>
      <div class="mt-2"></div>
      <BarIcon
        onClick={() => {
          reseter();
          openGrid();
        }}><LayoutGridIcon /></BarIcon
      >
      {#if additionalHamburgerMenu.length > 0}
        <div class="mt-2 h-px w-10 bg-selected shrink-0"></div>
        {#each additionalHamburgerMenu as menu}
          <div class="mt-2"></div>
          <BarIcon
            onClick={() => {
              reseter();
              menu.callback();
            }}>
              <PluginDefinedIcon ico={menu} />
            </BarIcon
          >
        {/each}
      {/if}
      <div class="mt-2 h-px w-10 bg-selected shrink-0"></div>
      <div class="mt-2"></div>
      <ExternalEditModeButton />
    </div>
    {/if}
  </div>
  </div>
  {/if}
  <div
    data-sidebar-persona
    class="flex w-14 flex-col items-center gap-1"
    class:max-xs:hidden={$leftBarCollapsed}
  >
    <button
      class="group relative grid h-[54px] w-[54px] place-items-center overflow-hidden rounded-xl border border-borderc/25 bg-darkbg text-textcolor2 shadow-sm outline outline-4 outline-offset-0 outline-borderc transition-all hover:border-primary hover:text-primary"
      aria-label={language.persona}
      title={language.persona}
      onclick={() => openPersonaManager.set(true)}
    >
      {#if effectivePersona?.persona.icon}
        {#await getCharImage(effectivePersona.persona.icon, 'plain')}
          <User2Icon size={22} />
        {:then personaImage}
          <img src={personaImage} alt="" class="h-full w-full object-cover object-top" />
        {/await}
      {:else}
        <User2Icon size={22} />
      {/if}
      <span
        data-persona-scope-badge
        class="absolute right-0 top-0 grid size-5 place-items-center rounded-full border border-darkborderc bg-darkbg text-textcolor shadow-md"
        title={effectivePersona?.scope === 'character'
          ? language.settingsWorkspace.personaManager.characterTab
          : language.settingsWorkspace.personaManager.globalTab}
      >
        <SolarBoldIcon name={effectivePersona?.scope === 'character' ? 'people-nearby' : 'earth'} size={12} />
      </span>
      <span class="absolute inset-x-0 bottom-0 h-1 bg-primary opacity-80"></span>
    </button>
    <span class="w-full truncate text-center text-[10px] font-medium text-textcolor2">
      {effectivePersona?.persona.name || language.persona}
    </span>
  </div>
  </div>
  <div
    data-character-vault-button
    class="flex w-full flex-col items-center gap-1 px-2 py-2"
    class:max-xs:hidden={$leftBarCollapsed}
  >
    <button
      type="button"
      class="character-toolbar-button character-toolbar-button--chat risu-button-lift group relative overflow-hidden p-0 outline outline-4 outline-offset-0 outline-darkborderc"
      style="width: 54px; height: 54px;"
      aria-label="Character Vault 열기"
      title="캐릭터 저장소 · 고정한 캐릭터만 사이드바에 표시됩니다."
      use:tooltip={"캐릭터 저장소 · 고정한 캐릭터만 사이드바에 표시됩니다."}
      onclick={() => characterVaultOpen.set(true)}
    >
      <img
        src={characterVaultIdle}
        alt=""
        draggable="false"
        class="size-full object-contain transition-opacity group-hover:opacity-0"
      />
      <img
        src={characterVaultHover}
        alt=""
        draggable="false"
        class="absolute inset-0 size-full object-contain opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
    <span data-character-vault-label class="text-[10px] font-medium leading-none text-textcolor2">저장소</span>
  </div>
  <div data-quick-inventory data-quick-inventory-grid class="character-list min-h-0 grow w-full overflow-x-hidden overflow-y-auto" class:max-xs:hidden={$leftBarCollapsed} use:touchDragContainer>
    <div class="h-4 min-h-4 w-14" role="listitem" data-spacer-index="0" ondragover={(e) => {
      if(!getCurrentSidebarDrag(e)){ return }
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      e.currentTarget.classList.add('bg-success')
    }} ondragleave={(e) => {
      e.currentTarget.classList.remove('bg-success')
    }} ondrop={(e) => {
      const drag = getCurrentSidebarDrag(e)
      if(!drag){ return }
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.classList.remove('bg-success')
      try {
        moveSidebarItem(drag,{index:0})
      } finally {
        clearCurrentDrag()
      }
    }} ondragenter={preventAll}></div>
    {#each charImages as char, ind}
      <div class="group relative flex items-center px-2"
        role="listitem"
        data-drag-index={ind}
        data-drag-kind={char.type === 'normal' ? 'character' : 'folder'}
        data-drag-id={char.id}
        data-folder-length={char.type === 'folder' ? char.folder.length : undefined}
        draggable={!isTouchDevice ? "true" : undefined}
        ondragstart={!isTouchDevice ? (e) => {avatarDragStart({ kind: char.type === 'normal' ? 'character' : 'folder', id: char.id }, e)} : undefined}
        ondragend={!isTouchDevice ? clearCurrentDrag : undefined}
        ondragover={!isTouchDevice ? (e) => avatarDragOver(e, {
          kind: char.type === 'normal' ? 'character' : 'folder',
          id: char.id,
          index: ind,
          folderLength: char.type === 'folder' ? char.folder.length : undefined,
        }) : undefined}
        ondragleave={!isTouchDevice ? clearAvatarDragFeedback : undefined}
        ondrop={!isTouchDevice ? (e) => {avatarCardDrop({
          kind: char.type === 'normal' ? 'character' : 'folder',
          id: char.id,
          index: ind,
          folderLength: char.type === 'folder' ? char.folder.length : undefined,
        }, e)} : undefined}
        ondragenter={!isTouchDevice ? preventAll : undefined}
        ontouchstart={touchDragEnabled ? (e) => {onTouchDragStart({ kind: char.type === 'normal' ? 'character' : 'folder', id: char.id }, e)} : undefined}
      >
        <SidebarIndicator
          isActive={char.type === 'normal' && $selectedCharID === char.index && sideBarMode !== 1}
        />
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="relative"
            role="button" tabindex="0"
            onpointerdown={(event) => selectPinnedCharacterOnMouse(event, char)}
            onclick={() => {
              if(suppressNextClick) return
              if(isTouchDevice && char.type === "normal"){
                selectCharacter(char.index);
              }
            }}
            onkeydown={(e) => {
              if (e.key === "Enter") {
                if(char.type === "normal"){
                  selectCharacter(char.index);
                }
              }
            }}
          >
          {#if char.type === 'normal'}
            <SidebarAvatar
              src={char.img ? sidebarCharacterImage(char.img) : "/none.webp"}
              size="56" 
              rounded={IconRounded} 
              name={char.name}
              chaId={DBState.db.characters[char.index]?.chaId}
            />
            {#if char.isNew}
              <span data-new-character-badge class="pointer-events-none absolute bottom-0 right-0 z-20 text-media-text" role="img" aria-label="새 캐릭터" title="새 캐릭터">
                <SolarBoldIcon name="star-shine" size={20} />
              </span>
            {/if}
          {:else if char.type === "folder"}
            {#key char.color}
            {#key char.name}
              <SidebarAvatar src="slot" size="56" rounded={IconRounded} bordered name={char.name} color={char.color} backgroundimg={char.img ? sidebarCharacterImage(char.img) : ""}
              oncontextmenu={async (e) => {
                e.preventDefault()
                const folderIndex = getFolderIndex(char.id)
                if(folderIndex === -1) return
                const sel = parseInt(await alertSelect([language.renameFolder,language.changeFolderColor,language.changeFolderImage,language.cancel]))
                if(sel === 0){
                  const v = await alertInput(language.changeFolderName, [], char.name)
                  const db = DBState.db
                  if(v){
                    const oder = db.characterOrder[folderIndex]
                    if(typeof(oder) === 'string'){
                      return
                    }
                    oder.name = v
                    db.characterOrder[folderIndex] = oder
                  }
                }
                else if(sel === 1){
                  const colors = ["red","green","blue","yellow","indigo","purple","pink","default"]
                  const sel = parseInt(await alertSelect(colors))
                  const db = DBState.db
                  const oder = db.characterOrder[folderIndex]
                  if(typeof(oder) === 'string'){
                    return
                  }
                  oder.color = colors[sel].toLocaleLowerCase()
                  db.characterOrder[folderIndex] = oder
                }
                else if(sel === 2) {
                  const sel = parseInt(await alertSelect(['Reset to Default Image', 'Select Image File']))
                  const db = DBState.db
                  const oder = db.characterOrder[folderIndex]
                  if(typeof(oder) === 'string'){
                    return
                  }

                  switch (sel) {
                    case 0:
                      oder.imgFile = null
                      oder.img = ''
                      break;
                  
                    case 1:
                      const folderImage = await selectSingleFile([
                        'png',
                        'jpg',
                        'webp',
                      ])

                      if(!folderImage) {
                        return
                      }

                      const folderImageData = await saveAsset(folderImage.data)

                      oder.imgFile = folderImageData
                      oder.img = await getFileSrc(folderImageData)
                      db.characterOrder[folderIndex] = oder
                      break;
                  }
                }
              }}
              onClick={() => {
                if(suppressNextClick) return
                if(char.type !== 'folder'){
                  return
                }
                if(openFolders.includes(char.id)){
                  openFolders.splice(openFolders.indexOf(char.id), 1)
                }
                else{
                  openFolders.push(char.id)
                }
                openFolders = openFolders
              }}>
                {#if DBState.db.showFolderName}
                  <div class="h-full w-full flex justify-center items-center">
                    <span class="hyphens-auto truncate font-bold">{char.name}</span>
                  </div>
                {:else if openFolders.includes(char.id)}
                  <FolderOpenIcon />
                {:else}
                  <FolderIcon />
                {/if}
              </SidebarAvatar>
            {/key}
            {/key}
          {/if}
        </div>
      </div>
      {#if char.type === 'folder' && openFolders.includes(char.id)}
        {#key char.color}
        <div class="folder-character-grid p-1 grid items-center rounded-lg relative">
          <div class="absolute top-0 left-1 border border-selected w-full h-full rounded-lg z-0 {
            char.color === 'red' ? 'bg-red-700/20' :
            char.color === 'yellow' ? 'bg-yellow-700/20' :
            char.color === 'green' ? 'bg-green-700/20' :
            char.color === 'blue' ? 'bg-blue-700/20' :
            char.color === 'indigo' ? 'bg-indigo-700/20' :
            char.color === 'purple' ? 'bg-purple-700/20' :
            char.color === 'pink' ? 'bg-pink-700/20' :
            'bg-darkbg/20'
          }" style:background-color={char.color.startsWith('#')
            ? `color-mix(in srgb, ${char.color} 20%, transparent)`
            : undefined}></div>
          <div class="h-4 min-h-4 w-14 relative z-10" role="listitem" data-spacer-index="0" data-spacer-folder={char.type === 'folder' ? char.id : undefined} ondragover={(e) => {
            if(!getCurrentSidebarDrag(e)){ return }
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'move'
            e.currentTarget.classList.add('bg-success')
          }} ondragleave={(e) => {
            e.currentTarget.classList.remove('bg-success')
          }} ondrop={(e) => {
            const drag = getCurrentSidebarDrag(e)
            if(!drag){ return }
            e.preventDefault()
            e.stopPropagation()
            e.currentTarget.classList.remove('bg-success')
            try {
              if(char.type === 'folder'){
                moveSidebarItem(drag,{index:0,folder:char.id})
              }
            } finally {
              clearCurrentDrag()
            }
          }} ondragenter={preventAll}></div>
          {#each char.folder as char2, ind}
              <div class="group relative flex items-center px-2 z-10"
              role="listitem"
              data-drag-index={ind}
              data-drag-folder={char.type === 'folder' ? char.id : undefined}
              data-drag-kind="character"
              data-drag-id={char2.id}
              draggable={!isTouchDevice ? "true" : undefined}
              ondragstart={!isTouchDevice ? (e) => {avatarDragStart({ kind:'character', id:char2.id, folder:char.id }, e)} : undefined}
              ondragend={!isTouchDevice ? clearCurrentDrag : undefined}
              ondragover={!isTouchDevice ? (e) => avatarDragOver(e, {
                kind: 'character',
                id: char2.id,
                index: ind,
                folder: char.id,
              }) : undefined}
              ondragleave={!isTouchDevice ? clearAvatarDragFeedback : undefined}
              ondrop={!isTouchDevice ? (e) => {avatarCardDrop({
                kind: 'character',
                id: char2.id,
                index: ind,
                folder: char.id,
              }, e)} : undefined}
              ondragenter={!isTouchDevice ? preventAll : undefined}
              ontouchstart={touchDragEnabled ? (e) => {onTouchDragStart({ kind:'character', id:char2.id, folder:char.id }, e)} : undefined}
            >
              <SidebarIndicator
                isActive={$selectedCharID === char2.index && sideBarMode !== 1}
              />
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <div class="relative"
                  role="button" tabindex="0"
                  onpointerdown={(event) => selectPinnedCharacterOnMouse(event, char2)}
                  onclick={() => {
                    if(suppressNextClick) return
                    if(isTouchDevice && char2.type === "normal"){
                      selectCharacter(char2.index);
                    }
                  }}
                  onkeydown={(e) => {
                    if (e.key === "Enter") {
                      if(char2.type === "normal"){
                        selectCharacter(char2.index);
                      }
                    }
                  }}
                >
                <SidebarAvatar
                  src={char2.img ? sidebarCharacterImage(char2.img) : "/none.webp"}
                  size="56" 
                  rounded={IconRounded} 
                  name={char2.name}
                  chaId={DBState.db.characters[char2.index]?.chaId}
                />
                {#if char2.isNew}
                  <span data-new-character-badge class="pointer-events-none absolute bottom-0 right-0 z-20 text-media-text" role="img" aria-label="새 캐릭터" title="새 캐릭터">
                    <SolarBoldIcon name="star-shine" size={20} />
                  </span>
                {/if}
              </div>
            </div>
            <div class="h-4 min-h-4 w-14 relative z-20" role="listitem" data-spacer-index={ind+1} data-spacer-folder={char.type === 'folder' ? char.id : undefined} ondragover={(e) => {
              if(!getCurrentSidebarDrag(e)){ return }
              e.preventDefault()
              e.stopPropagation()
              e.dataTransfer.dropEffect = 'move'
              e.currentTarget.classList.add('bg-success')
            }} ondragleave={(e) => {
              e.currentTarget.classList.remove('bg-success')
            }} ondrop={(e) => {
              const drag = getCurrentSidebarDrag(e)
              if(!drag){ return }
              e.preventDefault()
              e.stopPropagation()
              e.currentTarget.classList.remove('bg-success')
              try {
                if(char.type === 'folder'){
                  moveSidebarItem(drag,{index:ind+1,folder:char.id})
                }
              } finally {
                clearCurrentDrag()
              }
            }} ondragenter={preventAll}></div>
          {/each}
        </div>
        {/key}
      {/if}
      <div class="h-4 min-h-4 w-14" role="listitem" data-spacer-index={ind+1} ondragover={((e) => {
        if(!getCurrentSidebarDrag(e)){ return }
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        e.currentTarget.classList.add('bg-success')
      })} ondragleave={(e) => {
        e.currentTarget.classList.remove('bg-success')
      }} ondrop={(e) => {
        const drag = getCurrentSidebarDrag(e)
        if(!drag){ return }
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.classList.remove('bg-success')
        try {
          moveSidebarItem(drag,{index:ind+1})
        } finally {
          clearCurrentDrag()
        }
      }} ondragenter={preventAll}></div>
    {/each}
    <div class="flex flex-col items-center gap-2 px-2">
      <button
        type="button"
        data-sidebar-new-character
        class="flex h-14 w-14 cursor-pointer select-none items-center justify-center rounded-md border border-textcolor2 text-textcolor transition-colors hover:border-borderc"
        aria-label="새 캐릭터"
        title="새 캐릭터"
        use:tooltip={"새 캐릭터"}
        onclick={async () => {
          addCharacter({reseter}) 
        }}
        ><svg viewBox="0 0 24 24" width="1.2em" height="1.2em"
          ><path
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 6v6m0 0v6m0-6h6m-6 0H6"
          /></svg
        ></button
      >
    </div>
  </div>
  {#if DBState.db.hamburgerButtonBottom}
  <div class="border-t border-t-selected w-full relative text-textcolor" class:max-xs:hidden={$leftBarCollapsed}>
    {#if menuMode === 1}
      <div class="absolute bottom-full w-20 min-w-20 flex border-t-selected border-t bg-bgcolor flex-col items-center pt-2 rounded-t-md z-20 pb-2 max-h-[calc(100dvh-4rem)] overflow-x-hidden overflow-y-auto hamburger-menu">
        <BarIcon
        onClick={() => {
          if ($settingsOpen) {
            reseter();
            settingsOpen.set(false);
          } else {
            reseter();
            settingsOpen.set(true);
          }
        }}><Settings /></BarIcon
      >
      <div class="mt-2"></div>
      <BarIcon
        onClick={() => {
          reseter();
          selectedCharID.set(-1)
          PlaygroundStore.set(0)
          OpenRealmStore.set(false)
        }}><HomeIcon /></BarIcon>
      <div class="mt-2"></div>
      <BarIcon
        onClick={() => {
          reseter()
          if($selectedCharID === -1 && $PlaygroundStore !== 0){
            PlaygroundStore.set(0)
            return
          }
          selectedCharID.set(-1)
          PlaygroundStore.set(1)
        }}
      ><ShellIcon /></BarIcon>
      <div class="mt-2"></div>
      <BarIcon
        onClick={() => {
          reseter();
          openGrid();
        }}><LayoutGridIcon /></BarIcon
      >
      {#if additionalHamburgerMenu.length > 0}
        <div class="mt-2 h-px w-10 bg-selected shrink-0"></div>
        {#each additionalHamburgerMenu as menu}
          <div class="mt-2"></div>
          <BarIcon
            onClick={() => {
              reseter();
              menu.callback();
            }}>
              <PluginDefinedIcon ico={menu} />
            </BarIcon
          >
        {/each}
      {/if}
      <div class="mt-2 h-px w-10 bg-selected shrink-0"></div>
      <div class="mt-2"></div>
      <ExternalEditModeButton />
    </div>
    {/if}
  </div>
  {#if !DBState.db.hideLeftBarCollapseButton}
  <button
    class="hidden max-xs:flex h-8 min-h-8 w-14 min-w-14 cursor-pointer mt-2 items-center justify-center rounded-md border border-borderc text-textcolor transition-colors hover:border-primary hover:text-primary"
    aria-label="Collapse sidebar"
    onclick={() => leftBarCollapsed.set(true)}
  >
    <ChevronsLeft size={20} />
  </button>
  {/if}
  <button
    class="risu-button-lift my-2 flex size-10 min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-md bg-darkbutton text-textcolor transition-colors hover:bg-primary hover:text-accenttext"
    class:max-xs:hidden={$leftBarCollapsed}
    onclick={() => {
      menuMode = 1 - menuMode;
    }}><ListIcon />
  </button>
  {/if}
  <SidebarResizeHandle
    axis="width"
    field="characterListSidebarWidth"
    target={characterListSidebarElement}
    maxWidth={characterListSidebarMaxWidth}
  />
</div>
{/if}
<div
  bind:this={sidebarElement}
  data-character-sidebar
  class="setting-area relative h-full min-w-0 shrink-0 flex-col bg-darkbg text-textcolor max-h-full"
  style:width={sidebarWidth}
  style:--sidebar-size={sidebarWidth}
  class:risu-sidebar={!$sideBarClosing}
  class:risu-sidebar-close={$sideBarClosing}
  class:dynamic-sidebar={$DynamicGUI}
  class:hidden={hidden}
  class:flex={!hidden}
  onanimationend={() => {
    if($sideBarClosing){
      $sideBarClosing = false
      sideBarStore.set(false)
    }
  }}
>
  <div data-character-sidebar-scroll class="min-h-0 min-w-0 w-full flex-1 overflow-y-auto overflow-x-hidden pt-2 pb-6"
    class:px-2={$DynamicGUI} class:px-4={!$DynamicGUI}>
  <button
    class="flex w-full justify-end text-textcolor"
    onclick={async () => {
      if($sideBarClosing){
        return
      }
      $sideBarClosing = true;
    }}
  >
    <!-- <button class="border-none bg-transparent p-0 text-textcolor"><X /></button> -->
  </button>
  {#if $leftBarCollapsed}
    <button
      class="hidden max-xs:flex absolute top-3 left-0 h-12 w-12 border-r border-b border-t border-borderc rounded-r-md bg-darkbg hover:border-borderc transition-colors items-center justify-center text-textcolor opacity-50 hover:opacity-90 z-20"
      aria-label="Expand sidebar"
      onclick={() => leftBarCollapsed.set(false)}
    >
      <ArrowRight />
    </button>
  {/if}
  {#if sideBarMode === 0}
    {#if $selectedCharID < 0 || $settingsOpen}
      <span class="block text-base font-semibold text-textcolor mt-2">{language.recentChatsTitle}</span>
      <div class="flex items-center justify-between gap-2 mt-2">
        <span class="text-sm text-textcolor2">{language.hideRecentChats}</span>
        <ShSwitch
          checked={!!DBState.db.nodeOnlyHideRecentChats}
          onCheckedChange={(v) => (DBState.db.nodeOnlyHideRecentChats = v)}
        />
      </div>
      {#if DBState.db.nodeOnlyHideRecentChats}
        <!-- list hidden by user preference -->
      {:else if recentChars.length === 0}
        <span class="block text-sm text-textcolor2 mt-2">{language.noRecentChatsDesc}</span>
      {:else}
        <div class="flex flex-col gap-1.5 mt-2">
          {#each recentChars.slice(0, recentVisible) as rc (rc.index)}
            <button
              type="button"
              class="group flex items-center gap-2.5 rounded-md border border-borderc/10 bg-darkbg p-2 text-left transition-colors hover:border-borderc/30 hover:bg-selected/50"
              onclick={() => selectCharacter(rc.index)}
            >
              <div class="shrink-0">
                <SidebarAvatar
                  src={rc.image ? sidebarCharacterImage(rc.image) : "/none.webp"}
                  size="36"
                  rounded={IconRounded}
                  name={rc.name}
                  chaId={DBState.db.characters[rc.index]?.chaId}
                />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-semibold text-textcolor leading-tight truncate">{rc.name || "Unnamed"}</div>
                <div class="text-xs text-textcolor2 leading-tight truncate">{makeAgoText(rc.lastInteraction)}</div>
              </div>
            </button>
          {/each}
          {#if recentVisible < recentChars.length}
            <button
              type="button"
              class="w-full rounded-md border border-borderc/10 bg-darkbg p-2 text-center text-sm text-textcolor2 transition-colors hover:border-borderc/30 hover:bg-selected/50 hover:text-textcolor"
              onclick={() => recentVisible += 10}
            >
              {language.loadMore}
            </button>
          {/if}
        </div>
      {/if}
    {:else if DBState.db.characters[$selectedCharID]?.chaId === '§playground'}
      <SideChatList bind:chara={ DBState.db.characters[$selectedCharID]} />
    {:else}
      {@const currentCharacter = DBState.db.characters[$selectedCharID]}
      <div data-character-workspace-header class="flex min-h-10 items-center gap-2 border-b border-darkborderc pb-2">
        <strong data-character-title class="min-w-0 grow truncate text-base text-textcolor">
          {currentCharacter.name || language.character}
        </strong>
        {#if currentCharacter.type === 'character'}
          <ShButton
            data-character-manage
            variant="outline"
            size="icon-sm"
            aria-label={language.manageCharacter}
            title={language.manageCharacter}
            onclick={() => {
              characterManageOpen = true
            }}
          >
            <SolarAssetIcon src={shareIcon} name="share-bold" size={18} />
          </ShButton>
        {/if}
        {#if DBState.db.enableDevTools}
          <ShButton variant="ghost" size="icon-sm" aria-label="Developer tools" title="Developer tools" onclick={() => { devTool = true }}>
            <SolarAssetIcon src={magnifierBugIcon} name="magnifier-bug-bold" size={18} />
          </ShButton>
        {/if}
      </div>
      {#if currentCharacter.license !== 'private'}
        <nav data-character-config-navigation aria-label={language.character} class="my-2 flex w-full items-center justify-evenly gap-1 rounded-lg bg-selected/25 p-1">
          <button type="button" data-character-chat-home aria-label={language.Chat} aria-pressed={!$botMakerMode && !devTool && !$risuBardGalleryOpen} use:tooltip={language.Chat} class="character-toolbar-button character-toolbar-button--chat risu-button-lift" class:is-active={!$botMakerMode && !devTool && !$risuBardGalleryOpen} onclick={() => { devTool = false; risuBardGalleryOpen.set(false); botMakerMode.set(false) }}>
            <SolarBoldIcon name="chat-round-dots" size={22} />
          </button>
          <button type="button" data-character-config-tab aria-label={language.characterInfo} use:tooltip={language.characterInfo} aria-pressed={$botMakerMode && !devTool && $CharConfigSubMenu === 0} class="character-toolbar-button risu-button-lift" class:is-active={$botMakerMode && !devTool && $CharConfigSubMenu === 0} onclick={() => { devTool = false; risuBardGalleryOpen.set(false); botMakerMode.set(true); CharConfigSubMenu.set(0) }}>
            <SolarBoldIcon name="people-nearby" size={22} />
          </button>
          <button type="button" data-character-config-tab aria-label={language.characterDisplay} use:tooltip={language.characterDisplay} aria-pressed={$botMakerMode && !devTool && $CharConfigSubMenu === 1} class="character-toolbar-button risu-button-lift" class:is-active={$botMakerMode && !devTool && $CharConfigSubMenu === 1} onclick={() => { devTool = false; risuBardGalleryOpen.set(false); botMakerMode.set(true); CharConfigSubMenu.set(1) }}>
            <SolarBoldIcon name="gallery-wide" size={22} />
          </button>
          <button type="button" data-character-config-tab aria-label={language.loreBook} use:tooltip={language.loreBook} aria-pressed={$botMakerMode && !devTool && $CharConfigSubMenu === 3} class="character-toolbar-button risu-button-lift" class:is-active={$botMakerMode && !devTool && $CharConfigSubMenu === 3} onclick={() => { devTool = false; risuBardGalleryOpen.set(false); botMakerMode.set(true); CharConfigSubMenu.set(3) }}>
            <SolarBoldIcon name="notebook" size={22} />
          </button>
          {#if currentCharacter.type === 'character'}
            <button type="button" data-risubard-gallery aria-label={language.gallery} use:tooltip={language.gallery} aria-pressed={$risuBardGalleryOpen} class="character-toolbar-button risu-button-lift" class:is-active={$risuBardGalleryOpen} onclick={() => { devTool = false; botMakerMode.set(false); risuBardGalleryOpen.set(true); MobileSideBar.set(0) }}>
              <SolarBoldIcon name="camera-rotate" size={22} />
            </button>
            <button type="button" data-character-config-tab aria-label={language.scripts} use:tooltip={language.scripts} aria-pressed={$botMakerMode && !devTool && $CharConfigSubMenu === 4} class="character-toolbar-button risu-button-lift" class:is-active={$botMakerMode && !devTool && $CharConfigSubMenu === 4} onclick={() => { devTool = false; risuBardGalleryOpen.set(false); botMakerMode.set(true); CharConfigSubMenu.set(4) }}>
              <SolarBoldIcon name="code-square" size={22} />
            </button>
          {/if}
          <button type="button" data-character-config-tab aria-label={language.advancedSettings} use:tooltip={language.advancedSettings} aria-pressed={$botMakerMode && !devTool && $CharConfigSubMenu === 2} class="character-toolbar-button risu-button-lift" class:is-active={$botMakerMode && !devTool && $CharConfigSubMenu === 2} onclick={() => { devTool = false; risuBardGalleryOpen.set(false); botMakerMode.set(true); CharConfigSubMenu.set(2) }}>
            <SolarBoldIcon name="settings" size={22} />
          </button>
        </nav>
      {/if}
      {#if QuickSettings.open}
        <QuickSettingsGui />
      {:else if devTool}
        <DevTool />
      {:else if $botMakerMode}
        <CharConfig />
      {:else}
        <SideChatList bind:chara={ DBState.db.characters[$selectedCharID]} />
      {/if}
    {/if}
  {/if}
  </div>
  {#if $selectedCharID >= 0}
    <SidebarResizeHandle axis="width" target={sidebarElement} maxWidth={sidebarMaxWidth} />
  {/if}
</div>

{#if $DynamicGUI}
    <div role="button" tabindex="0" class="grow h-full min-w-12"
      class:max-xs:!min-w-8={!$leftBarCollapsed}
      class:max-xs:!min-w-6={$leftBarCollapsed}
      class:hidden={hidden} onclick={() => {
      if($sideBarClosing){
        return
      }
      $sideBarClosing = true;
    }}
      onkeydown={(e)=>{
        if(e.key === 'Enter'){
            e.currentTarget.click()
        }
      }}
      class:sidebar-dark-animation={!$sideBarClosing}
      class:sidebar-dark-close-animation={$sideBarClosing}>

    </div>

{/if}

<CharacterVaultDialog
  open={$characterVaultOpen}
  onOpenChange={(open) => characterVaultOpen.set(open)}
  onSelectCharacter={selectCharacter}
/>

<ShDialog
  bind:open={characterManageOpen}
  onOpenChange={(open) => { characterManageOpen = open }}
  size="xl"
  tier="base"
  closeOnEscape={true}
  closeOnOutsideClick={true}
  ariaLabel={language.manageCharacter}
  closeAriaLabel={language.close}
  contentClass="bg-darkbg"
  bodyClass="min-h-0 overflow-y-auto pr-1"
>
  <CharConfig subMenuOverride={6} />
</ShDialog>

<style>
  [data-character-config-navigation] :global(.character-toolbar-button) {
    min-width: 0;
    flex: 0 1 2.25rem;
  }
  .editMode {
    min-width: 6rem;
  }
  @keyframes sidebar-transition {
    from {
      transform: translate3d(-100%, 0, 0);
    }
    to {
      transform: translate3d(0, 0, 0);
    }
  }
  @keyframes sidebar-transition-close {
    from {
      transform: translate3d(0, 0, 0);
    }
    to {
      transform: translate3d(-100%, 0, 0);
    }
  }
  @keyframes sidebar-transition-non-dynamic {
    from {
      width: 0rem;
      min-width: 0rem;
    }
    to {
      width: var(--sidebar-size);
      min-width: var(--sidebar-size);
    }
  }
  @keyframes sidebar-transition-close-non-dynamic {
    from {
      width: var(--sidebar-size);
      min-width: var(--sidebar-size);
      right:0rem;
    }
    to {
      width: 0rem;
      min-width: 0rem;
      right:3rem;
    }
  }
  @keyframes sub-sidebar-transition {
    from {
      width: 0rem;
      min-width: 0rem;
    }
    to {
      width: 5rem;
      min-width: 5rem;
    }
  }
  @keyframes sub-sidebar-transition-close {
    from {
      width: 5rem;
      min-width: 5rem;
      max-width: 5rem;
      right:0rem;

    }
    to {
      width: 0rem;
      min-width: 0rem;
      max-width: 0rem;
      right: 10rem;
    }
  }
  @keyframes sidebar-dark-animation{
    from {
      background-color: transparent !important;
    }
    to {
      background-color: color-mix(in srgb, var(--color-overlay) 50%, transparent) !important;
    }
  }
  @keyframes sidebar-dark-closing-animation{
    from {
      background-color: color-mix(in srgb, var(--color-overlay) 50%, transparent) !important;
    }
    to {
      background-color: transparent !important;
    }
  }

  .risu-sidebar:not(.dynamic-sidebar) {
    animation-name: sidebar-transition-non-dynamic;
    animation-duration: var(--risu-animation-speed);
  }
  .risu-sidebar-close:not(.dynamic-sidebar) {
    animation-name: sidebar-transition-close-non-dynamic;
    animation-duration: var(--risu-animation-speed);
    position: relative;
  }
  .risu-sidebar.dynamic-sidebar {
    animation-name: sidebar-transition;
    animation-duration: var(--risu-animation-speed);
  }
  .risu-sidebar-close.dynamic-sidebar {
    animation-name: sidebar-transition-close;
    animation-duration: var(--risu-animation-speed);
  }


  .risu-sub-sidebar {
    animation-name: sub-sidebar-transition;
    animation-duration: var(--risu-animation-speed);
  }
  .risu-sub-sidebar-close {
    animation-name: sub-sidebar-transition-close;
    animation-duration: var(--risu-animation-speed);
    position: relative;
  }
  .sidebar-dark-animation{
    animation-name: sidebar-dark-transition;
    animation-duration: var(--risu-animation-speed);
    background-color: color-mix(in srgb, var(--color-overlay) 50%, transparent)
  }
  .sidebar-dark-close-animation{
    animation-name: sidebar-dark-closing-transition;
    animation-duration: var(--risu-animation-speed);
    background-color: transparent
  }
  .hamburger-menu {
    scrollbar-width: none;
    overscroll-behavior: none;
  }
  .hamburger-menu::-webkit-scrollbar {
    display: none;
  }
  .character-list-sidebar {
    --character-card-gap: 1rem;
  }
  .character-sidebar-primary-actions {
    display: grid;
    flex: 0 0 auto;
    grid-template-columns: repeat(auto-fit, 56px);
    justify-content: center;
    gap: var(--character-card-gap);
    width: 100%;
    padding: .75rem .75rem 1rem;
    border-bottom: 1px solid var(--color-selected);
  }
  .character-sidebar-menu-action {
    position: relative;
    z-index: 30;
    display: grid;
    width: 56px;
    place-items: center;
  }
  .character-sidebar-menu-action [data-sidebar-options-divider] {
    position: absolute;
    top: 100%;
    left: 50%;
    width: 80px;
    transform: translateX(-50%);
  }
  .character-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, 56px);
    align-content: start;
    justify-content: center;
    gap: var(--character-card-gap);
    overflow-y: auto;
    padding: 1rem .75rem .5rem;
    scrollbar-color: var(--color-borderc) transparent;
    scrollbar-gutter: stable;
    scrollbar-width: thin;
  }
  .character-list::-webkit-scrollbar {
    width: .5rem;
  }
  .character-list::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: var(--color-borderc);
  }
  .character-list > [data-spacer-index],
  .folder-character-grid > [data-spacer-index] {
    display: none;
  }
  .character-list > .group,
  .folder-character-grid > .group {
    width: 56px;
    padding-inline: 0;
  }
  :global(.quick-inventory-drop-before)::before,
  :global(.quick-inventory-drop-after)::after {
    position: absolute;
    z-index: 40;
    top: 4px;
    bottom: 4px;
    width: 3px;
    border-radius: 999px;
    background: var(--color-success);
    box-shadow: 0 0 8px color-mix(in srgb, var(--color-success) 55%, transparent);
    content: '';
    pointer-events: none;
  }
  :global(.quick-inventory-drop-before)::before {
    left: calc(var(--character-card-gap) / -2 - 1.5px);
  }
  :global(.quick-inventory-drop-after)::after {
    right: calc(var(--character-card-gap) / -2 - 1.5px);
  }
  :global(.quick-inventory-drop-column.quick-inventory-drop-before)::before,
  :global(.quick-inventory-drop-column.quick-inventory-drop-after)::after {
    right: 4px;
    left: 4px;
    width: auto;
    height: 3px;
  }
  :global(.quick-inventory-drop-column.quick-inventory-drop-before)::before {
    top: calc(var(--character-card-gap) / -2 - 1.5px);
    bottom: auto;
  }
  :global(.quick-inventory-drop-column.quick-inventory-drop-after)::after {
    top: auto;
    bottom: calc(var(--character-card-gap) / -2 - 1.5px);
  }
  :global(.quick-inventory-drop-inside) {
    border-radius: .75rem;
    background: color-mix(in srgb, var(--color-success) 18%, transparent);
  }
  .folder-character-grid {
    grid-column: 1 / -1;
    grid-template-columns: repeat(auto-fit, 56px);
    justify-content: center;
    gap: var(--character-card-gap);
    width: 100%;
    margin: 0;
    padding: .5rem;
  }
  .character-list > div:last-child {
    width: 56px;
    padding-inline: 0;
  }
  :global([data-new-character-badge] svg path) {
    fill: var(--color-media-text);
    stroke: var(--color-shadow);
    stroke-width: 2px;
    stroke-linejoin: round;
    paint-order: stroke fill;
  }
</style>
