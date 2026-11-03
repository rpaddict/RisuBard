<script lang="ts">
    import { ArrowRightToLineIcon, ChevronLeftIcon, ChevronRightIcon, LoaderCircleIcon } from '@lucide/svelte'
    import SolarBoldIcon from 'src/lib/UI/Icons/SolarBoldIcon.svelte'
    import SolarAssetIcon from 'src/lib/UI/Icons/SolarAssetIcon.svelte'
    import feedIcon from 'src/assets/solar-bold/feed-bold.svg'
    import loadIcon from 'src/assets/solar-bold/undo-left-square-bold.svg'
    import disketteIcon from 'src/assets/solar-bold/diskette-bold.svg'
    import lightningIcon from 'src/assets/solar-bold/lightning-bold.svg'
    import { language } from 'src/lang'

    interface Props {
        saving?: boolean
        onSave: () => void | Promise<void>
        onLoad: () => void | Promise<void>
        onQuickSave: () => void | Promise<void>
        onQuickLoad: () => void | Promise<void>
        page?: number
        turn?: number
        pageCount?: number
        /** The 1-based page on screen, not the number typed in the field. */
        currentPage?: number
        turnCount?: number
        onJump?: () => void | Promise<void>
        onPreviousPage?: () => void | Promise<void>
        onNextPage?: () => void | Promise<void>
        onFindReplace?: () => void
        findReplaceDisabled?: boolean
    }

    let {
        saving = false,
        onSave,
        onLoad,
        onQuickSave,
        onQuickLoad,
        page = $bindable(1),
        turn = $bindable(1),
        pageCount = 1,
        currentPage = 1,
        turnCount = 0,
        onJump = () => {},
        onPreviousPage = () => {},
        onNextPage = () => {},
        onFindReplace = () => {},
        findReplaceDisabled = false,
    }: Props = $props()

</script>

<div class="save-load-toolbar" data-chat-file-shortcuts data-composer-save-toolbar role="group" aria-label={language.risuBardShowSaveLoadShortcuts}>
    <button type="button" class="toolbar-button" data-shortcut-save-chat disabled={saving} aria-label={language.saveChatFileAction} title={language.saveChatFileAction} onclick={() => void onSave()}>
        {#if saving}<LoaderCircleIcon size={18} class="animate-spin" />{:else}<SolarAssetIcon src={feedIcon} name="feed-bold" size={19} />{/if}
    </button>
    <button type="button" class="toolbar-button" data-shortcut-load-chat aria-label={language.loadChatFileAction} title={language.loadChatFileAction} onclick={() => void onLoad()}>
        <SolarAssetIcon src={loadIcon} name="undo-left-square-bold" size={19} />
    </button>
    <span class="toolbar-divider" aria-hidden="true"></span>
    <button type="button" class="toolbar-button" data-shortcut-quicksave-chat disabled={saving} aria-label={language.risuBardQuickSave} title={language.risuBardQuickSave} onclick={() => void onQuickSave()}>
        <span class="quick-icon" aria-hidden="true"><SolarAssetIcon src={disketteIcon} name="diskette-bold" size={19} /><span class="quick-icon__bolt"><SolarAssetIcon src={lightningIcon} name="lightning-bold" size={10} /></span></span>
    </button>
    <button type="button" class="toolbar-button" data-shortcut-quickload-chat aria-label={language.risuBardQuickLoad} title={language.risuBardQuickLoad} onclick={() => void onQuickLoad()}>
        <span class="quick-icon" aria-hidden="true"><SolarAssetIcon src={loadIcon} name="undo-left-square-bold" size={19} /><span class="quick-icon__bolt"><SolarAssetIcon src={lightningIcon} name="lightning-bold" size={10} /></span></span>
    </button>
    <button type="button" class="toolbar-button" data-chat-find-replace aria-label="찾기/바꾸기" title="찾기/바꾸기" disabled={findReplaceDisabled} onclick={onFindReplace}>
        <SolarBoldIcon name="magnifier" size={19} />
    </button>
    <span class="toolbar-divider toolbar-divider--jump" aria-hidden="true"></span>
    <div class="jump-field" data-chat-page-jump>
        <span>{language.chatPageJumpLabel}</span>
        {#if pageCount > 1}
            <button type="button" class="page-step" data-chat-page-previous aria-label={language.chatPagePrevious} title={language.chatPagePrevious} disabled={currentPage <= 1} onclick={() => void onPreviousPage()}>
                <ChevronLeftIcon size={16} />
            </button>
        {/if}
        <input
            type="number"
            min="1"
            max={pageCount}
            bind:value={page}
            aria-label={language.chatPageJumpAria}
            onfocus={(event) => event.currentTarget.select()}
            onkeydown={(event) => {
                if (event.key === 'Enter') {
                    event.preventDefault()
                    void onJump()
                }
            }}
        />
        {#if pageCount > 1}
            <span class="page-total" data-chat-page-total>/ {pageCount}</span>
            <button type="button" class="page-step" data-chat-page-next aria-label={language.chatPageNext} title={language.chatPageNext} disabled={currentPage >= pageCount} onclick={() => void onNextPage()}>
                <ChevronRightIcon size={16} />
            </button>
        {/if}
    </div>
    <label class="jump-field" data-chat-turn-jump>
        <span>{language.chatTurnLabel}</span>
        <input
            type="number"
            min="1"
            max={Math.max(1, turnCount)}
            disabled={turnCount === 0}
            bind:value={turn}
            aria-label={language.chatTurnJumpAria}
            onfocus={(event) => event.currentTarget.select()}
            onkeydown={(event) => {
                if (event.key === 'Enter') {
                    event.preventDefault()
                    void onJump()
                }
            }}
        />
    </label>
    <button
        type="button"
        class="toolbar-button jump-button"
        data-chat-page-turn-jump-button
        aria-label={language.chatPageTurnJumpAria}
        title={language.chatPageTurnJumpAria}
        onclick={() => void onJump()}
    >
        <ArrowRightToLineIcon size={18} />
    </button>
</div>

<style>
    .save-load-toolbar { display: flex; width: fit-content; max-width: 100%; align-items: center; gap: .25rem; margin: 0 auto .5rem; padding: .25rem .5rem; overflow-x: auto; border: 1px solid var(--color-darkborderc); border-radius: 1.5rem; background: var(--color-bgcolor); transition: border-color .14s ease; }
    .save-load-toolbar:focus-within { border-color: var(--color-textcolor); }
    .toolbar-button { display: grid; width: 2.25rem; height: 2.25rem; flex: 0 0 2.25rem; place-items: center; border: 0; border-radius: 999px; color: var(--color-textcolor); background: transparent; transition: color .14s ease, background .14s ease; }
    .toolbar-button:hover:not(:disabled) { color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 16%, transparent); }
    .toolbar-button:disabled { pointer-events: none; opacity: .5; }
    .toolbar-divider { width: 1px; height: 1.2rem; margin: 0 .12rem; background: var(--color-darkborderc); }
    .quick-icon { position: relative; display: grid; place-items: center; }
    .quick-icon__bolt { position: absolute; right: -.28rem; bottom: -.18rem; display: grid; width: .82rem; height: .82rem; place-items: center; border: 1px solid var(--color-bgcolor); border-radius: 999px; color: var(--color-primary); background: var(--color-bgcolor); }
    .jump-field { display: flex; flex: 0 0 auto; align-items: center; gap: .25rem; color: var(--color-textcolor2); font-size: .7rem; font-weight: 600; white-space: nowrap; }
    .jump-field input { width: 3.25rem; height: 2.25rem; border: 1px solid var(--color-darkborderc); border-radius: .65rem; color: var(--color-textcolor); background: var(--color-darkbg); text-align: center; font-size: .75rem; font-variant-numeric: tabular-nums; outline: none; }
    .jump-field input:disabled { opacity: .45; }
    .page-step { display: grid; width: 1.75rem; height: 2.25rem; flex: 0 0 1.75rem; place-items: center; border: 0; border-radius: .65rem; color: var(--color-textcolor); background: transparent; transition: color .14s ease, background .14s ease; }
    .page-step:hover:not(:disabled) { color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 16%, transparent); }
    .page-step:disabled { pointer-events: none; opacity: .35; }
    .page-step:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
    .page-total { color: var(--color-textcolor); font-size: .75rem; font-weight: 500; font-variant-numeric: tabular-nums; }
    /* Phones cannot fit one row; page and turn controls move to a second row instead of scrolling out of view. */
    @media (max-width: 32rem) {
        .save-load-toolbar { flex-wrap: wrap; justify-content: center; row-gap: .25rem; border-radius: 1.25rem; }
        .toolbar-divider--jump { display: none; }
    }
    .jump-field input:focus-visible, .toolbar-button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
    .jump-button { color: var(--color-primary); }
    @media (prefers-reduced-motion: reduce) { .toolbar-button { transition: none; } }
</style>
