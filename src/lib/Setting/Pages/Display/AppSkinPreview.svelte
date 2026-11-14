<script lang="ts">
    import type { AppSkinSwatch } from 'src/ts/gui/appSkinSwatch';

    let { swatch: s }: { swatch: AppSkinSwatch | null } = $props();
</script>

<span
    class="block h-16 overflow-hidden rounded-md border"
    style:background-color={s?.ground ?? 'var(--color-bgcolor)'}
    style:border-color={s?.border ?? 'var(--color-darkborderc)'}
    aria-hidden="true"
>
    <span
        class="m-2 flex h-12 items-center gap-2 border px-2"
        style:background-color={s?.surface ?? 'var(--color-darkbg)'}
        style:border-color={s?.border ?? 'var(--color-darkborderc)'}
        style:border-radius={s?.radius ?? 'var(--risu-radius-md)'}
    >
        <span class="min-w-0 flex-1 text-left text-xs font-semibold" style:color={s?.text ?? 'var(--color-textcolor)'} style:font-family={s?.font ?? 'inherit'}>Aa 가</span>
        <span
            class="inline-flex h-6 shrink-0 items-center px-2 text-[10px] font-bold"
            style:background-color={s?.accent ?? 'var(--color-primary)'}
            style:color={s?.accentText ?? 'var(--color-accenttext)'}
            style:border-radius={s?.radius ?? 'var(--risu-radius-md)'}
        >OK</span>
    </span>
</span>
