<script lang="ts">
    import { language } from 'src/lang'
    import { tooltip } from 'src/ts/gui/tooltip'
    import tippy from 'tippy.js'
    import type { Chat, character as Character } from 'src/ts/storage/database.svelte'
    import type { RisuBardChatSettings } from 'src/ts/risubard/risuBardSettings'
    import { normalizeRisuBardDynamicMemoryMode, resolveRisuBardChatSettings } from 'src/ts/risubard/risuBardSettings'
    import { dynamicMemoryGrowth, measureActiveMemoryCharacters, resolveDynamicMemoryBudget } from 'src/ts/risubard/dynamicMemoryBudget'
    import {
        MEMORY_BUDGET_PRESETS,
        MEMORY_BUDGET_PRESET_IDS,
        detectMemoryBudgetPreset,
        memoryBudgetPresetValues,
        type MemoryBudgetPresetId,
    } from 'src/ts/risubard/memoryBudgetPreset'
    import {
        applyCurrentRisuBardSettingsToGlobal,
        buildRisuBardChatSettingHelp,
        formatRisuBardChatProfile,
        measureRisuBardChat,
        type RisuBardChatSettingHelpKey,
        type RisuBardChatSettingKey,
    } from 'src/ts/risubard/chatSettingsHelp'
    import {
        normalizeWikiWritingLanguage,
        wikiWritingLanguageOptions,
        wikiWritingLocales,
    } from 'src/ts/risubard/wikiWritingLanguage'

    interface Props {
        chat?: Chat
        character?: Pick<Character, 'risuBardPinnedSettings'>
        global: RisuBardChatSettings
        globalDynamicOnly?: boolean
    }

    let { chat, global, character, globalDynamicOnly = false }: Props = $props()
    let revision = $state(0)
    let globalFeedback = $state('')
    let settings = $derived.by(() => {
        revision
        return globalDynamicOnly ? resolveRisuBardChatSettings(global) : resolveRisuBardChatSettings(global, chat?.risuBardSettings, character?.risuBardPinnedSettings)
    })
    let pinned = $derived.by(() => {
        revision
        return character?.risuBardPinnedSettings !== undefined
    })
    let hasOverrides = $derived.by(() => {
        revision
        return pinned || Boolean(chat?.risuBardSettings
            && Object.keys(chat.risuBardSettings).length > 0)
    })
    let profile = $derived(measureRisuBardChat(chat?.message ?? []))
    let dynamicCharacters = $derived(settings.risuBardDynamicMemoryMode === 'off' ? 0 : measureActiveMemoryCharacters(chat?.message ?? [], true))
    let dynamicBudget = $derived(resolveDynamicMemoryBudget(settings, dynamicCharacters))
    type DynamicKey = 'risuBardInquiryTargetTokenBudget' | 'risuBardInquiryEventTokenBudget' | 'risuBardInquiryMaximumTokenBudget' | 'risuBardAnalysisTokenLimit'
    let editingKey = $state<DynamicKey | null>(null)
    let numberDraft = $state('')
    const formatNumber = (value: number) => value.toLocaleString('ko-KR')
    const dynamicModeLabels = { off: '사용 안 함', economy: '절약형', balanced: '균형형', recall: '회수 우선형' } as const

    // The selection is derived from the six stored values; only choosing 커스텀 keeps the fields open without changing them.
    let customOpen = $state(false)
    let presetSelection = $derived<MemoryBudgetPresetId | 'custom'>(customOpen ? 'custom' : detectMemoryBudgetPreset(settings))
    let showBudgetFields = $derived(globalDynamicOnly || presetSelection === 'custom')
    // One entry per label and value pair, so the summary can wrap between pairs but never inside one.
    let presetSummaryParts = $derived(presetSelection === 'custom' ? [] : [
        `검색 목표 ${formatNumber(settings.risuBardInquiryTargetTokenBudget)}`,
        `사건 ${formatNumber(settings.risuBardInquiryEventTokenBudget)}`,
        `자료별 ${formatNumber(settings.risuBardInquirySourceTokenBudget)}`,
        `최대 ${formatNumber(settings.risuBardInquiryMaximumTokenBudget)}`,
        `동적 한도 ${dynamicModeLabels[settings.risuBardDynamicMemoryMode]}`,
    ])

    function effectiveValue(key: RisuBardChatSettingKey): number | undefined {
        switch (key) {
            case 'risuBardInquiryTargetTokenBudget': return dynamicBudget.target
            case 'risuBardInquiryEventTokenBudget': return dynamicBudget.events
            case 'risuBardInquiryMaximumTokenBudget': return dynamicBudget.maximum
            case 'risuBardAnalysisTokenLimit': return dynamicBudget.analysis
        }
    }

    function dynamicValueHelp(key: RisuBardChatSettingKey): string {
        const effective = effectiveValue(key)
        const base = Number(settings[key])
        if (effective === undefined || effective === base) return ''
        const percent = base ? ((effective - base) / base * 100).toFixed(1) : '0'
        const capped = effective < base + Math.round(base * dynamicMemoryGrowth(settings.risuBardDynamicMemoryMode, dynamicCharacters))
        const label = key === 'risuBardAnalysisTokenLimit' ? '동적 요청' : '동적 한도'
        return `기본값 ${formatNumber(base)} → ${label} ${formatNumber(effective)} (+${percent}%)${capped ? '\n검색 증가 상한 적용' : ''}\n입력칸에서 기본값을 변경합니다.${key === 'risuBardAnalysisTokenLimit' ? '\n모델 출력 상한에 따라 요청값이 줄어들 수 있습니다.' : ''}`
    }

    function dynamicModeHelp(): string {
        const example = (mode: 'economy' | 'balanced' | 'recall', characters: number) => {
            return `+${Number((dynamicMemoryGrowth(mode, characters) * 100).toFixed(1))}%`
        }
        return [
            '현재 챗의 활성 AI 응답 본문 길이에 따라 검색 목표 토큰, 사건 검색 토큰, 검색 최대 토큰과 분석 토큰 한도를 늘립니다.',
            '처음부터 조금씩 늘고 증가 폭이 점차 줄어들며, 누적 50만 자에서 멈춥니다. AI 응답이 1,000자씩일 때의 기본값 대비 증가율:',
            `절약형: 50턴 ${example('economy', 50_000)}, 100턴 ${example('economy', 100_000)}, 500턴부터 ${example('economy', 500_000)}`,
            `균형형: 50턴 ${example('balanced', 50_000)}, 100턴 ${example('balanced', 100_000)}, 500턴부터 ${example('balanced', 500_000)}`,
            `회수 우선형: 50턴 ${example('recall', 50_000)}, 100턴 ${example('recall', 100_000)}, 500턴부터 ${example('recall', 500_000)}`,
            '검색 최대 토큰에는 검색 증가 상한도 적용합니다. 입력칸은 저장할 기본값이며, 아래에 동적으로 계산된 값을 표시합니다. 분석 요청값은 모델 출력 상한에 따라 줄어들 수 있습니다.',
        ].join('\n\n')
    }

    function settingHelp(key: RisuBardChatSettingHelpKey): string {
        if (key === 'risuBardMemoryBudgetPreset') return buildRisuBardChatSettingHelp(key, profile)
        if (key === 'risuBardDynamicMemoryMode') return dynamicModeHelp()
        if (key === 'risuBardDynamicMemoryMaximumTokens') return '검색 최대 토큰이 동적으로 늘어날 수 있는 상한입니다. 기본값이 이 값보다 크면 기본값을 유지합니다. 분석 토큰 한도는 모드별 최대 증가율을 따릅니다.'
        return [dynamicValueHelp(key), buildRisuBardChatSettingHelp(key, profile)].filter(Boolean).join('\n\n')
    }

    function helpTooltip(node: HTMLElement, content: string) {
        const instance = tippy(node, {
            content, theme: 'risubard', animation: 'fade', arrow: true,
            trigger: 'mouseenter focus click',
        })
        return {
            update(content: string) { instance.setContent(content) },
            destroy() { instance.destroy() },
        }
    }

    function setValue<K extends keyof RisuBardChatSettings>(
        key: K,
        value: RisuBardChatSettings[K],
    ) {
        if (!chat && !globalDynamicOnly) return
        const target = globalDynamicOnly ? global : character?.risuBardPinnedSettings ?? (chat!.risuBardSettings ??= {})
        target[key] = value
        globalFeedback = ''
        revision++
    }

    function setNumber(key: keyof RisuBardChatSettings, event: Event) {
        setValue(key, Number((event.currentTarget as HTMLInputElement).value))
    }

    function selectMemoryBudgetPreset(value: string) {
        if (!chat && !globalDynamicOnly) return
        if (value === 'custom') {
            customOpen = true
            return
        }
        const id = MEMORY_BUDGET_PRESET_IDS.find((candidate) => candidate === value)
        if (!id) return
        const values = memoryBudgetPresetValues(id)
        setValue('risuBardInquiryTargetTokenBudget', values.risuBardInquiryTargetTokenBudget)
        setValue('risuBardInquiryEventTokenBudget', values.risuBardInquiryEventTokenBudget)
        setValue('risuBardInquirySourceTokenBudget', values.risuBardInquirySourceTokenBudget)
        setValue('risuBardInquiryMaximumTokenBudget', values.risuBardInquiryMaximumTokenBudget)
        setValue('risuBardDynamicMemoryMode', values.risuBardDynamicMemoryMode)
        setValue('risuBardDynamicMemoryMaximumTokens', values.risuBardDynamicMemoryMaximumTokens)
        customOpen = false
    }

    function setPinned(event: Event) {
        if (!chat || !character) return
        if ((event.currentTarget as HTMLInputElement).checked) {
            character.risuBardPinnedSettings = { ...settings }
        } else {
            chat.risuBardSettings = { ...settings }
            delete character.risuBardPinnedSettings
        }
        globalFeedback = ''
        revision++
    }

    function applyToGlobal() {
        if (!chat || !hasOverrides) return
        applyCurrentRisuBardSettingsToGlobal(global, settings)
        delete chat.risuBardSettings
        globalFeedback = '현재 값을 전역 설정에 적용했습니다.'
        revision++
    }

    function resetToGlobal() {
        if (!chat) return
        if (pinned && character) character.risuBardPinnedSettings = resolveRisuBardChatSettings(global)
        delete chat.risuBardSettings
        globalFeedback = ''
        revision++
    }
</script>

{#snippet settingTitle(
    key: RisuBardChatSettingHelpKey,
    title: string,
    controlId: string,
)}
    <span class="setting-heading">
        <label for={controlId}>{title}</label>
        <button
            type="button"
            class="help-button"
            data-chat-setting-help={key}
            data-help-text={settingHelp(key)}
            aria-label={`${title} 도움말`}
            use:helpTooltip={settingHelp(key)}
        >?</button>
    </span>
{/snippet}

{#snippet dynamicNumber(key: DynamicKey, id: string, min = 256, max?: number)}
    <div class="dynamic-number">
        <input {id} type="number" {min} {max}
            value={editingKey === key ? numberDraft : settings[key]}
            aria-describedby={[
                settings.risuBardDynamicMemoryMode !== 'off' ? `${id}-dynamic` : '',
                editingKey === key ? `${id}-editing` : '',
            ].filter(Boolean).join(' ') || undefined}
            use:tooltip={dynamicValueHelp(key)}
            onfocus={(event) => {
                editingKey = key
                numberDraft = String(settings[key])
                event.currentTarget.value = numberDraft
            }}
            oninput={(event) => numberDraft = event.currentTarget.value}
            onblur={() => {
                if (editingKey !== key) return
                const value = Number(numberDraft)
                if (numberDraft.trim() && Number.isFinite(value)) {
                    const next = Math.min(max ?? Infinity, Math.max(min, Math.floor(value)))
                    if (next !== settings[key]) setValue(key, next)
                }
                editingKey = null
            }}
            onkeydown={(event) => {
                if (event.key === 'Escape') { editingKey = null; event.currentTarget.blur() }
                if (event.key === 'Enter') event.currentTarget.blur()
            }} />
        {#if settings.risuBardDynamicMemoryMode !== 'off'}
            <small id={`${id}-dynamic`} class="dynamic-value">
                {key === 'risuBardAnalysisTokenLimit' ? '동적 요청' : '동적 한도'} {formatNumber(effectiveValue(key)!)} 토큰
                {#if key === 'risuBardAnalysisTokenLimit'}
                    <span class="dynamic-note">모델 출력 상한에 따라 줄어들 수 있습니다.</span>
                {/if}
            </small>
        {/if}
        {#if editingKey === key}<small id={`${id}-editing`} class="editing-hint">기본값 편집 중</small>{/if}
    </div>
{/snippet}

<div class="chat-settings" data-chat-risubard-settings>
    {#if !globalDynamicOnly}
    <header class="settings-head">
        <div class="settings-title">
            <strong>현재 챗 설정</strong>
            <small>{formatRisuBardChatProfile(profile)}</small>
        </div>
        <div class="settings-actions">
            <label class="toggle-control" use:tooltip={'현재 설정을 이 봇의 기존 챗과 새 챗에 공통 적용합니다. 고정 중 변경한 옵션도 함께 반영됩니다. 해제하면 현재 챗은 값을 유지하고 다른 챗은 기존 개별 설정으로 돌아갑니다.'}>
                <input type="checkbox" data-pin-chat-settings-character checked={pinned}
                    disabled={!chat || !character} onchange={setPinned} />
                <span>이 봇에 고정</span>
            </label>
            <button type="button" class="primary-action" data-apply-chat-settings-global
                disabled={!hasOverrides} use:tooltip={'현재 BardWiki 값을 전역 기본값으로 저장합니다. 봇 고정 상태는 유지합니다.'}
                onclick={applyToGlobal}>전역값으로 적용</button>
            <button type="button" data-reset-chat-settings-global disabled={!hasOverrides}
                use:tooltip={pinned ? '이 봇의 고정 설정을 현재 전역 기본값으로 바꿉니다.' : '이 챗의 개별 설정을 지우고 전역 기본값을 사용합니다.'}
                onclick={resetToGlobal}>전역값 사용</button>
        </div>
        {#if globalFeedback}<small class="global-feedback" role="status">{globalFeedback}</small>{/if}
    </header>
    {/if}

    <section class="settings-section" aria-label={globalDynamicOnly ? '장기기억 동적 한도' : '기억 예산'}>
        <div class="settings-grid">
            {#if !globalDynamicOnly}
                <div class="setting-field preset-field" data-chat-setting-field="risuBardMemoryBudgetPreset">
                    <div class="preset-controls">
                        {@render settingTitle('risuBardMemoryBudgetPreset', '기억 예산', 'bardwiki-memory-budget')}
                        <select id="bardwiki-memory-budget" value={presetSelection} disabled={!chat}
                            aria-describedby={presetSummaryParts.length ? 'bardwiki-memory-budget-summary' : undefined}
                            onchange={(event) => selectMemoryBudgetPreset(event.currentTarget.value)}>
                            {#each MEMORY_BUDGET_PRESET_IDS as id (id)}
                                <option value={id}>{MEMORY_BUDGET_PRESETS[id].label}</option>
                            {/each}
                            <option value="custom">커스텀</option>
                        </select>
                    </div>
                    {#if presetSummaryParts.length}
                        <small id="bardwiki-memory-budget-summary" class="budget-summary">{#each presetSummaryParts as part, index}{#if index > 0}{' / '}{/if}<span class="summary-part">{part}</span>{/each}</small>
                    {/if}
                </div>
            {/if}
            {#if showBudgetFields}
                <div class="setting-field dynamic-field" data-chat-setting-field="risuBardDynamicMemoryMode">
                    {@render settingTitle('risuBardDynamicMemoryMode', '장기기억 동적 한도', 'bardwiki-dynamic-memory')}
                    <select id="bardwiki-dynamic-memory" value={settings.risuBardDynamicMemoryMode} disabled={!chat && !globalDynamicOnly}
                        onchange={(event) => setValue('risuBardDynamicMemoryMode', normalizeRisuBardDynamicMemoryMode(event.currentTarget.value))}>
                        <option value="off">사용 안 함</option><option value="economy">절약형</option>
                        <option value="balanced">균형형</option><option value="recall">회수 우선형</option>
                    </select>
                </div>
                {#if settings.risuBardDynamicMemoryMode !== 'off'}
                    <div class="setting-field" data-chat-setting-field="risuBardDynamicMemoryMaximumTokens">
                        {@render settingTitle('risuBardDynamicMemoryMaximumTokens', '검색 증가 상한', 'bardwiki-dynamic-maximum')}
                        <input id="bardwiki-dynamic-maximum" type="number" min="256" value={settings.risuBardDynamicMemoryMaximumTokens}
                            onchange={(event) => setNumber('risuBardDynamicMemoryMaximumTokens', event)} />
                    </div>
                {/if}
            {/if}
        </div>
    </section>

    {#if !globalDynamicOnly}
    <section class="settings-section" aria-labelledby="bardwiki-operation-settings">
        <h3 id="bardwiki-operation-settings">작동 방식</h3>
        <div class="settings-grid">
            <div class="setting-field" data-chat-setting-field="risuBardModelMode">
                {@render settingTitle('risuBardModelMode', '작업 모델', 'bardwiki-model-mode')}
                <select id="bardwiki-model-mode" data-memory-model-mode value={settings.risuBardModelMode}
                    onchange={(event) => setValue('risuBardModelMode', (event.currentTarget as HTMLSelectElement).value === 'model' ? 'model' : 'memory')}>
                    <option value="memory">보조 모델</option><option value="model">메인 모델</option>
                </select>
            </div>
            <div class="setting-field" data-chat-setting-field="showRequestStatus">
                {@render settingTitle('showRequestStatus', '요청 컨텍스트 상태 표시', 'bardwiki-request-status')}
                <label class="toggle-control" for="bardwiki-request-status">
                    <input id="bardwiki-request-status" type="checkbox" checked={settings.showRequestStatus}
                        onchange={(event) => setValue('showRequestStatus', (event.currentTarget as HTMLInputElement).checked)} />
                    <span>{settings.showRequestStatus ? '표시' : '숨김'}</span>
                </label>
            </div>
            <div class="setting-field featured" data-chat-setting-field="risuBardBardChanEnabled">
                {@render settingTitle('risuBardBardChanEnabled', '바드쨩 (Bard-chan)', 'bardwiki-bard-chan')}
                <label class="toggle-control" for="bardwiki-bard-chan">
                    <input id="bardwiki-bard-chan" type="checkbox" checked={settings.risuBardBardChanEnabled}
                        onchange={(event) => setValue('risuBardBardChanEnabled', (event.currentTarget as HTMLInputElement).checked)} />
                    <span>{settings.risuBardBardChanEnabled ? '사용' : '사용 안 함'}</span>
                </label>
            </div>
            <div class="setting-field featured" data-chat-setting-field="risuBardBardChanModelMode">
                {@render settingTitle('risuBardBardChanModelMode', '바드쨩 모델', 'bardwiki-bard-chan-model')}
                <select id="bardwiki-bard-chan-model" value={settings.risuBardBardChanModelMode}
                    onchange={(event) => setValue('risuBardBardChanModelMode', (event.currentTarget as HTMLSelectElement).value === 'model' ? 'model' : 'memory')}>
                    <option value="memory">보조 모델</option><option value="model">메인 모델</option>
                </select>
            </div>
        </div>
    </section>

    <section class="settings-section" aria-labelledby="bardwiki-search-settings">
        <h3 id="bardwiki-search-settings">검색</h3>
        <div class="settings-grid">
            {#if showBudgetFields}
                <div class="setting-field" data-chat-setting-field="risuBardInquiryTargetTokenBudget">
                    {@render settingTitle('risuBardInquiryTargetTokenBudget', '검색 목표 토큰', 'bardwiki-target-tokens')}
                    {@render dynamicNumber('risuBardInquiryTargetTokenBudget', 'bardwiki-target-tokens')}
                </div>
                <div class="setting-field" data-chat-setting-field="risuBardInquiryEventTokenBudget">
                    {@render settingTitle('risuBardInquiryEventTokenBudget', '사건 검색 토큰', 'bardwiki-event-tokens')}
                    {@render dynamicNumber('risuBardInquiryEventTokenBudget', 'bardwiki-event-tokens')}
                </div>
                <div class="setting-field" data-chat-setting-field="risuBardInquirySourceTokenBudget">
                    {@render settingTitle('risuBardInquirySourceTokenBudget', '자료별 검색 토큰', 'bardwiki-source-tokens')}
                    <input id="bardwiki-source-tokens" type="number" min="256" value={settings.risuBardInquirySourceTokenBudget} onchange={(event) => setNumber('risuBardInquirySourceTokenBudget', event)} />
                </div>
                <div class="setting-field" data-chat-setting-field="risuBardInquiryMaximumTokenBudget">
                    {@render settingTitle('risuBardInquiryMaximumTokenBudget', '검색 최대 토큰', 'bardwiki-maximum-tokens')}
                    {@render dynamicNumber('risuBardInquiryMaximumTokenBudget', 'bardwiki-maximum-tokens')}
                </div>
            {/if}
            <div class="setting-field" data-chat-setting-field="risuBardInquiryTimeoutMs">
                {@render settingTitle('risuBardInquiryTimeoutMs', '위키 조회 제한 시간(ms)', 'bardwiki-timeout')}
                <input id="bardwiki-timeout" type="number" min="1" max="10000" value={settings.risuBardInquiryTimeoutMs} onchange={(event) => setNumber('risuBardInquiryTimeoutMs', event)} />
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardHistoricalSourceMatchLimit">
                {@render settingTitle('risuBardHistoricalSourceMatchLimit', '과거 원문 최대 수', 'bardwiki-history-limit')}
                <input id="bardwiki-history-limit" type="number" min="0" max="32" value={settings.risuBardHistoricalSourceMatchLimit} onchange={(event) => setNumber('risuBardHistoricalSourceMatchLimit', event)} />
            </div>
        </div>
    </section>

    <section class="settings-section" aria-labelledby="bardwiki-analysis-settings">
        <h3 id="bardwiki-analysis-settings">분석 · 응답</h3>
        <div class="settings-grid">
            <div class="setting-field" data-chat-setting-field="risuBardAnalysisTokenLimit">
                {@render settingTitle('risuBardAnalysisTokenLimit', '분석 토큰 한도', 'bardwiki-analysis-tokens')}
                {@render dynamicNumber('risuBardAnalysisTokenLimit', 'bardwiki-analysis-tokens', 3072)}
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardAdditionalSearchLimit">
                {@render settingTitle('risuBardAdditionalSearchLimit', '추가 검색 횟수', 'bardwiki-search-count')}
                <input id="bardwiki-search-count" type="number" min="0" value={settings.risuBardAdditionalSearchLimit} onchange={(event) => setNumber('risuBardAdditionalSearchLimit', event)} />
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardCanonicalTargetLimit">
                {@render settingTitle('risuBardCanonicalTargetLimit', '정본 대상 한도', 'bardwiki-target-limit')}
                <input id="bardwiki-target-limit" type="number" min="1" value={settings.risuBardCanonicalTargetLimit} onchange={(event) => setNumber('risuBardCanonicalTargetLimit', event)} />
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardRecentMessageCount">
                {@render settingTitle('risuBardRecentMessageCount', '분석할 턴 수', 'bardwiki-analysis-messages')}
                <input id="bardwiki-analysis-messages" type="number" min="1" value={settings.risuBardRecentMessageCount} onchange={(event) => setNumber('risuBardRecentMessageCount', event)} />
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardResponseMessageCount">
                {@render settingTitle('risuBardResponseMessageCount', '응답용 턴 수', 'bardwiki-response-messages')}
                <input id="bardwiki-response-messages" type="number" min="1" value={settings.risuBardResponseMessageCount} onchange={(event) => setNumber('risuBardResponseMessageCount', event)} />
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardResponseExcludeUserMessages">
                {@render settingTitle('risuBardResponseExcludeUserMessages', '응답 사용자 메시지', 'bardwiki-response-exclude-user')}
                <label class="toggle-control" for="bardwiki-response-exclude-user">
                    <input id="bardwiki-response-exclude-user" type="checkbox" checked={settings.risuBardResponseExcludeUserMessages}
                        onchange={(event) => setValue('risuBardResponseExcludeUserMessages', (event.currentTarget as HTMLInputElement).checked)} />
                    <span>{settings.risuBardResponseExcludeUserMessages ? '제외' : '포함'}</span>
                </label>
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardAnalysisExcludeUserMessages">
                {@render settingTitle('risuBardAnalysisExcludeUserMessages', '분석 사용자 메시지', 'bardwiki-analysis-exclude-user')}
                <label class="toggle-control" for="bardwiki-analysis-exclude-user">
                    <input id="bardwiki-analysis-exclude-user" type="checkbox" checked={settings.risuBardAnalysisExcludeUserMessages}
                        onchange={(event) => setValue('risuBardAnalysisExcludeUserMessages', (event.currentTarget as HTMLInputElement).checked)} />
                    <span>{settings.risuBardAnalysisExcludeUserMessages ? '제외' : '포함'}</span>
                </label>
            </div>
        </div>
    </section>

    <section class="settings-section" aria-labelledby="bardwiki-writing-settings">
        <h3 id="bardwiki-writing-settings">정본 작성</h3>
        <div class="settings-grid">
            <div class="setting-field" data-chat-setting-field="risuBardCanonicalWritingStyle">
                {@render settingTitle('risuBardCanonicalWritingStyle', '정본 문체', 'bardwiki-writing-style')}
                <select id="bardwiki-writing-style" value={settings.risuBardCanonicalWritingStyle}
                    onchange={(event) => setValue('risuBardCanonicalWritingStyle', (event.currentTarget as HTMLSelectElement).value as RisuBardChatSettings['risuBardCanonicalWritingStyle'])}>
                    <option value="concise">간결</option><option value="standard">표준</option>
                    <option value="ultra-concise">초간결</option><option value="custom">사용자 지정</option>
                </select>
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardWikiWritingLanguage">
                {@render settingTitle('risuBardWikiWritingLanguage', language.risuBardWikiWritingLanguage, 'bardwiki-writing-language')}
                <select id="bardwiki-writing-language" value={(character?.risuBardPinnedSettings ?? chat?.risuBardSettings)?.risuBardWikiWritingLanguage ?? ''}
                    onchange={(event) => setValue('risuBardWikiWritingLanguage',
                        (event.currentTarget.value || undefined) as RisuBardChatSettings['risuBardWikiWritingLanguage'])}>
                    <option value="">{language.risuBardWikiLanguageGlobal} ({wikiWritingLocales[normalizeWikiWritingLanguage(global.risuBardWikiWritingLanguage)].label})</option>
                    {#each wikiWritingLanguageOptions as option}<option value={option.value}>{option.label}</option>{/each}
                </select>
            </div>
            {#if settings.risuBardCanonicalWritingStyle === 'custom'}
                <div class="setting-field wide" data-chat-setting-field="risuBardCanonicalCustomStyle">
                    {@render settingTitle('risuBardCanonicalCustomStyle', '사용자 지정 문체', 'bardwiki-custom-style')}
                    <textarea id="bardwiki-custom-style" rows="3" maxlength="1000" value={settings.risuBardCanonicalCustomStyle}
                        onchange={(event) => setValue('risuBardCanonicalCustomStyle', (event.currentTarget as HTMLTextAreaElement).value)}></textarea>
                </div>
            {/if}
        </div>
    </section>
    {/if}
</div>

<style>
    .dynamic-number { min-width: 0; position: relative; }
    .dynamic-value { display: block; margin-top: .2rem; color: var(--color-info); font-size: .7rem; line-height: 1.4; overflow-wrap: anywhere; }
    .dynamic-note { display: block; color: var(--color-textcolor2); }
    .editing-hint { display: block; color: var(--color-textcolor2); font-size: .7rem; margin-top: .2rem; }
    .chat-settings { container: chat-settings / inline-size; display: grid; gap: .48rem; min-width: 0; padding: .05rem; }
    .settings-head { position: sticky; z-index: 2; top: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: .3rem .75rem; padding: .18rem .12rem .48rem; border-bottom: 1px solid var(--risu-theme-darkborderc); background: var(--risu-theme-bgcolor); }
    .settings-title { display: grid; min-width: 0; gap: .12rem; }
    .settings-head strong { color: var(--risu-theme-textcolor); font-size: calc(.78rem + 4px); }
    .settings-head small { color: var(--risu-theme-textcolor2); font-size: calc(.6rem + 4px); }
    .settings-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .4rem; }
    .settings-head button { min-height: 2.2rem; padding: .35rem .58rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: .38rem; color: var(--risu-theme-textcolor2); background: color-mix(in srgb, var(--risu-theme-darkbg) 86%, var(--color-bgcolor)); font-size: calc(.62rem + 4px); font-weight: 650; cursor: pointer; }
    .settings-head button.primary-action { border-color: color-mix(in srgb, var(--risu-theme-primary) 58%, var(--risu-theme-darkborderc)); color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-primary) 16%, var(--risu-theme-darkbg)); }
    .settings-head button:disabled { opacity: .45; cursor: default; }
    .global-feedback { grid-column: 1 / -1; color: var(--risu-theme-primary) !important; }
    .settings-section { display: grid; gap: .32rem; min-width: 0; padding: .46rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: .48rem; background: color-mix(in srgb, var(--risu-theme-darkbg) 54%, var(--risu-theme-bgcolor)); }
    .settings-section h3 { margin: 0; color: var(--risu-theme-textcolor); font-size: calc(.68rem + 4px); font-weight: 750; letter-spacing: .01em; }
    .settings-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .32rem; }
    .setting-field { display: grid; grid-template-columns: minmax(0, 1fr) minmax(5.75rem, .72fr); min-width: 0; align-items: center; gap: .38rem; padding: .3rem .38rem; border: 1px solid color-mix(in srgb, var(--risu-theme-darkborderc) 72%, transparent); border-radius: .36rem; background: color-mix(in srgb, var(--risu-theme-darkbg) 76%, var(--color-bgcolor)); }
    .setting-field.featured { border-color: color-mix(in srgb, var(--risu-theme-primary) 38%, var(--risu-theme-darkborderc)); background: color-mix(in srgb, var(--risu-theme-primary) 8%, var(--risu-theme-darkbg)); }
    .setting-field.wide { grid-column: 1 / -1; grid-template-columns: minmax(8rem, .3fr) 1fr; }
    .setting-field.preset-field { grid-column: 1 / -1; grid-template-columns: minmax(0, 1fr); row-gap: .3rem; }
    .preset-controls { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem .6rem; min-width: 0; }
    .preset-controls .setting-heading { flex: 0 0 auto; }
    .preset-controls select { flex: 1 1 7rem; width: auto; max-width: min(16rem, 100%); }
    .budget-summary { min-width: 0; color: var(--risu-theme-textcolor2); font-size: .72rem; line-height: 1.45; overflow-wrap: anywhere; }
    .summary-part { white-space: nowrap; }
    .setting-heading { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: .35rem; color: var(--risu-theme-textcolor2); }
    .setting-heading label { min-width: 0; line-height: 1.28; font-size: .78rem; font-weight: 650; }
    .help-button { position: relative; display: grid; width: 1.45rem; height: 1.45rem; flex: 0 0 1.45rem; place-items: center; padding: 0; border: 1px solid var(--risu-theme-darkborderc); border-radius: 50%; color: var(--risu-theme-textcolor2); background: transparent; font-size: .72rem; font-weight: 750; cursor: help; }
    .help-button::after { position: absolute; inset: -.58rem; content: ''; }
    .help-button:hover { border-color: var(--risu-theme-primary); color: var(--risu-theme-primary); background: color-mix(in srgb, var(--risu-theme-primary) 10%, transparent); }
    input, select, textarea { width: 100%; min-width: 0; min-height: 2rem; padding: .28rem .42rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: .32rem; color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-darkbg) 92%, var(--color-bgcolor)); font-size: .78rem; }
    input[type='checkbox'] { width: 1rem; min-height: 1rem; height: 1rem; padding: 0; accent-color: var(--risu-theme-primary); }
    .toggle-control { display: flex; min-height: 2rem; align-items: center; gap: .4rem; padding: .28rem .42rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: .32rem; color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-darkbg) 92%, var(--color-bgcolor)); font-size: .78rem; cursor: pointer; }
    textarea { resize: vertical; }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, .toggle-control:has(input:focus-visible) { outline: 2px solid var(--risu-theme-primary); outline-offset: 2px; }

    @container chat-settings (max-width: 48rem) {
        .settings-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @container chat-settings (max-width: 31rem) {
        .settings-head { grid-template-columns: 1fr; }
        .settings-actions { justify-content: stretch; }
        .settings-actions button { flex: 1 1 auto; }
        .settings-grid { grid-template-columns: 1fr; }
        .setting-field.wide { grid-column: 1; }
    }
    @media (max-width: 40rem) {
        input, select, textarea, .toggle-control { min-height: 2.75rem; }
    }
</style>
