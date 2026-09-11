<script lang="ts">
    import { language } from 'src/lang'
    import { tooltip } from 'src/ts/gui/tooltip'
    import type { Chat } from 'src/ts/storage/database.svelte'
    import type { RisuBardChatSettings } from 'src/ts/risubard/risuBardSettings'
    import { resolveRisuBardChatSettings } from 'src/ts/risubard/risuBardSettings'
    import {
        applyCurrentRisuBardSettingsToGlobal,
        buildRisuBardChatSettingHelp,
        formatRisuBardChatProfile,
        measureRisuBardChat,
        type RisuBardChatSettingHelpKey,
    } from 'src/ts/risubard/chatSettingsHelp'
    import {
        normalizeWikiWritingLanguage,
        wikiWritingLanguageOptions,
        wikiWritingLocales,
    } from 'src/ts/risubard/wikiWritingLanguage'

    interface Props {
        chat?: Chat
        global: RisuBardChatSettings
    }

    let { chat, global }: Props = $props()
    let revision = $state(0)
    let globalFeedback = $state('')
    let settings = $derived.by(() => {
        revision
        return resolveRisuBardChatSettings(global, chat?.risuBardSettings)
    })
    let hasOverrides = $derived.by(() => {
        revision
        return Boolean(chat?.risuBardSettings
            && Object.keys(chat.risuBardSettings).length > 0)
    })
    let profile = $derived(measureRisuBardChat(chat?.message ?? []))

    function settingHelp(key: RisuBardChatSettingHelpKey): string {
        return buildRisuBardChatSettingHelp(key, profile)
    }

    function setValue<K extends keyof RisuBardChatSettings>(
        key: K,
        value: RisuBardChatSettings[K],
    ) {
        if (!chat) return
        chat.risuBardSettings ??= {}
        chat.risuBardSettings[key] = value
        globalFeedback = ''
        revision++
    }

    function setNumber(key: keyof RisuBardChatSettings, event: Event) {
        setValue(key, Number((event.currentTarget as HTMLInputElement).value))
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
            use:tooltip={settingHelp(key)}
        >?</button>
    </span>
{/snippet}

<div class="chat-settings" data-chat-risubard-settings>
    <header class="settings-head">
        <div class="settings-title">
            <strong>현재 챗 설정</strong>
            <small>{formatRisuBardChatProfile(profile)}</small>
        </div>
        <div class="settings-actions">
            <button type="button" class="primary-action" data-apply-chat-settings-global
                disabled={!hasOverrides} use:tooltip={'이 챗의 현재 BardWiki 값을 전역 기본값으로 저장합니다.'}
                onclick={applyToGlobal}>전역값으로 적용</button>
            <button type="button" data-reset-chat-settings-global disabled={!hasOverrides}
                use:tooltip={'이 챗의 개별 설정을 지우고 전역 기본값을 사용합니다.'}
                onclick={resetToGlobal}>전역값 사용</button>
        </div>
        {#if globalFeedback}<small class="global-feedback" role="status">{globalFeedback}</small>{/if}
    </header>

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
            <div class="setting-field" data-chat-setting-field="risuBardInquiryTargetTokenBudget">
                {@render settingTitle('risuBardInquiryTargetTokenBudget', '검색 목표 토큰', 'bardwiki-target-tokens')}
                <input id="bardwiki-target-tokens" type="number" min="256" value={settings.risuBardInquiryTargetTokenBudget} onchange={(event) => setNumber('risuBardInquiryTargetTokenBudget', event)} />
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardInquiryEventTokenBudget">
                {@render settingTitle('risuBardInquiryEventTokenBudget', '사건 검색 토큰', 'bardwiki-event-tokens')}
                <input id="bardwiki-event-tokens" type="number" min="256" value={settings.risuBardInquiryEventTokenBudget} onchange={(event) => setNumber('risuBardInquiryEventTokenBudget', event)} />
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardInquirySourceTokenBudget">
                {@render settingTitle('risuBardInquirySourceTokenBudget', '자료별 검색 토큰', 'bardwiki-source-tokens')}
                <input id="bardwiki-source-tokens" type="number" min="256" value={settings.risuBardInquirySourceTokenBudget} onchange={(event) => setNumber('risuBardInquirySourceTokenBudget', event)} />
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardInquiryMaximumTokenBudget">
                {@render settingTitle('risuBardInquiryMaximumTokenBudget', '검색 최대 토큰', 'bardwiki-maximum-tokens')}
                <input id="bardwiki-maximum-tokens" type="number" min="256" value={settings.risuBardInquiryMaximumTokenBudget} onchange={(event) => setNumber('risuBardInquiryMaximumTokenBudget', event)} />
            </div>
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
                <input id="bardwiki-analysis-tokens" type="number" min="3072" value={settings.risuBardAnalysisTokenLimit} onchange={(event) => setNumber('risuBardAnalysisTokenLimit', event)} />
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
                {@render settingTitle('risuBardRecentMessageCount', '분석 최근 메시지', 'bardwiki-analysis-messages')}
                <input id="bardwiki-analysis-messages" type="number" min="1" value={settings.risuBardRecentMessageCount} onchange={(event) => setNumber('risuBardRecentMessageCount', event)} />
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardResponseMessageCount">
                {@render settingTitle('risuBardResponseMessageCount', '응답 최근 메시지', 'bardwiki-response-messages')}
                <input id="bardwiki-response-messages" type="number" min="1" value={settings.risuBardResponseMessageCount} onchange={(event) => setNumber('risuBardResponseMessageCount', event)} />
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardResponseExcludeUserMessages">
                {@render settingTitle('risuBardResponseExcludeUserMessages', '응답 생성에서 사용자 메시지 제외', 'bardwiki-response-exclude-user')}
                <label class="toggle-control" for="bardwiki-response-exclude-user">
                    <input id="bardwiki-response-exclude-user" type="checkbox" checked={settings.risuBardResponseExcludeUserMessages}
                        onchange={(event) => setValue('risuBardResponseExcludeUserMessages', (event.currentTarget as HTMLInputElement).checked)} />
                    <span>{settings.risuBardResponseExcludeUserMessages ? '제외' : '포함'}</span>
                </label>
            </div>
            <div class="setting-field" data-chat-setting-field="risuBardAnalysisExcludeUserMessages">
                {@render settingTitle('risuBardAnalysisExcludeUserMessages', '위키 분석에서 사용자 메시지 제외', 'bardwiki-analysis-exclude-user')}
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
                <select id="bardwiki-writing-language" value={chat?.risuBardSettings?.risuBardWikiWritingLanguage ?? ''}
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
</div>

<style>
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
