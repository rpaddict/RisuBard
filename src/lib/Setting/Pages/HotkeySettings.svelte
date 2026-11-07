<script lang="ts">
    import { language } from "src/lang";
    import type { Hotkey } from "src/ts/defaulthotkeys";
    import { DBState } from "src/ts/stores.svelte";
    import SettingPage from "src/lib/UI/GUI/SettingPage.svelte";
    import TagAutocompleteSettings from './TagAutocompleteSettings.svelte';

    function displayKey(key: string): string {
        if (key === ' ') return 'SPACE';
        return key?.toLocaleUpperCase() ?? '—';
    }

    function captureKey(event: KeyboardEvent, hotkey: Hotkey) {
        event.preventDefault();
        event.stopPropagation();
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
        hotkey.key = event.key;
    }
</script>

<SettingPage
    title={language.hotkey}
    description={language.settingsWorkspace.hotkeyWorkspace.description}
>
    <div data-hotkey-table class="hotkey-table" role="table" aria-label={language.hotkey}>
        <div class="hotkey-header" role="row">
            <div role="columnheader">{language.settingsWorkspace.hotkeyWorkspace.columns.action}</div>
            <div role="columnheader">{language.settingsWorkspace.hotkeyWorkspace.columns.modifiers}</div>
            <div role="columnheader">{language.settingsWorkspace.hotkeyWorkspace.columns.key}</div>
        </div>

        <div class="hotkey-body" role="rowgroup">
            {#each DBState.db.hotkeys as hotkey (hotkey.action)}
                {#if language.hotkeyDesc[hotkey.action]}
                    <div data-hotkey-row={hotkey.action} class="hotkey-row" role="row">
                        <div class="action-cell" role="cell">
                            <span>{language.hotkeyDesc[hotkey.action]}</span>
                            <small>{hotkey.action}</small>
                        </div>

                        <div data-hotkey-modifiers class="modifier-cell" role="cell">
                            <button
                                type="button"
                                class:active={hotkey.ctrl}
                                aria-pressed={!!hotkey.ctrl}
                                onclick={() => { hotkey.ctrl = !hotkey.ctrl }}
                            >Ctrl</button>
                            <button
                                type="button"
                                class:active={hotkey.shift}
                                aria-pressed={!!hotkey.shift}
                                onclick={() => { hotkey.shift = !hotkey.shift }}
                            >Shift</button>
                            <button
                                type="button"
                                class:active={hotkey.alt}
                                aria-pressed={!!hotkey.alt}
                                onclick={() => { hotkey.alt = !hotkey.alt }}
                            >Alt</button>
                        </div>

                        <div data-hotkey-key class="key-cell" role="cell">
                            <input
                                aria-label={`${language.hotkeyDesc[hotkey.action]} · ${language.settingsWorkspace.hotkeyWorkspace.columns.key}`}
                                readonly
                                value={displayKey(hotkey.key)}
                                onkeydown={(event) => captureKey(event, hotkey)}
                            />
                        </div>
                    </div>
                {/if}
            {/each}
        </div>
    </div>

    <p class="capture-hint">{language.settingsWorkspace.hotkeyWorkspace.captureHint}</p>
    <TagAutocompleteSettings />
</SettingPage>

<style>
    .hotkey-table {
        width: 100%;
        overflow: hidden;
        border: 1px solid var(--settings-border);
        border-radius: var(--settings-radius);
        background: var(--settings-surface);
    }

    .hotkey-header,
    .hotkey-row {
        display: grid;
        grid-template-columns: minmax(13rem, 1.5fr) minmax(13rem, 1fr) 7rem;
        align-items: stretch;
    }

    .hotkey-header {
        min-height: 2.65rem;
        color: var(--risu-theme-textcolor2);
        background: color-mix(in srgb, var(--settings-surface) 88%, var(--risu-theme-textcolor));
        border-bottom: 1px solid var(--settings-border);
        font-size: .68rem;
        font-weight: 650;
        letter-spacing: .055em;
        text-transform: uppercase;
    }

    .hotkey-header > div,
    .hotkey-row > div {
        display: flex;
        align-items: center;
        padding: .7rem 1rem;
    }

    .hotkey-header > div + div,
    .hotkey-row > div + div {
        border-left: 1px solid var(--settings-border);
    }

    .hotkey-row {
        min-height: 4.25rem;
        transition: background-color 140ms ease;
    }

    .hotkey-row + .hotkey-row {
        border-top: 1px solid var(--settings-border);
    }

    .hotkey-row:hover {
        background: var(--settings-surface-hover);
    }

    .action-cell {
        min-width: 0;
        flex-direction: column;
        align-items: flex-start !important;
        justify-content: center;
        gap: .18rem;
    }

    .action-cell span {
        color: var(--risu-theme-textcolor);
        font-size: .84rem;
        font-weight: 580;
    }

    .action-cell small {
        color: var(--risu-theme-textcolor2);
        font-size: .68rem;
        line-height: 1;
        opacity: .75;
    }

    .modifier-cell {
        display: grid !important;
        grid-template-columns: repeat(3, minmax(3.3rem, 1fr));
        gap: .45rem;
    }

    .modifier-cell button {
        min-height: 2rem;
        padding: .3rem .55rem;
        border: 1px solid var(--settings-border);
        border-radius: calc(var(--risu-radius-lg) * 0.96);
        color: var(--risu-theme-textcolor2);
        background: color-mix(in srgb, var(--risu-theme-bgcolor) 76%, transparent);
        font-size: .73rem;
        font-weight: 590;
        transition: color 140ms ease, background-color 140ms ease, border-color 140ms ease;
    }

    .modifier-cell button:hover {
        color: var(--risu-theme-textcolor);
        border-color: color-mix(in srgb, var(--risu-theme-primary) 42%, var(--settings-border));
    }

    .modifier-cell button.active {
        color: var(--risu-theme-primary);
        background: color-mix(in srgb, var(--risu-theme-primary) 11%, var(--settings-surface));
        border-color: color-mix(in srgb, var(--risu-theme-primary) 42%, var(--settings-border));
    }

    .key-cell {
        justify-content: center;
    }

    .key-cell input {
        width: 100%;
        min-width: 4.5rem;
        height: 2.15rem;
        padding: 0 .5rem;
        border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 30%, var(--settings-border));
        border-radius: calc(var(--risu-radius-lg) * 0.96);
        outline: none;
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-bgcolor) 82%, transparent);
        font-size: .76rem;
        font-weight: 650;
        text-align: center;
        letter-spacing: .02em;
        cursor: text;
    }

    .key-cell input:focus-visible {
        border-color: var(--risu-theme-primary);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--risu-theme-primary) 20%, transparent);
    }

    .capture-hint {
        margin: .75rem .15rem 0;
        color: var(--risu-theme-textcolor2);
        font-size: .72rem;
        line-height: 1.5;
    }

    @media (max-width: 1050px) {
        .hotkey-header {
            display: none;
        }

        .hotkey-row {
            grid-template-columns: minmax(0, 1fr) 6.5rem;
            padding: .8rem;
            gap: .65rem .8rem;
        }

        .hotkey-row > div {
            padding: 0;
            border-left: 0 !important;
        }

        .action-cell {
            grid-column: 1 / -1;
        }

        .modifier-cell {
            min-width: 0;
        }
    }
</style>
