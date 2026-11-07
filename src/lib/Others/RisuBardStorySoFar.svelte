<script lang="ts">
    import { LocateFixedIcon, PencilIcon } from '@lucide/svelte'
    import type { WikiCatalogDocument } from 'src/ts/risubard/memoryWiki'
    import type { EventOrderMessage } from 'src/ts/risubard/eventOrder'
    import {
        buildStorySoFar,
        type StorySourceRef,
    } from 'src/ts/risubard/storySoFar'

    interface Props {
        documents: readonly WikiCatalogDocument[]
        messages?: readonly EventOrderMessage[]
        /** Server-extracted summaries; without them the bodies in documents are used. */
        summaries?: ReadonlyMap<string, readonly string[]>
        loading?: boolean
        onNavigate?: (source: StorySourceRef) => void
        onEdit?: (documentId: string) => void
    }

    let { documents, messages, summaries, loading = false, onNavigate, onEdit }: Props = $props()
    let entries = $derived(buildStorySoFar(documents, messages, summaries))
    // Long stories render in pages so thousands of cards are not built at once.
    const pageSize = 100
    let shownCount = $state(pageSize)
    let shownEntries = $derived(entries.slice(0, shownCount))
</script>

<section class="story-ledger" data-story-so-far aria-label="지금까지의 이야기">
    <header>
        <h2>지금까지의 이야기</h2>
        <p>확정된 사건을 원본 대화 순서로 읽습니다. 원본을 찾을 수 없는 사건은 뒤에 표시됩니다.</p>
    </header>

    {#if loading && entries.length === 0}
        <div class="story-empty" data-story-loading>
            이야기를 불러오는 중입니다.
        </div>
    {:else if entries.length === 0}
        <div class="story-empty" data-story-empty>
            아직 기록된 사건이 없습니다. AI 응답이 위키 분석을 거치면 사건이 여기에 쌓입니다.
        </div>
    {:else}
        <ol>
            {#each shownEntries as entry, index (entry.id)}
                {@const localSourceIds = entry.source.messageIds.filter(id => !id.startsWith('inherited:'))}
                <li data-story-entry={entry.id}>
                    <span class="chapter-mark">{String(index + 1).padStart(2, '0')}</span>
                    <article class="story-card">
                        <div class="entry-body">
                            {#if entry.time}<p class="entry-time" data-story-time>{entry.time}</p>{/if}
                            <div class="entry-heading">
                                <strong id={`story-title-${index}`}>{entry.title}</strong>
                                <button
                                    type="button"
                                    class="entry-edit"
                                    data-story-edit
                                    onclick={() => onEdit?.(entry.id)}
                                    aria-label="이 사건 편집"
                                    aria-describedby={`story-title-${index}`}
                                    title="이 사건 편집"
                                >
                                    <PencilIcon size={15} />
                                </button>
                            </div>
                            {#each entry.summary as item}
                                <p class="story-line">{item}</p>
                            {/each}
                        </div>
                        <button
                            type="button"
                            class="source-button"
                            data-story-source
                            onclick={() => onNavigate?.({ kind: 'chat', messageIds: localSourceIds })}
                            disabled={localSourceIds.length === 0}
                            title={localSourceIds.length ? '원문으로 이동' : '이전 챗 원문 없음'}
                        >
                            <LocateFixedIcon size={14} />
                            <span>{localSourceIds.length ? '원문으로 이동' : '이전 챗 원문 없음'}</span>
                        </button>
                    </article>
                </li>
            {/each}
        </ol>
        {#if shownEntries.length < entries.length}
            <button type="button" class="story-more" data-story-more onclick={() => { shownCount += pageSize }}>
                {Math.min(pageSize, entries.length - shownEntries.length).toLocaleString()}개 더 보기
                <span>남은 {(entries.length - shownEntries.length).toLocaleString()}개</span>
            </button>
        {/if}
    {/if}
</section>

<style>
    .story-ledger {
        --story-rule: color-mix(in srgb, var(--risu-theme-primary) 28%, transparent);
        height: 100%;
        overflow: auto;
        padding: clamp(1.2rem, 3vw, 2.5rem);
        background:
            linear-gradient(90deg, transparent 2.65rem, var(--story-rule) 2.65rem, var(--story-rule) calc(2.65rem + 1px), transparent calc(2.65rem + 1px)),
            color-mix(in srgb, var(--risu-theme-bgcolor) 82%, var(--risu-theme-darkbg));
    }
    header { max-width: 46rem; margin: 0 auto 1.8rem; padding-left: 2.6rem; }
    h2 { margin: .35rem 0 .3rem; font-family: Georgia, 'Noto Serif KR', serif; font-size: clamp(1.55rem, 3vw, 2.2rem); font-weight: 600; letter-spacing: -.035em; }
    header p { margin: 0; color: var(--risu-theme-textcolor2); font-size: .84rem; }
    ol { max-width: 46rem; margin: 0 auto; padding: 0; list-style: none; }
    li { position: relative; display: grid; grid-template-columns: 2rem minmax(0, 1fr); gap: .6rem; padding-bottom: 1rem; }
    .chapter-mark { padding-top: .9rem; color: color-mix(in srgb, var(--risu-theme-primary) 75%, var(--risu-theme-textcolor)); font: 700 .75rem/1 ui-monospace, monospace; letter-spacing: .08em; }
    .story-card { overflow: hidden; border: 1px solid color-mix(in srgb, var(--risu-theme-borderc) 24%, transparent); border-radius: calc(var(--risu-radius-sm) * 1.12); background: color-mix(in srgb, var(--risu-theme-darkbg) 80%, transparent); box-shadow: var(--risu-shadow-floating, 0 .25rem 1.2rem color-mix(in srgb, var(--color-shadow) 8%, transparent)); transition: border-color .16s ease, transform .16s ease, background .16s ease; }
    .story-card:focus-within { border-color: var(--risu-theme-primary); }
    button { color: var(--risu-theme-textcolor); cursor: pointer; }
    button:focus-visible { outline: 2px solid var(--risu-theme-primary); outline-offset: -2px; }
    .entry-body { padding: .85rem 1rem 1rem; }
    .entry-edit { display: grid; flex: 0 0 auto; width: 2rem; height: 2rem; place-items: center; padding: 0; border: 1px solid transparent; border-radius: calc(var(--risu-radius-sm) * 1.2); color: var(--risu-theme-textcolor2); background: transparent; }
    .entry-edit:hover { border-color: var(--risu-theme-primary); color: var(--risu-theme-primary); background: color-mix(in srgb, var(--risu-theme-primary) 10%, transparent); }
    .source-button { display: flex; align-items: center; justify-content: flex-end; gap: .35rem; width: 100%; padding: .45rem 1rem; border: 0; border-top: 1px solid color-mix(in srgb, var(--risu-theme-borderc) 18%, transparent); color: var(--risu-theme-textcolor2); background: color-mix(in srgb, var(--risu-theme-darkbg) 45%, transparent); font-size: .75rem; }
    .source-button:hover { color: var(--risu-theme-primary); }
    .entry-time { margin: 0 0 .2rem; color: color-mix(in srgb, var(--risu-theme-primary) 75%, var(--risu-theme-textcolor)); font-size: .75rem; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: .01em; }
    .entry-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: .45rem; color: var(--risu-theme-textcolor2); }
    .entry-heading strong { color: var(--risu-theme-textcolor); font-family: Georgia, 'Noto Serif KR', serif; font-size: .95rem; }
    .story-line { display: block; margin: 0; font-family: Georgia, 'Noto Serif KR', serif; font-size: .9rem; line-height: 1.72; }
    .story-line + .story-line { margin-top: .3rem; }
    .story-more { display: flex; align-items: baseline; justify-content: center; gap: .5rem; width: 100%; max-width: 43.4rem; margin: 1rem auto 2rem; padding: .7rem 1rem; border: 1px dashed var(--story-rule); border-radius: calc(var(--risu-radius-lg) * 0.8); color: var(--risu-theme-textcolor); background: transparent; font-size: .8rem; font-weight: 700; cursor: pointer; }
    .story-more span { color: var(--risu-theme-textcolor2); font-size: .75rem; font-weight: 500; font-variant-numeric: tabular-nums; }
    .story-more:hover { background: color-mix(in srgb, var(--risu-theme-primary) 10%, transparent); }
    .story-more:focus-visible { outline: 2px solid color-mix(in srgb, var(--risu-theme-primary) 70%, transparent); outline-offset: 2px; }
    .story-empty { max-width: 43.4rem; margin: 2rem auto; padding: 2rem; border: 1px dashed var(--story-rule); color: var(--risu-theme-textcolor2); text-align: center; }
</style>
