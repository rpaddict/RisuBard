<script lang="ts">
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte'
    import { language } from 'src/lang'

    let { open = $bindable(false) }: { open: boolean } = $props()
</script>

<ShDialog
    bind:open
    size="xl"
    resizable
    closeOnEscape
    contentClass="wiki-prompt-reference"
    bodyClass="reference-body"
>
    {#snippet title()}
        {language.risuBardWikiPrompt.helpTitle}
    {/snippet}
    {#snippet description()}
        {language.risuBardWikiPrompt.helpDescription}
    {/snippet}

    <section class="stage-guide">
        <h3>{language.risuBardWikiPrompt.helpStagesTitle}</h3>
        <div class="stage-grid">
            <article>
                <strong>{language.risuBardWikiPrompt.stageAnalysis}</strong>
                <p>{language.risuBardWikiPrompt.helpAnalysis}</p>
            </article>
            <article>
                <strong>{language.risuBardWikiPrompt.stageCanonicalRewrite}</strong>
                <p>{language.risuBardWikiPrompt.helpCanonical}</p>
            </article>
            <article>
                <strong>{language.risuBardWikiPrompt.stageResponse}</strong>
                <p>{language.risuBardWikiPrompt.helpResponse}</p>
            </article>
        </div>
    </section>

    <section>
        <h3>{language.risuBardWikiPrompt.helpFieldsTitle}</h3>
        <dl>
            <div><dt>schemaVersion / title</dt><dd>{language.risuBardWikiPrompt.helpSchemaAndTitle}</dd></div>
            <div><dt>establishedEvents</dt><dd>{language.risuBardWikiPrompt.helpEstablishedEvents}</dd></div>
            <div><dt>stateChanges</dt><dd>{language.risuBardWikiPrompt.helpStateChanges}</dd></div>
            <div><dt>characterKnowledge</dt><dd>{language.risuBardWikiPrompt.helpCharacterKnowledge}</dd></div>
            <div><dt>persistentFacts</dt><dd>{language.risuBardWikiPrompt.helpPersistentFacts}</dd></div>
            <div><dt>openContinuity</dt><dd>{language.risuBardWikiPrompt.helpOpenContinuity}</dd></div>
            <div><dt>canonicalUpdateCandidates</dt><dd>{language.risuBardWikiPrompt.helpCanonicalCandidates}</dd></div>
        </dl>
    </section>

    <section class="boundary">
        <h3>{language.risuBardWikiPrompt.helpBoundaryTitle}</h3>
        <p>{language.risuBardWikiPrompt.helpBoundary}</p>
        <p>{language.risuBardWikiPrompt.helpProgramOwnedFields}</p>
        <div class="example">
            <strong>{language.risuBardWikiPrompt.helpExampleTitle}</strong>
            <p>{language.risuBardWikiPrompt.helpExample}</p>
        </div>
    </section>
</ShDialog>

<style>
    :global(.wiki-prompt-reference) {
        min-width: min(48rem, calc(100vw - 2rem));
        min-height: 28rem;
    }

    :global(.reference-body) {
        display: grid;
        gap: 1.25rem;
    }

    section {
        display: grid;
        gap: .65rem;
    }

    h3,
    p {
        margin: 0;
    }

    h3 {
        font-size: .92rem;
        font-weight: 700;
    }

    .stage-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: .65rem;
    }

    .stage-grid article,
    dl > div,
    .example {
        border: 1px solid var(--settings-border, var(--risu-theme-darkborderc));
        border-radius: calc(var(--risu-radius-lg) * 1.3);
        background: color-mix(in srgb, var(--risu-theme-darkbg) 78%, transparent);
    }

    .stage-grid article,
    .example {
        padding: .8rem;
    }

    .stage-grid p,
    dd,
    .boundary > p,
    .example p {
        color: var(--risu-theme-textcolor2);
        font-size: .8rem;
        line-height: 1.55;
    }

    dl {
        display: grid;
        gap: .45rem;
        margin: 0;
    }

    dl > div {
        display: grid;
        grid-template-columns: minmax(10rem, .42fr) 1fr;
        gap: .75rem;
        padding: .7rem .8rem;
    }

    dt {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: .78rem;
        font-weight: 700;
    }

    dd {
        margin: 0;
    }

    .example {
        display: grid;
        gap: .35rem;
    }

    @media (max-width: 700px) {
        .stage-grid,
        dl > div {
            grid-template-columns: 1fr;
        }
    }
</style>
