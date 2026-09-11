<script lang="ts">
    import { downloadRisuHub, getRisuHub, hubAdditionalHTML, type hubType } from 'src/ts/characterCards';
    import { ArrowLeft, ArrowRight, HashIcon, MenuIcon, SearchIcon, SparklesIcon } from '@lucide/svelte';
    import { alertInput } from 'src/ts/alert';
    import { language } from 'src/lang';
    import { loadingActivity } from 'src/ts/gui/loadingActivity';
    import { DBState, RealmInitialOpenChar } from 'src/ts/stores.svelte';
    import { TagList } from 'src/ts/util';
    import ShButton from '../GUI/ShButton.svelte';
    import ShDialog from '../GUI/ShDialog.svelte';
    import RealmHubIcon from './RealmHubIcon.svelte';
    import RealmPopUp from './RealmPopUp.svelte';

    let openedData: null | hubType = $state(null);
    let charas: hubType[] = $state([]);
    let page = $state(0);
    let sort = $state('recommended');
    let search = $state('');
    let tagSearch = $state('');
    let tagInputFocused = $state(false);
    let highlightedTagIndex = $state(0);
    let menuOpen = $state(false);
    let nsfw = $state(false);
    let isKorean = $derived(DBState.db.language === 'ko');
    let ui = $derived(isKorean ? {
        title: 'RisuRealm 둘러보기',
        subtitle: '이름, 설명 또는 정확한 태그로 공유 캐릭터를 검색하세요.',
        searchLabel: 'RisuRealm 검색',
        searchPlaceholder: '캐릭터 검색',
        search: '검색',
        menu: 'RisuRealm 메뉴',
        tagLabel: '정확한 태그 검색',
        tagPlaceholder: '태그를 공백으로 구분해 입력',
        clear: '지우기',
        suggestions: '태그 자동완성',
        popular: '인기 태그',
        popularLabel: '현재 결과의 인기 태그',
        noResults: '검색 결과가 없습니다.',
        pages: 'RisuRealm 페이지',
        previousPage: '이전 페이지',
        nextPage: '다음 페이지',
        tools: 'RisuRealm 도구',
        toolsDescription: 'URL 또는 ID로 공유 캐릭터를 가져옵니다.',
        importCharacter: '캐릭터 가져오기',
        importPrompt: 'URL 또는 ID 입력',
    } : {
        title: 'Explore RisuRealm',
        subtitle: 'Search shared characters by name, description, or an exact tag.',
        searchLabel: 'Search RisuRealm',
        searchPlaceholder: 'Search characters',
        search: 'Search',
        menu: 'RisuRealm menu',
        tagLabel: 'Search by exact tags',
        tagPlaceholder: 'Exact tags, separated by spaces',
        clear: 'Clear',
        suggestions: 'Tag suggestions',
        popular: 'Popular',
        popularLabel: 'Popular tags in current results',
        noResults: 'No RisuRealm characters found.',
        pages: 'RisuRealm pages',
        previousPage: 'Previous page',
        nextPage: 'Next page',
        tools: 'RisuRealm tools',
        toolsDescription: 'Import a shared character directly from its URL or ID.',
        importCharacter: 'Import character',
        importPrompt: 'Input URL or ID',
    });

    let popularTags = $derived.by(() => {
        const counts = new Map<string, number>();
        for (const chara of charas) {
            for (const tag of chara.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
        return [...counts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 7)
            .map(([tag]) => tag);
    });

    let tagWords = $derived(tagSearch.split(/\s+/).filter(Boolean));
    let tagFragment = $derived(tagSearch.endsWith(' ') ? '' : (tagWords.at(-1) ?? ''));
    let completedTags = $derived.by(() => new Set(
        (tagSearch.endsWith(' ') ? tagWords : tagWords.slice(0, -1))
            .map((tag) => tag.toLowerCase()),
    ));
    let tagSuggestions = $derived.by(() => {
        const query = tagFragment.toLowerCase();
        const matches = TagList.filter((tag) => {
            if (completedTags.has(tag.value.toLowerCase())) return false;
            if (!query) return true;
            return tag.value.toLowerCase().startsWith(query)
                || tag.alias.some((alias) => alias.toLowerCase().startsWith(query));
        }).sort((a, b) => a.value.localeCompare(b.value));
        return query ? matches.slice(0, 8) : matches;
    });
    let showTagSuggestions = $derived(tagInputFocused && tagSuggestions.length > 0);

    function currentSearch() {
        const tags = [...new Set(tagSearch.split(/\s+/).map((tag) => tag.trim()).filter(Boolean))];
        return [search.trim(), ...tags.map((tag) => `tag:${tag}`)]
            .filter(Boolean)
            .join(' ');
    }

    async function getHub() {
        charas = await loadingActivity.read('RisuRealm', () => getRisuHub({
            search: currentSearch(),
            page,
            nsfw,
            sort,
        }));
    }

    function submitSearch(event?: SubmitEvent) {
        event?.preventDefault();
        if (sort === 'random' || sort === 'recommended') sort = '';
        page = 0;
        void getHub();
    }

    function changeSort(type: string) {
        sort = type;
        page = 0;
        void getHub();
    }

    function completeTag(tag: string) {
        const tags = tagSearch.trim().split(/\s+/).filter(Boolean);
        if (!tagSearch.endsWith(' ')) tags.pop();
        if (!tags.some((completed) => completed.toLowerCase() === tag.toLowerCase())) tags.push(tag);
        tagSearch = `${tags.join(' ')} `;
        highlightedTagIndex = 0;
    }

    function chooseTag(tag: string) {
        completeTag(tag);
        submitSearch();
    }

    function handleTagKeydown(event: KeyboardEvent) {
        if (showTagSuggestions && event.key === 'ArrowDown') {
            event.preventDefault();
            highlightedTagIndex = (highlightedTagIndex + 1) % tagSuggestions.length;
            return;
        }
        if (showTagSuggestions && event.key === 'ArrowUp') {
            event.preventDefault();
            highlightedTagIndex = (highlightedTagIndex - 1 + tagSuggestions.length) % tagSuggestions.length;
            return;
        }
        if (showTagSuggestions && (event.key === 'Tab' || event.key === 'Enter')) {
            event.preventDefault();
            completeTag(tagSuggestions[highlightedTagIndex]?.value ?? tagSuggestions[0].value);
            return;
        }
        if (event.key === 'Escape') {
            tagInputFocused = false;
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            submitSearch();
        }
    }

    void getHub();

    $effect(() => {
        if ($RealmInitialOpenChar) {
            openedData = $RealmInitialOpenChar;
            $RealmInitialOpenChar = null;
        }
    });
</script>

<section class="mt-4 w-full overflow-hidden rounded-2xl border border-darkborderc bg-darkbg shadow-lg shadow-shadow/10">
    <div class="border-b border-darkborderc bg-selected/20 px-4 py-4 sm:px-5">
        <div class="mb-4 flex items-start gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary">
                <SparklesIcon size={19} />
            </div>
            <div class="min-w-0">
                <h1 class="text-lg font-semibold tracking-tight text-textcolor">{ui.title}</h1>
                <p class="mt-0.5 text-sm leading-relaxed text-textcolor2">{ui.subtitle}</p>
            </div>
        </div>

        <form class="flex flex-col gap-2" onsubmit={submitSearch}>
            <div class="flex min-w-0 items-stretch overflow-hidden rounded-xl border border-darkborderc bg-bgcolor/40 transition-colors focus-within:border-borderc focus-within:ring-2 focus-within:ring-borderc/30">
                <SearchIcon size={18} class="ml-3 self-center text-textcolor2" />
                <input
                    bind:value={search}
                    aria-label={ui.searchLabel}
                    placeholder={ui.searchPlaceholder}
                    class="min-w-0 grow bg-transparent px-3 py-3 text-base text-textcolor outline-none placeholder:text-textcolor2/60"
                />
                <button
                    type="submit"
                    aria-label={ui.search}
                    class="flex w-12 shrink-0 items-center justify-center border-l border-darkborderc text-textcolor2 transition-colors hover:bg-selected hover:text-textcolor"
                >
                    <SearchIcon size={19} />
                </button>
                <button
                    type="button"
                    aria-label={ui.menu}
                    onclick={() => menuOpen = true}
                    class="flex w-12 shrink-0 items-center justify-center border-l border-darkborderc text-textcolor2 transition-colors hover:bg-selected hover:text-textcolor"
                >
                    <MenuIcon size={19} />
                </button>
            </div>

            <div class="relative">
                <div class="flex min-w-0 items-center rounded-xl border border-darkborderc bg-bgcolor/25 px-3 transition-colors focus-within:border-borderc focus-within:ring-2 focus-within:ring-borderc/30">
                    <HashIcon size={17} class="shrink-0 text-textcolor2" />
                    <input
                        bind:value={tagSearch}
                        aria-label={ui.tagLabel}
                        aria-autocomplete="list"
                        aria-controls="realm-tag-suggestions"
                        aria-expanded={showTagSuggestions}
                        aria-activedescendant={showTagSuggestions ? `realm-tag-option-${highlightedTagIndex}` : undefined}
                        placeholder={ui.tagPlaceholder}
                        class="min-w-0 grow bg-transparent px-3 py-2.5 text-sm text-textcolor outline-none placeholder:text-textcolor2/60"
                        onfocus={() => tagInputFocused = true}
                        onblur={() => tagInputFocused = false}
                        oninput={() => { highlightedTagIndex = 0; tagInputFocused = true; }}
                        onkeydown={handleTagKeydown}
                    />
                    {#if tagSearch}
                        <button type="button" class="text-xs text-textcolor2 hover:text-textcolor" onclick={() => { tagSearch = ''; highlightedTagIndex = 0; }}>{ui.clear}</button>
                    {/if}
                </div>

                {#if showTagSuggestions}
                    <div
                        id="realm-tag-suggestions"
                        role="listbox"
                        aria-label={ui.suggestions}
                        class="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-xl border border-darkborderc bg-darkbg p-1.5 shadow-xl shadow-shadow/20"
                    >
                        {#each tagSuggestions as tag, index (tag.value)}
                            <button
                                id={`realm-tag-option-${index}`}
                                type="button"
                                role="option"
                                aria-selected={index === highlightedTagIndex}
                                class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors {index === highlightedTagIndex ? 'bg-selected text-textcolor' : 'text-textcolor2 hover:bg-selected/50 hover:text-textcolor'}"
                                onpointerdown={(event) => event.preventDefault()}
                                onmouseenter={() => highlightedTagIndex = index}
                                onclick={() => completeTag(tag.value)}
                            >
                                <span>#{tag.value}</span>
                                {#if index === highlightedTagIndex}<span class="text-xs text-textcolor2">Tab / Enter</span>{/if}
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        </form>

        {#if popularTags.length > 0}
            <div class="mt-3 flex items-center gap-2 overflow-x-auto pb-0.5" aria-label={ui.popularLabel}>
                <span class="shrink-0 text-xs font-medium uppercase tracking-wide text-textcolor2/70">{ui.popular}</span>
                {#each popularTags as tag}
                    <button
                        type="button"
                        class="shrink-0 rounded-full border border-darkborderc bg-darkbg px-2.5 py-1 text-xs text-textcolor2 transition-colors hover:border-borderc hover:bg-selected hover:text-textcolor"
                        onclick={() => chooseTag(tag)}
                    >#{tag}</button>
                {/each}
            </div>
        {/if}
    </div>

    <div class="flex items-center gap-2 overflow-x-auto border-b border-darkborderc px-4 py-3 sm:px-5">
        <button
            type="button"
            class="shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors {nsfw ? 'border-primary/50 bg-primary/20 text-textcolor' : 'border-darkborderc text-textcolor2 hover:bg-selected/40'}"
            onclick={() => { nsfw = !nsfw; page = 0; void getHub(); }}
        >{nsfw ? 'NSFW' : 'SFW'}</button>
        <span class="h-5 border-l border-darkborderc"></span>
        {#each [
            ['recommended', language.recommended],
            ['', language.recent],
            ['trending', language.trending],
            ['downloads', language.downloads],
            ['random', language.random],
        ] as option}
            <button
                type="button"
                class="shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors {sort === option[0] ? 'border-borderc bg-selected text-textcolor' : 'border-transparent text-textcolor2 hover:bg-selected/40 hover:text-textcolor'}"
                onclick={() => changeSort(option[0])}
            >{option[1]}</button>
        {/each}
    </div>
</section>

{@html hubAdditionalHTML}

<div class="grid w-full grid-cols-1 gap-3 py-4 lg:grid-cols-2">
    {#each charas as chara (chara.id)}
        <RealmHubIcon onClick={() => openedData = chara} {chara} />
    {/each}
</div>

{#if charas.length === 0}
    <div class="flex min-h-32 items-center justify-center rounded-2xl border border-dashed border-darkborderc text-sm text-textcolor2">
        {ui.noResults}
    </div>
{/if}

{#if sort !== 'random' && sort !== 'recommended'}
    <nav class="flex w-full justify-center pb-4" aria-label={ui.pages}>
        <div class="flex items-center gap-2 rounded-xl border border-darkborderc bg-darkbg p-1.5">
            <ShButton
                variant="ghost"
                size="icon-sm"
                aria-label={ui.previousPage}
                disabled={page === 0}
                onclick={() => { if (page > 0) { page -= 1; void getHub(); } }}
            ><ArrowLeft size={18} /></ShButton>
            <span class="min-w-10 text-center text-sm font-medium text-textcolor">{page + 1}</span>
            <ShButton
                variant="ghost"
                size="icon-sm"
                aria-label={ui.nextPage}
                onclick={() => { page += 1; void getHub(); }}
            ><ArrowRight size={18} /></ShButton>
        </div>
    </nav>
{/if}

{#if openedData}
    <RealmPopUp bind:openedData />
{/if}

<ShDialog bind:open={menuOpen} size="sm" closeOnEscape={true} closeOnOutsideClick={true}>
    {#snippet title()}{ui.tools}{/snippet}
    {#snippet description()}{ui.toolsDescription}{/snippet}
    <ShButton variant="secondary" className="w-full" onclick={async () => {
        menuOpen = false;
        const input = await alertInput(ui.importPrompt);
        if (!input) return;
        if (input.startsWith('http')) {
            const url = new URL(input);
            const id = url.searchParams.get('realm') ?? url.searchParams.get('code') ?? input.split('/').at(-1);
            if (id) {
                void downloadRisuHub(id);
                return;
            }
        }
        const id = input.split('?').at(-1);
        if (id) void downloadRisuHub(id);
    }}>{ui.importCharacter}</ShButton>
</ShDialog>
