<script lang="ts" module>
    // Sh alert — vega-derived spec for inline informational/warning blocks.
    // See _reference/shadcn-components/alert/alert.svelte for source.
    //
    // Variants:
    //  - default: 중성 정보 박스
    //  - destructive: 위험/보안 경고 (draculared 톤)
    //  - warning: 주의 환기 (노랑)
    //  - info: 정보 안내 (파랑)
    //  - success: 성공/완료 (초록)
    //
    // Layout follows vega: 2-column grid when an icon snippet is provided,
    // single-column otherwise. Title/description rows align next to the
    // icon automatically. See .agent/guide/ui.md.
    //
    // `action` snippet — for actionable banners (info + CTA button). When
    // provided, the alert switches to a flex row: icon+text on the left, the
    // action (e.g. a ShButton) right-aligned, wrapping on narrow viewports.
    export type ShAlertVariant = 'default' | 'destructive' | 'warning' | 'info' | 'success';
</script>

<script lang="ts">
    import type { Snippet } from 'svelte';
    import { cn } from 'src/lib/utils';

    interface Props {
        variant?: ShAlertVariant;
        className?: string;
        icon?: Snippet;
        title?: Snippet;
        children?: Snippet;
        action?: Snippet;
    }

    let {
        variant = 'default',
        className = '',
        icon,
        title,
        children,
        action,
    }: Props = $props();

    const base = 'settings-alert border px-4 py-3 text-sm text-left';

    const variantClasses: Record<ShAlertVariant, string> = {
        default: 'settings-alert--default',
        destructive: 'settings-alert--destructive',
        warning: 'settings-alert--warning',
        info: 'settings-alert--info',
        success: 'settings-alert--success',
    };

    // action present → flex row (icon+text ←→ button); otherwise the vega grid.
    const layoutClasses = $derived(
        action
            ? 'flex items-center justify-between gap-3 flex-wrap'
            : 'grid gap-0.5' + (icon ? ' grid-cols-[auto_1fr] gap-x-2.5' : ''),
    );
</script>

<div role="alert" class={cn(base, variantClasses[variant], layoutClasses, className)}>
    {#if action}
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
            {#if icon}
                <div data-slot="alert-icon" class="shrink-0 [&_svg]:size-4 [&_svg]:shrink-0">
                    {@render icon()}
                </div>
            {/if}
            <div class="min-w-0">
                {#if title}
                    <div class="font-medium leading-snug">{@render title()}</div>
                {/if}
                {#if children}
                    <div class="leading-relaxed opacity-90">{@render children()}</div>
                {/if}
            </div>
        </div>
        <div class="shrink-0">
            {@render action()}
        </div>
    {:else}
        {#if icon}
            <div
                data-slot="alert-icon"
                class="row-span-2 self-start translate-y-0.5 [&_svg]:size-4 [&_svg]:shrink-0"
            >
                {@render icon()}
            </div>
        {/if}
        {#if title}
            <div class="font-medium leading-snug">
                {@render title()}
            </div>
        {/if}
        {#if children}
            <div class="leading-relaxed opacity-90">
                {@render children()}
            </div>
        {/if}
    {/if}
</div>

<style>
    .settings-alert {
        --alert-accent: var(--risu-theme-textcolor2);
        border-radius: calc(var(--settings-radius, var(--risu-radius-xl)) * .75);
        color: var(--risu-theme-textcolor);
        background: var(--settings-surface, var(--risu-theme-darkbg));
        border-color: var(--settings-border, var(--risu-theme-darkborderc));
    }

    .settings-alert--destructive {
        --alert-accent: var(--color-danger);
        background: var(--color-danger-bg);
        border-color: var(--color-danger-border);
    }

    .settings-alert--warning {
        --alert-accent: var(--color-warning);
        background: var(--color-warning-bg);
        border-color: var(--color-warning-border);
    }

    .settings-alert--info {
        --alert-accent: var(--color-info);
        background: var(--color-info-bg);
        border-color: var(--color-info-border);
    }

    .settings-alert--success {
        --alert-accent: var(--color-success);
        background: var(--color-success-bg);
        border-color: var(--color-success-border);
    }

    [data-slot="alert-icon"] {
        color: var(--alert-accent);
    }
</style>
