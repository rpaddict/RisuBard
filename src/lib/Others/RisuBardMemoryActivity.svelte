<script lang="ts">
    import { ActivityIcon, BotIcon, ChevronDownIcon, Clock3Icon, DownloadIcon, FileSearchIcon } from '@lucide/svelte'
    import type { Message } from 'src/ts/storage/database.svelte'
    import {
        RISUBARD_MEMORY_ACTIVITY_EVENT,
        getRecentRisuBardMemoryActivity,
        type RisuBardLiveActivity,
    } from 'src/ts/risubard/memoryActivity'
    import {
        addRetainedAssistantSummary,
        attachWikiInquiryDiagnostics,
        buildLegacyChatRequestEvidence,
        chatRequestFailureLabel,
        formatChatRequestEvidenceMarkdown,
        groupInjectionManifestItems,
        loadChatRequestEvidence,
        type ChatRequestEvidence,
    } from 'src/ts/risubard/chatRequestEvidence'
    import {
        REQUEST_LOG_RECORDED_EVENT,
        type RequestLogSource,
    } from 'src/ts/requestLog'
    import { requestPurposeLabels } from 'src/ts/requestPurpose'
    import { canonicalTurnFailureWarning } from 'src/ts/risubard/canonicalTurnReceipt'
    import type { RequestInjectionKind } from 'src/ts/status/requestStatus'
    import { downloadFile } from 'src/ts/globalApi.svelte'
    import { formatWikiInquiryDiagnostic } from 'src/ts/risubard/wikiInquiryDiagnostics'

    interface Props {
        characterId: string
        chatId: string
        messages: Message[]
        onSelectPath?: (path: string) => void
    }

    let { characterId, chatId, messages, onSelectPath }: Props = $props()
    let live = $state<RisuBardLiveActivity[]>([])
    let liveScope = $state('')
    let evidenceExporting = $state(false)
    let evidenceExportError = $state('')
    let evidenceLoading = $state(false)
    let evidenceLoadError = $state('')
    let evidenceLoadSequence = 0
    let storedEvidence = $state<ChatRequestEvidence | null>(null)
    let evidenceScope = $state('')
    let generationEntries = $derived(messages.flatMap((message) => {
        const info = message.generationInfo
        return message.role === 'char' && info?.risuBardContext
            ? [{
                messageId: message.chatId ?? info.generationId ?? 'unknown',
                generationId: info.generationId,
                timestamp: message.time,
                info,
            }]
            : []
    }).reverse())
    let requestEntries = $derived(attachWikiInquiryDiagnostics(storedEvidence?.requests ?? [], messages))
    let receiptEntries = $derived(messages.flatMap((message) => {
        const receipt = message.risubardCanonicalReceipt
        if (message.role !== 'char' || !receipt) return []
        const failed = canonicalTurnFailureWarning(receipt) !== undefined
        return [{
            id: message.chatId ?? receipt.recordedAt,
            timestamp: receipt.recordedAt,
            failed,
            eventCount: receipt.eventIds.length,
            changeCount: receipt.changes.length,
            message: receipt.warnings.join(' ') || [
                receipt.changes.length > 0
                    ? `정본 ${receipt.changes.length}건을 반영했습니다.`
                    : '확정 사실을 검사했으며 정본 변경은 없었습니다.',
                ...(receipt.notes ?? []),
            ].join(' '),
        }]
    }).reverse())
    let storedActivityEntries = $derived([
        ...requestEntries.map((request) => ({
            kind: 'request' as const,
            key: `request-${request.id}`,
            timestamp: request.timestamp,
            request,
        })),
        ...receiptEntries.map((receipt) => ({
            kind: 'receipt' as const,
            key: `receipt-${receipt.id}-${receipt.timestamp}`,
            timestamp: receipt.timestamp,
            receipt,
        })),
    ].sort((a, b) => {
        const byTimestamp = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        if (byTimestamp !== 0) return byTimestamp
        return b.key.localeCompare(a.key)
    }))
    let recordedGenerationIds = $derived(new Set(requestEntries.flatMap(
        (entry) => entry.generationId ? [entry.generationId] : []
    )))
    let entries = $derived(generationEntries.filter(
        (entry) => !recordedGenerationIds.has(entry.messageId)
            && (!entry.generationId || !recordedGenerationIds.has(entry.generationId))
    ))

    const formatNumber = (value: number | null | undefined) =>
        value == null ? '확인 불가' : value.toLocaleString()
    const duration = (timing: Message['generationInfo'] extends infer G
        ? G extends { stageTiming?: infer T } ? T : never
        : never) => {
        if (!timing) return undefined
        return Object.values(timing).reduce(
            (total, value) => total + (typeof value === 'number' ? value : 0),
            0
        )
    }
    const sourceLabels: Record<RequestLogSource, string> = {
        main: '답변 생성',
        memory: '위키 작업',
        'wiki-admin': '위키 관리자 명령',
        translate: '번역',
        emotion: '감정 분석',
        sub: '보조 작업',
        preview: '미리보기',
        test: '테스트',
        tts: '음성 생성',
        image: '이미지 생성',
        plugin: '플러그인 작업',
        other: '기타 요청',
    }
    const formatTimestamp = (value: string | number) =>
        new Date(value).toLocaleString('ko-KR')
    const formatDuration = (value: number | null | undefined) =>
        value == null ? '확인 불가' : value < 1_000
            ? `${value.toLocaleString()} ms`
            : `${(value / 1_000).toFixed(1)}초`
    const formatFirstTokenDuration = (value: number | null | undefined) =>
        value == null ? '확인 불가 ms' : formatDuration(value)
    const outcomeLabel = (outcome: ChatRequestEvidence['requests'][number]['outcome']) =>
        outcome === 'done' ? '성공'
            : outcome === 'response-received' ? '응답 수신'
            : outcome === 'aborted' ? '중단' : '요청 실패'
    const requestLabel = (request: ChatRequestEvidence['requests'][number]) =>
        request.purpose === 'chat-response'
            ? '스토리 생성'
            : request.purpose
                ? requestPurposeLabels[request.purpose]
                : sourceLabels[request.source]
    const injectionGroup: Record<RequestInjectionKind, string> = {
        systemPrompt: '시스템', jailbreak: '시스템', globalNote: '시스템',
        authorNote: '시스템', instruction: '시스템', tool: '시스템',
        character: '캐릭터', persona: '페르소나', lorebook: '로어북',
        grimoire: '그리모어', grimoireRequired: '그리모어',
        wiki: 'BardWiki', memory: 'BardWiki', exampleDialogue: '예시 대화',
        chatHistory: '채팅', other: '기타',
    }
    const injectionGroupOrder = [
        '시스템', '캐릭터', '페르소나', 'BardWiki', '그리모어', '로어북',
        '채팅', '예시 대화', '기타',
    ]
    const groupedInjectionTokens = (
        manifest: ChatRequestEvidence['requests'][number]['injectionManifest']
    ) => {
        if (!manifest) return []
        const grouped = new Map<string, number>()
        const displayItems = groupInjectionManifestItems(manifest)
        const chatItems = displayItems.filter((item) => item.kind === 'chatHistory')
        for (const item of displayItems) {
            if (item.kind === 'chatHistory') continue
            const label = injectionGroup[item.kind]
            grouped.set(label, (grouped.get(label) ?? 0) + item.tokens)
        }
        return injectionGroupOrder.flatMap((label) => {
            if (label === '채팅') {
                return chatItems.map((item) => ({
                    label: item.label.replace('채팅 기록 · ', '채팅 기록 '),
                    tokens: item.tokens,
                }))
            }
            const tokens = grouped.get(label) ?? 0
            return tokens > 0 ? [{ label, tokens }] : []
        })
    }
    const injectionItemLabel = (label: string) => label
        .replace('채팅 기록 · ', '채팅 기록 ')
        .replace('추가 지침 · ', '추가 지침 ')
    const legacyEvidence = () => buildLegacyChatRequestEvidence(
        chatId,
        generationEntries.map((entry) => ({
            timestamp: entry.timestamp,
            generationId: entry.info.generationId ?? entry.messageId,
            model: entry.info.model,
            inputTokens: entry.info.inputTokens,
            outputTokens: entry.info.outputTokens,
            durationMs: duration(entry.info.stageTiming),
            wikiTokens: entry.info.risuBardContext?.selectedTokens,
        })),
    )

    async function refreshStoredEvidence() {
        const targetChatId = chatId
        const sequence = ++evidenceLoadSequence
        evidenceLoading = true
        evidenceLoadError = ''
        try {
            const evidence = await loadChatRequestEvidence(targetChatId)
            if (evidenceScope === targetChatId && sequence === evidenceLoadSequence) {
                storedEvidence = evidence
            }
        } catch (error) {
            if (evidenceScope === targetChatId && sequence === evidenceLoadSequence) {
                evidenceLoadError = error instanceof Error
                    ? error.message
                    : '보존 요청 로그를 불러오지 못했습니다.'
            }
        } finally {
            if (sequence === evidenceLoadSequence) evidenceLoading = false
        }
    }

    async function exportRequestEvidence() {
        if (evidenceExporting) return
        evidenceExporting = true
        evidenceExportError = ''
        try {
            const persisted = await loadChatRequestEvidence(chatId)
            storedEvidence = persisted
            const baseEvidence = persisted.requestCount > 0
                ? persisted
                : legacyEvidence()
            if (baseEvidence.requestCount === 0) {
                evidenceExportError = '이 채팅에 저장된 요청 증거가 없습니다.'
                return
            }
            const evidence = await addRetainedAssistantSummary(
                baseEvidence,
                messages,
            )
            const stamp = evidence.generatedAt.replaceAll(':', '-').replaceAll('.', '-')
            await downloadFile(
                `risubard-chat-evidence-${stamp}.md`,
                formatChatRequestEvidenceMarkdown(evidence),
            )
        } catch (error) {
            evidenceExportError = error instanceof Error
                ? error.message
                : '요청 증거 파일을 만들지 못했습니다.'
        } finally {
            evidenceExporting = false
        }
    }

    $effect(() => {
        const scope = JSON.stringify([characterId, chatId])
        if (liveScope !== scope) {
            liveScope = scope
            live = getRecentRisuBardMemoryActivity(characterId, chatId)
        }
        if (evidenceScope !== chatId) {
            evidenceScope = chatId
            storedEvidence = null
            void refreshStoredEvidence()
        }
        const receive = (event: Event) => {
            const detail = (event as CustomEvent<RisuBardLiveActivity>).detail
            if (detail.characterId !== characterId || detail.chatId !== chatId) return
            live = [detail, ...live].slice(0, 50)
        }
        const receiveRecorded = (event: Event) => {
            const detail = (event as CustomEvent<{
                sessionChatIds?: string[]
            }>).detail
            if (!detail.sessionChatIds?.includes(chatId)) return
            void refreshStoredEvidence()
        }
        window.addEventListener(RISUBARD_MEMORY_ACTIVITY_EVENT, receive)
        window.addEventListener(REQUEST_LOG_RECORDED_EVENT, receiveRecorded)
        return () => {
            window.removeEventListener(RISUBARD_MEMORY_ACTIVITY_EVENT, receive)
            window.removeEventListener(REQUEST_LOG_RECORDED_EVENT, receiveRecorded)
        }
    })
</script>

<details class="activity-console" open data-memory-activity>
    <summary class="activity-heading">
        <ActivityIcon size={15} /> 작업 로그
    </summary>
    <div class="evidence-toolbar">
        <button
            type="button"
            data-export-request-evidence="markdown"
            aria-label="Markdown 다운로드"
            title="Markdown 다운로드"
            disabled={evidenceExporting}
            onclick={exportRequestEvidence}
        ><DownloadIcon size={14} /></button>
    </div>
    {#if evidenceLoadError}<div class="evidence-error" role="status">{evidenceLoadError}</div>{/if}
    {#if evidenceExportError}<div class="evidence-error" role="status">{evidenceExportError}</div>{/if}
    <div class="activity-stream">
        {#if live.length > 0}
            <details class="live-session">
                <summary class="section-toggle">
                    <span><Clock3Icon size={13} /> 이번 실행의 실시간 이벤트</span>
                    <small>{live.length}개 · 앱 재시작 시 초기화</small>
                    <span class="fold-icon"><ChevronDownIcon size={14} /></span>
                </summary>
                <div class="live-list">
                    {#each live as item (`${item.timestamp}-${item.operation}`)}
                        <article class="live-entry">
                            <div class="entry-title"><Clock3Icon size={13} /><strong>{item.message}</strong></div>
                            <time datetime={new Date(item.timestamp).toISOString()}>{formatTimestamp(item.timestamp)}</time>
                            {#if item.wikiPaths?.length}
                                <div class="path-list">
                                    {#each item.wikiPaths as path}
                                        <button type="button" onclick={() => onSelectPath?.(path)}>{path}</button>
                                    {/each}
                                </div>
                            {/if}
                        </article>
                    {/each}
                </div>
            </details>
        {/if}

        {#each storedActivityEntries as item (item.key)}
            {#if item.kind === 'receipt'}
                <article
                    class="result-entry"
                    data-outcome={item.receipt.failed ? 'failed' : 'done'}
                >
                    <div class="result-heading">
                        <strong>BardWiki 정본 반영</strong>
                        <span class="entry-type">정본 처리</span>
                        <time datetime={item.receipt.timestamp}>{formatTimestamp(item.receipt.timestamp)}</time>
                        <em class="outcome" data-outcome={item.receipt.failed ? 'failed' : 'done'}>
                            {item.receipt.failed ? '실패' : '완료'}
                        </em>
                    </div>
                    <p>{item.receipt.message}</p>
                    <small>사건 보존 {item.receipt.eventCount}건 · 정본 변경 {item.receipt.changeCount}건</small>
                </article>
            {:else}
            <details class="request-entry" data-request-source={item.request.source}>
                <summary class="request-summary">
                    <span class="summary-line">
                        <strong class="request-kind">{requestLabel(item.request)}</strong>
                        <span class="entry-type">AI 요청</span>
                        <time datetime={item.request.timestamp}>{formatTimestamp(item.request.timestamp)}</time>
                        <em class="outcome" data-outcome={item.request.outcome}>{outcomeLabel(item.request.outcome)}</em>
                    </span>
                    <span class="summary-data">
                        <span class="summary-metrics">
                            <b>입력 {formatNumber(item.request.inputTokens)}</b>
                            <b>출력 {formatNumber(item.request.outputTokens)}</b>
                            <b>소요 {formatDuration(item.request.durationMs)}</b>
                        </span>
                        {#if item.request.injectionManifest}
                            <span class="summary-groups">
                            {#each groupedInjectionTokens(item.request.injectionManifest) as group}
                                <b>{group.label} {formatNumber(group.tokens)}</b>
                            {/each}
                            </span>
                        {/if}
                    </span>
                    <span class="fold-icon"><ChevronDownIcon size={15} /></span>
                </summary>
                <div class="request-details">
                    {#if item.request.wikiInquiry}
                        <p data-wiki-inquiry>{formatWikiInquiryDiagnostic(item.request.wikiInquiry)}</p>
                    {/if}
                    <div class="metadata-grid">
                        <span><small>로그 ID</small><strong>#{item.request.id}</strong></span>
                        <span><small>모델</small><strong>{item.request.model ?? '확인 불가'}</strong></span>
                        <span><small>공급자</small><strong>{item.request.provider ?? '확인 불가'}</strong></span>
                        <span><small>생성 ID</small><code>{item.request.generationId ?? '확인 불가'}</code></span>
                        <span><small>로그 종류</small><strong>{item.request.source}</strong></span>
                        <span><small>첫 응답</small> <strong>{formatFirstTokenDuration(item.request.firstTokenMs)}</strong></span>
                        <span><small>추론 / 캐시</small><strong>{formatNumber(item.request.reasoningTokens)} / {formatNumber(item.request.cachedTokens)}</strong></span>
                        {#if item.request.selectedHistoryMessageCount !== undefined}
                            <span><small>선택 채팅</small><strong>{item.request.selectedHistoryMessageCount}개</strong></span>
                        {/if}
                    </div>
                    {#if item.request.injectionManifest}
                        <div class="composition">
                            <div class="detail-title">
                                입력 상세 · {formatNumber(item.request.injectionManifest.totalTokens)} tokens
                                {item.request.injectionManifest.estimated ? ' · 추정' : ''}
                            </div>
                            <div class="composition-list">
                                {#each groupInjectionManifestItems(item.request.injectionManifest) as injectionItem}
                                    {#if injectionItem.details}
                                    <details
                                        class="composition-group"
                                        data-injection-group={injectionItem.kind}
                                    >
                                        <summary>
                                            <span>{injectionItemLabel(injectionItem.label)}</span>
                                            <strong>{formatNumber(injectionItem.tokens)}</strong>
                                        </summary>
                                        <div class="composition-sublist">
                                            {#each injectionItem.details as detail}
                                                <span>
                                                    <span>{detail.label}</span>
                                                    <strong>{formatNumber(detail.tokens)}</strong>
                                                </span>
                                            {/each}
                                        </div>
                                    </details>
                                    {:else}
                                    <span>
                                        <span>{injectionItemLabel(injectionItem.label)}</span>
                                        <strong>{formatNumber(injectionItem.tokens)}</strong>
                                    </span>
                                    {/if}
                                {/each}
                            </div>
                        </div>
                    {/if}
                    {#if item.request.outcome === 'response-received'}
                        <p class="transport-note">
                            모델 응답을 받은 기록입니다. 검증·저장 결과는 시간순 로그의 정본 처리 항목을 확인하세요.
                        </p>
                    {:else if item.request.failureCategory}
                        <p class="transport-note" data-failure-category={item.request.failureCategory}>
                            오류 유형: {chatRequestFailureLabel(item.request.failureCategory)}
                        </p>
                    {/if}
                </div>
            </details>
            {/if}
        {/each}

        {#if entries.length > 0}
            <div class="section-label legacy-label">
                <span>채팅에 남은 구형 생성 기록</span>
                <small>상세 요청 행이 보존되기 전 기록</small>
            </div>
        {/if}
        {#each entries as entry (entry.messageId)}
            <details class="request-entry generation-entry">
                <summary class="request-summary">
                    <span class="summary-line">
                        <strong class="request-kind">답변 생성 · 구형</strong>
                        {#if entry.timestamp}
                            <time datetime={new Date(entry.timestamp).toISOString()}>{formatTimestamp(entry.timestamp)}</time>
                        {:else}
                            <time>시각 확인 불가</time>
                        {/if}
                    </span>
                    <span class="summary-metrics">
                        <b>입력 {formatNumber(entry.info.inputTokens)}</b>
                        <b>출력 {formatNumber(entry.info.outputTokens)}</b>
                        <b>소요 {formatDuration(duration(entry.info.stageTiming))}</b>
                    </span>
                    <span class="summary-groups">
                        <b>BardWiki {formatNumber(entry.info.risuBardContext?.selectedTokens)}</b>
                        <b>선택 채팅 {entry.info.risuBardContext?.recentMessages.length ?? 0}개</b>
                    </span>
                    <span class="fold-icon"><ChevronDownIcon size={15} /></span>
                </summary>
                <div class="request-details">
                    <div class="metadata-grid">
                        <span><small>모델</small><strong>{entry.info.model ?? '확인 불가'}</strong></span>
                        <span><small>생성 ID</small><code>{entry.messageId}</code></span>
                        <span><small>검색</small><strong>{formatDuration(entry.info.risuBardContext?.inquiryDurationMs)}</strong></span>
                        <span><small>도구</small><strong>{entry.info.toolUsed ? '사용' : '없음'}</strong></span>
                    </div>
                    {#if entry.info.risuBardContext?.wikiInquiry}
                        <p data-wiki-inquiry>{formatWikiInquiryDiagnostic(entry.info.risuBardContext.wikiInquiry)}</p>
                    {/if}
                    <div class="trace-grid">
                        <div>
                            <div class="detail-title">최근 원문 메시지</div>
                            <div class="chips">
                                {#each entry.info.risuBardContext?.recentMessages ?? [] as recent}
                                    <code>{recent.role} · {recent.id}</code>
                                {/each}
                            </div>
                        </div>
                        <div>
                            <div class="detail-title"><FileSearchIcon size={12} /> 컨텍스트 문서</div>
                            <div class="path-list">
                                {#each entry.info.risuBardContext?.wikiPaths ?? [] as path}
                                    <button type="button" onclick={() => onSelectPath?.(path)}>{path}</button>
                                {:else}
                                    <span>선택된 문서 없음</span>
                                {/each}
                            </div>
                        </div>
                    </div>
                </div>
            </details>
        {/each}

        {#if live.length === 0 && storedActivityEntries.length === 0 && entries.length === 0}
            <div class="empty">이 채팅에 보존된 요청 기록이 없습니다.</div>
        {/if}
    </div>
</details>

<style>
    .activity-console { --activity-font-step: 3px; display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; border-top: 1px solid var(--risu-theme-darkborderc); background: color-mix(in srgb, var(--risu-theme-darkbg) 97%, var(--color-bgcolor)); }
    .activity-heading { display: flex; align-items: center; gap: .45rem; padding: .62rem .85rem; cursor: pointer; color: var(--risu-theme-textcolor); font-size: calc(.74rem + var(--activity-font-step)); font-weight: 800; list-style: none; }
    .evidence-toolbar { display: flex; justify-content: flex-end; padding: 0 .75rem .55rem; color: var(--risu-theme-textcolor2); font-size: calc(.64rem + var(--activity-font-step)); }
    .evidence-toolbar button { display: inline-flex; align-items: center; gap: .25rem; padding: .25rem .42rem; border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 26%, var(--risu-theme-darkborderc)); border-radius: .3rem; color: var(--risu-theme-primary); background: color-mix(in srgb, var(--risu-theme-primary) 8%, transparent); font-size: calc(.62rem + var(--activity-font-step)); }
    .evidence-toolbar button:hover:not(:disabled) { background: color-mix(in srgb, var(--risu-theme-primary) 16%, transparent); }
    .evidence-toolbar button:disabled { opacity: .55; }
    .evidence-error { margin: 0 .75rem .55rem; padding: .42rem .55rem; border-left: 2px solid var(--risu-theme-error); color: var(--risu-theme-error); background: color-mix(in srgb, var(--risu-theme-error) 7%, transparent); font-size: calc(.64rem + var(--activity-font-step)); }
    .activity-stream { display: grid; flex: 1; align-content: start; min-height: 0; overflow: auto; gap: .46rem; padding: 0 .75rem .75rem; }
    .section-label { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; padding: .38rem .1rem .05rem; color: var(--risu-theme-textcolor); font-size: calc(.66rem + var(--activity-font-step)); font-weight: 800; letter-spacing: .02em; }
    .section-label small { color: var(--risu-theme-textcolor2); font-size: calc(.58rem + var(--activity-font-step)); font-weight: 500; }
    .legacy-label { margin-top: .2rem; }
    .live-session { border: 1px dashed color-mix(in srgb, var(--risu-theme-textcolor2) 28%, transparent); border-radius: .45rem; background: color-mix(in srgb, var(--risu-theme-textcolor2) 3%, transparent); }
    .section-toggle { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: .5rem; padding: .52rem .62rem; cursor: pointer; list-style: none; }
    .section-toggle > span { display: flex; align-items: center; gap: .35rem; color: var(--risu-theme-textcolor); font-size: calc(.65rem + var(--activity-font-step)); font-weight: 750; }
    .section-toggle small { color: var(--risu-theme-textcolor2); font-size: calc(.58rem + var(--activity-font-step)); }
    .live-list { display: grid; gap: .35rem; padding: 0 .45rem .45rem; }
    .live-entry { display: grid; gap: .35rem; padding: .5rem .58rem; border-radius: .35rem; background: color-mix(in srgb, var(--risu-theme-darkbg) 88%, transparent); }
    .result-entry { display: grid; gap: .3rem; padding: .58rem .72rem; border: 1px solid color-mix(in srgb, var(--color-success) 30%, var(--risu-theme-darkborderc)); border-radius: .48rem; background: color-mix(in srgb, var(--color-success) 5%, var(--risu-theme-darkbg)); }
    .result-entry[data-outcome='failed'] { border-color: color-mix(in srgb, var(--risu-theme-error) 45%, var(--risu-theme-darkborderc)); background: color-mix(in srgb, var(--risu-theme-error) 6%, var(--risu-theme-darkbg)); }
    .result-heading { display: flex; align-items: center; flex-wrap: wrap; gap: .35rem .45rem; }
    .result-heading strong { font-size: calc(.68rem + var(--activity-font-step)); }
    .result-entry p { margin: 0; color: var(--risu-theme-textcolor); font-size: calc(.61rem + var(--activity-font-step)); line-height: 1.45; }
    .result-entry > small { color: var(--risu-theme-textcolor2); font-size: calc(.58rem + var(--activity-font-step)); }
    .request-entry { position: relative; overflow: hidden; border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 19%, var(--risu-theme-darkborderc)); border-radius: .48rem; background: color-mix(in srgb, var(--risu-theme-darkbg) 93%, transparent); }
    .request-entry::before { position: absolute; inset: 0 auto 0 0; width: 2px; content: ''; background: color-mix(in srgb, var(--risu-theme-primary) 72%, transparent); }
    .request-summary { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .35rem .6rem; padding: .58rem .72rem .58rem .78rem; cursor: pointer; list-style: none; }
    .request-summary:hover { background: color-mix(in srgb, var(--risu-theme-primary) 5%, transparent); }
    .summary-line, .summary-data, .summary-metrics, .summary-groups { display: flex; align-items: center; flex-wrap: wrap; gap: .3rem .42rem; min-width: 0; }
    .summary-line { grid-column: 1; }
    .summary-line time { color: var(--risu-theme-textcolor2); font-size: calc(.61rem + var(--activity-font-step)); }
    .request-kind { color: var(--risu-theme-textcolor); font-size: calc(.68rem + var(--activity-font-step)); font-weight: 850; }
    .outcome { padding: .12rem .32rem; border-radius: 999px; font-size: calc(.56rem + var(--activity-font-step)); font-style: normal; font-weight: 800; }
    .outcome[data-outcome='done'] { color: var(--color-success); background: color-mix(in srgb, var(--color-success) 10%, transparent); }
    .outcome[data-outcome='response-received'] { color: var(--risu-theme-primary); background: color-mix(in srgb, var(--risu-theme-primary) 10%, transparent); }
    .outcome[data-outcome='failed'] { color: var(--risu-theme-error); background: color-mix(in srgb, var(--risu-theme-error) 10%, transparent); }
    .outcome[data-outcome='aborted'] { color: var(--risu-theme-textcolor2); background: color-mix(in srgb, var(--risu-theme-textcolor2) 9%, transparent); }
    .summary-data { grid-column: 1; }
    .summary-metrics b, .summary-groups b { padding: .16rem .34rem; border-radius: .26rem; font: 400 calc(.6rem + var(--activity-font-step)) ui-monospace, monospace; }
    .summary-metrics b { color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-textcolor2) 8%, transparent); }
    .summary-groups b { color: var(--risu-theme-textcolor2); border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 13%, transparent); background: color-mix(in srgb, var(--risu-theme-primary) 4%, transparent); }
    .fold-icon { grid-column: 2; grid-row: 1 / -1; align-self: center; color: var(--risu-theme-textcolor2); transition: transform .16s ease, color .16s ease; }
    details[open] > summary .fold-icon { transform: rotate(180deg); color: var(--risu-theme-primary); }
    .request-details { display: grid; gap: .62rem; padding: .62rem .72rem .72rem .78rem; border-top: 1px solid color-mix(in srgb, var(--risu-theme-primary) 12%, var(--risu-theme-darkborderc)); background: color-mix(in srgb, var(--color-bgcolor) 7%, transparent); }
    .metadata-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .4rem; }
    .metadata-grid > span { display: grid; gap: .16rem; min-width: 0; padding: .38rem .44rem; border-radius: .32rem; background: color-mix(in srgb, var(--risu-theme-textcolor2) 5%, transparent); }
    .metadata-grid small { color: var(--risu-theme-textcolor2); font-size: calc(.54rem + var(--activity-font-step)); text-transform: uppercase; letter-spacing: .06em; }
    .metadata-grid strong, .metadata-grid code { overflow: hidden; color: var(--risu-theme-textcolor); font-size: calc(.61rem + var(--activity-font-step)); font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
    .composition { display: grid; gap: .35rem; }
    .detail-title { display: flex; align-items: center; gap: .3rem; color: var(--risu-theme-textcolor2); font-size: calc(.58rem + var(--activity-font-step)); font-weight: 400; text-transform: uppercase; letter-spacing: .055em; }
    .composition-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .24rem .55rem; }
    .composition-list > span { display: flex; align-items: baseline; justify-content: space-between; gap: .55rem; min-width: 0; padding: .25rem .32rem; border-bottom: 1px dotted color-mix(in srgb, var(--risu-theme-textcolor2) 18%, transparent); color: var(--risu-theme-textcolor2); font-size: calc(.59rem + var(--activity-font-step)); }
    .composition-list > span > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .composition-list strong { flex: 0 0 auto; color: var(--risu-theme-textcolor); font: 400 calc(.58rem + var(--activity-font-step)) ui-monospace, monospace; }
    .composition-group { min-width: 0; border-bottom: 1px dotted color-mix(in srgb, var(--risu-theme-textcolor2) 18%, transparent); color: var(--risu-theme-textcolor2); font-size: calc(.59rem + var(--activity-font-step)); }
    .composition-group > summary, .composition-sublist > span { display: flex; align-items: baseline; justify-content: space-between; gap: .55rem; min-width: 0; padding: .25rem .32rem; }
    .composition-group > summary { cursor: pointer; list-style: none; }
    .composition-group > summary > span, .composition-sublist > span > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .composition-sublist { display: grid; padding: 0 0 .2rem .55rem; color: color-mix(in srgb, var(--risu-theme-textcolor2) 82%, transparent); }
    .transport-note { margin: 0; padding: .4rem .5rem; border-left: 2px solid var(--risu-theme-primary); color: var(--risu-theme-textcolor2); background: color-mix(in srgb, var(--risu-theme-primary) 5%, transparent); font-size: calc(.58rem + var(--activity-font-step)); line-height: 1.4; }
    .entry-title { display: flex; align-items: center; gap: .38rem; }
    .entry-title strong { font-size: calc(.64rem + var(--activity-font-step)); }
    time, .empty, .path-list span { color: var(--risu-theme-textcolor2); font-size: calc(.61rem + var(--activity-font-step)); }
    .chips, .path-list { display: flex; flex-wrap: wrap; gap: .28rem .4rem; }
    .chips code { padding: .18rem .35rem; border-radius: .25rem; color: var(--risu-theme-textcolor2); background: color-mix(in srgb, var(--risu-theme-textcolor2) 7%, transparent); font-size: calc(.58rem + var(--activity-font-step)); }
    .trace-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .65rem; }
    .trace-grid > div { display: grid; align-content: start; gap: .3rem; min-width: 0; }
    .path-list button { max-width: 100%; overflow: hidden; text-overflow: ellipsis; padding: .18rem .35rem; border-radius: .25rem; color: var(--risu-theme-primary); background: color-mix(in srgb, var(--risu-theme-primary) 10%, transparent); font: calc(.58rem + var(--activity-font-step)) ui-monospace, monospace; text-align: left; }
    .path-list button:hover { background: color-mix(in srgb, var(--risu-theme-primary) 18%, transparent); }
    .empty { padding: 1rem; border: 1px dashed color-mix(in srgb, var(--risu-theme-textcolor2) 20%, transparent); border-radius: .45rem; text-align: center; }
    @media (max-width: 720px) {
        .metadata-grid, .composition-list, .trace-grid { grid-template-columns: 1fr; }
        .summary-line time { flex-basis: 100%; }
    }
</style>
