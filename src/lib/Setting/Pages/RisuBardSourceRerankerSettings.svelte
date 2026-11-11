<script lang="ts">
    import { DBState } from 'src/ts/stores.svelte'
    import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte'
    import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte'
    import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
    import { normalizeRisuBardSourceRerankerSettings } from 'src/ts/risubard/sourceRerankerApi'

    const id = $props.id()
    // Older databases may predate the field; normalization on load fills it, this guards hot paths.
    if (!DBState.db.risuBardSourceReranker) DBState.db.risuBardSourceReranker = normalizeRisuBardSourceRerankerSettings(undefined)
    let settings = $derived(DBState.db.risuBardSourceReranker!)
</script>

<div data-setting-row data-setting-id="risubard.sourceReranker" class="settings-standard-row flex flex-col gap-3 border-t border-darkborderc">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span class="text-sm text-textcolor">과거 원문 재순위 방식</span>
        <SelectInput bind:value={settings.method} ariaLabel="과거 원문 재순위 방식" className="w-full sm:w-64">
            <OptionInput value="model">보조 모델 (작업 모델 경로)</OptionInput>
            <OptionInput value="reranker">리랭커 API</OptionInput>
        </SelectInput>
    </div>
    {#if settings.method === 'reranker'}
        <p class="text-xs text-textcolor2">Cohere 방식의 <code>/rerank</code> 요청을 보냅니다. Cohere, Jina, Infinity 같은 로컬 서버를 쓸 수 있으며, 주소가 <code>/rerank</code>로 끝나지 않으면 자동으로 붙입니다. 요청이 실패하면 기존 검색 결과를 그대로 씁니다.</p>
        <div class="grid items-center gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <label for={`${id}-url`} class="text-sm text-textcolor">URL</label>
            <TextInput id={`${id}-url`} bind:value={settings.url} placeholder="예: https://api.cohere.com/v2" fullwidth />
            <label for={`${id}-key`} class="text-sm text-textcolor">API 키</label>
            <TextInput id={`${id}-key`} bind:value={settings.key} hideText fullwidth />
            <label for={`${id}-model`} class="text-sm text-textcolor">모델</label>
            <TextInput id={`${id}-model`} bind:value={settings.model} placeholder="예: rerank-v3.5" fullwidth />
            <label for={`${id}-score`} class="text-sm text-textcolor">최소 관련도</label>
            <input id={`${id}-score`} type="number" step="0.05" bind:value={settings.minScore}
                class="w-full rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor shadow-xs focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc sm:w-32" />
        </div>
        <p class="text-xs text-textcolor2">점수가 최소 관련도보다 낮은 원문은 버리고, 남은 원문 중 상위 4개를 위키 문서보다 먼저 넣습니다. 점수 범위는 모델마다 다르므로 엉뚱한 원문이 들어오면 값을 올리고, 맞는 원문이 빠지면 내리세요.</p>
    {/if}
</div>
