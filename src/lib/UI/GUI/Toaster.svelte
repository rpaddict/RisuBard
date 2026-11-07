<script lang="ts">
    import { Toaster as SonnerToaster, type ToasterProps } from 'svelte-sonner';
    import { isTouchDevice } from 'src/ts/stores.svelte';

    let { ...rest }: ToasterProps = $props();

    const position = $derived<ToasterProps['position']>($isTouchDevice ? 'top-center' : 'top-right');
    // Only request-status toasts can sit at the bottom (desktop setting); lift
    // them above the chat input and save/page toolbar (~120px sticky area).
    const offset = { top: '24px', right: '24px', bottom: '128px', left: '24px' };
</script>

<SonnerToaster
    theme="dark"
    {position}
    {offset}
    richColors
    duration={3500}
    visibleToasts={8}
    toastOptions={{
        classes: {
            toast: 'risu-toast',
            title: 'risu-toast-title',
            description: 'risu-toast-description',
        },
    }}
    style="
        --normal-bg: var(--risu-theme-darkbg);
        --normal-text: var(--risu-theme-textcolor);
        --normal-border: var(--risu-theme-darkborderc);
        font-family: inherit;
    "
    {...rest}
/>

<style>
    :global(.risu-toast) {
        border-radius: var(--risu-radius-md);
        font-size: 0.875rem;
    }
    :global(.risu-toast-title) {
        font-weight: 500;
    }
</style>
