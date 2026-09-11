import { SettingsRoute, type SettingsRouteValue } from '../routing'

export type SettingsSectionId = 'ai' | 'risubard' | 'experience' | 'extensions' | 'system'
export type SettingsNavigationScope = 'all' | 'full' | 'desktop' | 'dev'

export interface SettingsNavigationItem {
    id: string
    route: SettingsRouteValue
    aliases?: SettingsRouteValue[]
    scope?: SettingsNavigationScope
}

export interface SettingsNavigationSection {
    id: SettingsSectionId
    items: SettingsNavigationItem[]
}

export interface SettingsNavigationContext {
    isLite: boolean
    isDesktop: boolean
    devPanelEnabled: boolean
}

export const settingsSections: SettingsNavigationSection[] = [
    {
        id: 'ai',
        items: [
            {
                id: 'ai-settings',
                route: SettingsRoute.ModelPreset,
                aliases: [
                    SettingsRoute.ChatBot,
                    SettingsRoute.OtherBots,
                ],
                scope: 'full',
            },
            { id: 'chat-prompt-presets', route: SettingsRoute.PromptPreset, scope: 'full' },
            { id: 'advanced', route: SettingsRoute.Advanced, scope: 'full' },
        ],
    },
    {
        id: 'risubard',
        items: [
            {
                id: 'risubard-common',
                route: SettingsRoute.RisuBardCommon,
                aliases: [SettingsRoute.RisuBardChat],
                scope: 'full',
            },
            { id: 'risubard-wiki-prompt', route: SettingsRoute.RisuBardWikiPrompt, scope: 'full' },
            { id: 'risubard-grimoire-prompt', route: SettingsRoute.RisuBardGrimoirePrompt, scope: 'full' },
        ],
    },
    {
        id: 'experience',
        items: [
            {
                id: 'experience-settings',
                route: SettingsRoute.Display,
                aliases: [SettingsRoute.Language, SettingsRoute.Accessibility],
            },
            { id: 'sound', route: SettingsRoute.SoundAndNotification, scope: 'full' },
            { id: 'hotkeys', route: SettingsRoute.Hotkey, scope: 'desktop' },
        ],
    },
    {
        id: 'extensions',
        items: [
            { id: 'modules', route: SettingsRoute.Module, scope: 'full' },
            { id: 'plugins', route: SettingsRoute.Plugin, scope: 'full' },
            { id: 'inlay-images', route: SettingsRoute.InlayImageGallery, scope: 'full' },
        ],
    },
    {
        id: 'system',
        items: [
            { id: 'remote-access', route: SettingsRoute.RemoteAccess, scope: 'full' },
            { id: 'system', route: SettingsRoute.System, scope: 'full' },
            { id: 'developer', route: SettingsRoute.DevPanel, scope: 'dev' },
        ],
    },
]

function isVisible(item: SettingsNavigationItem, context: SettingsNavigationContext): boolean {
    switch (item.scope ?? 'all') {
        case 'full':
            return !context.isLite
        case 'desktop':
            return context.isDesktop
        case 'dev':
            return !context.isLite && context.devPanelEnabled
        default:
            return true
    }
}

export function getVisibleSettingsSections(context: SettingsNavigationContext): SettingsNavigationSection[] {
    return settingsSections
        .map((section) => ({
            ...section,
            items: section.items.filter((item) => isVisible(item, context)),
        }))
        .filter((section) => section.items.length > 0)
}

export function isSettingsNavigationItemActive(
    item: SettingsNavigationItem,
    route: SettingsRouteValue,
): boolean {
    return item.route === route || item.aliases?.includes(route) === true
}

export function isExperienceSettingsRoute(route: SettingsRouteValue): boolean {
    const routes: SettingsRouteValue[] = [
        SettingsRoute.Display,
        SettingsRoute.Language,
        SettingsRoute.Accessibility,
    ]
    return routes.includes(route)
}
