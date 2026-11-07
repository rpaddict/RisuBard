<script lang="ts">
    export interface SettingsSectionTab {
        label: string
        value: number
    }

    interface Props {
        tabs: SettingsSectionTab[]
        selected: number
        onSelect: (value: number) => void
        ariaLabel?: string
        class?: string
        variant?: 'default' | 'prominent'
    }

    let {
        tabs,
        selected,
        onSelect,
        ariaLabel,
        class: className = '',
        variant = 'default',
    }: Props = $props()
</script>

<div
    data-settings-section-tabs
    data-skin-part="tabs"
    class="settings-section-tabs {className}"
    class:prominent={variant === 'prominent'}
    role="tablist"
    aria-label={ariaLabel}
>
    {#each tabs as tab (tab.value)}
        <button
            role="tab"
            data-skin-part="tab"
            data-skin-state={selected === tab.value ? 'active' : undefined}
            aria-selected={selected === tab.value}
            class:active={selected === tab.value}
            onclick={() => onSelect(tab.value)}
        >
            <span>{tab.label}</span>
        </button>
    {/each}
</div>

<style>
    .settings-section-tabs {
        width: 100%;
        display: flex;
        overflow-x: auto;
        overflow-y: hidden;
        margin-bottom: 1.75rem;
        border-bottom: 1px solid var(--settings-border, var(--risu-theme-darkborderc));
        scrollbar-width: none;
        -ms-overflow-style: none;
        scroll-snap-type: x proximity;
    }

    .settings-section-tabs::-webkit-scrollbar {
        display: none;
    }

    button {
        position: relative;
        flex: 0 0 auto;
        min-height: 2.75rem;
        padding: .6rem .85rem;
        color: var(--risu-theme-textcolor2);
        font-size: .79rem;
        font-weight: 560;
        white-space: nowrap;
        scroll-snap-align: start;
        transition: color 140ms ease, background-color 140ms ease;
    }

    button:hover {
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-selected) 24%, transparent);
    }

    button.active {
        color: var(--risu-theme-textcolor);
    }

    button.active::after {
        position: absolute;
        right: .35rem;
        bottom: -1px;
        left: .35rem;
        height: 2px;
        border-radius: 999px 999px 0 0;
        background: var(--risu-theme-primary);
        content: '';
    }

    .settings-section-tabs.prominent {
        gap: .3rem;
        padding: .35rem;
        border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 48%, var(--risu-theme-darkborderc));
        border-radius: calc(var(--risu-radius-2xl) * 0.9);
        background: color-mix(in srgb, var(--risu-theme-primary) 24%, var(--risu-theme-bgcolor));
    }

    .prominent button {
        min-height: 3rem;
        padding: .72rem 1.15rem;
        border-radius: calc(var(--risu-radius-lg) * 1.24);
        color: var(--risu-theme-textcolor);
        font-size: .96rem;
        font-weight: 700;
        letter-spacing: -.01em;
        transition: color 180ms ease, background-color 180ms ease, box-shadow 180ms ease;
    }

    .prominent button:hover {
        background: color-mix(in srgb, var(--risu-theme-primary) 42%, var(--risu-theme-bgcolor));
    }

    .prominent button.active {
        background: color-mix(in srgb, var(--risu-theme-primary) 62%, var(--risu-theme-bgcolor));
        box-shadow:
            0 1px 2px color-mix(in srgb, var(--risu-theme-darkbg) 36%, transparent),
            inset 0 0 0 1px color-mix(in srgb, var(--risu-theme-textcolor) 18%, transparent);
    }

    .prominent button:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--risu-theme-textcolor) 74%, var(--risu-theme-primary));
        outline-offset: -3px;
    }

    .prominent button.active::after {
        display: none;
    }

    @media (max-width: 767px) {
        button {
            min-height: 2.7rem;
            padding-inline: .75rem;
            font-size: .78rem;
        }
    }
</style>
