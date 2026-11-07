<script lang="ts">
    import { ReplaceAllIcon, SearchIcon } from '@lucide/svelte'
    import type { Message } from 'src/ts/storage/database.svelte'
    import { previewFindReplace } from 'src/ts/risubard/findReplace'

    interface Document {
        id: string
        title: string
        content: string
    }

    interface Result {
        wikiMatches: number
        wikiDocuments: number
        chatMatches: number
        chatMessages: number
    }

    interface Props {
        documents: Document[]
        messages: Message[]
        onReplace(input: {
            find: string
            replacement: string
            wiki: boolean
            chat: boolean
        }): Promise<Result>
    }

    let { documents, messages, onReplace }: Props = $props()
    let find = $state('')
    let replacement = $state('')
    let wiki = $state(true)
    let chat = $state(true)
    let running = $state(false)
    let error = $state('')
    let result = $state<Result | null>(null)
    let preview = $derived(previewFindReplace(documents, messages, find))
    let selectedMatches = $derived(
        (wiki ? preview.wikiMatches : 0) + (chat ? preview.chatMatches : 0)
    )

    async function run() {
        if (running || !find || find === replacement || selectedMatches === 0) {
            return
        }
        running = true
        error = ''
        result = null
        try {
            result = await onReplace({ find, replacement, wiki, chat })
        }
        catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
        }
        finally {
            running = false
        }
    }
</script>

<section class="find-replace" data-find-replace>
    <header>
        <span class="tool-mark"><ReplaceAllIcon size={19} /></span>
        <div>
            <h2>전체 찾기/바꾸기</h2>
            <p>대소문자를 구분해 입력한 글자와 정확히 같은 부분을 교정합니다.</p>
        </div>
    </header>

    <div class="fields">
        <label>
            <span><SearchIcon size={13} /> 찾을 내용</span>
            <input
                data-find-replace-find
                bind:value={find}
                maxlength="256"
                autocomplete="off"
                placeholder="길버드"
            />
        </label>
        <span class="arrow" aria-hidden="true">→</span>
        <label>
            <span>바꿀 내용</span>
            <input
                data-find-replace-replacement
                bind:value={replacement}
                maxlength="256"
                autocomplete="off"
                placeholder="길버트"
            />
        </label>
    </div>

    <div class="scopes" aria-label="바꿀 범위">
        <label class:inactive={!wiki}>
            <input type="checkbox" bind:checked={wiki} />
            <span>
                <strong>메모리 위키 전체</strong>
                <small>위키 {preview.wikiMatches}곳 · {preview.wikiDocuments}개 문서</small>
            </span>
        </label>
        <label class:inactive={!chat}>
            <input type="checkbox" bind:checked={chat} />
            <span>
                <strong>현재 챗 내역</strong>
                <small>챗 {preview.chatMatches}곳 · {preview.chatMessages}개 메시지</small>
            </span>
        </label>
    </div>

    <div class="action-row">
        <p>별도 문서 이력을 추가하지 않습니다. 챗의 화자명과 swipe 후보도 함께 바뀝니다.</p>
        <button
            type="button"
            data-find-replace-run
            disabled={running || !find || find === replacement || selectedMatches === 0}
            onclick={run}
        >
            <ReplaceAllIcon size={15} />
            {running ? '바꾸는 중…' : `${selectedMatches}곳 모두 바꾸기`}
        </button>
    </div>

    {#if result}
        <div class="status success" role="status">
            {result.wikiMatches + result.chatMatches}곳을 바꿨습니다
            <span>위키 {result.wikiDocuments}개 문서 · 챗 {result.chatMessages}개 메시지</span>
        </div>
    {:else if error}
        <div class="status error" role="alert">{error}</div>
    {/if}
</section>

<style>
    .find-replace { display: grid; align-content: start; gap: 1rem; height: 100%; overflow: auto; padding: 1.15rem; color: var(--risu-theme-textcolor); }
    header { display: flex; align-items: center; gap: .7rem; padding-bottom: .9rem; border-bottom: 1px solid var(--risu-theme-darkborderc); }
    .tool-mark { display: grid; flex: 0 0 auto; width: 2.35rem; height: 2.35rem; place-items: center; border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 42%, var(--risu-theme-darkborderc)); border-radius: calc(var(--risu-radius-lg) * 0.96); color: var(--risu-theme-primary); background: color-mix(in srgb, var(--risu-theme-primary) 10%, transparent); }
    h2, p { margin: 0; }
    h2 { font: 700 .95rem/1.25 Georgia, serif; }
    header p, .action-row p { margin-top: .2rem; color: var(--risu-theme-textcolor2); font-size: .68rem; line-height: 1.5; }
    .fields { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: end; gap: .55rem; }
    label { min-width: 0; }
    .fields label { display: grid; gap: .38rem; }
    .fields label > span { display: flex; align-items: center; gap: .3rem; color: var(--risu-theme-textcolor2); font-size: .7rem; font-weight: 700; }
    .fields input { width: 100%; min-width: 0; padding: .58rem .65rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: calc(var(--risu-radius-md) * 1.12); color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-darkbg) 92%, var(--color-bgcolor)); font-size: .78rem; }
    input:focus { outline: 2px solid color-mix(in srgb, var(--risu-theme-primary) 45%, transparent); outline-offset: 1px; }
    .arrow { padding-bottom: .55rem; color: var(--risu-theme-primary); }
    .scopes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .65rem; }
    .scopes label { display: flex; align-items: center; gap: .65rem; padding: .75rem; border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 26%, var(--risu-theme-darkborderc)); border-radius: calc(var(--risu-radius-lg) * 0.96); background: color-mix(in srgb, var(--risu-theme-primary) 6%, var(--risu-theme-darkbg)); cursor: pointer; }
    .scopes label.inactive { opacity: .55; }
    .scopes input { accent-color: var(--risu-theme-primary); }
    .scopes span { display: grid; gap: .16rem; }
    .scopes strong { font-size: .75rem; }
    .scopes small { color: var(--risu-theme-textcolor2); font-size: .65rem; }
    .action-row { display: flex; align-items: center; gap: 1rem; padding-top: .25rem; }
    .action-row p { flex: 1; }
    button { display: inline-flex; flex: 0 0 auto; align-items: center; gap: .4rem; padding: .55rem .75rem; border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 52%, var(--risu-theme-darkborderc)); border-radius: calc(var(--risu-radius-md) * 1.12); color: var(--risu-theme-darkbg); background: var(--risu-theme-primary); font-size: .72rem; font-weight: 800; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .status { display: flex; flex-wrap: wrap; gap: .35rem .7rem; padding: .7rem .8rem; border-radius: calc(var(--risu-radius-md) * 1.12); font-size: .72rem; }
    .status span { color: var(--risu-theme-textcolor2); }
    .status.success { border: 1px solid color-mix(in srgb, var(--risu-theme-success) 42%, var(--risu-theme-darkborderc)); background: color-mix(in srgb, var(--risu-theme-success) 9%, transparent); }
    .status.error { border: 1px solid color-mix(in srgb, var(--risu-theme-error) 42%, var(--risu-theme-darkborderc)); color: var(--risu-theme-error); }
    @media (max-width: 640px) { .fields, .scopes { grid-template-columns: 1fr; } .arrow { display: none; } .action-row { align-items: stretch; flex-direction: column; } .action-row button { justify-content: center; } }
</style>
