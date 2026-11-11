<script lang="ts">
    import { language } from 'src/lang'
    import { tooltip } from 'src/ts/gui/tooltip'
    import tippy from 'tippy.js'
    import RisuBardRecommendedPreset from './RisuBardRecommendedPreset.svelte'
    import type { Chat, character as Character } from 'src/ts/storage/database.svelte'
    import { alertConfirm } from 'src/ts/alert'
    import type { RisuBardChatSettings, RisuBardNumberSettingKey } from 'src/ts/risubard/risuBardSettings'
    import {
        normalizeRisuBardDynamicMemoryMode,
        normalizeRisuBardNumberSetting,
        resolveRisuBardChatSettings,
        risuBardNumberSettingBounds,
        RISUBARD_ANALYSIS_LORE_EXCLUDE_WORDS_MAX_LENGTH,
    } from 'src/ts/risubard/risuBardSettings'
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
        risuBardCurrentChatSettingKeys,
        type RisuBardChatSettingHelpKey,
        type RisuBardChatSettingKey,
    } from 'src/ts/risubard/chatSettingsHelp'
    import {
        WIKI_SCALE_PRESETS,
        WIKI_SCALE_PRESET_IDS,
        detectWikiScalePreset,
        formatWikiScaleTokens,
        normalizeRisuBardWikiSettingsView,
        wikiScalePresetValues,
        type RisuBardWikiSettingsView,
        type WikiScalePresetId,
    } from 'src/ts/risubard/wikiScalePreset'
    import {
        normalizeWikiWritingLanguage,
        wikiWritingLanguageOptions,
        wikiWritingLocales,
    } from 'src/ts/risubard/wikiWritingLanguage'

    interface Props {
        chat?: Chat
        character?: Pick<Character, 'risuBardPinnedSettings'>
        global: RisuBardChatSettings & { risuBardWikiSettingsView?: RisuBardWikiSettingsView }
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
    let matchesGlobal = $derived.by(() => {
        const resolvedGlobal = resolveRisuBardChatSettings(global)
        return risuBardCurrentChatSettingKeys.every((key) => resolvedGlobal[key] === settings[key])
    })
    let formDisabled = $derived(!chat && !globalDynamicOnly)
    let scopeText = $derived(pinned
        ? '바꾼 값은 이 봇의 모든 챗에 저장됩니다. 고정을 풀면 이 챗은 지금 값을 그대로 씁니다.'
        : hasOverrides
            ? '바꾼 값은 이 챗에만 저장됩니다.'
            : '바꾼 값은 이 챗에만 저장됩니다. 지금은 전역값을 따릅니다.')
    let profile = $derived(measureRisuBardChat(chat?.message ?? []))
    let dynamicCharacters = $derived(settings.risuBardDynamicMemoryMode === 'off' ? 0 : measureActiveMemoryCharacters(chat?.message ?? [], true))
    let dynamicBudget = $derived(resolveDynamicMemoryBudget(settings, dynamicCharacters))
    type DynamicKey = 'risuBardInquiryTargetTokenBudget' | 'risuBardInquiryEventTokenBudget' | 'risuBardInquiryMaximumTokenBudget' | 'risuBardAnalysisTokenLimit'
    let editingKey = $state<DynamicKey | null>(null)
    let numberDraft = $state('')
    const formatNumber = (value: number) => value.toLocaleString('ko-KR')
    const dynamicModeLabels = { off: '사용 안 함', economy: '절약형', balanced: '균형형', recall: '회수 우선형' } as const

    // The view is a global preference, so the sidebar and the settings page open the same way.
    let view = $derived.by(() => {
        revision
        return normalizeRisuBardWikiSettingsView(global.risuBardWikiSettingsView)
    })
    let simple = $derived(view === 'simple' && !globalDynamicOnly)
    let scaleSelection = $derived<WikiScalePresetId | 'custom'>(detectWikiScalePreset(settings))

    function setView(next: RisuBardWikiSettingsView) {
        global.risuBardWikiSettingsView = next
        revision++
    }

    function selectWikiScale(id: WikiScalePresetId) {
        if (!chat) return
        const values = wikiScalePresetValues(id)
        setValue('risuBardAnalysisTokenLimit', values.risuBardAnalysisTokenLimit)
        setValue('risuBardAnalysisLoreTokenLimit', values.risuBardAnalysisLoreTokenLimit)
    }

    // The selection is derived from the six stored values; only choosing 사용자 지정 keeps the fields open without changing them.
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
            '현재 챗의 활성 AI 응답 본문 길이에 따라 검색 목표 토큰, 사건 검색 토큰, 검색 최대 토큰과 위키 분석 최대 길이를 늘립니다.',
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
        if (key === 'risuBardDynamicMemoryMaximumTokens') return '검색 최대 토큰이 동적으로 늘어날 수 있는 상한입니다. 기본값이 이 값보다 크면 기본값을 유지합니다. 위키 분석 최대 길이는 모드별 최대 증가율을 따릅니다.'
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

    // A short note next to a number field when the typed value was changed before saving.
    let numberNotes = $state<Partial<Record<RisuBardNumberSettingKey, string>>>({})
    const noteTimers = new Map<RisuBardNumberSettingKey, ReturnType<typeof setTimeout>>()

    function clearNumberNote(key: RisuBardNumberSettingKey) {
        clearTimeout(noteTimers.get(key))
        noteTimers.delete(key)
        if (numberNotes[key] !== undefined) delete numberNotes[key]
    }

    function showNumberNote(key: RisuBardNumberSettingKey, note: string) {
        clearNumberNote(key)
        numberNotes[key] = note
        noteTimers.set(key, setTimeout(() => clearNumberNote(key), 3_000))
    }

    $effect(() => () => {
        for (const timer of noteTimers.values()) clearTimeout(timer)
        noteTimers.clear()
    })

    function numberBounds(key: RisuBardNumberSettingKey) {
        return risuBardNumberSettingBounds(key, settings.risuBardInquiryMaximumTokenBudget)
    }

    /** Normalizes a typed value with the resolve bounds, writes it back into the field, and stores it when it changed. */
    function commitNumber(key: RisuBardNumberSettingKey, raw: string, input: HTMLInputElement) {
        const current = settings[key]
        const { min, max } = numberBounds(key)
        const typed = raw.trim() ? Number(raw) : Number.NaN
        const next = normalizeRisuBardNumberSetting(key, typed, current, settings.risuBardInquiryMaximumTokenBudget)
        input.value = String(next)
        if (next !== current) setValue(key, next)
        if (!Number.isFinite(typed)) showNumberNote(key, '빈 값은 저장하지 않고 이전 값으로 되돌렸습니다.')
        else if (typed < min || typed > max) showNumberNote(key, max === Number.MAX_SAFE_INTEGER
            ? `최솟값 ${formatNumber(min)}에 맞췄습니다.`
            : `허용 범위(${formatNumber(min)}~${formatNumber(max)})에 맞췄습니다.`)
        else if (next !== typed) showNumberNote(key, '정수로 맞췄습니다.')
        else clearNumberNote(key)
    }

    function setNumber(key: RisuBardNumberSettingKey, event: Event) {
        const input = event.currentTarget as HTMLInputElement
        commitNumber(key, input.value, input)
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

    async function applyToGlobal() {
        if (!chat || matchesGlobal) return
        if (!await alertConfirm('모든 봇의 기본값이 지금 값으로 바뀝니다. 계속할까요?')) return
        applyCurrentRisuBardSettingsToGlobal(global, settings)
        delete chat.risuBardSettings
        globalFeedback = '현재 값을 전역 설정에 적용했습니다.'
        revision++
    }

    function resetToGlobal() {
        if (!chat) return
        // Pinned: drop the pin as well, so this chat follows global instead of a pinned copy of it.
        if (character) delete character.risuBardPinnedSettings
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

{#snippet sourceRerankField()}
    <div class="setting-field" data-chat-setting-field="risuBardSourceRerank">
        {@render settingTitle('risuBardSourceRerank', '과거 원문 재순위', 'bardwiki-source-rerank')}
        <label class="toggle-control" for="bardwiki-source-rerank">
            <input id="bardwiki-source-rerank" type="checkbox" checked={settings.risuBardSourceRerank}
                disabled={settings.risuBardHistoricalSourceMatchLimit === 0}
                onchange={(event) => setValue('risuBardSourceRerank', (event.currentTarget as HTMLInputElement).checked)} />
            <span>{settings.risuBardSourceRerank ? '켬' : '끔'}</span>
        </label>
    </div>
{/snippet}

{#snippet numberNote(key: RisuBardNumberSettingKey, id: string)}
    {#if numberNotes[key]}
        <small id={`${id}-note`} class="number-note" role="status" data-number-note={key}>{numberNotes[key]}</small>
    {/if}
{/snippet}

{#snippet numberInput(key: RisuBardNumberSettingKey, id: string)}
    <input {id} type="number" min={numberBounds(key).min} max={numberBounds(key).max} value={settings[key]}
        aria-describedby={numberNotes[key] ? `${id}-note` : undefined}
        oninput={() => clearNumberNote(key)}
        onchange={(event) => setNumber(key, event)} />
    {@render numberNote(key, id)}
{/snippet}

{#snippet dynamicNumber(key: DynamicKey, id: string)}
    <div class="dynamic-number">
        <input {id} type="number" min={numberBounds(key).min} max={numberBounds(key).max}
            value={editingKey === key ? numberDraft : settings[key]}
            aria-describedby={[
                settings.risuBardDynamicMemoryMode !== 'off' ? `${id}-dynamic` : '',
                editingKey === key ? `${id}-editing` : '',
                numberNotes[key] ? `${id}-note` : '',
            ].filter(Boolean).join(' ') || undefined}
            use:tooltip={dynamicValueHelp(key)}
            onfocus={(event) => {
                editingKey = key
                numberDraft = String(settings[key])
                event.currentTarget.value = numberDraft
            }}
            oninput={(event) => { numberDraft = event.currentTarget.value; clearNumberNote(key) }}
            onblur={(event) => {
                if (editingKey !== key) return
                commitNumber(key, numberDraft, event.currentTarget)
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
        {@render numberNote(key, id)}
    </div>
{/snippet}

{#snippet wikiScaleControl()}
    <fieldset class="scale-field" data-chat-setting-field="risuBardWikiScale">
        <legend class="setting-heading">
            <span>작업 규모</span>
            <button
                type="button"
                class="help-button"
                data-chat-setting-help="risuBardWikiScale"
                aria-label="작업 규모 도움말"
                use:helpTooltip={'위키 분석이 한 번에 읽는 분량입니다. 정리 중에 쌓인 턴을 한 번에 묶을 수 있는 양도 이 값으로 정해집니다.\n\n크게 할수록 긴 응답과 여러 턴을 잘라 내지 않고 한 번에 분석하지만, 호출 하나가 무거워집니다. 모델의 입력 한도가 작으면 가볍게를 고르세요.\n\n분석에 넣을 로어북 양도 함께 맞춰집니다.'}
            >?</button>
        </legend>
        <div class="scale-options">
            {#each WIKI_SCALE_PRESET_IDS as id (id)}
                <label class="scale-option">
                    <input type="radio" name="bardwiki-wiki-scale" value={id} checked={scaleSelection === id}
                        disabled={!chat} onchange={() => selectWikiScale(id)} />
                    <span class="scale-name">{WIKI_SCALE_PRESETS[id].label}</span>
                    <span class="scale-tokens">{formatWikiScaleTokens(WIKI_SCALE_PRESETS[id].analysis)}</span>
                </label>
            {/each}
        </div>
        {#if scaleSelection === 'custom'}
            <small class="scale-summary" data-wiki-scale-custom>
                고급에서 직접 조정한 값을 쓰는 중입니다 (분석 {formatNumber(settings.risuBardAnalysisTokenLimit)}토큰, 로어북 {formatNumber(settings.risuBardAnalysisLoreTokenLimit)}토큰). 위에서 하나를 고르면 그 값으로 바뀝니다.
            </small>
        {:else}
            <small class="scale-summary">
                분석 {formatNumber(settings.risuBardAnalysisTokenLimit)}토큰, 분석용 로어북 {formatNumber(settings.risuBardAnalysisLoreTokenLimit)}토큰
            </small>
        {/if}
    </fieldset>
{/snippet}

<div class="chat-settings" data-chat-risubard-settings>
    {#if !globalDynamicOnly}
    <header class="settings-head">
        <div class="settings-title">
            <strong>{pinned ? '이 봇의 모든 챗 설정 (고정)' : '이 챗 설정'}</strong>
            <small>{formatRisuBardChatProfile(profile)}</small>
        </div>
        <div class="settings-actions">
            <label class="toggle-control">
                <input type="checkbox" data-pin-chat-settings-character checked={pinned}
                    disabled={!chat || !character} onchange={setPinned} />
                <span>이 봇에 고정</span>
            </label>
            <button type="button" class="primary-action" data-apply-chat-settings-global
                disabled={!chat || matchesGlobal}
                onclick={applyToGlobal}>전역값으로 적용</button>
            <button type="button" data-reset-chat-settings-global disabled={!chat || !hasOverrides}
                onclick={resetToGlobal}>{pinned ? '고정 풀고 전역값 따르기' : '전역값 사용'}</button>
        </div>
        {#if formDisabled}
            <small class="scope-line" data-chat-settings-disabled-reason>챗을 연 뒤 바꿀 수 있습니다.</small>
        {:else}
            <small class="scope-line" data-chat-settings-scope>{scopeText}</small>
        {/if}
        {#if globalFeedback}<small class="global-feedback" role="status">{globalFeedback}</small>{/if}
    </header>
    <div class="view-switch" role="group" aria-label="설정 보기">
        <button type="button" aria-pressed={view === 'simple'} data-wiki-settings-view="simple"
            onclick={() => setView('simple')}>간단</button>
        <button type="button" aria-pressed={view === 'advanced'} data-wiki-settings-view="advanced"
            onclick={() => setView('advanced')}>고급</button>
    </div>
    {/if}

    <fieldset class="settings-form" data-chat-settings-form disabled={formDisabled}>
    {#if !globalDynamicOnly}
    <section class="settings-section recommended-section" aria-label="공식 추천 설정">
        <RisuBardRecommendedPreset {settings} disabled={formDisabled}
            onApply={(changes) => { for (const [key, value] of Object.entries(changes)) setValue(key as keyof RisuBardChatSettings, value) }} />
    </section>
    {/if}
    {#if simple}
    <section class="settings-section" aria-label="위키 분석">
        {@render wikiScaleControl()}
        <div class="settings-grid">
            <div class="setting-field" data-chat-setting-field="risuBardModelMode">
                {@render settingTitle('risuBardModelMode', '작업 모델', 'bardwiki-model-mode')}
                <select id="bardwiki-model-mode" data-memory-model-mode value={settings.risuBardModelMode}
                    onchange={(event) => setValue('risuBardModelMode', (event.currentTarget as HTMLSelectElement).value === 'model' ? 'model' : 'memory')}>
                    <option value="memory">보조 모델</option><option value="model">메인 모델</option>
                </select>
            </div>
            {@render sourceRerankField()}
            <div class="setting-field" data-chat-setting-field="risuBardWikiWritingLanguage">
                {@render settingTitle('risuBardWikiWritingLanguage', language.risuBardWikiWritingLanguage, 'bardwiki-writing-language')}
                <select id="bardwiki-writing-language" value={(character?.risuBardPinnedSettings ?? chat?.risuBardSettings)?.risuBardWikiWritingLanguage ?? ''}
                    onchange={(event) => setValue('risuBardWikiWritingLanguage',
                        (event.currentTarget.value || undefined) as RisuBardChatSettings['risuBardWikiWritingLanguage'])}>
                    <option value="">{language.risuBardWikiLanguageGlobal} ({wikiWritingLocales[normalizeWikiWritingLanguage(global.risuBardWikiWritingLanguage)].label})</option>
                    {#each wikiWritingLanguageOptions as option}<option value={option.value}>{option.label}</option>{/each}
                </select>
            </div>
        </div>
    </section>
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
                            {#if !simple || presetSelection === 'custom'}
                                <option value="custom" disabled={simple}>사용자 지정</option>
                            {/if}
                        </select>
                    </div>
                    {#if simple && presetSelection === 'custom'}
                        <small class="budget-summary" data-memory-budget-custom>고급에서 직접 조정한 값을 쓰는 중입니다. 위에서 하나를 고르면 그 값으로 바뀝니다.</small>
                    {/if}
                    {#if presetSummaryParts.length}
                        <small id="bardwiki-memory-budget-summary" class="budget-summary">{#each presetSummaryParts as part, index}{#if index > 0}{' / '}{/if}<span class="summary-part">{part}</span>{/each}</small>
                    {/if}
                </div>
            {/if}
            {#if showBudgetFields && !simple}
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
                        {@render numberInput('risuBardDynamicMemoryMaximumTokens', 'bardwiki-dynamic-maximum')}
                    </div>
                {/if}
            {/if}
        </div>
    </section>


    {#if simple}
    <p class="simple-note">검색 분량, 문체, 메시지 수 같은 세부 값은 <button type="button" class="link-button" onclick={() => setView('advanced')}>고급</button>에서 바꿀 수 있습니다.</p>
    {/if}

    {#if !globalDynamicOnly && !simple}
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
                    {@render numberInput('risuBardInquirySourceTokenBudget', 'bardwiki-source-tokens')}
                </div>
                <div class="setting-field" data-chat-setting-field="risuBardInquiryMaximumTokenBudget">
                    {@render settingTitle('risuBardInquiryMaximumTokenBudget', '검색 최대 토큰', 'bardwiki-maximum-tokens')}
                    {@render dynamicNumber('risuBardInquiryMaximumTokenBudget', 'bardwiki-maximum-tokens')}
                </div>
            {/if}
            <div class="setting-field" data-chat-setting-field="risuBardInquiryTimeoutMs">
                {@render settingTitle('risuBardInquiryTimeoutMs', '위키 조회 제한 시간(ms)', 'bardwiki-timeout')}
                <input id="bardwiki-timeout" type="number" min="1" max="10000" value={settings.risuBardInquiryTimeoutMs}
                    aria-describedby={numberNotes.risuBardInquiryTimeoutMs ? 'bardwiki-timeout-note' : undefined}
                    oninput={() => clearNumberNote('risuBardInquiryTimeoutMs')}
                    onchange={(event) => setNumber('risuBardInquiryTimeoutMs', event)} />
                {@render numberNote('risuBardInquiryTimeoutMs', 'bardwiki-timeout')}
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardHistoricalSourceMatchLimit">
                {@render settingTitle('risuBardHistoricalSourceMatchLimit', '과거 원문 최대 수', 'bardwiki-history-limit')}
                <input id="bardwiki-history-limit" type="number" min="0" max="32" value={settings.risuBardHistoricalSourceMatchLimit}
                    aria-describedby={numberNotes.risuBardHistoricalSourceMatchLimit ? 'bardwiki-history-limit-note' : undefined}
                    oninput={() => clearNumberNote('risuBardHistoricalSourceMatchLimit')}
                    onchange={(event) => setNumber('risuBardHistoricalSourceMatchLimit', event)} />
                {@render numberNote('risuBardHistoricalSourceMatchLimit', 'bardwiki-history-limit')}
            </div>
            {@render sourceRerankField()}
        </div>
    </section>

    <section class="settings-section" aria-labelledby="bardwiki-analysis-settings">
        <h3 id="bardwiki-analysis-settings">분석과 답변</h3>
        {@render wikiScaleControl()}
        <div class="settings-grid">
            <div class="setting-field" data-chat-setting-field="risuBardAnalysisTokenLimit">
                {@render settingTitle('risuBardAnalysisTokenLimit', '위키 분석 최대 길이(토큰)', 'bardwiki-analysis-tokens')}
                {@render dynamicNumber('risuBardAnalysisTokenLimit', 'bardwiki-analysis-tokens')}
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardAnalysisTurnInterval">
                {@render settingTitle('risuBardAnalysisTurnInterval', '몇 턴마다 묶어 분석', 'bardwiki-analysis-interval')}
                {@render numberInput('risuBardAnalysisTurnInterval', 'bardwiki-analysis-interval')}
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardAdditionalSearchLimit">
                {@render settingTitle('risuBardAdditionalSearchLimit', '근거 부족 시 다시 찾기 횟수', 'bardwiki-search-count')}
                {@render numberInput('risuBardAdditionalSearchLimit', 'bardwiki-search-count')}
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardRecentMessageCount">
                {@render settingTitle('risuBardRecentMessageCount', '위키 분석이 읽을 최근 응답 수', 'bardwiki-analysis-messages')}
                {@render numberInput('risuBardRecentMessageCount', 'bardwiki-analysis-messages')}
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardResponseMessageCount">
                {@render settingTitle('risuBardResponseMessageCount', '답변에 그대로 넣을 최근 응답 수', 'bardwiki-response-messages')}
                {@render numberInput('risuBardResponseMessageCount', 'bardwiki-response-messages')}
            </div>
            <!-- The stored keys say "exclude"; the checkboxes show the inverse so that checked means included. -->
            <div class="setting-field" data-chat-setting-field="risuBardResponseExcludeUserMessages">
                {@render settingTitle('risuBardResponseExcludeUserMessages', '답변에 사용자 메시지 넣기', 'bardwiki-response-exclude-user')}
                <label class="toggle-control" for="bardwiki-response-exclude-user">
                    <input id="bardwiki-response-exclude-user" type="checkbox" checked={!settings.risuBardResponseExcludeUserMessages}
                        onchange={(event) => setValue('risuBardResponseExcludeUserMessages', !(event.currentTarget as HTMLInputElement).checked)} />
                    <span>{settings.risuBardResponseExcludeUserMessages ? '뺌' : '넣음'}</span>
                </label>
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardAnalysisExcludeUserMessages">
                {@render settingTitle('risuBardAnalysisExcludeUserMessages', '분석에 사용자 메시지 넣기', 'bardwiki-analysis-exclude-user')}
                <label class="toggle-control" for="bardwiki-analysis-exclude-user">
                    <input id="bardwiki-analysis-exclude-user" type="checkbox" checked={!settings.risuBardAnalysisExcludeUserMessages}
                        onchange={(event) => setValue('risuBardAnalysisExcludeUserMessages', !(event.currentTarget as HTMLInputElement).checked)} />
                    <span>{settings.risuBardAnalysisExcludeUserMessages ? '뺌' : '넣음'}</span>
                </label>
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardAnalysisLoreTokenLimit">
                {@render settingTitle('risuBardAnalysisLoreTokenLimit', '분석에 넣을 로어북(토큰)', 'bardwiki-analysis-lore-tokens')}
                {@render numberInput('risuBardAnalysisLoreTokenLimit', 'bardwiki-analysis-lore-tokens')}
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardAnalysisLoreIncludeAlwaysActive">
                {@render settingTitle('risuBardAnalysisLoreIncludeAlwaysActive', '항상 켜진 로어북 넣기', 'bardwiki-analysis-lore-always')}
                <label class="toggle-control" for="bardwiki-analysis-lore-always">
                    <input id="bardwiki-analysis-lore-always" type="checkbox" checked={settings.risuBardAnalysisLoreIncludeAlwaysActive}
                        disabled={settings.risuBardAnalysisLoreTokenLimit === 0}
                        onchange={(event) => setValue('risuBardAnalysisLoreIncludeAlwaysActive', (event.currentTarget as HTMLInputElement).checked)} />
                    <span>{settings.risuBardAnalysisLoreIncludeAlwaysActive ? '넣음' : '뺌'}</span>
                </label>
            </div>
            <div class="setting-field wide" data-chat-setting-field="risuBardAnalysisLoreExcludeWords">
                {@render settingTitle('risuBardAnalysisLoreExcludeWords', '이 단어가 든 로어북 빼기', 'bardwiki-analysis-lore-exclude')}
                <textarea id="bardwiki-analysis-lore-exclude" rows="3" maxlength={RISUBARD_ANALYSIS_LORE_EXCLUDE_WORDS_MAX_LENGTH}
                    placeholder="한 줄에 하나씩"
                    disabled={settings.risuBardAnalysisLoreTokenLimit === 0}
                    value={settings.risuBardAnalysisLoreExcludeWords}
                    onchange={(event) => setValue('risuBardAnalysisLoreExcludeWords', (event.currentTarget as HTMLTextAreaElement).value)}></textarea>
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
                    <option value="concise">기본</option><option value="custom">사용자 지정</option>
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
    </fieldset>
</div>

<style>
    .view-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; padding: 2px; border: 1px solid var(--risu-theme-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.9); background: color-mix(in srgb, var(--risu-theme-darkbg) 80%, var(--risu-theme-bgcolor)); }
    .view-switch button { min-height: 2rem; border: 0; border-radius: calc(var(--risu-radius-sm) * 1.36); background: transparent; color: var(--risu-theme-textcolor2); font-size: .82rem; font-weight: 650; cursor: pointer; transition: background-color .15s ease-out, color .15s ease-out; }
    .view-switch button:hover { color: var(--risu-theme-textcolor); }
    .view-switch button[aria-pressed='true'] { color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-primary) 30%, var(--risu-theme-darkbg)); }
    .scale-field { display: grid; gap: .32rem; min-width: 0; margin: 0; padding: .38rem; border: 1px solid color-mix(in srgb, var(--risu-theme-darkborderc) 72%, transparent); border-radius: calc(var(--risu-radius-md) * 0.96); background: color-mix(in srgb, var(--risu-theme-darkbg) 76%, var(--color-bgcolor)); }
    .scale-field legend { float: left; width: 100%; margin-bottom: .1rem; padding: 0; }
    .scale-field legend span { font-size: .78rem; font-weight: 650; }
    .scale-options { clear: both; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .3rem; }
    .scale-option { position: relative; display: grid; justify-items: center; gap: .05rem; min-height: 3rem; padding: .4rem .25rem; border: 1px solid color-mix(in srgb, var(--risu-theme-primary) 24%, var(--risu-theme-darkborderc)); border-radius: calc(var(--risu-radius-lg) * 0.8); color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-primary) 8%, var(--risu-theme-darkbg)); cursor: pointer; transition: border-color .15s ease-out, background-color .15s ease-out; }
    .scale-option input { position: absolute; opacity: 0; pointer-events: none; }
    .scale-option:hover { border-color: color-mix(in srgb, var(--risu-theme-primary) 55%, var(--risu-theme-darkborderc)); background: color-mix(in srgb, var(--risu-theme-primary) 15%, var(--risu-theme-darkbg)); }
    .scale-option:has(input:checked) { border-color: color-mix(in srgb, var(--risu-theme-primary) 80%, var(--risu-theme-darkborderc)); color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-primary) 32%, var(--risu-theme-darkbg)); }
    .scale-option:has(input:checked) .scale-tokens { color: var(--risu-theme-textcolor); }
    .scale-option:has(input:focus-visible) { outline: 2px solid var(--risu-theme-primary); outline-offset: 2px; }
    .scale-option:has(input:disabled) { opacity: .5; cursor: default; }
    .scale-name { font-size: .8rem; font-weight: 700; }
    .scale-tokens { font-size: .75rem; font-weight: 650; font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--risu-theme-primary) 70%, var(--risu-theme-textcolor)); }
    .scale-summary { color: var(--risu-theme-textcolor2); font-size: .75rem; line-height: 1.45; overflow-wrap: anywhere; }
    .simple-note { margin: 0; padding: 0 .2rem; color: var(--risu-theme-textcolor2); font-size: .75rem; line-height: 1.45; }
    .link-button { padding: 0; border: 0; background: none; color: var(--risu-theme-primary); font: inherit; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
    .dynamic-number { min-width: 0; position: relative; }
    .dynamic-value { display: block; margin-top: .2rem; color: var(--color-info); font-size: .75rem; line-height: 1.4; overflow-wrap: anywhere; }
    .dynamic-note { display: block; color: var(--color-textcolor2); }
    .editing-hint { display: block; color: var(--color-textcolor2); font-size: .75rem; margin-top: .2rem; }
    .number-note { display: block; grid-column: 1 / -1; margin-top: .1rem; color: var(--color-danger, var(--risu-theme-textcolor2)); font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
    .settings-form { display: grid; align-content: start; gap: .48rem; min-width: 0; margin: 0; padding: 0; border: 0; }
    .settings-form:disabled { opacity: .6; }
    .chat-settings { container: chat-settings / inline-size; display: grid; align-content: start; gap: .48rem; min-width: 0; padding: .05rem; }
    .settings-head { position: sticky; z-index: 2; top: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: .3rem .75rem; padding: .18rem .12rem .48rem; border-bottom: 1px solid var(--risu-theme-darkborderc); background: var(--risu-theme-bgcolor); }
    .settings-title { display: grid; min-width: 0; gap: .12rem; }
    .settings-head strong { color: var(--risu-theme-textcolor); font-size: calc(.78rem + 4px); }
    .settings-head small { color: var(--risu-theme-textcolor2); font-size: calc(.6rem + 4px); }
    .settings-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .4rem; }
    .settings-head button { min-height: 2.2rem; padding: .35rem .58rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.76); color: var(--risu-theme-textcolor2); background: color-mix(in srgb, var(--risu-theme-darkbg) 86%, var(--color-bgcolor)); font-size: calc(.62rem + 4px); font-weight: 650; cursor: pointer; }
    .settings-head button.primary-action { border-color: color-mix(in srgb, var(--risu-theme-primary) 58%, var(--risu-theme-darkborderc)); color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-primary) 16%, var(--risu-theme-darkbg)); }
    .settings-head button:disabled { opacity: .45; cursor: default; }
    .scope-line { grid-column: 1 / -1; line-height: 1.45; }
    .global-feedback { grid-column: 1 / -1; color: var(--risu-theme-primary) !important; }
    .settings-section { display: grid; gap: .32rem; min-width: 0; padding: .46rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.96); background: color-mix(in srgb, var(--risu-theme-darkbg) 54%, var(--risu-theme-bgcolor)); }
    .settings-section h3 { margin: 0; color: var(--risu-theme-textcolor); font-size: calc(.68rem + 4px); font-weight: 750; letter-spacing: .01em; }
    .settings-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .32rem; }
    .setting-field { display: grid; grid-template-columns: minmax(0, 1fr) minmax(5.75rem, .72fr); min-width: 0; align-items: center; gap: .38rem; padding: .3rem .38rem; border: 1px solid color-mix(in srgb, var(--risu-theme-darkborderc) 72%, transparent); border-radius: calc(var(--risu-radius-md) * 0.96); background: color-mix(in srgb, var(--risu-theme-darkbg) 76%, var(--color-bgcolor)); }
    .setting-field.wide { grid-column: 1 / -1; grid-template-columns: minmax(8rem, .3fr) 1fr; }
    .setting-field.preset-field { grid-column: 1 / -1; grid-template-columns: minmax(0, 1fr); row-gap: .3rem; }
    .preset-controls { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem .6rem; min-width: 0; }
    .preset-controls .setting-heading { flex: 0 0 auto; }
    .preset-controls select { flex: 1 1 7rem; width: auto; max-width: min(16rem, 100%); }
    .budget-summary { min-width: 0; color: var(--risu-theme-textcolor2); font-size: .75rem; line-height: 1.45; overflow-wrap: anywhere; }
    .summary-part { white-space: nowrap; }
    .setting-heading { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: .35rem; color: var(--risu-theme-textcolor2); }
    .setting-heading label { min-width: 0; line-height: 1.28; font-size: .78rem; font-weight: 650; }
    .help-button { position: relative; display: grid; width: 1.45rem; height: 1.45rem; flex: 0 0 1.45rem; place-items: center; padding: 0; border: 1px solid var(--risu-theme-darkborderc); border-radius: 50%; color: var(--risu-theme-textcolor2); background: transparent; font-size: .75rem; font-weight: 750; cursor: help; }
    .help-button::after { position: absolute; inset: -.58rem; content: ''; }
    .help-button:hover { border-color: var(--risu-theme-primary); color: var(--risu-theme-primary); background: color-mix(in srgb, var(--risu-theme-primary) 10%, transparent); }
    input, select, textarea { width: 100%; min-width: 0; min-height: 2rem; padding: .28rem .42rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: calc(var(--risu-radius-sm) * 1.28); color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-darkbg) 92%, var(--color-bgcolor)); font-size: .78rem; }
    input[type='checkbox'] { width: 1rem; min-height: 1rem; height: 1rem; padding: 0; accent-color: var(--risu-theme-primary); }
    .toggle-control { display: flex; min-height: 2rem; align-items: center; gap: .4rem; padding: .28rem .42rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: calc(var(--risu-radius-sm) * 1.28); color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-darkbg) 92%, var(--color-bgcolor)); font-size: .78rem; cursor: pointer; }
    textarea { resize: vertical; }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, .toggle-control:has(input:focus-visible) { outline: 2px solid var(--risu-theme-primary); outline-offset: 2px; }

    @container chat-settings (max-width: 48rem) {
        .settings-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @container chat-settings (max-width: 20rem) {
        .scale-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
