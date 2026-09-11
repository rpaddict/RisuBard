<script lang="ts">
    import { language } from 'src/lang'
    import { loadingActivity } from 'src/ts/gui/loadingActivity'
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    const { foreground, background, failure } = loadingActivity
</script>

{#if $foreground}
    <ShDialog open={true} tier="top" size="sm" closable={false} closeOnEscape={true} closeOnOutsideClick={false}
        ariaLabel={language.loading || 'Loading...'} onOpenChange={(open) => { if (!open) $foreground?.cancel() }}>
        <section data-character-loading aria-busy="true">
            <div class="truncate text-sm text-textcolor2">{$foreground.label}</div>
            <div class="mt-3 flex items-center gap-3" role="status">
                <span class="h-4 w-4 rounded-full border-2 border-darkborderc border-t-textcolor motion-safe:animate-spin" aria-hidden="true"></span>
                <span>{language.loading}…</span>
            </div>
            <button class="mt-5 rounded-md border border-darkborderc px-3 py-1.5 text-sm hover:bg-darkbutton" onclick={$foreground.cancel}>{language.cancel}</button>
        </section>
    </ShDialog>
{/if}

{#if $background.length || $failure}
    <aside class="pointer-events-none fixed bottom-3 right-3 z-[62] max-w-[min(28rem,90vw)] rounded-md border border-darkborderc bg-darkbg px-3 py-2 text-xs text-textcolor2 shadow-sm" data-loading-activity role="status" aria-live="polite">
        {#if $background.length}
            <div class="flex items-center gap-2">
                <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-selected motion-safe:animate-pulse"></span>
                <span class="truncate">{language.loading}: {$background[$background.length - 1].label}</span>
                {#if $background.length > 1}<span class="shrink-0 tabular-nums">+{$background.length - 1}</span>{/if}
            </div>
        {/if}
        {#if $failure}
            <div class="truncate text-warning">{$failure.timeout ? language.loadingFeedback.timeout : language.loadingFeedback.failed}: {$failure.label}</div>
        {/if}
    </aside>
{/if}
