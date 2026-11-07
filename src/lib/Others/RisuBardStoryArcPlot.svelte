<script lang="ts">
    import markdownit from 'markdown-it'
    import { ArrowRightIcon, PencilIcon } from '@lucide/svelte'
    import type { WikiCatalogDocument } from 'src/ts/risubard/memoryWiki'
    import type { EventOrderMessage } from 'src/ts/risubard/eventOrder'
    import {
        buildStoryArcView,
        extractStoryArcLinks,
        storyArcDisplayMarkdown,
    } from 'src/ts/risubard/storyArcView'

    type WikiDocument = WikiCatalogDocument

    interface Props {
        documents: readonly WikiCatalogDocument[]
        messages?: readonly EventOrderMessage[]
        checkpointSize: number
        enabled: boolean
        onOpenDocument?: (documentId: string) => void
    }

    let { documents, messages, checkpointSize, enabled, onOpenDocument }: Props = $props()
    const markdownRenderer = markdownit({
        html: false,
        breaks: false,
        linkify: false,
        typographer: true,
    })
    let view = $derived(buildStoryArcView(documents, checkpointSize, messages))
    let links = $derived(view.document?.content !== undefined
        ? extractStoryArcLinks(view.document.content)
        : [])
    let renderedMarkdown = $derived(view.document?.content !== undefined
        ? markdownRenderer.render(storyArcDisplayMarkdown(view.document.content))
        : '')

    // Where the automatic update switch lives in app settings (src/ts/setting/risuBardCommonSettingsData.ts).
    const autoUpdateSettingPath = '설정 > 리스바드 > 공통 설정 > 아크플로터 (Archplotter) > 아크플로터 자동 갱신'

    function normalizedTitle(value: string): string {
        return value.normalize('NFKC').toLocaleLowerCase().trim()
    }

    function linkedDocument(target: string): WikiDocument | undefined {
        const normalized = normalizedTitle(target)
        return documents.find((document) =>
            document.status !== 'retracted'
            && (document.id === target.trim()
                || normalizedTitle(document.title) === normalized
                || (document.aliases ?? []).some((alias) =>
                    normalizedTitle(alias) === normalized)))
    }
</script>

<section class="arc-ledger" data-story-arc-plot aria-label="아크 플롯">
    <header class="arc-hero">
        <div class="arc-heading">
            <div>
                <h2>아크 플롯</h2>
                <p>긴 이야기의 줄기와 전환점, 아직 풀리지 않은 흐름을 한눈에 봅니다.</p>
            </div>
            <span class:paused={!enabled} class="arc-status">
                {#if view.bodyPending}
                    불러오는 중
                {:else if !enabled}
                    자동 갱신 꺼짐
                {:else if view.remainingEventCount === 0}
                    다음 위키 갱신 대기 중
                {:else if view.document}
                    다음 갱신까지 {view.remainingEventCount}개
                {:else}
                    확정 사건 {view.pendingEventCount}/{view.checkpointSize}개
                {/if}
            </span>
        </div>
        {#if !enabled && view.document}
            <p class="arc-paused-note" data-story-arc-paused>
                자동 갱신이 꺼져 있어 이 플롯은 새 사건을 반영하지 않습니다. {autoUpdateSettingPath}에서 켤 수 있습니다.
            </p>
        {/if}
    </header>

    {#if !view.document}
        <div class="arc-empty" data-story-arc-empty>
            <span class="empty-route" aria-hidden="true"><i></i><i></i><i></i></span>
            <strong>아직 생성된 아크 플롯이 없습니다.</strong>
            {#if !enabled}
                <p>자동 갱신이 꺼져 있어 새 플롯을 만들지 않습니다. {autoUpdateSettingPath}에서 켤 수 있습니다.</p>
            {:else if view.remainingEventCount > 0}
                <p>사건이 {view.remainingEventCount}개가 더 쌓이면 첫 플롯을 만듭니다.</p>
            {:else}
                <p>생성 조건을 채웠습니다. 다음 BardWiki 갱신에서 아크 플롯 작성을 시도합니다.</p>
            {/if}
        </div>
    {:else}
        <article class="arc-document" data-story-arc-document={view.document.id}>
            <div class="document-toolbar">
                <div>
                    <strong>{view.document.title}</strong>
                </div>
                <button
                    type="button"
                    data-story-arc-edit
                    onclick={() => onOpenDocument?.(view.document!.id)}
                >
                    <PencilIcon size={14} /> 작업 공간에서 편집
                </button>
            </div>
            <div class="arc-markdown">{@html renderedMarkdown}</div>
        </article>

        {#if links.length > 0}
            <section class="linked-events" aria-label="연결된 문서">
                <div class="linked-heading">
                    <span>연결된 문서</span>
                    <small>{links.length}개</small>
                </div>
                <div class="link-list">
                    {#each links as link (link.target)}
                        {@const targetDocument = linkedDocument(link.target)}
                        {#if targetDocument}
                            <button
                                type="button"
                                data-story-arc-link={link.target}
                                onclick={() => onOpenDocument?.(targetDocument.id)}
                            >
                                <span>{link.label}</span><ArrowRightIcon size={14} />
                            </button>
                        {:else}
                            <span class="missing-link" title="현재 위키에서 문서를 찾을 수 없습니다.">
                                {link.label}
                            </span>
                        {/if}
                    {/each}
                </div>
            </section>
        {/if}
    {/if}
</section>

<style>
    .arc-ledger {
        --arc-rule: color-mix(in srgb, var(--risu-theme-primary) 30%, transparent);
        height: 100%;
        overflow: auto;
        padding: clamp(1.15rem, 3vw, 2.4rem);
        color: var(--risu-theme-textcolor);
        background:
            radial-gradient(circle at 82% 8%, color-mix(in srgb, var(--risu-theme-primary) 9%, transparent), transparent 24rem),
            color-mix(in srgb, var(--risu-theme-bgcolor) 84%, var(--risu-theme-darkbg));
    }
    .arc-hero, .arc-document, .linked-events, .arc-empty { max-width: 48rem; margin-inline: auto; }
    .arc-hero { margin-bottom: 1.4rem; }
    .arc-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; }
    .arc-paused-note { margin: .7rem 0 0; color: var(--risu-theme-textcolor2); font-size: .8rem; line-height: 1.6; }
    h2 { margin: 0 0 .3rem; font-family: Georgia, 'Noto Serif KR', serif; font-size: clamp(1.55rem, 3vw, 2.15rem); font-weight: 600; letter-spacing: -.035em; }
    .arc-heading p { margin: 0; color: var(--risu-theme-textcolor2); font-size: .84rem; line-height: 1.55; }
    .arc-status { flex: 0 0 auto; padding: .35rem .58rem; border: 1px solid var(--arc-rule); border-radius: 999px; color: var(--risu-theme-primary); background: color-mix(in srgb, var(--risu-theme-primary) 8%, transparent); font-size: .75rem; font-weight: 700; }
    .arc-status.paused { color: var(--risu-theme-textcolor2); border-color: var(--risu-theme-darkborderc); background: transparent; }
    .arc-empty { display: grid; justify-items: center; gap: .7rem; margin-top: 2rem; padding: 2.6rem 1.4rem; border: 1px dashed var(--arc-rule); border-radius: var(--risu-radius-lg); text-align: center; background: color-mix(in srgb, var(--risu-theme-darkbg) 54%, transparent); }
    .arc-empty strong { font-family: Georgia, 'Noto Serif KR', serif; font-size: 1rem; }
    .arc-empty p { max-width: 35rem; margin: 0; color: var(--risu-theme-textcolor2); font-size: .78rem; line-height: 1.65; }
    .empty-route { display: flex; align-items: center; gap: 1.35rem; margin-bottom: .35rem; }
    .empty-route i { position: relative; width: .52rem; height: .52rem; border: 2px solid var(--risu-theme-primary); border-radius: 50%; }
    .empty-route i:not(:last-child)::after { content: ''; position: absolute; left: calc(100% + 2px); top: 50%; width: 1.25rem; height: 1px; background: var(--arc-rule); }
    .arc-document { overflow: hidden; border: 1px solid color-mix(in srgb, var(--risu-theme-borderc) 28%, transparent); border-radius: calc(var(--risu-radius-lg) * 0.9); background: color-mix(in srgb, var(--risu-theme-darkbg) 82%, transparent); box-shadow: var(--risu-shadow-overlay, 0 .4rem 1.8rem color-mix(in srgb, var(--color-shadow) 8%, transparent)); }
    .document-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .7rem .9rem; border-bottom: 1px solid var(--arc-rule); background: color-mix(in srgb, var(--risu-theme-primary) 6%, transparent); }
    .document-toolbar > div { display: grid; gap: .15rem; }
    .document-toolbar strong { font-family: Georgia, 'Noto Serif KR', serif; font-size: .88rem; }
    .document-toolbar button, .link-list button { display: inline-flex; align-items: center; gap: .38rem; border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 35%, var(--risu-theme-darkborderc)); border-radius: calc(var(--risu-radius-sm) * 1.4); color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-primary) 8%, transparent); cursor: pointer; }
    .document-toolbar button { flex: 0 0 auto; padding: .42rem .62rem; font-size: .75rem; }
    .document-toolbar button:hover, .link-list button:hover { border-color: var(--risu-theme-primary); color: var(--risu-theme-primary); }
    button:focus-visible { outline: 2px solid var(--risu-theme-primary); outline-offset: 2px; }
    .arc-markdown { padding: 1rem 1.15rem 1.4rem; font-family: Georgia, 'Noto Serif KR', serif; font-size: .88rem; line-height: 1.75; }
    .arc-markdown :global(h1), .arc-markdown :global(h2), .arc-markdown :global(h3) { margin: 1.25em 0 .55em; line-height: 1.3; }
    .arc-markdown :global(h1:first-child) { margin-top: 0; font-size: 1.3rem; }
    .arc-markdown :global(h2) { padding-bottom: .35rem; border-bottom: 1px solid var(--arc-rule); font-size: 1.08rem; }
    .arc-markdown :global(h3) { font-size: .96rem; }
    .arc-markdown :global(p) { margin: .6rem 0; }
    .arc-markdown :global(ul), .arc-markdown :global(ol) { margin: .65rem 0; padding-left: 1.35rem; }
    .arc-markdown :global(li + li) { margin-top: .25rem; }
    .arc-markdown :global(blockquote) { margin: .8rem 0; padding: .2rem .8rem; border-left: 3px solid var(--risu-theme-primary); color: var(--risu-theme-textcolor2); }
    .linked-events { margin-top: 1rem; padding: .85rem .95rem; border: 1px solid color-mix(in srgb, var(--risu-theme-borderc) 22%, transparent); border-radius: calc(var(--risu-radius-lg) * 0.9); background: color-mix(in srgb, var(--risu-theme-darkbg) 55%, transparent); }
    .linked-heading { display: flex; align-items: baseline; gap: .45rem; margin-bottom: .65rem; }
    .linked-heading span { font-size: .75rem; font-weight: 750; }
    .linked-heading small { color: var(--risu-theme-textcolor2); font-size: .75rem; }
    .link-list { display: flex; flex-wrap: wrap; gap: .45rem; }
    .link-list button, .missing-link { padding: .38rem .55rem; font-size: .75rem; }
    .missing-link { border: 1px dashed var(--risu-theme-darkborderc); border-radius: calc(var(--risu-radius-sm) * 1.4); color: var(--risu-theme-textcolor2); }
    @media (max-width: 520px) {
        .arc-heading, .document-toolbar { align-items: flex-start; flex-direction: column; }
        .arc-status { align-self: flex-start; }
        .document-toolbar button { width: 100%; justify-content: center; min-height: 2.6rem; }
        .arc-markdown { padding-inline: .9rem; font-size: .94rem; }
    }
</style>
