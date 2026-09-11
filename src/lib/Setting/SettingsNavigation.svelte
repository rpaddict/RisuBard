<script lang="ts">
    import {
        ActivityIcon,
        ArrowLeftIcon,
        BookOpenIcon,
        BracesIcon,
        ChevronLeftIcon,
        CircleXIcon,
        CodeIcon,
        FlaskConicalIcon,
        ImageIcon,
        KeyboardIcon,
        MonitorIcon,
        MonitorSmartphoneIcon,
        PackageIcon,
        SearchIcon,
        SettingsIcon,
        SparklesIcon,
        ScrollTextIcon,
        TruckIcon,
        UserRoundIcon,
        Volume2Icon,
    } from '@lucide/svelte'
    import { language } from 'src/lang'
    import PluginDefinedIcon from '../Others/PluginDefinedIcon.svelte'
    import { additionalSettingsMenu } from 'src/ts/stores.svelte'
    import type {
        SettingsNavigationItem,
        SettingsNavigationSection,
        SettingsSectionId,
    } from 'src/ts/setting/settingsNavigation'
    import { isSettingsNavigationItemActive } from 'src/ts/setting/settingsNavigation'
    import { SettingsRoute, type SettingsRouteValue } from 'src/ts/routing'

    interface Props {
        sections: SettingsNavigationSection[]
        activeRoute: SettingsRouteValue
        onNavigate: (route: SettingsRouteValue) => void
        onSearch: () => void
        onClose: () => void
        onMobileBack: () => void
        mobile?: boolean
        compact?: boolean
    }

    let {
        sections,
        activeRoute,
        onNavigate,
        onSearch,
        onClose,
        onMobileBack,
        mobile = false,
        compact = false,
    }: Props = $props()

    const icons = {
        'ai-settings': SparklesIcon,
        'chat-prompt-presets': ScrollTextIcon,
        'risubard-common': SettingsIcon,
        'risubard-wiki-prompt': ScrollTextIcon,
        'risubard-grimoire-prompt': ScrollTextIcon,
        prompt: SparklesIcon,
        'global-lorebook': ScrollTextIcon,
        'global-regex': BracesIcon,
        'experience-settings': MonitorIcon,
        sound: Volume2Icon,
        hotkeys: KeyboardIcon,
        modules: PackageIcon,
        plugins: CodeIcon,
        'inlay-images': ImageIcon,
        migration: TruckIcon,
        'remote-access': MonitorSmartphoneIcon,
        advanced: ActivityIcon,
        system: SettingsIcon,
        developer: FlaskConicalIcon,
    }

    function sectionLabel(id: SettingsSectionId): string {
        return language.settingsWorkspace.sections[id]
    }

    function itemLabel(item: SettingsNavigationItem): string {
        const labels: Record<string, string> = {
            'ai-settings': language.settingsWorkspace.sections.ai,
            'chat-prompt-presets': language.settingsWorkspace.aiWorkspace.sections['chat-prompt-presets'].title,
            'risubard-common': language.risuBardSettings.common.title,
            'risubard-wiki-prompt': language.risuBardWikiPrompt.title,
            'risubard-grimoire-prompt': language.risuBardGrimoirePrompt.title,
            prompt: language.promptTemplate,
            'global-lorebook': language.loreBook,
            'global-regex': language.regexScript,
            'experience-settings': language.settingsWorkspace.sections.experience,
            sound: language.soundAndNotification,
            hotkeys: language.hotkey,
            modules: language.modules,
            plugins: language.plugin,
            'inlay-images': language.playground.inlayImageGallery,
            migration: language.migration,
            'remote-access': language.remoteAccess,
            advanced: language.advancedSettings,
            system: language.system,
            developer: 'Dev Panel',
        }
        return labels[item.id] ?? item.id
    }

    function activeLabel(): string {
        const active = sections
            .flatMap((section) => section.items)
            .find((item) => isSettingsNavigationItemActive(item, activeRoute))
        return active ? itemLabel(active) : language.settings
    }
</script>

{#if mobile && compact}
    <header class="mobile-header">
        <button
            data-settings-mobile-back
            class="mobile-action"
            aria-label={language.backToList}
            onclick={onMobileBack}
        >
            <ChevronLeftIcon size={20} />
        </button>
        <span class="mobile-title">{activeLabel()}</span>
        <button
            data-settings-close
            class="mobile-action"
            aria-label={language.settingsWorkspace.close}
            onclick={onClose}
        >
            <CircleXIcon size={20} />
        </button>
    </header>
{:else}
    <nav
        data-settings-navigation
        class:mobile
        aria-label={language.settings}
    >
        <button data-settings-close class="back-to-app" onclick={onClose}>
            <ArrowLeftIcon size={17} />
            <span>{language.settingsWorkspace.backToApp}</span>
        </button>

        <button data-settings-search class="search-trigger" onclick={onSearch}>
            <SearchIcon size={16} />
            <span>{language.searchSettingsPlaceholder}</span>
            {#if !mobile}<kbd>Ctrl K</kbd>{/if}
        </button>

        <div class="navigation-scroll">
            {#each sections as section (section.id)}
                <section data-settings-section={section.id} class="navigation-section">
                    <h2>{sectionLabel(section.id)}</h2>
                    <div class="navigation-items">
                        {#if section.id === 'ai'}
                            <button
                                data-settings-persona
                                aria-haspopup="dialog"
                                onclick={() => onNavigate(SettingsRoute.Persona)}
                            >
                                <UserRoundIcon size={17} strokeWidth={1.8} />
                                <span>{language.persona}</span>
                            </button>
                        {/if}
                        {#each section.items as item (item.id)}
                            {@const Icon = icons[item.id as keyof typeof icons]}
                            <button
                                class:active={isSettingsNavigationItemActive(item, activeRoute)}
                                aria-current={isSettingsNavigationItemActive(item, activeRoute) ? 'page' : undefined}
                                onclick={() => onNavigate(item.route)}
                            >
                                {#if Icon}<Icon size={17} strokeWidth={1.8} />{/if}
                                <span>{itemLabel(item)}</span>
                            </button>
                        {/each}
                    </div>
                </section>
            {/each}

            {#if additionalSettingsMenu.length > 0}
                <section data-settings-section="plugin" class="navigation-section">
                    <h2>{language.plugin}</h2>
                    <div class="navigation-items">
                        {#each additionalSettingsMenu as menu}
                            <button onclick={() => menu.callback()}>
                                <PluginDefinedIcon ico={menu} />
                                <span>{menu.name}</span>
                            </button>
                        {/each}
                    </div>
                </section>
            {/if}
        </div>
    </nav>
{/if}

<style>
    nav {
        width: 17.5rem;
        height: 100%;
        flex: 0 0 17.5rem;
        display: flex;
        flex-direction: column;
        gap: .75rem;
        padding: .8rem .7rem .9rem;
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-darkbg) 92%, var(--risu-theme-bgcolor));
        border-right: 1px solid color-mix(in srgb, var(--risu-theme-darkborderc) 72%, transparent);
    }

    nav.mobile {
        width: 100%;
        flex-basis: 100%;
        border-right: 0;
    }

    .back-to-app,
    .search-trigger,
    .navigation-items button,
    .mobile-action {
        transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
    }

    .back-to-app {
        min-height: 2.25rem;
        display: flex;
        align-items: center;
        gap: .55rem;
        padding: 0 .55rem;
        border-radius: .55rem;
        color: var(--risu-theme-textcolor2);
        font-size: .82rem;
        text-align: left;
    }

    .back-to-app:hover,
    .navigation-items button:hover {
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-selected) 56%, transparent);
    }

    .search-trigger {
        min-height: 2.35rem;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: .55rem;
        padding: 0 .65rem;
        border: 1px solid color-mix(in srgb, var(--risu-theme-darkborderc) 74%, transparent);
        border-radius: .65rem;
        background: color-mix(in srgb, var(--risu-theme-bgcolor) 70%, transparent);
        color: var(--risu-theme-textcolor2);
        font-size: .78rem;
        text-align: left;
    }

    .search-trigger:hover {
        border-color: color-mix(in srgb, var(--risu-theme-borderc) 58%, transparent);
    }

    .search-trigger span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    kbd {
        padding: .08rem .32rem;
        border: 1px solid color-mix(in srgb, var(--risu-theme-darkborderc) 70%, transparent);
        border-radius: .3rem;
        font-size: .62rem;
        font-family: inherit;
        opacity: .72;
    }

    .navigation-scroll {
        min-height: 0;
        overflow-y: auto;
        padding: .2rem .15rem 1.5rem;
        scrollbar-width: thin;
    }

    .navigation-section + .navigation-section {
        margin-top: 1.1rem;
    }

    .navigation-section h2 {
        margin: 0 0 .3rem;
        padding: 0 .55rem;
        color: var(--risu-theme-textcolor2);
        font-size: .66rem;
        font-weight: 650;
        letter-spacing: .075em;
        text-transform: uppercase;
        opacity: .72;
    }

    .navigation-items {
        display: flex;
        flex-direction: column;
        gap: .08rem;
    }

    .navigation-items button {
        min-height: 2.15rem;
        display: flex;
        align-items: center;
        gap: .62rem;
        padding: .34rem .58rem;
        border-radius: .55rem;
        color: var(--risu-theme-textcolor2);
        font-size: .82rem;
        text-align: left;
    }

    .navigation-items button.active {
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-selected) 82%, transparent);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--risu-theme-borderc) 14%, transparent);
    }

    .mobile-header {
        position: sticky;
        top: 0;
        z-index: 20;
        min-height: 3.25rem;
        display: grid;
        grid-template-columns: 2.35rem minmax(0, 1fr) 2.35rem;
        align-items: center;
        gap: .5rem;
        padding: .45rem .65rem;
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-bgcolor) 88%, transparent);
        border-bottom: 1px solid color-mix(in srgb, var(--risu-theme-darkborderc) 66%, transparent);
        backdrop-filter: blur(16px);
    }

    .mobile-title {
        overflow: hidden;
        font-size: .9rem;
        font-weight: 650;
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .mobile-action {
        width: 2.35rem;
        height: 2.35rem;
        display: grid;
        place-items: center;
        border-radius: .55rem;
        color: var(--risu-theme-textcolor2);
    }

    .mobile-action:hover {
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-selected) 60%, transparent);
    }

    @media (max-width: 767px) {
        nav {
            padding: .65rem .7rem max(1rem, env(safe-area-inset-bottom));
        }

        .navigation-items button {
            min-height: 2.55rem;
            font-size: .88rem;
        }

    }
</style>
