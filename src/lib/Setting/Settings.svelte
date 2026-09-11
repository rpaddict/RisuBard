<script lang="ts">
    import { MediaQuery } from 'svelte/reactivity'
    import AdvancedSettings from './Pages/AdvancedSettings.svelte'
    import FilesSettings from './Pages/FilesSettings.svelte'
    import GlobalLoreBookSettings from './Pages/GlobalLoreBookSettings.svelte'
    import GlobalRegex from './Pages/GlobalRegex.svelte'
    import HotkeySettings from './Pages/HotkeySettings.svelte'
    import RisuBardCommonSettings from './Pages/RisuBardCommonSettings.svelte'
    import RisuBardWikiPromptSettings from './Pages/RisuBardWikiPromptSettings.svelte'
    import RisuBardGrimoirePromptSettings from './Pages/RisuBardGrimoirePromptSettings.svelte'
    import InlayImageGallery from './Pages/InlayImageGallery.svelte'
    import ModuleSettings from './Pages/Module/ModuleSettings.svelte'
    import NotificationSoundSettings from './Pages/NotificationSoundSettings.svelte'
    import PluginSettings from './Pages/PluginSettings.svelte'
    import PromptPresetSettings from './Pages/PromptPresetSettings.svelte'
    import PromptSettings from './Pages/PromptSettings.svelte'
    import RemoteAccessSettings from './Pages/RemoteAccessSettings.svelte'
    import SystemSettings from './Pages/SystemSettings.svelte'
    import Lorepreset from './lorepreset.svelte'
    import SettingsNavigation from './SettingsNavigation.svelte'
    import SettingsSearch from './SettingsSearch.svelte'
    import AISettingsWorkspace from './AISettingsWorkspace.svelte'
    import ExperienceSettingsWorkspace from './ExperienceSettingsWorkspace.svelte'
    import DevPanel from 'src/lib/_dev/DevPanel.svelte'
    import { isLite } from 'src/ts/lite'
    import { MobileGUI, SettingsMenuIndex, settingsOpen } from 'src/ts/stores.svelte'
    import { openSettings, SettingsRoute, SystemTab, type SettingsRouteValue } from 'src/ts/routing'
    import { getVisibleSettingsSections, isExperienceSettingsRoute } from 'src/ts/setting/settingsNavigation'
    import { isAISettingsRoute } from 'src/ts/setting/aiSettingsSections'

    const desktopMedia = new MediaQuery('(min-width: 768px)')
    const devPanelEnabled = typeof localStorage !== 'undefined'
        && localStorage.getItem('risu-dev-panel') === '1'

    let openLoreList = $state(false)
    let searchOpen = $state(false)
    let isDesktop = $derived(desktopMedia.current && !$MobileGUI)
    let sections = $derived(getVisibleSettingsSections({
        isLite: $isLite,
        isDesktop,
        devPanelEnabled,
    }))

    $effect(() => {
        if ($SettingsMenuIndex === SettingsRoute.Migration) {
            openSettings(SettingsRoute.System, SystemTab.Backups)
            return
        }
        if (isDesktop && $SettingsMenuIndex === SettingsRoute.None) {
            $SettingsMenuIndex = $isLite ? SettingsRoute.Language : SettingsRoute.ModelPreset
        }
        if (!isDesktop && $SettingsMenuIndex === SettingsRoute.Hotkey) {
            $SettingsMenuIndex = SettingsRoute.None
        }
    })

    function navigate(route: SettingsRouteValue) {
        openSettings(route)
    }

    function closeSettings() {
        settingsOpen.set(false)
    }

    function backToNavigation() {
        $SettingsMenuIndex = SettingsRoute.None
    }

    function handleSettingsShortcut(event: KeyboardEvent) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault()
            searchOpen = true
        }
    }
</script>

<svelte:window onkeydown={handleSettingsShortcut} />

<div class="settings-workspace rs-setting-cont">
    <div class="settings-shell rs-setting-cont-2">
        {#if isDesktop || $SettingsMenuIndex === SettingsRoute.None}
            <SettingsNavigation
                {sections}
                activeRoute={$SettingsMenuIndex as SettingsRouteValue}
                onNavigate={navigate}
                onSearch={() => { searchOpen = true }}
                onClose={closeSettings}
                onMobileBack={backToNavigation}
                mobile={!isDesktop}
            />
        {/if}

        {#if isDesktop || $SettingsMenuIndex !== SettingsRoute.None}
            <main
                class="settings-content rs-setting-cont-4"
                class:settings-content--mobile-collection={$SettingsMenuIndex === SettingsRoute.Module || $SettingsMenuIndex === SettingsRoute.Plugin}
            >
                {#if !isDesktop}
                    <SettingsNavigation
                        {sections}
                        activeRoute={$SettingsMenuIndex as SettingsRouteValue}
                        onNavigate={navigate}
                        onSearch={() => { searchOpen = true }}
                        onClose={closeSettings}
                        onMobileBack={backToNavigation}
                        mobile={true}
                        compact={true}
                    />
                {/if}

                {#key $SettingsMenuIndex}
                    <div class="settings-page" class:settings-page--collection={$SettingsMenuIndex === SettingsRoute.Module || $SettingsMenuIndex === SettingsRoute.Plugin}>
                        {#if $SettingsMenuIndex === SettingsRoute.PromptPreset}
                            <PromptPresetSettings />
                        {:else if isAISettingsRoute($SettingsMenuIndex as SettingsRouteValue)}
                            <AISettingsWorkspace
                                activeRoute={$SettingsMenuIndex as SettingsRouteValue}
                                onNavigate={navigate}
                            />
                        {:else if $SettingsMenuIndex === SettingsRoute.RisuBardCommon || $SettingsMenuIndex === SettingsRoute.RisuBardChat}
                            <RisuBardCommonSettings />
                        {:else if $SettingsMenuIndex === SettingsRoute.RisuBardWikiPrompt}
                            <RisuBardWikiPromptSettings />
                        {:else if $SettingsMenuIndex === SettingsRoute.RisuBardGrimoirePrompt}
                            <RisuBardGrimoirePromptSettings />
                        {:else if isExperienceSettingsRoute($SettingsMenuIndex as SettingsRouteValue)}
                            <ExperienceSettingsWorkspace
                                activeRoute={$SettingsMenuIndex as SettingsRouteValue}
                                onNavigate={navigate}
                            />
                        {:else if $SettingsMenuIndex === SettingsRoute.SoundAndNotification}
                            <NotificationSoundSettings />
                        {:else if $SettingsMenuIndex === SettingsRoute.Plugin}
                            <PluginSettings />
                        {:else if $SettingsMenuIndex === SettingsRoute.Files}
                            <FilesSettings />
                        {:else if $SettingsMenuIndex === SettingsRoute.Advanced}
                            <AdvancedSettings />
                        {:else if $SettingsMenuIndex === SettingsRoute.GlobalLoreBook}
                            <GlobalLoreBookSettings bind:openLoreList />
                        {:else if $SettingsMenuIndex === SettingsRoute.GlobalRegex}
                            <GlobalRegex />
                        {:else if $SettingsMenuIndex === SettingsRoute.Module}
                            <ModuleSettings />
                        {:else if $SettingsMenuIndex === SettingsRoute.Prompt}
                            <PromptSettings onGoBack={() => { $SettingsMenuIndex = SettingsRoute.ChatBot }} />
                        {:else if $SettingsMenuIndex === SettingsRoute.Hotkey && isDesktop}
                            <HotkeySettings />
                        {:else if $SettingsMenuIndex === SettingsRoute.InlayImageGallery}
                            <InlayImageGallery />
                        {:else if $SettingsMenuIndex === SettingsRoute.RemoteAccess}
                            <RemoteAccessSettings />
                        {:else if $SettingsMenuIndex === SettingsRoute.System}
                            <SystemSettings />
                        {:else if $SettingsMenuIndex === SettingsRoute.DevPanel && devPanelEnabled}
                            <DevPanel />
                        {/if}
                    </div>
                {/key}
            </main>
        {/if}
    </div>
</div>

{#if openLoreList}
    <Lorepreset close={() => { openLoreList = false }} />
{/if}
<SettingsSearch bind:open={searchOpen} />

<style>
    .settings-workspace {
        --risu-theme-textcolor2: color-mix(
            in srgb,
            var(--risu-theme-textcolor) 82%,
            var(--risu-theme-bgcolor)
        );
        --settings-content-width: 58rem;
        --settings-page-gutter: clamp(2rem, 4vw, 3.75rem);
        --settings-surface: color-mix(
            in srgb,
            var(--risu-theme-bgcolor) 96%,
            var(--risu-theme-textcolor)
        );
        --settings-surface-hover: color-mix(
            in srgb,
            var(--risu-theme-bgcolor) 91%,
            var(--risu-theme-textcolor)
        );
        --settings-border: color-mix(
            in srgb,
            var(--risu-theme-textcolor) 14%,
            transparent
        );
        --settings-radius: 1rem;
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        overflow: hidden;
        color: var(--risu-theme-textcolor);
        background: var(--risu-theme-bgcolor);
    }

    .settings-shell {
        width: 100%;
        height: 100%;
        display: flex;
        overflow: hidden;
    }

    .settings-content {
        min-width: 0;
        flex: 1;
        overflow-y: auto;
        overscroll-behavior: contain;
        background: var(--risu-theme-bgcolor);
        scrollbar-width: thin;
    }

    .settings-page {
        width: min(100%, var(--settings-content-width));
        min-height: 100%;
        margin: 0 auto;
        padding: 4.5rem var(--settings-page-gutter) 7rem;
    }

    .settings-page:has(> :global(.settings-standard-page--resizable)) {
        padding-bottom: 0;
    }

    .settings-page:has(> :global(.settings-standard-page--full-width)) {
        width: 100%;
        max-width: 100%;
        height: 100%;
        min-height: 0;
        display: flex;
        flex-direction: column;
        padding: 1rem clamp(1rem, 2vw, 2rem) 1.5rem;
        overflow: hidden;
    }

    .settings-content:has(:global(.settings-standard-page--full-width)) { overflow: hidden; }

    :global(.settings-standard-page) {
        min-width: 0;
        display: flex;
        flex-direction: column;
    }

    :global(.settings-standard-page__header) {
        max-width: 46rem;
        margin-bottom: 2.65rem;
    }

    :global(.settings-standard-page__header h1) {
        margin: 0;
        color: var(--risu-theme-textcolor);
        font-size: clamp(1.65rem, 2.2vw, 1.95rem);
        font-weight: 650;
        letter-spacing: -.035em;
        line-height: 1.2;
    }

    :global(.settings-standard-page__header p) {
        margin: .55rem 0 0;
        color: var(--risu-theme-textcolor2);
        font-size: .9rem;
        line-height: 1.55;
    }

    :global(.settings-standard-page__body) {
        min-width: 0;
        display: flex;
        flex-direction: column;
    }

    :global(.settings-standard-page .settings-standard-page) {
        padding-top: 2.5rem;
    }

    :global(.settings-standard-page .settings-standard-page .settings-standard-page__header) {
        margin-bottom: 1.1rem;
    }

    :global(.settings-standard-page .settings-standard-page .settings-standard-page__header h1) {
        font-size: 1.05rem;
        font-weight: 620;
        letter-spacing: -.015em;
    }

    :global(.settings-standard-group) {
        width: 100%;
        overflow: hidden;
        margin-bottom: 1.75rem;
        border: 1px solid var(--settings-border);
        border-radius: var(--settings-radius);
        background: var(--settings-surface);
    }

    :global(.settings-standard-section-heading) {
        margin: 2.4rem .15rem .8rem;
        color: var(--risu-theme-textcolor);
    }

    :global(.settings-standard-section-heading:first-child) {
        margin-top: 0;
    }

    :global(.settings-standard-section-heading > *) {
        margin: 0;
    }

    :global(.settings-standard-section-heading h2) {
        font-size: 1rem;
        font-weight: 620;
        letter-spacing: -.012em;
    }

    :global(.settings-standard-row) {
        min-height: 4.1rem;
        padding: .78rem 1rem;
        border-color: var(--settings-border);
    }

    :global(.settings-standard-row:hover) {
        background: var(--settings-surface-hover);
    }

    :global(.settings-standard-row > div:first-child > span:first-child) {
        font-size: .84rem;
        font-weight: 570;
    }

    :global(.settings-standard-row > div:first-child > p) {
        max-width: 35rem;
        font-size: .74rem;
        line-height: 1.45;
    }

    :global(.settings-standard-stack) {
        min-width: 0;
        display: flex;
        flex-direction: column;
    }

    @media (max-width: 767px) {
        .settings-shell {
            display: block;
        }

        .settings-content {
            width: 100%;
            height: 100%;
        }

        .settings-page {
            padding: 1.15rem 1rem max(5rem, env(safe-area-inset-bottom));
        }

        .settings-content:has(:global(.settings-standard-page--full-width)) { display: flex; flex-direction: column; }
        .settings-content:has(:global(.settings-standard-page--full-width)) .settings-page { height: auto; flex: 1; }

        .settings-content--mobile-collection:has(:global(.settings-standard-page--resizable)) {
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .settings-content--mobile-collection:has(:global(.settings-standard-page--resizable)) .settings-page {
            flex: 1;
            min-height: 0;
            padding: 0;
        }

        .settings-content--mobile-collection :global(.mobile-header) {
            flex: 0 0 auto;
        }

        .settings-content--mobile-collection :global(.settings-standard-page--resizable) {
            width: 100%;
            height: 100%;
            min-height: 0;
            max-height: none;
            padding-bottom: 0;
        }

        .settings-content--mobile-collection :global(.settings-standard-page--resizable > .settings-standard-page__header),
        .settings-content--mobile-collection :global([data-manager-window-resize]) {
            display: none;
        }

        .settings-content--mobile-collection :global(.settings-standard-page--resizable > .settings-standard-page__body) {
            min-height: 0;
            overflow: hidden;
        }

        .settings-content--mobile-collection :global([data-collection-organizer-list]) {
            height: 100%;
            border: 0;
            border-radius: 0;
        }

        :global(.settings-standard-page__header) {
            margin-bottom: 1.75rem;
        }

        :global(.settings-standard-row) {
            min-height: 3.8rem;
            align-items: flex-start;
            gap: .75rem;
            padding: .75rem .85rem;
        }
    }

    @media (max-width: 520px) {
        :global(.settings-standard-row) {
            flex-direction: column;
            align-items: stretch;
        }

        :global(.settings-standard-row > div:last-child) {
            max-width: 100%;
            align-self: flex-end;
        }
    }

    @media (min-width: 1500px) {
        .settings-workspace { --settings-content-width: 62rem; }
        .settings-page {
            width: min(100%, var(--settings-content-width));
        }
    }
</style>
