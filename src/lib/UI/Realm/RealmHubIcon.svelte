<script lang="ts">
    import { BookIcon, DownloadIcon, ImageIcon, SmileIcon } from '@lucide/svelte';
    import { hubURL, type hubType } from 'src/ts/characterCards';
    import { DBState } from 'src/ts/stores.svelte';
    import { parseMultilangString } from 'src/ts/util';

    interface Props {
        onClick?: () => void;
        onAuthorClick?: (author: string) => void;
        chara: hubType;
    }

    let { onClick = () => {}, onAuthorClick = () => {}, chara }: Props = $props();
    let isKorean = $derived(DBState.db.language === 'ko');
    let ui = $derived(isKorean ? {
        by: '제작자',
        searchByAuthor: '제작자로 검색',
        downloads: '다운로드',
        emotions: '감정 이미지 포함',
        assets: '추가 에셋 포함',
        lorebook: '로어북 포함',
    } : {
        by: 'by',
        searchByAuthor: 'Search by creator',
        downloads: 'Downloads',
        emotions: 'Emotion images',
        assets: 'Additional assets',
        lorebook: 'Lorebook',
    });
    let localizedDescription = $derived.by(() => {
        const descriptions = parseMultilangString(chara.desc);
        return descriptions[DBState.db.language] ?? descriptions.en ?? descriptions.xx ?? '';
    });

    function selectAuthor(event: MouseEvent | KeyboardEvent) {
        event.stopPropagation();
        if (chara.authorname) onAuthorClick(chara.authorname);
    }

    function handleAuthorKeydown(event: KeyboardEvent) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        selectAuthor(event);
    }
</script>

<button
    type="button"
    class="group relative flex w-full min-w-0 overflow-hidden rounded-2xl border border-darkborderc bg-darkbg p-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-borderc hover:bg-selected/35 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-borderc/50"
    onclick={onClick}
>
    <div class="relative h-28 w-24 shrink-0 overflow-hidden rounded-xl border border-darkborderc bg-darkbutton sm:h-32 sm:w-28">
        {#if DBState.db.hideAllImages}
            <div class="flex size-full items-center justify-center text-3xl text-textcolor2">?</div>
        {:else}
            <img class="size-full object-cover object-top transition-transform duration-300 group-hover:scale-105" alt={chara.name} src={`${hubURL}/resource/` + chara.img} />
        {/if}
    </div>

    <div class="flex min-w-0 grow flex-col px-3 py-1">
        <div class="flex min-w-0 items-start justify-between gap-2">
            <div class="min-w-0">
                <h2 class="truncate text-base font-semibold tracking-tight text-textcolor sm:text-lg">{chara.name}</h2>
                {#if chara.authorname}
                    <span
                        role="button"
                        tabindex="0"
                        title={ui.searchByAuthor}
                        class="mt-0.5 block truncate text-xs text-textcolor2 hover:text-textcolor hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-borderc"
                        onclick={selectAuthor}
                        onkeydown={handleAuthorKeydown}
                    >{ui.by} {chara.authorname}</span>
                {/if}
            </div>
            <div class="flex shrink-0 items-center gap-1 text-xs text-textcolor2" title={ui.downloads}>
                <DownloadIcon size={14} />
                <span>{chara.download}</span>
            </div>
        </div>

        <p class="mt-2 line-clamp-2 text-sm leading-relaxed text-textcolor2">{localizedDescription}</p>

        <div class="mt-auto flex items-end justify-between gap-2 pt-3">
            <div class="flex min-w-0 flex-wrap gap-1">
                {#each chara.tags.slice(0, 3) as tag}
                    <span class="max-w-28 truncate rounded-full border border-darkborderc bg-selected/40 px-2 py-0.5 text-xs text-borderc">#{tag}</span>
                {/each}
                {#if chara.tags.length > 3}
                    <span class="rounded-full border border-darkborderc px-2 py-0.5 text-xs text-textcolor2">+{chara.tags.length - 3}</span>
                {/if}
            </div>
            <div class="flex shrink-0 items-center gap-1.5 text-textcolor2">
                {#if chara.hasEmotion}<span title={ui.emotions}><SmileIcon size={15} /></span>{/if}
                {#if chara.hasAsset}<span title={ui.assets}><ImageIcon size={15} /></span>{/if}
                {#if chara.hasLore}<span title={ui.lorebook}><BookIcon size={15} /></span>{/if}
            </div>
        </div>
    </div>
</button>
