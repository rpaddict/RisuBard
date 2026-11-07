<script lang="ts">
    import markdownit from 'markdown-it'
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    import helpMarkdown from '../../../docs/ko/memory-wiki.md?raw'

    interface Props {
        open?: boolean
    }

    let { open = $bindable(false) }: Props = $props()

    const helpHtml = markdownit({
        html: false,
        breaks: false,
        linkify: false,
        typographer: true,
    }).render(helpMarkdown)
</script>

<ShDialog
    bind:open
    size="xl"
    tier="top"
    closeOnEscape
    contentClass="memory-wiki-help-dialog"
    bodyClass="memory-wiki-help-body"
    closeAriaLabel="사용 가이드 닫기"
>
    {#snippet title()}BardWiki 사용 가이드{/snippet}
    <article class="help-document" data-memory-help-content>
        {@html helpHtml}
    </article>
</ShDialog>

<style>
    :global(.memory-wiki-help-dialog) {
        width: min(92vw, 56rem);
        max-width: none;
        max-height: min(90vh, 58rem);
        padding: 0;
        gap: 0;
        overflow: hidden;
        background: var(--color-darkbg);
    }
    :global(.memory-wiki-help-dialog > :first-child) {
        min-height: 3.25rem;
        justify-content: center;
        padding: .8rem 3.5rem .8rem 1.15rem;
        border-bottom: 1px solid var(--color-darkborderc);
        background: color-mix(in srgb, var(--color-selected) 18%, var(--color-darkbg));
    }
    :global(.memory-wiki-help-body) {
        min-height: 0;
        overflow-y: auto;
        padding: 1.2rem clamp(1rem, 3vw, 2rem) 2rem;
    }
    .help-document { max-width: 48rem; margin: 0 auto; color: var(--color-textcolor2); line-height: 1.7; }
    .help-document :global(h1) { margin: 0 0 .7rem; color: var(--color-textcolor); font: 700 1.35rem/1.25 Georgia, serif; }
    .help-document :global(h2) { margin: 1.7rem 0 .55rem; padding-top: .75rem; border-top: 1px solid var(--color-darkborderc); color: var(--color-textcolor); font-size: .98rem; font-weight: 750; }
    .help-document :global(h3) { margin: 1.25rem 0 .4rem; color: var(--color-textcolor); font-size: .92rem; font-weight: 700; line-height: 1.5; }
    .help-document :global(p) { margin: .45rem 0; }
    .help-document :global(ul),
    .help-document :global(ol) { display: grid; gap: .32rem; margin: .5rem 0; padding-left: 1.35rem; }
    .help-document :global(strong) { color: var(--color-textcolor); }
    .help-document :global(code) { padding: .08rem .28rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-sm) * 1.12); color: var(--color-textcolor); background: color-mix(in srgb, var(--color-selected) 24%, transparent); }

    @media (max-width: 640px) {
        :global(.memory-wiki-help-dialog) { width: 100vw; height: 100dvh; max-height: none; border-radius: 0; }
    }
</style>
