<script lang="ts">
    import { DBState } from 'src/ts/stores.svelte'
    import {
        formatTagHotkey, getTagHotkeyWarnings, normalizeTagAutocompleteSettings, tagHotkeyLabels,
        type TagAutocompleteSettings, type TagHotkeyAction,
    } from 'src/ts/tagAutocomplete/settings'

    const actions: TagHotkeyAction[] = ['previous', 'next', 'accept', 'close']
    const modifiers = ['ctrl', 'alt', 'shift', 'meta'] as const
    const modifierLabels = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Meta' }
    let settings = $derived(normalizeTagAutocompleteSettings(DBState.db.tagAutocomplete))
    let warnings = $derived(getTagHotkeyWarnings(settings, DBState.db.hotkeys))

    function update(values: Partial<TagAutocompleteSettings>) {
        DBState.db.tagAutocomplete = normalizeTagAutocompleteSettings({ ...normalizeTagAutocompleteSettings(DBState.db.tagAutocomplete), ...values })
    }

    function capture(event: KeyboardEvent, action: TagHotkeyAction, index: number) {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (event.isComposing || event.keyCode === 229 || ['Control', 'Shift', 'Alt', 'Meta', 'Process', 'Unidentified'].includes(event.key)) return
        const next = normalizeTagAutocompleteSettings(DBState.db.tagAutocomplete)
        next.hotkeys[action][index] = {
            action: `tagAutocomplete.${action}`, key: event.key, ctrl: event.ctrlKey,
            alt: event.altKey, shift: event.shiftKey, meta: event.metaKey,
        }
        update(next)
    }

    function toggleModifier(action: TagHotkeyAction, index: number, modifier: typeof modifiers[number]) {
        const next = normalizeTagAutocompleteSettings(DBState.db.tagAutocomplete)
        next.hotkeys[action][index][modifier] = !next.hotkeys[action][index][modifier]
        update(next)
    }
</script>

<section class="tag-settings" aria-label="Danbooru 태그 자동완성">
    <h3>Danbooru 태그 자동완성</h3>
    <p>프롬프트 에디터에서 쉼표나 줄바꿈으로 태그를 구분합니다. 위아래 키로 후보를 고르고 Enter 또는 Tab으로 삽입합니다. 일반 채팅 입력에는 적용하지 않습니다.</p>
    <div class="settings-card">
        <label class="setting-row">
            <span>태그 자동완성 사용</span>
            <input type="checkbox" checked={settings.enabled} onchange={(event) => update({ enabled: event.currentTarget.checked })} />
        </label>
        <label class="setting-row">
            <span>자동완성 최소 글자 수 <small>앞뒤 공백과 가중치 괄호를 제외한 검색어 기준입니다.</small></span>
            <input type="number" min="1" max="10" step="1" value={settings.minLength} onchange={(event) => update({ minLength: Number(event.currentTarget.value) })} />
        </label>
        <label class="setting-row">
            <span>검색과 치환 범위 <small>태그 전체는 커서 오른쪽도 함께 검색하고 교체합니다.</small></span>
            <select value={settings.scope} onchange={(event) => update({ scope: event.currentTarget.value === 'whole' ? 'whole' : 'left' })}>
                <option value="left">커서 왼쪽</option>
                <option value="whole">태그 전체 자동완성</option>
            </select>
        </label>
    </div>

    <div class="shortcut-heading">
        <h4>태그 자동완성 단축키</h4>
        <button type="button" onclick={() => update({ hotkeys: normalizeTagAutocompleteSettings().hotkeys })}>단축키 기본값 복원</button>
    </div>
    <p>키 입력 칸에서 원하는 조합을 누르거나 보조키 버튼을 변경하세요. 유효한 후보 목록이 열렸을 때만 공통 단축키보다 우선합니다. 중복 시 닫기 → 확정 → 이전 → 다음 순서로 처리합니다. 목록이 닫혀 있으면 기존 편집 단축키가 동작합니다.</p>
    <div class="settings-card">
        {#each actions as action}
            {#each settings.hotkeys[action] as binding, index}
                <div class="hotkey-row">
                    <span>{tagHotkeyLabels[action]}{settings.hotkeys[action].length > 1 ? ` ${index + 1}` : ''}</span>
                    <div class="modifiers" aria-label={`${tagHotkeyLabels[action]} ${index + 1} 보조키`} role="group">
                        {#each modifiers as modifier}
                            <button type="button" class:active={binding[modifier]} aria-pressed={!!binding[modifier]}
                                onclick={() => toggleModifier(action, index, modifier)}>{modifierLabels[modifier]}</button>
                        {/each}
                    </div>
                    <input class="key-input" readonly aria-label={`${tagHotkeyLabels[action]} ${index + 1} 키`}
                        value={formatTagHotkey(binding)} onkeydown={(event) => capture(event, action, index)} />
                </div>
            {/each}
        {/each}
    </div>
    {#if warnings.length}
        <ul class="warnings" aria-live="polite">
            {#each warnings as warning}<li>{warning}</li>{/each}
        </ul>
    {/if}
</section>

<style>
    .tag-settings { margin-top: 1.5rem; color: var(--color-textcolor); }
    h3, h4 { margin: 0; font-weight: 650; }
    h3 { font-size: 1rem; }
    h4 { font-size: .9rem; }
    p, small { color: color-mix(in srgb, var(--color-textcolor) 78%, var(--color-bgcolor)); font-size: .8rem; line-height: 1.6; }
    p { margin: .6rem 0 .8rem; }
    small { display: block; margin-top: .2rem; }
    .settings-card { border: 1px solid var(--settings-border, var(--color-darkborderc)); border-radius: var(--settings-radius, calc(var(--risu-radius-lg) * 1.3)); background: var(--settings-surface, var(--color-darkbg)); }
    .setting-row, .hotkey-row { display: grid; align-items: center; gap: .8rem; padding: .8rem 1rem; font-size: .85rem; }
    .setting-row { grid-template-columns: minmax(0, 1fr) auto; }
    .hotkey-row { grid-template-columns: minmax(7rem, 1fr) minmax(12rem, 1fr) minmax(7rem, 1fr); }
    .setting-row + .setting-row, .hotkey-row + .hotkey-row { border-top: 1px solid var(--settings-border, var(--color-darkborderc)); }
    .shortcut-heading { display: flex; align-items: center; justify-content: space-between; gap: .7rem; margin-top: 1.2rem; }
    button, input:not([type=checkbox]), select { min-height: 2.75rem; border: 1px solid var(--settings-border, var(--color-darkborderc)); border-radius: calc(var(--risu-radius-lg) * 0.9); background: var(--color-bgcolor); color: var(--color-textcolor); padding: .4rem .55rem; font-size: .8rem; }
    button { cursor: pointer; }
    button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    input[type=number] { width: 4.5rem; }
    input[type=checkbox] { width: 1.25rem; height: 1.25rem; accent-color: var(--color-primary); }
    .modifiers { display: grid; grid-template-columns: repeat(4, 1fr); gap: .35rem; }
    .active { color: var(--color-primary); border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, var(--color-bgcolor)); }
    .key-input { width: 100%; min-width: 0; text-align: center; }
    .warnings { margin: .8rem 0 0; padding: .8rem .8rem .8rem 1.8rem; border: 1px solid var(--settings-border, var(--color-darkborderc)); border-radius: var(--risu-radius-lg); background: color-mix(in srgb, var(--color-primary) 10%, var(--color-bgcolor)); font-size: .8rem; line-height: 1.6; }
    @media (max-width: 760px) {
        .hotkey-row { grid-template-columns: minmax(0, 1fr); }
        .setting-row { grid-template-columns: minmax(0, 1fr); }
        .setting-row select { width: 100%; }
        .shortcut-heading { align-items: flex-start; flex-wrap: wrap; }
    }
</style>
