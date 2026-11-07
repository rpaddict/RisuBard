<script lang="ts">
    import { tick } from 'svelte'
    import { Popover } from 'bits-ui'
    import {
        ChevronDownIcon,
        ListTreeIcon,
        LoaderCircleIcon,
        PlayIcon,
        RotateCcwIcon,
        SquareTerminalIcon,
        XIcon,
    } from '@lucide/svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import { BARDCHAT_COMMAND_TEMPLATES } from 'src/ts/risubard/bardChatCommandTemplates'
    import type {
        DirectWikiCommandResult,
        DirectWikiContextSelection,
    } from 'src/ts/risubard/directWikiCommand'

    interface Props {
        onExecute: (
            instruction: string,
            contextSelection: DirectWikiContextSelection
        ) => Promise<DirectWikiCommandResult>
        contextSelection?: DirectWikiContextSelection
        mobileLayout?: boolean
        onContextSelectionChange?: (
            selection: DirectWikiContextSelection
        ) => void
        targetDocumentTitleOrId?: string
        canRestore?: boolean
        onRestore?: () => Promise<void>
    }

    const DEFAULT_CONTEXT_SELECTION: DirectWikiContextSelection = {
        wiki: true,
        chat: false,
        systemPrompt: false,
        characterDescription: false,
        persona: false,
        characterLorebook: false,
        moduleLorebook: false,
    }
    const contextOptions: Array<{
        key: keyof DirectWikiContextSelection
        label: string
        title: string
    }> = [
        { key: 'wiki', label: '위키', title: '현재 BardWiki 문서' },
        { key: 'chat', label: '챗', title: '설정된 개수의 최근 사용자와 AI 메시지' },
        { key: 'systemPrompt', label: '시스템', title: '현재 시스템 프롬프트' },
        { key: 'characterDescription', label: '캐릭터', title: '캐릭터 설명, 성격, 시나리오' },
        { key: 'persona', label: '페르소나', title: '현재 챗에 연결된 페르소나' },
        { key: 'characterLorebook', label: '캐릭터 로어', title: '명령에 반응한 캐릭터 로어북' },
        { key: 'moduleLorebook', label: '모듈 로어', title: '활성 모듈 로어북' },
    ]
    let {
        onExecute,
        contextSelection = DEFAULT_CONTEXT_SELECTION,
        mobileLayout = false,
        onContextSelectionChange,
        targetDocumentTitleOrId = '',
        canRestore = false,
        onRestore,
    }: Props = $props()
    let selection = $state<DirectWikiContextSelection>({
        ...DEFAULT_CONTEXT_SELECTION,
    })
    let loadedSelectionKey = ''
    let instruction = $state('')
    let running = $state(false)
    let error = $state('')
    let result = $state<DirectWikiCommandResult | null>(null)
    let restoring = $state(false)
    let textareaElement = $state<HTMLTextAreaElement>()
    let contextOpen = $state(false)
    let templatesOpen = $state(false)
    let selectedTemplateId = $state(BARDCHAT_COMMAND_TEMPLATES[0].id)
    let rememberedSelectionStart = $state(0)
    let rememberedSelectionEnd = $state(0)
    const selectedTemplate = $derived(
        BARDCHAT_COMMAND_TEMPLATES.find((template) =>
            template.id === selectedTemplateId
        ) ?? BARDCHAT_COMMAND_TEMPLATES[0]
    )
    const selectedTemplatePrompt = $derived(
        selectedTemplate.prompt.replaceAll(
            '<문서 제목 또는 ID>',
            targetDocumentTitleOrId.trim() || '<문서 제목 또는 ID>'
        )
    )

    $effect(() => {
        const key = JSON.stringify(contextSelection)
        if (key === loadedSelectionKey) return
        selection = { ...contextSelection }
        loadedSelectionKey = key
    })

    function setContext(
        key: keyof DirectWikiContextSelection,
        checked: boolean
    ) {
        selection = { ...selection, [key]: checked }
        onContextSelectionChange?.({ ...selection })
    }

    function openTemplates() {
        rememberedSelectionStart = textareaElement?.selectionStart
            ?? instruction.length
        rememberedSelectionEnd = textareaElement?.selectionEnd
            ?? rememberedSelectionStart
        contextOpen = false
        templatesOpen = true
    }

    function closeTemplates() {
        templatesOpen = false
    }

    async function applyTemplate(mode: 'insert' | 'replace') {
        let caret = selectedTemplatePrompt.length
        if (mode === 'insert') {
            const start = Math.min(rememberedSelectionStart, instruction.length)
            const end = Math.min(
                Math.max(rememberedSelectionEnd, start),
                instruction.length
            )
            instruction = instruction.slice(0, start)
                + selectedTemplatePrompt
                + instruction.slice(end)
            caret = start + selectedTemplatePrompt.length
        }
        else {
            instruction = selectedTemplatePrompt
        }
        templatesOpen = false
        await tick()
        textareaElement?.focus()
        textareaElement?.setSelectionRange(caret, caret)
    }

    async function run() {
        const command = instruction.trim()
        if (!command || running) return
        running = true
        error = ''
        result = null
        try {
            result = await onExecute(command, { ...selection })
        }
        catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
        }
        finally {
            running = false
        }
    }

    async function restore() {
        if (!onRestore || !canRestore || running || restoring) return
        restoring = true
        error = ''
        try {
            await onRestore()
            result = null
        }
        catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
        }
        finally {
            restoring = false
        }
    }

</script>

<section
    class="command-terminal"
    class:mobile-layout={mobileLayout}
    data-wiki-command-terminal
>
    <header class="terminal-toolbar">
        <div class="terminal-title">
            <span class="terminal-mark"><SquareTerminalIcon size={17} /></span>
            <strong>BARDCHAT</strong>
        </div>
        <Popover.Root bind:open={contextOpen}>
            <Popover.Trigger>
                {#snippet child({ props })}
                    <button
                        {...props}
                        type="button"
                        class="toolbar-button"
                        data-bardchat-context-open
                        title="AI에게 함께 보낼 컨텍스트 선택"
                        disabled={running || restoring}
                    ><span>컨텍스트</span><ChevronDownIcon size={13} /></button>
                {/snippet}
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    side="bottom"
                    align="start"
                    sideOffset={8}
                    collisionPadding={8}
                    avoidCollisions={true}
                    strategy="fixed"
                    trapFocus={false}
                    aria-label="BARDCHAT 주입 정보"
                    class="z-50 w-64 overflow-y-auto overscroll-contain rounded-md border border-darkborderc bg-darkbg p-1.5 text-textcolor shadow-md outline-none"
                    style="max-width: calc(100vw - 1rem); max-height: var(--bits-popover-content-available-height);"
                >
                    <fieldset
                        class="context-menu"
                        aria-label="BARDCHAT 주입 정보"
                        data-bardchat-context-menu
                    >
                        {#each contextOptions as option}
                            <label class:active={selection[option.key]} title={option.title}>
                                <input
                                    type="checkbox"
                                    data-bardchat-context={option.key}
                                    checked={selection[option.key]}
                                    disabled={running || restoring}
                                    onchange={(event) => setContext(
                                        option.key,
                                        event.currentTarget.checked
                                    )}
                                />
                                <span>{option.label}</span>
                            </label>
                        {/each}
                    </fieldset>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
        <button
            type="button"
            class="toolbar-button"
            data-bardchat-template-open
            title="명령어 템플릿 열기"
            onclick={openTemplates}
        ><ListTreeIcon size={14} /><span>명령어 리스트</span></button>
        <button
            type="button"
            class="restore-button"
            data-bardchat-restore
            aria-label="마지막 BARDCHAT 변경 복원"
            title="마지막 BARDCHAT 실행 이전 스냅샷으로 복원"
            disabled={!canRestore || running || restoring}
            onclick={() => void restore()}
        >
            {#if restoring}<LoaderCircleIcon class="animate-spin" size={15} />
            {:else}<RotateCcwIcon size={15} />{/if}
        </button>
        <span class="toolbar-spacer"></span>
        <ShButton
            variant="primary"
            size="sm"
            data-wiki-command-run
            title="지시 실행 (Ctrl+Enter)"
            onclick={run}
            disabled={running || restoring || !instruction.trim()}
        >
            {#if running}
                <LoaderCircleIcon class="animate-spin" size={14} /> 실행 중
            {:else}
                <PlayIcon size={14} /> 지시 실행
            {/if}
        </ShButton>
    </header>

    <div class="terminal-body">
        <span class="prompt" aria-hidden="true">›</span>
        <textarea
            data-wiki-command-input
            bind:this={textareaElement}
            bind:value={instruction}
            rows="4"
            maxlength="8000"
            placeholder="예: 현 메시지의 프로파일에 언급된 인물들을 각각 character 문서로 만들고, 모든 프로필 정보를 반영해."
            onkeydown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault()
                    void run()
                }
            }}
        ></textarea>
    </div>

    <footer>
        <div class="terminal-status" aria-live="polite" data-wiki-command-result>
            {#if error}
                <span class="failure">실행 실패: {error}</span>
            {:else if result}
                <span class:failure={result.failed.length > 0}>
                    적용 {result.applied.length}건
                    {#if result.applied.length > 0}
                        : {result.applied.map((item) => item.title).join(', ')}
                    {/if}
                </span>
                {#each result.failed as item}
                    <span class="failure">적용하지 못함: {item.title} ({item.reason})</span>
                {/each}
            {:else}
                <span>Ctrl+Enter로 실행합니다. 바꾸기 전 문서는 기록되어 되돌릴 수 있고, 다른 작업과 겹치면 저장하지 않습니다.</span>
            {/if}
        </div>
    </footer>
</section>

{#if templatesOpen}
    <div
        class="template-backdrop"
        role="presentation"
        onclick={(event) => {
            if (event.target === event.currentTarget) closeTemplates()
        }}
        onkeydown={(event) => {
            if (event.key === 'Escape') closeTemplates()
        }}
    >
        <div
            class="template-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bardchat-template-title"
            tabindex="-1"
            data-bardchat-template-dialog
        >
            <header class="template-dialog-header">
                <div>
                    <span class="dialog-kicker">BARDCHAT / COMMAND LIBRARY</span>
                    <h2 id="bardchat-template-title">명령어 리스트</h2>
                    <p>계약을 지키는 명령을 골라 필요한 대상만 수정한 뒤 실행하세요.</p>
                </div>
                <button
                    type="button"
                    class="dialog-close-icon"
                    aria-label="명령어 리스트 닫기"
                    onclick={closeTemplates}
                ><XIcon size={18} /></button>
            </header>

            <div class="template-grid">
                <nav class="template-list" aria-label="BARDCHAT 명령어" data-template-list-pane>
                    {#each BARDCHAT_COMMAND_TEMPLATES as template}
                        <button
                            type="button"
                            class:active={template.id === selectedTemplateId}
                            data-bardchat-template-option={template.id}
                            onclick={() => selectedTemplateId = template.id}
                        >
                            <span class="command-code">{template.command}</span>
                            <strong>{template.title}</strong>
                            <small>{template.description}</small>
                        </button>
                    {/each}
                </nav>
                <article class="template-preview" data-template-prompt-pane>
                    <div class="preview-heading">
                        <span>{selectedTemplate.command}</span>
                        <strong>{selectedTemplate.title}</strong>
                    </div>
                    <pre data-bardchat-template-preview>{selectedTemplatePrompt}</pre>
                </article>
            </div>

            <footer class="template-dialog-footer">
                <span>삽입은 터미널에서 마지막으로 선택한 위치를 사용합니다.</span>
                <div>
                    <ShButton
                        variant="soft-primary"
                        size="sm"
                        data-bardchat-template-insert
                        onclick={() => applyTemplate('insert')}
                    >삽입</ShButton>
                    <ShButton
                        variant="primary"
                        size="sm"
                        data-bardchat-template-replace
                        onclick={() => applyTemplate('replace')}
                    >교체</ShButton>
                    <ShButton
                        variant="outline"
                        size="sm"
                        data-bardchat-template-close
                        onclick={closeTemplates}
                    >닫기</ShButton>
                </div>
            </footer>
        </div>
    </div>
{/if}

<style>
    .command-terminal {
        --terminal-line: color-mix(in srgb, var(--risu-theme-primary) 34%, transparent);
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        box-sizing: border-box;
        overflow: hidden;
        border: 1px solid var(--terminal-line);
        border-radius: calc(var(--risu-radius-lg) * 1.1);
        background:
            linear-gradient(180deg, color-mix(in srgb, var(--risu-theme-primary) 4%, transparent), transparent 38%),
            color-mix(in srgb, var(--risu-theme-darkbg) 96%, var(--color-bgcolor));
        box-shadow: inset 3px 0 0 color-mix(in srgb, var(--risu-theme-primary) 70%, transparent);
    }
    .command-terminal > footer {
        display: flex;
        align-items: center;
        gap: .65rem;
        padding: .62rem .75rem;
    }
    .command-terminal > header {
        padding: .45rem .65rem;
        border-bottom: 1px solid var(--terminal-line);
    }
    .command-terminal > footer {
        min-height: 1.85rem;
        box-sizing: border-box;
        padding-block: .28rem;
        border-top: 1px solid var(--terminal-line);
        background: color-mix(in srgb, var(--risu-theme-primary) 5%, transparent);
    }
    .terminal-toolbar {
        display: flex;
        align-items: center;
        min-width: 0;
    }
    .terminal-toolbar {
        flex: 0 0 auto;
        gap: .38rem;
        overflow: visible;
    }
    .terminal-title { display: flex; align-items: center; flex: 0 0 auto; gap: .5rem; }
    .terminal-title strong {
        color: var(--risu-theme-textcolor);
        font: 700 .82rem/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
        letter-spacing: .02em;
    }
    .terminal-status {
        color: var(--risu-theme-textcolor2);
        font-size: .68rem;
    }
    .terminal-mark {
        display: grid;
        place-items: center;
        width: 1.85rem;
        height: 1.85rem;
        border: 1px solid var(--terminal-line);
        border-radius: calc(var(--risu-radius-sm) * 1.4);
        color: var(--risu-theme-primary);
        background: color-mix(in srgb, var(--risu-theme-primary) 8%, transparent);
    }
    .context-menu {
        --terminal-line: color-mix(in srgb, var(--risu-theme-primary) 34%, transparent);
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: .25rem;
        min-width: 0;
        margin: 0;
        padding: 0;
        border: 0;
    }
    .context-menu label {
        display: inline-flex;
        align-items: center;
        gap: .75rem;
        min-height: 2.75rem;
        padding: .5rem .75rem;
        box-sizing: border-box;
        border: 1px solid var(--terminal-line);
        border-radius: calc(var(--risu-radius-sm) * 1.4);
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-darkbg) 88%, transparent);
        font-size: .875rem;
        font-weight: 500;
        line-height: 1.4;
        cursor: pointer;
        user-select: none;
    }
    .context-menu label.active {
        border-color: color-mix(in srgb, var(--risu-theme-primary) 60%, var(--terminal-line));
        color: var(--risu-theme-primary);
        background: color-mix(in srgb, var(--risu-theme-primary) 10%, transparent);
    }
    .context-menu label:hover {
        background: color-mix(in srgb, var(--risu-theme-primary) 16%, var(--risu-theme-darkbg));
    }
    .context-menu label:focus-within {
        outline: 2px solid var(--risu-theme-primary);
        outline-offset: -2px;
    }
    .context-menu input {
        width: 1.125rem;
        height: 1.125rem;
        flex-shrink: 0;
        margin: 0;
        accent-color: var(--risu-theme-primary);
    }
    .context-menu input:disabled { opacity: .55; }
    .toolbar-button,
    .restore-button {
        display: inline-flex;
        align-items: center;
        gap: .34rem;
        min-height: 1.85rem;
        padding: .3rem .52rem;
        border: 1px solid var(--terminal-line);
        border-radius: calc(var(--risu-radius-sm) * 1.4);
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-primary) 8%, transparent);
        font-size: .68rem;
        font-weight: 700;
        cursor: pointer;
    }
    .restore-button {
        display: grid;
        place-items: center;
        width: 1.9rem;
        min-width: 1.9rem;
        padding: 0;
    }
    .toolbar-button:hover,
    .toolbar-button:focus-visible,
    .restore-button:hover:not(:disabled),
    .restore-button:focus-visible {
        border-color: var(--risu-theme-primary);
        color: var(--risu-theme-primary);
        outline: 0;
    }
    .restore-button:disabled { cursor: not-allowed; opacity: .42; }
    .toolbar-spacer { flex: 1 1 auto; min-width: .25rem; }
    .terminal-toolbar :global([data-wiki-command-run]) { flex: 0 0 auto; }
    .terminal-body {
        display: grid;
        flex: 1;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: stretch;
        gap: .55rem;
        min-height: 0;
        padding: .75rem;
    }
    .prompt {
        padding-top: .46rem;
        color: var(--risu-theme-primary);
        font: 800 1rem/1 ui-monospace, monospace;
    }
    textarea {
        width: 100%;
        height: 100%;
        min-height: 4.5rem;
        box-sizing: border-box;
        resize: none;
        padding: .5rem .58rem;
        border: 0;
        border-left: 1px solid var(--terminal-line);
        outline: 0;
        color: var(--risu-theme-textcolor);
        background: transparent;
        font: .74rem/1.58 ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    textarea::placeholder { color: color-mix(in srgb, var(--risu-theme-textcolor2) 72%, transparent); }
    textarea:focus-visible {
        border-left-color: var(--risu-theme-primary);
        background: color-mix(in srgb, var(--risu-theme-primary) 3%, transparent);
    }
    .terminal-status {
        display: grid;
        gap: .12rem;
        min-width: 0;
    }
    .failure { color: var(--risu-theme-draculared); }

    .template-backdrop {
        position: fixed;
        z-index: 10000;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 1.25rem;
        background: color-mix(in srgb, var(--risu-theme-darkbg) 78%, transparent);
        backdrop-filter: blur(7px);
    }
    .template-dialog {
        --dialog-line: color-mix(in srgb, var(--risu-theme-primary) 28%, var(--risu-theme-darkborderc));
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        width: min(62rem, 94vw);
        height: min(44rem, 86vh);
        overflow: hidden;
        border: 1px solid var(--dialog-line);
        border-radius: var(--risu-radius-xl);
        color: var(--risu-theme-textcolor);
        background:
            linear-gradient(135deg, color-mix(in srgb, var(--risu-theme-primary) 7%, transparent), transparent 42%),
            var(--risu-theme-darkbg);
        box-shadow: var(--risu-shadow-overlay, 0 1.4rem 4rem color-mix(in srgb, var(--color-darkbg) 55%, transparent));
    }
    .template-dialog-header,
    .template-dialog-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: .8rem 1rem;
        border-color: var(--dialog-line);
    }
    .template-dialog-header { border-bottom: 1px solid var(--dialog-line); }
    .template-dialog-header > div { display: grid; gap: .12rem; }
    .template-dialog-header h2 {
        margin: 0;
        font-size: 1rem;
        line-height: 1.2;
    }
    .template-dialog-header p,
    .template-dialog-footer > span {
        margin: 0;
        color: var(--risu-theme-textcolor2);
        font-size: .68rem;
    }
    .dialog-kicker {
        color: var(--risu-theme-primary);
        font: 700 .56rem/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
        letter-spacing: .12em;
    }
    .dialog-close-icon {
        display: grid;
        place-items: center;
        width: 2rem;
        height: 2rem;
        border: 1px solid transparent;
        border-radius: calc(var(--risu-radius-sm) * 1.4);
        color: var(--risu-theme-textcolor2);
        background: transparent;
        cursor: pointer;
    }
    .dialog-close-icon:hover,
    .dialog-close-icon:focus-visible {
        border-color: var(--dialog-line);
        color: var(--risu-theme-textcolor);
        outline: 0;
    }
    .template-grid {
        display: grid;
        grid-template-columns: minmax(14rem, 32%) minmax(0, 1fr);
        min-height: 0;
    }
    .template-list {
        min-height: 0;
        overflow-y: auto;
        padding: .6rem;
        border-right: 1px solid var(--dialog-line);
        background: color-mix(in srgb, var(--risu-theme-darkbg) 78%, var(--color-bgcolor));
    }
    .template-list button {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        width: 100%;
        gap: .12rem .5rem;
        padding: .58rem .62rem;
        border: 1px solid transparent;
        border-radius: calc(var(--risu-radius-md) * 1.12);
        color: var(--risu-theme-textcolor);
        text-align: left;
        background: transparent;
        cursor: pointer;
    }
    .template-list button:hover { background: color-mix(in srgb, var(--risu-theme-primary) 6%, transparent); }
    .template-list button.active {
        border-color: var(--dialog-line);
        background: color-mix(in srgb, var(--risu-theme-primary) 11%, transparent);
        box-shadow: inset 2px 0 0 var(--risu-theme-primary);
    }
    .template-list strong { align-self: center; font-size: .75rem; }
    .template-list small {
        grid-column: 2;
        color: var(--risu-theme-textcolor2);
        font-size: .64rem;
        line-height: 1.4;
    }
    .command-code {
        align-self: center;
        padding: .16rem .28rem;
        border-radius: calc(var(--risu-radius-sm) * 0.88);
        color: var(--risu-theme-primary);
        background: color-mix(in srgb, var(--risu-theme-primary) 10%, transparent);
        font: 700 .53rem/1 ui-monospace, SFMono-Regular, Consolas, monospace;
        letter-spacing: .06em;
    }
    .template-preview {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        min-width: 0;
        min-height: 0;
        padding: 1rem;
    }
    .preview-heading {
        display: flex;
        align-items: baseline;
        gap: .55rem;
        padding: 0 .15rem .65rem;
    }
    .preview-heading span {
        color: var(--risu-theme-primary);
        font: 800 .65rem/1 ui-monospace, SFMono-Regular, Consolas, monospace;
        letter-spacing: .08em;
    }
    .preview-heading strong { font-size: .82rem; }
    .template-preview pre {
        min-width: 0;
        min-height: 0;
        margin: 0;
        overflow: auto;
        white-space: pre-wrap;
        padding: .85rem .9rem;
        border: 1px solid var(--dialog-line);
        border-radius: var(--risu-radius-lg);
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-darkbg) 88%, var(--color-darkbg));
        font: .74rem/1.65 ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    .template-dialog-footer {
        border-top: 1px solid var(--dialog-line);
        background: color-mix(in srgb, var(--risu-theme-primary) 4%, transparent);
    }
    .template-dialog-footer > div { display: flex; gap: .45rem; }

    .command-terminal.mobile-layout {
            border-inline: 0;
            border-bottom: 0;
            border-radius: 0;
            box-shadow: none;
        }
        .command-terminal.mobile-layout > header {
            display: flex;
            gap: .28rem;
            padding: .4rem .45rem;
        }
        .mobile-layout .terminal-title { display: none; }
        .mobile-layout .toolbar-button {
            min-height: 2.25rem;
            justify-content: center;
            padding-inline: .55rem;
        }
        .mobile-layout .terminal-body { gap: .35rem; padding: .45rem .5rem; }
        .mobile-layout .prompt { padding-top: .55rem; }
        .mobile-layout textarea { font-size: 1rem; }
        .command-terminal.mobile-layout > footer {
            gap: .5rem;
            padding: .4rem .5rem;
        }
        .mobile-layout .terminal-status {
            flex: 1;
            max-height: 2.5rem;
            overflow: hidden;
            line-height: 1.35;
        }
        .mobile-layout .terminal-body :global(button) {
            min-height: 2.75rem;
        }

    @media (max-width: 46rem) {
        .template-backdrop { padding: .55rem; }
        .template-dialog { width: 100%; height: min(48rem, 92dvh); }
        .template-dialog-header p,
        .template-dialog-footer > span { display: none; }
        .template-grid { grid-template-columns: 42% minmax(0, 1fr); }
        .template-list { padding: .35rem; }
        .template-list button { grid-template-columns: 1fr; padding: .5rem; }
        .template-list small { display: none; }
        .template-list strong { font-size: .72rem; }
        .command-code { justify-self: start; }
        .template-preview { padding: .55rem; }
        .template-preview pre { padding: .65rem; font-size: .69rem; }
        .template-dialog-footer { align-items: stretch; }
        .template-dialog-footer > div { width: 100%; }
        .template-dialog-footer :global(button) { flex: 1; }
    }

    @media (max-width: 30rem) {
        .template-dialog { height: calc(100dvh - 1rem); }
        .template-grid {
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: minmax(7rem, 34%) minmax(0, 1fr);
        }
        .template-list {
            border-right: 0;
            border-bottom: 1px solid var(--dialog-line);
        }
    }
</style>
