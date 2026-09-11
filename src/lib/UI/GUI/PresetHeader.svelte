<script lang="ts">
    import { ChevronRightIcon } from "@lucide/svelte";

    interface Props {
        label: string;
        activeName: string;
        onManage: () => void;
        compact?: boolean;
    }

    let {
        label,
        activeName,
        onManage,
        compact = false,
    }: Props = $props();

</script>

<button
    type="button"
    data-settings-preset-header
    aria-label={`${label}: ${activeName}`}
    onclick={onManage}
    class="settings-preset-header w-full flex items-center gap-3 px-4 py-3 mb-5 cursor-pointer transition-colors"
    class:settings-preset-header--compact={compact}
>
    <div class="flex flex-col min-w-0 grow">
        <span class="text-xs text-textcolor2">{label}</span>
        <span class="text-sm text-textcolor truncate">{activeName}</span>
    </div>
    <ChevronRightIcon size={18} class="shrink-0 text-textcolor2" />
</button>

<style>
    .settings-preset-header {
        border: 1px solid var(--settings-border, var(--risu-theme-darkborderc));
        border-radius: var(--settings-radius, .75rem);
        background: var(--settings-surface, var(--risu-theme-darkbg));
    }

    .settings-preset-header:hover {
        background: var(--settings-surface-hover, var(--risu-theme-selected));
    }

    .settings-preset-header--compact {
        width: min(30rem, 48vw);
        margin-bottom: 0;
        padding: .45rem .75rem;
    }

    @media (max-width: 640px) {
        .settings-preset-header--compact { width: 100%; }
    }
</style>
