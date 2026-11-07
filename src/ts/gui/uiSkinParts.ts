// Stable skin hooks. Skin CSS may target only these `data-skin-part` values
// (plus the attributes listed per part), never internal class names.
// Removing or renaming a part, or changing what it marks, is a breaking change:
// bump UI_SKIN_API_VERSION. Adding a part is not.

export const UI_SKIN_API_VERSION = 1

export interface UiSkinPartDefinition {
    part: string
    /** What the element is, for skin authors. */
    description: string
    /** Extra attributes this part exposes, with their possible values. */
    attributes?: Partial<Record<'data-skin-variant' | 'data-skin-state' | 'data-skin-role', readonly string[]>>
}

export const uiSkinParts: readonly UiSkinPartDefinition[] = [
    { part: 'app-shell', description: 'Root of the main app layout.' },
    { part: 'sidebar-rail', description: 'Narrow left rail with the bot and menu icons.' },
    { part: 'rail-icon', description: 'One bot avatar, folder, or menu icon on the left rail.', attributes: { 'data-skin-state': ['active'] } },
    { part: 'sidebar-panel', description: 'Side panel next to the rail (chat list, bot settings).' },
    { part: 'chat-screen', description: 'Scrolling chat area that holds the messages and the composer.' },
    { part: 'message', description: 'One chat message row. Bot-authored HTML inside it keeps its own styles.', attributes: { 'data-skin-role': ['user', 'bot'] } },
    { part: 'composer', description: 'Message input area at the bottom of the chat.' },
    { part: 'composer-field', description: 'Rounded field holding the message textarea and its buttons.' },
    {
        part: 'button',
        description: 'Standard button.',
        attributes: { 'data-skin-variant': ['default', 'outline', 'secondary', 'ghost', 'destructive', 'success', 'primary', 'soft-primary', 'binding', 'link'] },
    },
    { part: 'input', description: 'Text input, textarea, number input, or select trigger.' },
    { part: 'switch', description: 'On/off toggle switch.' },
    { part: 'checkbox', description: 'Visible box of a checkbox.', attributes: { 'data-skin-state': ['checked'] } },
    { part: 'chip', description: 'Small badge or tag.', attributes: { 'data-skin-variant': ['default', 'secondary', 'destructive', 'outline', 'ghost', 'link', 'warning', 'info', 'success'] } },
    { part: 'tabs', description: 'Row of section tabs.' },
    { part: 'tab', description: 'One section tab.', attributes: { 'data-skin-state': ['active'] } },
    { part: 'modal', description: 'Dialog or modal surface.' },
    { part: 'menu', description: 'Dropdown menu surface.' },
    { part: 'settings-nav', description: 'Settings navigation column.' },
    { part: 'settings-page', description: 'One settings page.' },
]
