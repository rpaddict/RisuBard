<script lang="ts">
    import { language } from 'src/lang'
    import type { Chat } from 'src/ts/storage/database.svelte'
    import type { RisuBardChatSettings } from 'src/ts/risubard/risuBardSettings'
    import { resolveRisuBardChatSettings } from 'src/ts/risubard/risuBardSettings'

    interface Props {
        chat?: Chat
        global: RisuBardChatSettings
    }

    let { chat, global }: Props = $props()
    let revision = $state(0)
    let settings = $derived.by(() => {
        revision
        return resolveRisuBardChatSettings(global, chat?.risuBardSettings)
    })

    function setValue<K extends keyof RisuBardChatSettings>(
        key: K,
        value: RisuBardChatSettings[K],
    ) {
        if (!chat) return
        chat.risuBardSettings ??= {}
        chat.risuBardSettings[key] = value
        revision++
    }

    function setNumber(key: keyof RisuBardChatSettings, event: Event) {
        setValue(key, Number((event.currentTarget as HTMLInputElement).value))
    }

    function resetToGlobal() {
        if (!chat) return
        delete chat.risuBardSettings
        revision++
    }
</script>

<div class="chat-settings" data-chat-risubard-settings>
    <div class="settings-head">
        <strong>현재 챗 설정</strong>
        <button type="button" onclick={resetToGlobal} disabled={!chat?.risuBardSettings}>
            전역값 사용
        </button>
    </div>
    <label>
        <span>작업 모델</span>
        <select data-memory-model-mode value={settings.risuBardModelMode}
            onchange={(event) => setValue('risuBardModelMode', (event.currentTarget as HTMLSelectElement).value === 'model' ? 'model' : 'memory')}>
            <option value="memory">보조 모델</option>
            <option value="model">메인 모델</option>
        </select>
    </label>
    <label class="check"><input type="checkbox" checked={settings.showRequestStatus}
        onchange={(event) => setValue('showRequestStatus', (event.currentTarget as HTMLInputElement).checked)} /> 요청 컨텍스트 상태 표시</label>
    <label><span>검색 목표 토큰</span><input type="number" min="256" step="256" value={settings.risuBardInquiryTargetTokenBudget} onchange={(event) => setNumber('risuBardInquiryTargetTokenBudget', event)} /></label>
    <label><span>사건 검색 토큰</span><input type="number" min="256" step="256" value={settings.risuBardInquiryEventTokenBudget} onchange={(event) => setNumber('risuBardInquiryEventTokenBudget', event)} /></label>
    <label><span>자료별 검색 토큰</span><input type="number" min="256" step="256" value={settings.risuBardInquirySourceTokenBudget} onchange={(event) => setNumber('risuBardInquirySourceTokenBudget', event)} /></label>
    <label><span>검색 최대 토큰</span><input type="number" min="256" step="256" value={settings.risuBardInquiryMaximumTokenBudget} onchange={(event) => setNumber('risuBardInquiryMaximumTokenBudget', event)} /></label>
    <label><span>과거 원문 최대 수</span><input type="number" min="0" max="32" step="1" value={settings.risuBardHistoricalSourceMatchLimit} onchange={(event) => setNumber('risuBardHistoricalSourceMatchLimit', event)} /></label>
    <label><span>분석 토큰 한도</span><input type="number" min="3072" step="1024" value={settings.risuBardAnalysisTokenLimit} onchange={(event) => setNumber('risuBardAnalysisTokenLimit', event)} /></label>
    <label><span>추가 검색 횟수</span><input type="number" min="0" step="1" value={settings.risuBardAdditionalSearchLimit} onchange={(event) => setNumber('risuBardAdditionalSearchLimit', event)} /></label>
    <label><span>정본 대상 한도</span><input type="number" min="1" step="1" value={settings.risuBardCanonicalTargetLimit} onchange={(event) => setNumber('risuBardCanonicalTargetLimit', event)} /></label>
    <label><span>분석 최근 메시지</span><input type="number" min="1" step="1" value={settings.risuBardRecentMessageCount} onchange={(event) => setNumber('risuBardRecentMessageCount', event)} /></label>
    <label><span>응답 최근 메시지</span><input type="number" min="1" step="1" value={settings.risuBardResponseMessageCount} onchange={(event) => setNumber('risuBardResponseMessageCount', event)} /></label>
    <label class="check"><input type="checkbox" checked={settings.risuBardResponseExcludeUserMessages}
        onchange={(event) => setValue('risuBardResponseExcludeUserMessages', (event.currentTarget as HTMLInputElement).checked)} /> 사용자 메시지 제외</label>
    <label>
        <span>정본 문체</span>
        <select value={settings.risuBardCanonicalWritingStyle}
            onchange={(event) => setValue('risuBardCanonicalWritingStyle', (event.currentTarget as HTMLSelectElement).value as RisuBardChatSettings['risuBardCanonicalWritingStyle'])}>
            <option value="concise">간결</option><option value="standard">표준</option>
            <option value="ultra-concise">초간결</option><option value="custom">사용자 지정</option>
        </select>
    </label>
    <label>
        <span>{language.risuBardWikiWritingLanguage}</span>
        <select value={chat?.risuBardSettings?.risuBardWikiWritingLanguage ?? ''}
            onchange={(event) => setValue('risuBardWikiWritingLanguage',
                (event.currentTarget.value || undefined) as RisuBardChatSettings['risuBardWikiWritingLanguage'])}>
            <option value="">{language.risuBardWikiLanguageGlobal} ({global.risuBardWikiWritingLanguage === 'en' ? 'English' : global.risuBardWikiWritingLanguage === 'ja' ? '日本語' : '한국어'})</option>
            <option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option>
        </select>
    </label>
    {#if settings.risuBardCanonicalWritingStyle === 'custom'}
        <label class="wide"><span>사용자 지정 문체</span><textarea rows="3" maxlength="1000" value={settings.risuBardCanonicalCustomStyle}
            onchange={(event) => setValue('risuBardCanonicalCustomStyle', (event.currentTarget as HTMLTextAreaElement).value)}></textarea></label>
    {/if}
</div>

<style>
    .chat-settings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .52rem; max-height: min(31rem, 72vh); overflow-y: auto; padding: .1rem; }
    .settings-head { display: flex; grid-column: 1 / -1; align-items: center; justify-content: space-between; gap: .7rem; padding-bottom: .35rem; border-bottom: 1px solid var(--risu-theme-darkborderc); }
    .settings-head strong { font-size: calc(.74rem + 4px); }
    .settings-head button { padding: .24rem .4rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: .3rem; color: var(--risu-theme-textcolor2); background: transparent; font-size: calc(.62rem + 4px); }
    label { display: grid; gap: .22rem; min-width: 0; color: var(--risu-theme-textcolor2); font-size: calc(.63rem + 4px); }
    label.check { display: flex; align-items: center; gap: .38rem; }
    label.wide { grid-column: 1 / -1; }
    input, select, textarea { min-width: 0; padding: .34rem .42rem; border: 1px solid var(--risu-theme-darkborderc); border-radius: .3rem; color: var(--risu-theme-textcolor); background: color-mix(in srgb, var(--risu-theme-darkbg) 90%, var(--color-bgcolor)); font-size: calc(.66rem + 4px); }
    input[type='checkbox'] { width: .9rem; height: .9rem; padding: 0; accent-color: var(--risu-theme-primary); }
    textarea { resize: vertical; }
    @media (max-width: 34rem) { .chat-settings { grid-template-columns: 1fr; } .settings-head, label.wide { grid-column: 1; } }
</style>
