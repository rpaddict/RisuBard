<script lang="ts">
    import { onDestroy } from 'svelte'
    import type { character as Character } from 'src/ts/storage/database.svelte'
    import { getCurrentLocale } from 'src/lang'
    import { requestChatData } from 'src/ts/process/request/request'
    import { downloadFile, saveAsset } from 'src/ts/globalApi.svelte'
    import { selectFileByDom } from 'src/ts/util'
    import {
        createBlankStudioProject,
        createStudioAppearance,
        normalizeFirstMessageStudioProject,
        resetFirstMessageStudioScriptstate,
        resolveStudioProjectLocale,
        setStudioTextLanguage,
        type FirstMessageStudioLocale,
        type FirstMessageStudioImageFrame,
        type FirstMessageStudioLanguage,
        type FirstMessageStudioOption,
        type FirstMessageStudioProject,
        type FirstMessageStudioScenarioGroup,
        type FirstMessageStudioScenarioRule,
        type FirstMessageStudioSkinPreset,
        type FirstMessageStudioText,
        type FirstMessageStudioVariable,
    } from 'src/ts/firstMessageStudio'
    import {
        applyFirstMessageStudioTranslations,
        buildFirstMessageStudioTranslationPrompt,
        collectFirstMessageStudioTranslationEntries,
        parseFirstMessageStudioTranslations,
    } from 'src/ts/firstMessageStudioTranslation'
    import {
        compileFirstMessageStudioCompatibility,
        exportFirstMessageStudioProject,
        importFirstMessageStudioProject,
        isFirstMessageStudioCompatibilityMessage,
        mergeFirstMessageStudioDefaultVariables,
        mergeFirstMessageStudioTriggers,
    } from 'src/ts/firstMessageStudioSharing'
    import FirstMessageStudioImageCropEditor from './FirstMessageStudioImageCropEditor.svelte'
    import FirstMessageStudioRuntime from './FirstMessageStudioRuntime.svelte'

    interface Props {
        character: Character
        onClose: () => void
    }

    let { character, onClose }: Props = $props()

    function makeInitialProject(): FirstMessageStudioProject {
        const project = character.firstMessageStudio
            ? normalizeFirstMessageStudioProject(structuredClone(character.firstMessageStudio))
            : createBlankStudioProject()
        const firstMessage = character.firstMessage ?? ''
        const fallbackMissing = !character.firstMessageStudio
            || !Object.prototype.hasOwnProperty.call(character.firstMessageStudio, 'fallbackMessage')
            || !project.fallbackMessage.trim()
        if (fallbackMissing && firstMessage.trim() && !isFirstMessageStudioCompatibilityMessage(firstMessage)) {
            project.fallbackMessage = firstMessage
        }
        return project
    }

    const initialProject = makeInitialProject()
    let draft = $state(initialProject)
    let selectedStageId = $state('')
    let presentationOptionId = $state('')
    let editLocale: FirstMessageStudioLocale = $state(resolveStudioProjectLocale(initialProject, {}, getCurrentLocale()))
    let editorMode: 'content' | 'languages' | 'variables' | 'scenarios' | 'design' | 'code' | 'share' = $state('content')
    let showAiTranslation = $state(false)
    let translationSource = $state(initialProject.localization.defaultLanguage)
    let translationTarget = $state(initialProject.localization.languages.find((language) => language.id !== initialProject.localization.defaultLanguage)?.id ?? initialProject.localization.defaultLanguage)
    let translating = $state(false)
    let translationMessage = $state('')
    let shareMessage = $state('')
    let translationController: AbortController | undefined
    let selectedStage = $derived(draft.stages.find((stage) => stage.id === selectedStageId) ?? draft.stages[0])
    let presentationOption = $derived(selectedStage?.options.find((option) => option.id === presentationOptionId) ?? selectedStage?.options[0])
    let scenarioVariableNames = $derived.by(() => {
        const names = new Set<string>()
        if (draft.stageVariable) names.add(draft.stageVariable)
        if (draft.localization.variable) names.add(draft.localization.variable)
        for (const variable of draft.variables) if (variable.name) names.add(variable.name)
        for (const stage of draft.stages) {
            for (const option of stage.options) {
                for (const effect of option.effects) if (effect.variable) names.add(effect.variable)
                if (option.input?.variable) names.add(option.input.variable)
                if (option.input?.displayVariable) names.add(option.input.displayVariable)
            }
        }
        return [...names]
    })

    function localized(value: FirstMessageStudioText | undefined) {
        if (typeof value === 'string') return value
        return value?.[editLocale] ?? ''
    }

    function editStage(id: string) {
        selectedStageId = id
        editorMode = 'content'
    }

    function setLocalized(value: FirstMessageStudioText | undefined, nextValue: string): FirstMessageStudioText {
        return setStudioTextLanguage(value, editLocale, nextValue, draft.localization.languages)
    }

    function newLocalized(value: string): FirstMessageStudioText {
        return setStudioTextLanguage(undefined, editLocale, value, draft.localization.languages)
    }

    function migrateTextLanguage(value: FirstMessageStudioText | undefined, previous: string, next: string) {
        if (!value || typeof value === 'string' || !(previous in value)) return value
        const migrated = { ...value, [next]: value[previous] }
        delete migrated[previous]
        return migrated
    }

    function renameLanguage(language: FirstMessageStudioLanguage, nextIdValue: string) {
        const nextId = nextIdValue.trim().replace(/[^a-zA-Z0-9_-]+/g, '-')
        const previous = language.id
        if (!nextId || nextId === previous || draft.localization.languages.some((candidate) => candidate !== language && candidate.id === nextId)) return
        const migrate = (value: FirstMessageStudioText | undefined) => migrateTextLanguage(value, previous, nextId)
        draft.title = migrate(draft.title)!
        for (const variable of draft.variables) {
            variable.label = migrate(variable.label)!
            for (const choice of variable.choices) {
                choice.label = migrate(choice.label)!
                choice.value = migrate(choice.value)!
            }
        }
        for (const stage of draft.stages) {
            stage.tag = migrate(stage.tag)!
            stage.title = migrate(stage.title)!
            stage.speaker = migrate(stage.speaker)
            stage.description = migrate(stage.description)!
            for (const option of stage.options) {
                option.label = migrate(option.label)!
                option.description = migrate(option.description)
                option.badge = migrate(option.badge)
                for (const effect of option.effects) effect.value = migrate(effect.value)!
                if (option.input) {
                    option.input.label = migrate(option.input.label)!
                    option.input.placeholder = migrate(option.input.placeholder)
                }
                if (option.presentation) {
                    option.presentation.speaker = migrate(option.presentation.speaker)
                    option.presentation.description = migrate(option.presentation.description)!
                }
            }
        }
        for (const rule of draft.scenarioRules) rule.message = migrate(rule.message)!
        language.id = nextId
        if (draft.localization.defaultLanguage === previous) draft.localization.defaultLanguage = nextId
        if (editLocale === previous) editLocale = nextId
        if (translationSource === previous) translationSource = nextId
        if (translationTarget === previous) translationTarget = nextId
    }

    function addLanguage() {
        const id = uniqueId('language', draft.localization.languages.map((language) => language.id))
        draft.localization.languages.push({ id, label: '새 언어', value: id })
        editLocale = id
        translationTarget = id
    }

    function removeLanguage(index: number) {
        if (draft.localization.languages.length === 1) return
        const [removed] = draft.localization.languages.splice(index, 1)
        const fallback = draft.localization.languages[0].id
        if (draft.localization.defaultLanguage === removed.id) draft.localization.defaultLanguage = fallback
        if (editLocale === removed.id) editLocale = fallback
        if (translationSource === removed.id) translationSource = fallback
        if (translationTarget === removed.id) translationTarget = fallback
    }

    async function translateStudio() {
        translationMessage = ''
        if (translationSource === translationTarget) {
            translationMessage = '원본 언어와 번역 언어가 같습니다.'
            return
        }
        const entries = collectFirstMessageStudioTranslationEntries(draft, translationSource)
        if (entries.length === 0) {
            translationMessage = '원본 언어에 번역할 문구가 없습니다.'
            return
        }
        const source = draft.localization.languages.find((language) => language.id === translationSource)
        const target = draft.localization.languages.find((language) => language.id === translationTarget)
        const controller = new AbortController()
        translationController = controller
        translating = true
        try {
            const response = await requestChatData({
                formated: [{ role: 'user', content: buildFirstMessageStudioTranslationPrompt(entries, source?.label ?? translationSource, target?.label ?? translationTarget) }],
                bias: {},
                currentChar: character,
                useStreaming: false,
                noMultiGen: true,
                tools: [],
                disablePromptCache: true,
                logSource: 'other',
            }, 'model', controller.signal)
            if (controller.signal.aborted) return
            if (response.type !== 'success') throw new Error('translation-request-failed')
            const translations = parseFirstMessageStudioTranslations(response.result, entries.map((entry) => entry.id))
            draft = applyFirstMessageStudioTranslations($state.snapshot(draft), translationTarget, translations)
            editLocale = translationTarget
            translationMessage = `${entries.length}개 문구를 번역했습니다.`
        }
        catch (cause) {
            if (!controller.signal.aborted) {
                translationMessage = cause instanceof Error && cause.message === 'translation-response-incomplete'
                    ? '일부 번역이 빠졌습니다. 다시 시도해 주세요.'
                    : '번역 결과를 적용하지 못했습니다. 다시 시도해 주세요.'
            }
        }
        finally {
            if (translationController === controller) translationController = undefined
            translating = false
        }
    }

    onDestroy(() => translationController?.abort())

    function uniqueId(prefix: string, values: string[]) {
        let index = values.length + 1
        while (values.includes(`${prefix}-${index}`)) index++
        return `${prefix}-${index}`
    }

    function addStage() {
        const id = uniqueId('stage', draft.stages.map((stage) => stage.id))
        draft.stages.push({
            id,
            tag: newLocalized('단계'),
            title: newLocalized('새 화면'),
            description: newLocalized('안내나 질문을 적어 주세요.'),
            optionPresentationEnabled: false,
            options: [],
        })
        selectedStageId = id
    }

    function moveStage(direction: -1 | 1) {
        if (!selectedStage) return
        const index = draft.stages.findIndex((stage) => stage.id === selectedStage.id)
        const target = index + direction
        if (index < 0 || target < 0 || target >= draft.stages.length) return
        const [moved] = draft.stages.splice(index, 1)
        draft.stages.splice(target, 0, moved)
    }

    function removeStage() {
        if (!selectedStage || draft.stages.length === 1) return
        const removed = selectedStage.id
        draft.stages = draft.stages.filter((stage) => stage.id !== removed)
        for (const stage of draft.stages) {
            for (const option of stage.options) if (option.nextStageId === removed) option.nextStageId = undefined
        }
        if (draft.startStageId === removed) draft.startStageId = draft.stages[0].id
        selectedStageId = draft.stages[0].id
    }

    function addOption() {
        if (!selectedStage) return
        const option: FirstMessageStudioOption = {
            id: uniqueId('choice', selectedStage.options.map((option) => option.id)),
            label: newLocalized('새 선택지'),
            description: newLocalized(''),
            effects: draft.variables[0] ? [{ variable: draft.variables[0].name, value: '' }] : [],
        }
        if (selectedStage.optionPresentationEnabled) option.presentation = newOptionPresentation()
        selectedStage.options.push(option)
    }

    function removeOption(id: string) {
        if (selectedStage) selectedStage.options = selectedStage.options.filter((option) => option.id !== id)
    }

    function moveOption(index: number, direction: -1 | 1) {
        if (!selectedStage) return
        const target = index + direction
        if (target < 0 || target >= selectedStage.options.length) return
        const [moved] = selectedStage.options.splice(index, 1)
        selectedStage.options.splice(target, 0, moved)
    }

    function selectSkin(preset: FirstMessageStudioSkinPreset) {
        draft.appearance = preset === 'custom' ? { ...draft.appearance, preset } : createStudioAppearance(preset)
    }

    function addEffect(option: FirstMessageStudioOption) {
        option.effects.push({ variable: draft.variables[0]?.name ?? 'variable_name', value: '' })
    }

    function toggleInput(option: FirstMessageStudioOption, checked: boolean) {
        option.input = checked ? {
            variable: draft.variables[0]?.name ?? 'custom_input',
            label: newLocalized('직접 입력'),
            placeholder: newLocalized('여기에 입력하세요'),
            required: true,
        } : undefined
    }

    function newOptionPresentation() {
        return {
            speaker: newLocalized(''),
            description: newLocalized(''),
            imageEnabled: false,
            imageFrame: 'contain' as const,
            imagePositionX: 50,
            imagePositionY: 50,
        }
    }

    function ensureOptionPresentation(option: FirstMessageStudioOption) {
        option.presentation ??= newOptionPresentation()
        return option.presentation
    }

    function toggleOptionPresentations(checked: boolean) {
        if (!selectedStage) return
        selectedStage.optionPresentationEnabled = checked
        if (checked) {
            for (const option of selectedStage.options) ensureOptionPresentation(option)
            presentationOptionId = selectedStage.options[0]?.id ?? ''
        }
    }

    function selectPresentationOption(option: FirstMessageStudioOption) {
        ensureOptionPresentation(option)
        presentationOptionId = option.id
    }

    function uniquePresentationAssetName(option: FirstMessageStudioOption, fileName: string) {
        const safeName = fileName.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'illustration.png'
        const prefix = `fmstudio-${selectedStage?.id ?? 'stage'}-${option.id}-`
        const base = `${prefix}${safeName}`
        const existing = new Set((character.additionalAssets ?? []).map((asset) => asset[0]))
        if (!existing.has(base)) return base
        const dot = base.lastIndexOf('.')
        const stem = dot > 0 ? base.slice(0, dot) : base
        const extension = dot > 0 ? base.slice(dot) : ''
        let index = 2
        while (existing.has(`${stem}-${index}${extension}`)) index++
        return `${stem}-${index}${extension}`
    }

    async function uploadPresentationImage(option: FirstMessageStudioOption) {
        const files = await selectFileByDom(['png', 'webp', 'jpeg', 'jpg', 'gif', 'avif'])
        const file = files?.[0]
        if (!file) return
        const extension = file.name.split('.').pop()?.toLowerCase() || 'png'
        const assetName = uniquePresentationAssetName(option, file.name)
        const assetPath = await saveAsset(new Uint8Array(await file.arrayBuffer()), '', extension)
        character.additionalAssets = [...(character.additionalAssets ?? []), [assetName, assetPath, extension]]
        const presentation = ensureOptionPresentation(option)
        presentation.imageEnabled = true
        presentation.imageAssetName = assetName
    }

    function addVariable() {
        const names = draft.variables.map((variable) => variable.name)
        const name = uniqueId('variable', names)
        draft.variables.push({
            name,
            label: newLocalized('새 변수'),
            defaultValue: '',
            choices: [],
        })
    }

    function removeVariable(index: number) {
        draft.variables.splice(index, 1)
    }

    function moveVariable(index: number, direction: -1 | 1) {
        const target = index + direction
        if (target < 0 || target >= draft.variables.length) return
        const [moved] = draft.variables.splice(index, 1)
        draft.variables.splice(target, 0, moved)
    }

    function renameVariable(variable: FirstMessageStudioVariable, nextName: string) {
        const previousName = variable.name
        variable.name = nextName
        if (!previousName || previousName === nextName) return
        for (const stage of draft.stages) {
            for (const option of stage.options) {
                for (const effect of option.effects) if (effect.variable === previousName) effect.variable = nextName
                if (option.input?.variable === previousName) option.input.variable = nextName
                if (option.input?.displayVariable === previousName) option.input.displayVariable = nextName
            }
        }
    }

    function newScenarioCondition() {
        return { variable: scenarioVariableNames[0] ?? '', operator: 'equals' as const, value: '' }
    }

    function addScenarioRule() {
        const id = uniqueId('scenario', draft.scenarioRules.map((rule) => rule.id))
        draft.scenarioRules.push({
            id,
            label: '새 시나리오',
            message: newLocalized(''),
            groups: [{ id: `${id}-group-1`, conditions: [newScenarioCondition()] }],
        })
    }

    function moveScenarioRule(index: number, direction: -1 | 1) {
        const target = index + direction
        if (target < 0 || target >= draft.scenarioRules.length) return
        const [moved] = draft.scenarioRules.splice(index, 1)
        draft.scenarioRules.splice(target, 0, moved)
    }

    function removeScenarioRule(index: number) {
        draft.scenarioRules.splice(index, 1)
    }

    function addScenarioGroup(rule: FirstMessageStudioScenarioRule) {
        const id = uniqueId(`${rule.id}-group`, rule.groups.map((group) => group.id))
        rule.groups.push({ id, conditions: [newScenarioCondition()] })
    }

    function addScenarioCondition(group: FirstMessageStudioScenarioGroup) {
        group.conditions.push(newScenarioCondition())
    }

    function save() {
        const project = normalizeFirstMessageStudioProject($state.snapshot(draft))
        character.firstMessageStudio = project
        const currentChat = character.chats?.[character.chatPage]
        if (currentChat) currentChat.scriptstate = resetFirstMessageStudioScriptstate(project, currentChat.scriptstate ?? {})
        if (project.compatibilityEnabled) {
            const compiled = compileFirstMessageStudioCompatibility(project)
            character.firstMessage = compiled.firstMessage
            character.triggerscript = mergeFirstMessageStudioTriggers(character.triggerscript ?? [], compiled.triggers)
            character.defaultVariables = mergeFirstMessageStudioDefaultVariables(character.defaultVariables ?? '', compiled.defaultVariables)
        }
        else {
            character.firstMessage = project.fallbackMessage
            character.triggerscript = mergeFirstMessageStudioTriggers(character.triggerscript ?? [], [])
            character.defaultVariables = mergeFirstMessageStudioDefaultVariables(character.defaultVariables ?? '', '')
        }
        onClose()
    }

    async function exportProject() {
        shareMessage = ''
        const filename = `${character.name || 'character'}-first-message-studio.json`.replace(/[\\/:*?"<>|]+/g, '-')
        await downloadFile(filename, new TextEncoder().encode(exportFirstMessageStudioProject($state.snapshot(draft))))
        shareMessage = '스튜디오 프로젝트를 내보냈습니다.'
    }

    async function importProject() {
        shareMessage = ''
        try {
            const files = await selectFileByDom(['json'])
            if (!files?.[0]) return
            draft = importFirstMessageStudioProject(await files[0].text())
            selectedStageId = draft.startStageId
            editLocale = draft.localization.defaultLanguage
            translationSource = draft.localization.defaultLanguage
            translationTarget = draft.localization.languages.find((language) => language.id !== draft.localization.defaultLanguage)?.id ?? draft.localization.defaultLanguage
            shareMessage = '스튜디오 프로젝트를 불러왔습니다. 저장하기 전까지 캐릭터에는 적용되지 않습니다.'
        }
        catch (cause) {
            shareMessage = cause instanceof Error ? cause.message : '프로젝트를 불러오지 못했습니다.'
        }
    }
</script>

<div
    class="risu-modal-overlay overlay"
    role="dialog"
    aria-modal="true"
    aria-label="퍼스트 메시지 스튜디오"
    tabindex="-1"
    onclick={(event) => {
        if (event.target === event.currentTarget) onClose()
    }}
    onkeydown={(event) => {
        if (event.key === 'Escape') onClose()
    }}
>
    <section data-skin-part="modal" class="risu-modal-surface shell">
        <header class="risu-modal-header topbar">
            <div class="title-row" data-studio-title-row>
                <h2>퍼스트 메시지 스튜디오</h2>
                <p>누구나 쉽게 만드는 퍼스트 메시지</p>
                <label class="studio-enabled" data-studio-enabled-toggle title="끄면 스튜디오 선택기 대신 기존 퍼스트 메시지를 사용합니다.">
                    <input class="studio-toggle-input" type="checkbox" bind:checked={draft.enabled}/>
                    <span class="studio-toggle-track" data-studio-enabled-track aria-hidden="true"><i></i></span>
                    <span>스튜디오 사용</span>
                </label>
            </div>
            <div class="top-actions" data-studio-top-actions>
                <button class="risu-modal-close" type="button" aria-label="닫기" onclick={onClose}>✕</button>
            </div>
        </header>

        <main class="workspace">
            <aside class="rail">
                <div class="rail-title"><span>화면</span><button type="button" data-studio-add-stage onclick={addStage}>＋ 새 화면</button></div>
                <div class="stage-list">
                    {#each draft.stages as stage, index}
                        <button
                            type="button"
                            data-studio-editor-stage={stage.id}
                            class:active={!selectedStageId ? stage.id === draft.startStageId : stage.id === selectedStageId}
                            onclick={() => editStage(stage.id)}
                        >
                            <small>STEP {index + 1}</small>
                            <strong>{localized(stage.title)}</strong>
                            <span>{stage.options.length}개 선택지</span>
                        </button>
                    {/each}
                </div>
                <div class="rail-move">
                    <button type="button" data-studio-move-stage-up onclick={() => moveStage(-1)} disabled={draft.stages.indexOf(selectedStage) <= 0}>↑ 이동</button>
                    <button type="button" data-studio-move-stage-down onclick={() => moveStage(1)} disabled={draft.stages.indexOf(selectedStage) >= draft.stages.length - 1}>↓ 이동</button>
                </div>
                <button class="rail-action danger" type="button" data-studio-remove-stage onclick={removeStage} disabled={draft.stages.length === 1}>화면 삭제</button>
            </aside>

            <section class="editor">
                <nav class="mode-tabs" data-studio-primary-toolbar aria-label="스튜디오 편집 영역">
                    <button type="button" data-studio-languages-tab class:active={editorMode === 'languages'} onclick={() => editorMode = 'languages'}>언어</button>
                    <button type="button" data-studio-variables-tab class:active={editorMode === 'variables'} onclick={() => editorMode = 'variables'}>변수</button>
                    <button type="button" data-studio-scenarios-tab class:active={editorMode === 'scenarios'} onclick={() => editorMode = 'scenarios'}>시나리오</button>
                    <button type="button" data-studio-design-tab class:active={editorMode === 'design'} onclick={() => editorMode = 'design'}>창 디자인</button>
                    <button type="button" data-studio-code-tab class:active={editorMode === 'code'} onclick={() => editorMode = 'code'}>고급 코드</button>
                    <button type="button" data-studio-share-tab class:active={editorMode === 'share'} onclick={() => editorMode = 'share'}>공유</button>
                </nav>

                {#if editorMode === 'content' || editorMode === 'scenarios'}
                    <section class="screen-toolbar" data-studio-screen-toolbar aria-label="화면 번역 편집 도구">
                        <span aria-hidden="true"></span>
                        <button
                            type="button"
                            data-studio-ai-translation-toggle
                            class:active={showAiTranslation}
                            title="프로젝트의 모든 화면·선택지·변수 표시 문구를 원본 언어에서 대상 언어로 번역합니다. 변수명과 저장값은 변경하지 않습니다."
                            onclick={() => showAiTranslation = !showAiTranslation}
                        >UI 자동번역</button>
                        <label>편집 언어
                            <select data-studio-edit-language value={editLocale} onchange={(event) => editLocale = event.currentTarget.value}>
                                {#each draft.localization.languages as language}<option value={language.id}>{language.label}</option>{/each}
                            </select>
                        </label>
                    </section>
                {/if}
                {#if (editorMode === 'content' || editorMode === 'scenarios') && showAiTranslation}
                    <section class="translation-panel" data-studio-ai-translation-panel>
                        <div>
                            <strong>메인 모델로 UI 문구 번역</strong>
                            <small>화면 제목·설명·선택지처럼 사용자에게 보이는 문구만 번역합니다. 변수명과 저장값은 건드리지 않습니다.</small>
                        </div>
                        <label>원본 언어
                            <select value={translationSource} onchange={(event) => translationSource = event.currentTarget.value}>
                                {#each draft.localization.languages as language}<option value={language.id}>{language.label}</option>{/each}
                            </select>
                        </label>
                        <label>번역 언어
                            <select data-studio-ai-target-language value={translationTarget} onchange={(event) => translationTarget = event.currentTarget.value}>
                                {#each draft.localization.languages as language}<option value={language.id}>{language.label}</option>{/each}
                            </select>
                        </label>
                        <button type="button" data-studio-ai-translate disabled={translating || translationSource === translationTarget} onclick={translateStudio}>{translating ? '번역 중…' : '프로젝트 전체 번역'}</button>
                        {#if translationMessage}<p>{translationMessage}</p>{/if}
                    </section>
                {/if}

                {#if editorMode === 'languages'}
                    <section class="language-page" data-studio-language-settings>
                        <div class="section-heading">
                            <div><span>LOCALIZATION</span><h3>프로젝트 언어 설정</h3><p>편집할 언어와 퍼스트 메시지에서 저장할 언어 변수값을 관리합니다.</p></div>
                            <button type="button" data-studio-add-language onclick={addLanguage}>＋ 언어 추가</button>
                        </div>
                        <div class="language-settings">
                            <div class="language-project-fields">
                                <label>언어 변수 이름<input data-studio-language-variable bind:value={draft.localization.variable} placeholder="cv_lang"/></label>
                                <label>기본 언어<select bind:value={draft.localization.defaultLanguage}>{#each draft.localization.languages as language}<option value={language.id}>{language.label}</option>{/each}</select></label>
                            </div>
                            <div class="language-list-heading"><div><strong>프로젝트 언어</strong><small>언어 키는 번역 데이터에, 변수 저장값은 퍼스트 메시지의 언어 선택 결과에 사용됩니다.</small></div></div>
                            <div class="language-list">
                                {#each draft.localization.languages as language, languageIndex}
                                    <article class="language-row" data-studio-language={language.id}>
                                        <b>{String(languageIndex + 1).padStart(2, '0')}</b>
                                        <label>언어 키<input value={language.id} onchange={(event) => renameLanguage(language, event.currentTarget.value)} placeholder="ko"/></label>
                                        <label>표시 이름<input bind:value={language.label} placeholder="한국어"/></label>
                                        <label>변수 저장값<input bind:value={language.value} placeholder="1"/></label>
                                        <button type="button" aria-label={`${language.label} 삭제`} onclick={() => removeLanguage(languageIndex)} disabled={draft.localization.languages.length === 1}>삭제</button>
                                    </article>
                                {/each}
                            </div>
                        </div>
                    </section>
                {:else if editorMode === 'variables'}
                    <section class="variable-editor">
                        <div class="section-heading">
                            <div><span>VARIABLES</span><h3>변수</h3><p>선택 결과를 저장하거나 시나리오 조건에서 사용할 변수를 관리합니다.</p></div>
                            <button type="button" data-studio-add-variable onclick={addVariable}>＋ 변수 등록</button>
                        </div>
                        {#if draft.variables.length === 0}
                            <div class="empty-state">아직 등록한 변수가 없습니다. 화면의 선택 결과나 시나리오 조건에 사용할 변수를 추가하세요.</div>
                        {:else}
                            <div class="variable-list">
                                <div class="variable-list-header" aria-hidden="true">
                                    <span data-studio-variable-name-label title="선택 결과를 저장하고 시나리오 조건식에서 참조하는 내부 변수 이름입니다.">변수 이름</span>
                                    <span data-studio-variable-label-label title="스튜디오 화면에서 이 변수를 알아보기 쉽게 표시하는 이름입니다. 실행 결과에는 영향을 주지 않습니다.">표시 이름</span>
                                    <span data-studio-variable-default-label title="사용자가 값을 선택하기 전에 변수에 들어 있는 초기값입니다.">기본값</span>
                                    <span></span><span></span><span></span>
                                </div>
                                {#each draft.variables as variable, variableIndex}
                                    <div class="variable-row" data-studio-variable={variable.name}>
                                        <input
                                            aria-label="변수 이름"
                                            data-studio-variable-name
                                            title="선택 결과를 저장하고 시나리오 조건식에서 참조하는 내부 변수 이름입니다."
                                            value={variable.name}
                                            oninput={(event) => renameVariable(variable, event.currentTarget.value)}
                                            placeholder="route"
                                        />
                                        <input
                                            aria-label="표시 이름"
                                            data-studio-variable-label
                                            title="스튜디오 화면에서 이 변수를 알아보기 쉽게 표시하는 이름입니다. 실행 결과에는 영향을 주지 않습니다."
                                            value={localized(variable.label)}
                                            oninput={(event) => variable.label = setLocalized(variable.label, event.currentTarget.value)}
                                            placeholder="주인공 유형"
                                        />
                                        <input
                                            aria-label="기본값"
                                            data-studio-variable-default
                                            title="사용자가 값을 선택하기 전에 변수에 들어 있는 초기값입니다."
                                            bind:value={variable.defaultValue}
                                            placeholder="1"
                                        />
                                        <button type="button" data-studio-move-variable-up title="이 변수를 목록에서 위로 이동합니다." aria-label="변수 위로 이동" onclick={() => moveVariable(variableIndex, -1)} disabled={variableIndex === 0}>↑</button>
                                        <button type="button" data-studio-move-variable-down title="이 변수를 목록에서 아래로 이동합니다." aria-label="변수 아래로 이동" onclick={() => moveVariable(variableIndex, 1)} disabled={variableIndex === draft.variables.length - 1}>↓</button>
                                        <button class="delete" type="button" data-studio-delete-variable title="이 변수의 기본값 등록을 삭제합니다. 화면 선택지에 이미 연결된 저장 동작은 유지됩니다." onclick={() => removeVariable(variableIndex)}>삭제</button>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </section>
                {:else if editorMode === 'scenarios'}
                    <section class="scenario-editor" data-studio-scenario-settings>
                        <div class="section-heading">
                            <div><span>SCENARIOS</span><h3>완료 후 시나리오</h3><p>위에서부터 조건을 확인해 처음 맞는 시나리오를 표시합니다. 묶음끼리는 모두 맞아야 하고(AND), 한 묶음 안에서는 하나만 맞으면 됩니다(OR).</p></div>
                            <button type="button" data-studio-add-scenario onclick={addScenarioRule}>＋ 시나리오 추가</button>
                        </div>
                        <datalist id="studio-scenario-variables" data-studio-scenario-variables>
                            {#each scenarioVariableNames as name}<option value={name}></option>{/each}
                        </datalist>
                        {#if draft.scenarioRules.length === 0}
                            <div class="empty-state">아직 시나리오가 없습니다. 선택이 끝난 뒤 조건별로 다른 첫 메시지를 보여 주려면 추가하세요.</div>
                        {/if}
                        {#each draft.scenarioRules as rule, ruleIndex}
                            <article class="scenario-card" data-studio-scenario-rule={rule.id}>
                                <header class="scenario-header">
                                    <b>{String(ruleIndex + 1).padStart(2, '0')}</b>
                                    <label>관리용 이름<input data-studio-scenario-label bind:value={rule.label} placeholder="예: 시골 주인공 · 정사 루트"/></label>
                                    <div class="scenario-actions">
                                        <button type="button" data-studio-move-scenario-up onclick={() => moveScenarioRule(ruleIndex, -1)} disabled={ruleIndex === 0}>↑</button>
                                        <button type="button" data-studio-move-scenario-down onclick={() => moveScenarioRule(ruleIndex, 1)} disabled={ruleIndex === draft.scenarioRules.length - 1}>↓</button>
                                        <button class="delete" type="button" data-studio-delete-scenario onclick={() => removeScenarioRule(ruleIndex)}>삭제</button>
                                    </div>
                                </header>
                                <div class="scenario-body">
                                    <div class="scenario-groups">
                                        {#each rule.groups as group, groupIndex}
                                            {#if groupIndex > 0}<div class="logic-divider"><span>AND · 이 묶음도 맞아야 함</span></div>{/if}
                                            <section class="scenario-group" data-studio-scenario-group={group.id}>
                                                <header><strong>조건 묶음 {groupIndex + 1}</strong><small>아래 조건 중 하나만 맞으면 통과 (OR)</small></header>
                                                {#each group.conditions as condition, conditionIndex}
                                                    {#if conditionIndex > 0}<div class="or-divider">또는</div>{/if}
                                                    <div class="condition-row" data-studio-scenario-condition>
                                                        <label>변수<input data-studio-scenario-variable list="studio-scenario-variables" bind:value={condition.variable} placeholder="cv_start"/></label>
                                                        <label>비교<select data-studio-scenario-operator bind:value={condition.operator}><option value="equals">같음</option><option value="not-equals">다름</option></select></label>
                                                        <label>값<input data-studio-scenario-value bind:value={condition.value} placeholder="1"/></label>
                                                        <button type="button" aria-label="조건 삭제" onclick={() => group.conditions.splice(conditionIndex, 1)} disabled={group.conditions.length === 1}>✕</button>
                                                    </div>
                                                {/each}
                                                <button class="condition-add" type="button" data-studio-add-condition onclick={() => addScenarioCondition(group)}>＋ 또는 조건 추가</button>
                                            </section>
                                        {/each}
                                    </div>
                                    <button class="group-add" type="button" data-studio-add-condition-group onclick={() => addScenarioGroup(rule)}>＋ AND 조건 묶음 추가</button>
                                    <label class="scenario-message">이 조건에서 사용할 첫 메시지<textarea data-studio-scenario-message rows="12" value={localized(rule.message)} oninput={(event) => rule.message = setLocalized(rule.message, event.currentTarget.value)} placeholder="선택이 끝난 뒤 표시할 메시지를 적으세요."></textarea></label>
                                </div>
                            </article>
                        {/each}
                    </section>
                {:else if editorMode === 'design'}
                    <section class="design-editor">
                        <div class="section-heading"><div><span>WINDOW</span><h3>색상과 형태</h3><p>기본 창의 외형만 설정합니다. 특수 표현은 고급 코드에서 추가할 수 있습니다.</p></div></div>
                        <div class="skin-grid">
                            <button type="button" data-studio-skin="minimal" class:active={draft.appearance.preset === 'minimal'} onclick={() => selectSkin('minimal')}><i class="skin-swatch minimal"></i><strong>Minimal</strong><small>단정한 기본 창</small></button>
                            <button type="button" data-studio-skin="glass" class:active={draft.appearance.preset === 'glass'} onclick={() => selectSkin('glass')}><i class="skin-swatch glass"></i><strong>Glass</strong><small>투명한 패널</small></button>
                            <button type="button" data-studio-skin="custom" class:active={draft.appearance.preset === 'custom'} onclick={() => selectSkin('custom')}><i class="skin-swatch custom"></i><strong>Custom</strong><small>현재 값 직접 조정</small></button>
                        </div>
                        <div class="design-card">
                            <div class="color-grid">
                                <label>강조색<span class="color-input"><input type="color" data-studio-accent-color bind:value={draft.appearance.accentColor}/><input bind:value={draft.appearance.accentColor}/></span></label>
                                <label>창 배경<span class="color-input"><input type="color" bind:value={draft.appearance.backgroundColor}/><input bind:value={draft.appearance.backgroundColor}/></span></label>
                                <label>내용 배경<span class="color-input"><input type="color" bind:value={draft.appearance.surfaceColor}/><input bind:value={draft.appearance.surfaceColor}/></span></label>
                                <label>글자색<span class="color-input"><input type="color" bind:value={draft.appearance.textColor}/><input bind:value={draft.appearance.textColor}/></span></label>
                            </div>
                            <div class="two-columns">
                                <label>선택지 한 줄 개수<select data-studio-option-columns bind:value={draft.appearance.optionColumns}><option value={1}>1개</option><option value={2}>2개</option><option value={3}>3개</option></select></label>
                                <label>모서리 둥글기 <b>{draft.appearance.cornerRadius}px</b><input type="range" min="0" max="32" bind:value={draft.appearance.cornerRadius}/></label>
                            </div>
                        </div>
                        <div class="design-card toggles">
                            <header><strong>보이거나 숨길 기본 요소</strong></header>
                            <label class="check"><input type="checkbox" bind:checked={draft.appearance.showHeader}/> 창 제목</label>
                            <label class="check"><input type="checkbox" bind:checked={draft.appearance.showProgress}/> 진행 단계</label>
                            <label class="check"><input type="checkbox" bind:checked={draft.appearance.showNavigation}/> 이전 / 처음부터 버튼</label>
                        </div>
                    </section>
                {:else if editorMode === 'code'}
                    <section class="code-editor">
                        <div class="section-heading"><div><span>ADVANCED</span><h3>고급 표현 코드</h3><p>기본 기능에 없는 장식이나 상태 표시는 여기서 추가합니다.</p></div></div>
                        <article class="code-card">
                            <header><div><strong>사용자 CSS</strong><small><code>:scope</code>는 이 창 하나를 뜻합니다. 다른 채팅 UI에는 적용되지 않습니다.</small></div></header>
                            <textarea data-studio-custom-css class="code-area" rows="14" bind:value={draft.customCss} spellcheck="false" placeholder={':scope { border-width: 2px; }\n.studio-extra { color: #7dd3fc; }'}></textarea>
                        </article>
                        <article class="code-card">
                            <header><div><strong>추가 HTML</strong><small>창 본문 위에 삽입됩니다. <code>{'{{variable_name}}'}</code>으로 변수를 표시할 수 있습니다. 스크립트와 이벤트 속성은 안전을 위해 제거됩니다.</small></div></header>
                            <textarea data-studio-custom-html class="code-area" rows="10" bind:value={draft.customHtml} spellcheck="false" placeholder={'<div class="studio-extra">선택: {{route}}</div>'}></textarea>
                        </article>
                    </section>
                {:else if editorMode === 'share'}
                    <section class="share-editor" data-studio-share-settings>
                        <div class="section-heading"><div><span>SHARE</span><h3>공유와 Risu 호환</h3><p>편집 가능한 원본과 일반 Risu가 실행할 결과를 함께 관리합니다.</p></div></div>
                        <article class="share-card">
                            <div><strong>스튜디오 프로젝트</strong><small>화면, 선택지, 번역, 디자인과 완료 후 메시지를 하나의 JSON 파일로 옮깁니다.</small></div>
                            <div class="share-actions">
                                <button type="button" data-studio-export-project onclick={exportProject}>프로젝트 내보내기</button>
                                <button type="button" data-studio-import-project onclick={importProject}>프로젝트 가져오기</button>
                            </div>
                        </article>
                        <article class="share-card compatibility-card">
                            <div><strong>일반 Risu 호환 결과</strong><small>저장할 때 표준 퍼스트 메시지, 기본 변수와 버튼 트리거를 생성합니다. 스튜디오 원본은 카드 확장 필드에 그대로 남아 다시 편집할 수 있습니다.</small></div>
                            <label class="switch" data-studio-compatibility-toggle><input type="checkbox" bind:checked={draft.compatibilityEnabled}/> 저장 시 호환 결과 포함</label>
                        </article>
                        <article class="share-card fallback-card">
                            <div><strong>완료 후 원문 메시지</strong><small>선택기가 끝난 뒤 표시할 실제 첫 메시지입니다. 호환 결과 안에 포함되지만 이 원본은 별도로 보존됩니다.</small></div>
                            <textarea data-studio-fallback-message rows="12" bind:value={draft.fallbackMessage}></textarea>
                        </article>
                        {#if shareMessage}<p class="share-message">{shareMessage}</p>{/if}
                    </section>
                {:else}
                    {#if selectedStage}
                        <div class="form-box">
                            <label>화면 태그<input value={localized(selectedStage.tag)} oninput={(event) => selectedStage.tag = setLocalized(selectedStage.tag, event.currentTarget.value)}/></label>
                            <label>화면 제목<input data-studio-stage-title value={localized(selectedStage.title)} oninput={(event) => selectedStage.title = setLocalized(selectedStage.title, event.currentTarget.value)}/></label>
                            <label class="check presentation-master-toggle" title="선택지에 마우스를 올리거나 키보드로 초점을 맞출 때 메인 삽화와 설명을 바꿉니다."><input data-studio-option-presentation-toggle type="checkbox" checked={selectedStage.optionPresentationEnabled} onchange={(event) => toggleOptionPresentations(event.currentTarget.checked)}/> 선택지별 메인 삽화와 설명 사용</label>
                            {#if !selectedStage.optionPresentationEnabled}
                                <label>화자 <span class="optional">선택 사항 · 비우면 표시하지 않음</span><input data-studio-stage-speaker value={localized(selectedStage.speaker)} oninput={(event) => selectedStage.speaker = event.currentTarget.value ? setLocalized(selectedStage.speaker, event.currentTarget.value) : undefined}/></label>
                                <label>질문 · 설명<textarea rows="2" value={localized(selectedStage.description)} oninput={(event) => selectedStage.description = setLocalized(selectedStage.description, event.currentTarget.value)}></textarea></label>
                            {/if}
                        </div>

                        {#if selectedStage.optionPresentationEnabled}
                            <section class="presentation-editor" data-studio-option-presentation-editor>
                                <div class="presentation-editor-heading"><div><strong>선택지 프레젠테이션</strong><small>탭마다 호버 시 표시할 화자·설명·삽화를 설정합니다.</small></div></div>
                                {#if selectedStage.options.length === 0}
                                    <div class="empty-state">먼저 이 화면에 선택지를 추가하세요.</div>
                                {:else}
                                    <div class="presentation-tabs" role="tablist" aria-label="선택지 프레젠테이션">
                                        {#each selectedStage.options as option, optionIndex}
                                            <button type="button" role="tab" data-studio-presentation-tab={option.id} class:active={presentationOption?.id === option.id} aria-selected={presentationOption?.id === option.id} onclick={() => selectPresentationOption(option)}><b>{String(optionIndex + 1).padStart(2, '0')}</b>{localized(option.label) || `선택지 ${optionIndex + 1}`}</button>
                                        {/each}
                                    </div>
                                    {#if presentationOption}
                                        {@const presentation = ensureOptionPresentation(presentationOption)}
                                        <div class="presentation-fields" role="tabpanel">
                                            <div class="presentation-image-controls">
                                                <label class="check" title="끄면 이 선택지는 삽화 없이 화자와 설명만 넓게 표시합니다."><input data-studio-presentation-image-toggle type="checkbox" bind:checked={presentation.imageEnabled}/> 선택지 삽화 사용</label>
                                                {#if presentation.imageEnabled}
                                                    <label class="frame-mode-field" title="삽화를 표시할 프레임 형태를 정합니다. 잘리는 위치는 아래 미리보기에서 직접 조절합니다.">삽화 프레임
                                                        <select data-studio-presentation-image-frame value={presentation.imageFrame} onchange={(event) => presentation.imageFrame = event.currentTarget.value as FirstMessageStudioImageFrame}>
                                                            <option value="contain" title="사용 가능한 너비와 높이 안에 삽화 전체를 중앙 정렬해 표시합니다.">전체 표시 · 크롭 없음</option>
                                                            <option value="square" title="정사각형 프레임입니다. 잘리는 위치는 아래에서 드래그해 정합니다.">정사각형</option>
                                                            <option value="landscape" title="16:9 가로형 프레임입니다. 잘리는 위치는 아래에서 드래그해 정합니다.">가로형 16:9</option>
                                                            <option value="portrait" title="3:4 세로형 프레임입니다. 잘리는 위치는 아래에서 드래그해 정합니다.">세로형 3:4</option>
                                                        </select>
                                                    </label>
                                                    <div class="asset-actions">
                                                        <button type="button" data-studio-upload-presentation-image onclick={() => uploadPresentationImage(presentationOption)}>{presentation.imageAssetName ? '삽화 바꾸기' : '삽화 넣기'}</button>
                                                        {#if presentation.imageAssetName}
                                                            <span data-studio-presentation-asset-name title={presentation.imageAssetName}>{presentation.imageAssetName}</span>
                                                            <button class="delete" type="button" data-studio-remove-presentation-image title="연결만 해제하며 캐릭터 에셋 파일은 삭제하지 않습니다." onclick={() => presentation.imageAssetName = undefined}>연결 해제</button>
                                                        {/if}
                                                    </div>
                                                    {#if presentation.imageAssetName}
                                                        <FirstMessageStudioImageCropEditor
                                                            assetName={presentation.imageAssetName}
                                                            assets={character.additionalAssets ?? []}
                                                            frame={presentation.imageFrame}
                                                            positionX={presentation.imagePositionX}
                                                            positionY={presentation.imagePositionY}
                                                            onPositionChange={(x, y) => {
                                                                presentation.imagePositionX = x
                                                                presentation.imagePositionY = y
                                                            }}
                                                        />
                                                    {/if}
                                                {/if}
                                            </div>
                                            <label>화자 <span class="optional">비우면 표시하지 않음</span><input data-studio-presentation-speaker value={localized(presentation.speaker)} oninput={(event) => presentation.speaker = event.currentTarget.value ? setLocalized(presentation.speaker, event.currentTarget.value) : undefined} placeholder="농부"/></label>
                                            <label>메인 설명<textarea data-studio-presentation-description rows="4" value={localized(presentation.description)} oninput={(event) => presentation.description = setLocalized(presentation.description, event.currentTarget.value)} placeholder="이 선택지에 마우스를 올렸을 때 보여 줄 설명을 적으세요."></textarea></label>
                                        </div>
                                    {/if}
                                {/if}
                            </section>
                        {/if}

                        <div class="option-heading">
                            <div><strong>선택지</strong><small>선택하면 저장할 변수와 값을 정합니다.</small></div>
                            <button type="button" data-studio-add-option onclick={addOption}>＋ 선택지 추가</button>
                        </div>
                        <div class="option-list">
                            {#each selectedStage.options as option, optionIndex}
                                <article class="option-card" data-studio-option-card={option.id}>
                                    <header>
                                        <b>{String(optionIndex + 1).padStart(2, '0')}</b><strong>{localized(option.label)}</strong>
                                        <div class="option-actions">
                                            <button type="button" aria-label="선택지 위로 이동" data-studio-move-option-up={option.id} onclick={() => moveOption(optionIndex, -1)} disabled={optionIndex === 0}>↑</button>
                                            <button type="button" aria-label="선택지 아래로 이동" data-studio-move-option-down={option.id} onclick={() => moveOption(optionIndex, 1)} disabled={optionIndex === selectedStage.options.length - 1}>↓</button>
                                            <button class="delete" type="button" data-studio-delete-option={option.id} onclick={() => removeOption(option.id)}>삭제</button>
                                        </div>
                                    </header>
                                    <div class="option-body">
                                        <label>버튼 이름<input value={localized(option.label)} oninput={(event) => option.label = setLocalized(option.label, event.currentTarget.value)}/></label>
                                        <label>짧은 설명<input value={localized(option.description)} oninput={(event) => option.description = setLocalized(option.description, event.currentTarget.value)}/></label>
                                        <div class="two-columns">
                                            <label>다음 화면<select value={option.nextStageId ?? ''} onchange={(event) => option.nextStageId = event.currentTarget.value || undefined}><option value="">현재 화면 유지</option>{#each draft.stages as target}<option value={target.id}>{localized(target.title)}</option>{/each}</select></label>
                                            <label class="check"><input type="checkbox" bind:checked={option.completes}/> 이 선택으로 완료</label>
                                        </div>
                                        <div class="effects">
                                            <div><strong>저장할 변수와 값</strong><button type="button" onclick={() => addEffect(option)}>＋ 추가</button></div>
                                            {#each option.effects as effect, effectIndex}
                                                <div class="effect-row">
                                                    {#if draft.variables.length > 0}
                                                        <select aria-label="변수 이름" bind:value={effect.variable}>
                                                            {#each draft.variables as variable}<option value={variable.name}>{localized(variable.label) || variable.name}</option>{/each}
                                                        </select>
                                                    {:else}
                                                        <input aria-label="변수 이름" bind:value={effect.variable} placeholder="variable_name"/>
                                                    {/if}
                                                    <span>=</span>
                                                    <input aria-label="저장 값" value={localized(effect.value)} oninput={(event) => effect.value = setLocalized(effect.value, event.currentTarget.value)} placeholder="value"/>
                                                    <button type="button" aria-label="변수 삭제" onclick={() => option.effects.splice(effectIndex, 1)}>✕</button>
                                                </div>
                                            {/each}
                                        </div>
                                        <label class="check"><input type="checkbox" checked={Boolean(option.input)} onchange={(event) => toggleInput(option, event.currentTarget.checked)}/> 사용자가 직접 입력하는 선택지</label>
                                        {#if option.input}
                                            <div class="three-columns input-settings">
                                                <label>입력 변수<input bind:value={option.input.variable}/></label>
                                                <label>입력 안내<input value={localized(option.input.label)} oninput={(event) => option.input!.label = setLocalized(option.input!.label, event.currentTarget.value)}/></label>
                                                <label>예시 문구<input value={localized(option.input.placeholder)} oninput={(event) => option.input!.placeholder = setLocalized(option.input!.placeholder, event.currentTarget.value)}/></label>
                                            </div>
                                        {/if}
                                    </div>
                                </article>
                            {/each}
                        </div>
                    {/if}
                {/if}
            </section>

            <aside class="preview">
                <header><strong>실제 미리보기</strong><small>직접 클릭해 전체 흐름을 시험하세요.</small></header>
                <FirstMessageStudioRuntime project={draft} assets={character.additionalAssets ?? []} preview/>
                <details>
                    <summary>완료 후 원문 메시지</summary>
                    <p>스튜디오가 꺼져 있거나 완료된 뒤에는 이 원문이 사용됩니다.</p>
                    <textarea rows="7" bind:value={draft.fallbackMessage}></textarea>
                </details>
            </aside>
        </main>

        <footer class="footer">
            <span>스튜디오 데이터는 캐릭터 카드에도 포함됩니다.</span>
            <div><button type="button" onclick={onClose}>취소</button><button class="save" type="button" data-studio-save onclick={save}>저장하고 닫기</button></div>
        </footer>
    </section>
</div>

<style>
    .overlay{position:fixed;z-index:1000;inset:0;padding:1.25rem;background:color-mix(in srgb, var(--color-overlay) 58%, transparent);backdrop-filter:blur(4px)}
    .shell{display:grid;grid-template-rows:auto 1fr auto;width:min(96rem,100%);height:100%;margin:auto;overflow:hidden;border:1px solid var(--color-darkborderc);border-radius:var(--risu-radius-2xl);color:var(--color-textcolor);background:var(--color-darkbg);box-shadow:var(--risu-shadow-overlay, 0 1.5rem 4rem color-mix(in srgb, var(--color-shadow) 32%, transparent))}
    .topbar,.footer{display:flex;align-items:center;justify-content:space-between;gap:1rem}
    .topbar{padding:1rem 1.25rem;border-bottom:1px solid var(--risu-theme-darkborderc);background:var(--risu-theme-darkbg)}
    .title-row{display:flex;min-width:0;flex:1;align-items:center;gap:1rem}.topbar h2{flex:none;margin:0;font-size:1.3rem}.topbar p{overflow:hidden;margin:0;color:var(--risu-theme-textcolor2);font-size:.78rem;font-weight:700;text-overflow:ellipsis;white-space:nowrap}
    .studio-enabled{position:relative;display:flex;flex:none;align-items:center;gap:.5rem;padding:.4rem .68rem;border:1px solid color-mix(in srgb,var(--risu-theme-primary) 55%,var(--risu-theme-darkborderc));border-radius:999px;color:var(--risu-theme-textcolor);background:color-mix(in srgb,var(--risu-theme-primary) 9%,var(--risu-theme-darkbg));font-size:.7rem;font-weight:850;white-space:nowrap;cursor:pointer}.studio-toggle-input{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);border:0;white-space:nowrap}.studio-toggle-track{position:relative;width:2rem;height:1.05rem;border-radius:999px;background:var(--risu-theme-darkborderc);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--risu-theme-textcolor) 12%,transparent);transition:background .15s ease,box-shadow .15s ease}.studio-toggle-track i{position:absolute;top:.16rem;left:.17rem;width:.73rem;height:.73rem;border-radius:50%;background:var(--risu-theme-textcolor);box-shadow:var(--risu-shadow-raised, 0 .1rem .25rem color-mix(in srgb, var(--color-shadow) 35%, transparent));transition:transform .15s ease}.studio-toggle-input:checked+.studio-toggle-track{background:var(--risu-theme-primary);box-shadow:0 0 .65rem color-mix(in srgb,var(--risu-theme-primary) 40%,transparent)}.studio-toggle-input:checked+.studio-toggle-track i{transform:translateX(.93rem);background:var(--risu-theme-darkbg)}.studio-toggle-input:focus-visible+.studio-toggle-track{outline:2px solid var(--risu-theme-textcolor);outline-offset:2px}
    .top-actions{display:flex;flex:none;align-items:center;gap:.7rem}.top-actions>button{display:grid;width:2.15rem;height:2.15rem;place-items:center;padding:0;border-radius:50%}.switch{display:flex;align-items:center;gap:.4rem;padding:.45rem .65rem;border:1px solid var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 0.9);white-space:nowrap}.switch input{width:auto;flex:none}
    .workspace{display:grid;grid-template-columns:13rem minmax(27rem,1fr) minmax(28rem,36rem);min-height:0}
    .rail,.editor,.preview{min-height:0;overflow:auto}.rail{display:flex;flex-direction:column;padding:.65rem;border-right:1px solid var(--risu-theme-darkborderc);background:var(--risu-theme-darkbg)}
    .rail-title{display:flex;align-items:center;justify-content:space-between;gap:.55rem;padding:.3rem;color:var(--risu-theme-textcolor2);font-size:.7rem;font-weight:800}.rail-title button{padding:.48rem .7rem;border:1px solid var(--risu-theme-darkborderc);background:var(--risu-theme-bgcolor);font-size:.7rem;font-weight:800}
    .stage-list{display:grid;gap:.35rem}.stage-list button{display:grid;gap:.12rem;padding:.62rem;border:1px solid transparent;border-radius:var(--risu-radius-lg);text-align:left}
    .stage-list button.active{border-color:var(--risu-theme-primary);background:var(--risu-theme-bgcolor);box-shadow:inset 3px 0 var(--risu-theme-primary)}
    .stage-list small{color:var(--risu-theme-primary);font:700 .6rem ui-monospace,monospace}.stage-list span{color:var(--risu-theme-textcolor2);font-size:.62rem}
    .rail-action{margin-top:.6rem;padding:.45rem;border:1px solid var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 0.8);font-size:.66rem}.rail-move{display:grid;grid-template-columns:1fr 1fr;gap:.3rem;margin-top:.6rem}
    .rail-move button{padding:.4rem .25rem;border:1px solid var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 0.8);font-size:.6rem}.rail-action.danger{color:var(--color-danger)}
    .editor{padding:1rem}.mode-tabs{position:sticky;z-index:20;top:0;display:grid;grid-template-columns:repeat(6,minmax(7rem,1fr));gap:.35rem;overflow-x:auto;margin-bottom:.8rem;padding:.25rem;border:1px solid var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 1.3);background:var(--risu-theme-darkbg);box-shadow:var(--risu-shadow-floating, 0 .5rem 1rem color-mix(in srgb,var(--risu-theme-darkbg) 70%,transparent))}
    .mode-tabs button{padding:.58rem;border-radius:calc(var(--risu-radius-md) * 1.12);color:var(--risu-theme-textcolor2);font-weight:800}.mode-tabs button.active{color:var(--risu-theme-darkbg);background:var(--risu-theme-primary)}
    .screen-toolbar{position:sticky;z-index:19;top:3.2rem;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:.65rem;margin-bottom:.8rem;padding:.55rem .7rem;border:1px solid var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 1.2);background:var(--risu-theme-darkbg);box-shadow:var(--risu-shadow-floating, 0 .5rem 1rem color-mix(in srgb,var(--risu-theme-darkbg) 70%,transparent))}
    .screen-toolbar>button{justify-self:center;border:1px solid var(--risu-theme-darkborderc);font-weight:800}.screen-toolbar>button.active{border-color:var(--risu-theme-primary);color:var(--risu-theme-primary)}.screen-toolbar>label{display:flex;justify-self:end;align-items:center;gap:.45rem;white-space:nowrap}.screen-toolbar select{width:8.5rem}
    .translation-panel{display:grid;grid-template-columns:minmax(12rem,1fr) 9rem 9rem auto;align-items:end;gap:.65rem;margin:-.25rem 0 .8rem;padding:.75rem;border:1px solid var(--risu-theme-primary);border-radius:calc(var(--risu-radius-lg) * 1.2);background:var(--risu-theme-darkbg)}
    .translation-panel>div{display:grid;gap:.18rem}.translation-panel small,.language-list-heading small{color:var(--risu-theme-textcolor2);font-size:.62rem}.translation-panel>p{grid-column:1/-1;margin:0;color:var(--risu-theme-primary);font-size:.66rem}
    .language-page{display:grid;gap:.75rem}
    .language-settings{display:grid;gap:.75rem;padding:.75rem;border:1px solid var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 1.2);background:var(--risu-theme-darkbg)}.language-project-fields{display:grid;grid-template-columns:1fr 1fr;gap:.55rem}.language-list-heading{display:flex;align-items:end;justify-content:space-between}.language-list-heading>div{display:grid}.language-list{display:grid;gap:.4rem}.language-row{display:grid;grid-template-columns:auto 1fr 1fr 1fr auto;align-items:end;gap:.45rem;padding:.55rem;border:1px solid var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 0.9);background:var(--risu-theme-bgcolor)}.language-row>b{align-self:center;color:var(--risu-theme-primary);font:800 .62rem ui-monospace,monospace}.language-row>button{align-self:end;color:var(--color-danger)}
    .form-box,.option-body{display:grid;gap:.65rem;padding:.75rem}.form-box{border:1px solid var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 1.2);background:var(--risu-theme-darkbg)}
    .presentation-master-toggle{justify-self:start;padding:.45rem .6rem;border:1px solid color-mix(in srgb,var(--risu-theme-primary) 45%,var(--risu-theme-darkborderc));border-radius:calc(var(--risu-radius-lg) * 0.9);background:color-mix(in srgb,var(--risu-theme-primary) 7%,transparent)}.presentation-editor{display:grid;gap:.65rem;margin-top:.75rem;padding:.75rem;border:1px solid var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 1.3);background:var(--risu-theme-darkbg)}.presentation-editor-heading>div{display:grid;gap:.15rem}.presentation-editor-heading small{color:var(--risu-theme-textcolor2);font-size:.65rem}.presentation-tabs{display:flex;gap:.35rem;overflow-x:auto;padding-bottom:.15rem}.presentation-tabs button{display:flex;min-width:max-content;align-items:center;gap:.42rem;padding:.5rem .7rem;border:1px solid var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 0.9);color:var(--risu-theme-textcolor2);background:var(--risu-theme-bgcolor);font-weight:750}.presentation-tabs button b{color:var(--risu-theme-primary);font:800 .58rem ui-monospace,monospace}.presentation-tabs button.active{border-color:var(--risu-theme-primary);color:var(--risu-theme-textcolor);box-shadow:inset 0 -2px var(--risu-theme-primary)}.presentation-fields{display:grid;gap:.65rem;padding:.7rem;border:1px solid var(--risu-theme-darkborderc);border-radius:var(--risu-radius-lg);background:var(--risu-theme-bgcolor)}.presentation-image-controls{display:grid;gap:.45rem}.asset-actions{display:flex;align-items:center;gap:.45rem;min-width:0}.asset-actions>button:first-child{border:1px solid var(--risu-theme-primary);color:var(--risu-theme-primary)}.asset-actions span{overflow:hidden;min-width:0;color:var(--risu-theme-textcolor2);font:600 .65rem ui-monospace,monospace;text-overflow:ellipsis;white-space:nowrap}.asset-actions .delete{flex:none;color:var(--color-danger)}
    .frame-mode-field{display:grid;grid-template-columns:minmax(6rem,max-content) minmax(12rem,22rem);align-items:center;gap:.55rem}
    .two-columns,.three-columns{display:grid;grid-template-columns:1fr 1fr;gap:.55rem}.three-columns{grid-template-columns:repeat(3,1fr)}
    label{display:grid;gap:.28rem;color:var(--risu-theme-textcolor2);font-size:.66rem;font-weight:700}label .optional{font-size:.58rem;font-weight:500}
    input,textarea,select{width:100%;border:1px solid var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 0.76);padding:.46rem .52rem;color:var(--risu-theme-textcolor);background:var(--risu-theme-bgcolor);font:inherit;font-size:.74rem}
    .option-heading,.section-heading{display:flex;align-items:end;justify-content:space-between;gap:.7rem}.option-heading{margin:1rem 0 .55rem}.option-heading>div,.section-heading>div,.preview>header,.code-card header>div{display:grid}
    .section-heading span{color:var(--risu-theme-primary);font:800 .6rem ui-monospace,monospace;letter-spacing:.12em}.section-heading h3{margin:.2rem 0;font-size:1.1rem}.section-heading p,.preview small,.option-heading small,.code-card small{margin:0;color:var(--risu-theme-textcolor2);font-size:.68rem}
    .option-list,.variable-editor,.scenario-editor,.design-editor,.code-editor{display:grid;gap:.7rem}.option-card,.scenario-card,.design-card,.code-card{overflow:hidden;border:1px solid var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 1.3);background:var(--risu-theme-darkbg)}
    .option-card>header,.code-card>header{display:flex;align-items:center;gap:.5rem;padding:.58rem .7rem;border-bottom:1px solid var(--risu-theme-darkborderc)}.option-card>header b{color:var(--risu-theme-primary);font:800 .65rem ui-monospace,monospace}
    .option-actions{display:flex;gap:.25rem;margin-left:auto}.option-actions button{min-width:2rem;border:1px solid var(--risu-theme-darkborderc)}.option-actions .delete{margin-left:auto;color:var(--color-danger)}
    .check{display:flex;align-items:center;gap:.4rem}.check input{width:auto}.effects{display:grid;gap:.35rem;padding:.5rem;border-radius:calc(var(--risu-radius-lg) * 0.8);background:var(--risu-theme-bgcolor)}.effects>div:first-child{display:flex;justify-content:space-between}
    .effect-row{display:grid;grid-template-columns:1fr auto 1fr auto;align-items:center;gap:.3rem}.input-settings{padding:.5rem;border:1px dashed var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 0.8)}
    .variable-list{display:grid;gap:.38rem;overflow-x:auto;padding:.15rem}.variable-list-header,.variable-row{display:grid;grid-template-columns:minmax(9rem,1fr) minmax(9rem,1fr) minmax(7rem,1fr) 2.4rem 2.4rem 3.6rem;gap:.42rem;min-width:38rem}.variable-list-header{padding:0 .05rem;color:var(--risu-theme-textcolor2);font-size:.63rem;font-weight:800}.variable-list-header span[title]{cursor:help}.variable-row{align-items:center}.variable-row input{min-width:0}.variable-row button{height:100%;min-height:2.15rem;border:1px solid var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 0.76);font-weight:800}.variable-row button:not(:disabled):hover{border-color:var(--risu-theme-primary);color:var(--risu-theme-primary)}.variable-row .delete{color:var(--color-danger)}.empty-state{padding:1rem;border:1px dashed var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 1.2);color:var(--risu-theme-textcolor2);font-size:.72rem;text-align:center}
    .scenario-header{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:end;gap:.65rem;padding:.65rem .75rem;border-bottom:1px solid var(--risu-theme-darkborderc)}.scenario-header>b{align-self:center;color:var(--risu-theme-primary);font:800 .65rem ui-monospace,monospace}.scenario-actions{display:flex;gap:.25rem}.scenario-actions button{min-width:2rem;border:1px solid var(--risu-theme-darkborderc)}.scenario-actions .delete{color:var(--color-danger)}.scenario-body,.scenario-groups{display:grid;gap:.65rem}.scenario-body{padding:.75rem}.scenario-group{display:grid;gap:.45rem;padding:.65rem;border:1px solid var(--risu-theme-darkborderc);border-radius:var(--risu-radius-lg);background:var(--risu-theme-bgcolor)}.scenario-group>header{display:flex;align-items:baseline;justify-content:space-between;gap:.5rem}.scenario-group small{color:var(--risu-theme-textcolor2);font-size:.62rem}.condition-row{display:grid;grid-template-columns:minmax(8rem,1.2fr) minmax(6rem,.6fr) minmax(8rem,1fr) auto;align-items:end;gap:.4rem}.condition-row>button{margin-bottom:.05rem;color:var(--color-danger)}.logic-divider{text-align:center}.logic-divider span{display:inline-block;padding:.2rem .65rem;border-radius:999px;color:var(--risu-theme-darkbg);background:var(--risu-theme-primary);font-size:.62rem;font-weight:900}.or-divider{color:var(--risu-theme-primary);font-size:.62rem;font-weight:800;text-align:center}.condition-add,.group-add{justify-self:start;border:1px dashed var(--risu-theme-primary);color:var(--risu-theme-primary)}.scenario-message textarea{min-height:12rem;resize:vertical}
    .skin-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem}.skin-grid button{display:grid;gap:.18rem;padding:.55rem;border:1px solid var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 1.3);text-align:left;background:var(--risu-theme-darkbg)}.skin-grid button.active{border-color:var(--risu-theme-primary);box-shadow:inset 0 0 0 1px var(--risu-theme-primary)}.skin-grid small{color:var(--risu-theme-textcolor2);font-size:.58rem}
    .skin-swatch{height:3rem;margin-bottom:.2rem;border-radius:calc(var(--risu-radius-lg) * 0.8)}.skin-swatch.minimal{background:linear-gradient(145deg,#1f2937 0 64%,#5b8cff 64% 72%,#111827 72%)}.skin-swatch.glass{background:radial-gradient(circle at 70% 20%,#65d9ff88,transparent 35%),linear-gradient(145deg,#1b4661cc,#101827)}.skin-swatch.custom{background:conic-gradient(from 90deg,#ff6b6b,#ffd166,#65d9ff,#b18cff,#ff6b6b)}
    .design-card{display:grid;gap:.75rem;padding:.8rem}.color-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:.6rem}.color-input{display:grid;grid-template-columns:2.35rem 1fr;gap:.35rem}.color-input input[type='color']{height:2rem;padding:.15rem}.design-card.toggles{grid-template-columns:repeat(3,minmax(0,1fr))}.design-card.toggles header{grid-column:1/-1}
    .code-area{min-height:12rem;resize:vertical;border:0;border-radius:0;padding:.85rem;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:2}.code-card header code{color:var(--risu-theme-primary)}
    .share-editor{display:grid;gap:.75rem}.share-card{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.85rem;border:1px solid var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 1.3);background:var(--risu-theme-darkbg)}.share-card>div:first-child{display:grid;gap:.2rem}.share-card small{color:var(--risu-theme-textcolor2);font-size:.66rem}.share-actions{display:flex;flex:none;gap:.45rem}.share-actions button{border:1px solid var(--risu-theme-primary);color:var(--risu-theme-primary)}.compatibility-card>.switch{flex:none}.fallback-card{display:grid}.fallback-card textarea{min-height:15rem}.share-message{margin:0;color:var(--risu-theme-primary);font-size:.7rem}
    .preview{padding:.9rem;border-left:1px solid var(--risu-theme-darkborderc);background:var(--risu-theme-darkbg)}.preview details{margin-top:.7rem;padding:.5rem;border:1px solid var(--risu-theme-darkborderc);border-radius:calc(var(--risu-radius-lg) * 0.9)}.preview details p{color:var(--risu-theme-textcolor2);font-size:.65rem}
    .footer{padding:.7rem 1rem;border-top:1px solid var(--risu-theme-darkborderc);background:var(--risu-theme-darkbg)}.footer>span{color:var(--risu-theme-textcolor2);font-size:.67rem}.footer>div{display:flex;gap:.45rem}
    button{padding:.4rem .58rem;border-radius:calc(var(--risu-radius-lg) * 0.8);color:inherit}button.save{color:var(--risu-theme-darkbg);background:var(--risu-theme-primary);font-weight:800}
    @media(max-width:72rem){.workspace{grid-template-columns:12rem 1fr}.preview{display:none}.translation-panel{grid-template-columns:1fr 1fr}.translation-panel>div{grid-column:1/-1}}@media(max-width:48rem){.overlay{padding:0}.shell{border:0;border-radius:0}.topbar{padding:.75rem}.title-row{gap:.55rem}.title-row p{display:none}.workspace{grid-template-columns:1fr}.rail{max-height:11rem}.stage-list{display:flex;overflow:auto}.stage-list button{min-width:9rem}.mode-tabs{grid-template-columns:repeat(6,minmax(7rem,1fr))}.screen-toolbar{grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)}.screen-toolbar>span{display:block}.screen-toolbar>label{font-size:0}.screen-toolbar>label select{width:7rem;font-size:.7rem}.translation-panel,.language-project-fields,.language-row,.two-columns,.three-columns,.color-grid,.design-card.toggles,.scenario-header,.condition-row{grid-template-columns:1fr}.share-card{display:grid}.skin-grid{grid-template-columns:1fr}}
</style>
