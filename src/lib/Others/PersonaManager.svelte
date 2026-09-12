<script lang="ts">
    import { onDestroy, onMount } from 'svelte'
    import { CircleQuestionMarkIcon, XIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { alertMd } from 'src/ts/alert'
    import { tooltip } from 'src/ts/gui/tooltip'
    import { DBState, openPersonaManager, personaSelectCallback, selectedCharID } from 'src/ts/stores.svelte'
    import { getEffectivePersona, type PersonaSelection } from 'src/ts/personaScopes'
    import PersonaSettings from '../Setting/Pages/PersonaSettings.svelte'

    const PERSONA_MANAGER_WIDTH_KEY = 'risubard-persona-manager-width'
    const MIN_MANAGER_WIDTH = 520
    let managerWidth = $state(672)
    let stopManagerResize: (() => void) | null = null
    let pointerStartedOnBackdrop = false
    const currentSelection = $derived.by(() => {
        const character = DBState.db.characters[$selectedCharID]
        const chat = character?.chats?.[character.chatPage]
        return getEffectivePersona(DBState.db, character, chat)
    })

    function close() {
        personaSelectCallback.set(null)
        openPersonaManager.set(false)
    }

    function closeFromBackdrop(event: MouseEvent) {
        if (!pointerStartedOnBackdrop) return
        pointerStartedOnBackdrop = false
        if (event.target === event.currentTarget) close()
    }

    function selectPersona(selection: PersonaSelection): void {
        $personaSelectCallback?.(selection)
    }

    function normalizeManagerWidth(value: number): number {
        const viewportMaximum = Math.max(0, window.innerWidth - 32)
        return Math.min(viewportMaximum, Math.max(MIN_MANAGER_WIDTH, Math.round(Number.isFinite(value) ? value : 672)))
    }

    function persistManagerWidth(): void {
        managerWidth = normalizeManagerWidth(managerWidth)
        localStorage.setItem(PERSONA_MANAGER_WIDTH_KEY, String(managerWidth))
    }

    function startManagerResize(event: PointerEvent): void {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = managerWidth
        stopManagerResize?.()

        const update = (moveEvent: PointerEvent) => {
            managerWidth = normalizeManagerWidth(startWidth + (moveEvent.clientX - startX) * 2)
        }
        const stop = () => {
            window.removeEventListener('pointermove', update)
            window.removeEventListener('pointerup', stop)
            window.removeEventListener('pointercancel', stop)
            window.removeEventListener('blur', stop)
            persistManagerWidth()
            stopManagerResize = null
        }
        stopManagerResize = stop
        window.addEventListener('pointermove', update)
        window.addEventListener('pointerup', stop, { once: true })
        window.addEventListener('pointercancel', stop, { once: true })
        window.addEventListener('blur', stop, { once: true })
    }

    function resizeManagerByKeyboard(event: KeyboardEvent): void {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        managerWidth = normalizeManagerWidth(
            managerWidth + (event.key === 'ArrowRight' ? 24 : -24),
        )
        persistManagerWidth()
    }

    onMount(() => {
        const storedWidth = Number(localStorage.getItem(PERSONA_MANAGER_WIDTH_KEY))
        managerWidth = normalizeManagerWidth(storedWidth || managerWidth)
        const fitViewport = () => { managerWidth = normalizeManagerWidth(managerWidth) }
        window.addEventListener('resize', fitViewport)
        return () => window.removeEventListener('resize', fitViewport)
    })

    onDestroy(() => {
        stopManagerResize?.()
        personaSelectCallback.set(null)
    })
</script>

<!-- Backdrop dismissal has a keyboard-equivalent close-button path. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="risu-modal-overlay persona-manager-backdrop" onclick={closeFromBackdrop}
    onpointerdowncapture={(event) => { pointerStartedOnBackdrop = event.target === event.currentTarget }}>
    <dialog open class="risu-modal-surface persona-manager" style={`--persona-manager-width: ${managerWidth}px`} aria-labelledby="persona-manager-title">
        <header class="risu-modal-header">
            <div class="persona-manager-title">
                <h1 id="persona-manager-title">{language.persona}</h1>
                <button
                    class="help-button"
                    aria-label={language.settingsWorkspace.personaManager.help}
                    title={language.settingsWorkspace.personaManager.help}
                    use:tooltip={language.settingsWorkspace.personaManager.help}
                    onclick={() => alertMd(language.settingsWorkspace.personaManager.help)}
                >
                    <CircleQuestionMarkIcon size={16} />
                </button>
            </div>
            <button class="risu-modal-close close-button" aria-label={language.settingsWorkspace.personaManager.close} title={language.settingsWorkspace.personaManager.close} onclick={close}>
                <XIcon size={20} />
            </button>
        </header>
        <div class="persona-manager-content">
            <PersonaSettings embedded initialSelection={currentSelection} onSelect={$personaSelectCallback ? selectPersona : undefined} />
        </div>
        <button
            data-persona-manager-resizer
            class="persona-manager-resizer"
            aria-label={language.settingsWorkspace.personaManager.resizeWindow}
            title={language.settingsWorkspace.personaManager.resizeWindow}
            use:tooltip={language.settingsWorkspace.personaManager.resizeWindow}
            onpointerdown={startManagerResize}
            onkeydown={resizeManagerByKeyboard}
        ><span></span></button>
    </dialog>
</div>

<style>
    .persona-manager-backdrop {
        position: fixed;
        inset: 0;
        z-index: 40;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 16px;
        background: color-mix(in srgb, var(--color-overlay) 58%, transparent);
        backdrop-filter: blur(4px);
    }

    .persona-manager {
        position: relative;
        margin: 0;
        width: min(var(--persona-manager-width), calc(100vw - 32px));
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
        height: calc(100dvh - 2rem);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        color: var(--color-textcolor);
        background: var(--color-darkbg);
        border: 1px solid var(--color-darkborderc);
        border-radius: 1rem;
        box-shadow: 0 1.5rem 4rem color-mix(in srgb, var(--color-shadow) 32%, transparent);
    }

    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1.35rem 1.5rem 1rem;
        border-bottom: 1px solid color-mix(in srgb, var(--risu-theme-darkborderc) 68%, transparent);
    }

    .persona-manager-title {
        display: flex;
        align-items: center;
        gap: .4rem;
    }

    header h1 {
        margin: 0;
        font-size: 1.35rem;
        font-weight: 700;
    }

    .close-button {
        width: 2.35rem;
        height: 2.35rem;
        display: grid;
        place-items: center;
        border-radius: .6rem;
        color: var(--risu-theme-textcolor2);
    }

    .close-button:hover,
    .help-button:hover {
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-selected) 65%, transparent);
    }

    .help-button {
        width: 1.75rem;
        height: 1.75rem;
        display: grid;
        place-items: center;
        border-radius: .45rem;
        color: var(--risu-theme-textcolor2);
    }

    .persona-manager-content {
        flex: 1;
        overflow-y: auto;
        padding: 1.5rem;
    }

    .persona-manager-resizer {
        position: absolute;
        top: 4.6rem;
        right: 0;
        bottom: .75rem;
        z-index: 3;
        width: .75rem;
        display: grid;
        place-items: center;
        cursor: col-resize;
        touch-action: none;
    }

    .persona-manager-resizer span {
        width: .2rem;
        height: 3rem;
        border-radius: 999px;
        background: var(--risu-theme-darkborderc);
        transition: height .15s ease, background .15s ease;
    }

    .persona-manager-resizer:hover span,
    .persona-manager-resizer:focus-visible span {
        height: 4rem;
        background: var(--risu-theme-borderc);
    }

    @media (max-width: 600px) {
        .persona-manager-backdrop {
            padding: 0;
        }

        .persona-manager {
            width: 100%;
            height: 100dvh;
            border: 0;
            border-radius: 0;
        }

        .persona-manager-resizer {
            display: none;
        }
    }
</style>
