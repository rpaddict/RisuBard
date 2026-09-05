import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { normalizeNarrativeWorkingMessageLimit } from 'src/ts/risubard/narrativeContext'

const chatPagePath = resolve(process.cwd(), 'src/lib/Setting/Pages/RisuBardChatSettings.svelte')
const commonPagePath = resolve(process.cwd(), 'src/lib/Setting/Pages/RisuBardCommonSettings.svelte')
const settingsDataPath = resolve(process.cwd(), 'src/ts/setting/risuBardCommonSettingsData.ts')
const grimoireLanguagePagePath = resolve(
    process.cwd(),
    'src/lib/Setting/Pages/RisuBardGrimoireLanguageSettings.svelte'
)
const arcPlotterPresetPath = resolve(
    process.cwd(),
    'src/lib/Setting/Pages/RisuBardArcPlotterPresets.svelte'
)
const memoryWikiPath = resolve(process.cwd(), 'src/lib/Others/RisuBardMemoryWiki.svelte')
const commonPage = existsSync(commonPagePath) ? readFileSync(commonPagePath, 'utf8') : ''
const settingsData = readFileSync(settingsDataPath, 'utf8')
const grimoireLanguagePage = existsSync(grimoireLanguagePagePath)
    ? readFileSync(grimoireLanguagePagePath, 'utf8')
    : ''
const arcPlotterPreset = readFileSync(arcPlotterPresetPath, 'utf8')
const memoryWiki = readFileSync(memoryWikiPath, 'utf8')
const workspace = readFileSync(
    resolve(process.cwd(), 'src/lib/Setting/Settings.svelte'),
    'utf8',
)
const displaySettings = readFileSync(
    resolve(process.cwd(), 'src/ts/setting/displaySettingsData.svelte.ts'),
    'utf8',
)
const processSource = readFileSync(
    resolve(process.cwd(), 'src/ts/process/index.svelte.ts'),
    'utf8',
)
const databaseSource = readFileSync(
    resolve(process.cwd(), 'src/ts/storage/database.svelte.ts'),
    'utf8',
)

describe('RisuBard mode settings', () => {
    test('persists dedicated wiki prompt presets and scoped guide injections', () => {
        expect(databaseSource).toContain('risuBardWikiPromptPresets?:')
        expect(databaseSource).toContain('risuBardChatWikiPromptPresetId?: string')
        expect(databaseSource).toContain('risuBardWikiGuide?: string')
        expect(databaseSource).toContain('normalizeWikiPromptPresetState({')
        expect(databaseSource).toContain("typeof c.risuBardWikiGuide !== 'string'")
        expect(processSource).toContain('compileWikiPromptGuide(')
        expect(processSource).toContain("characterGuide: risuChatParser(character?.risuBardWikiGuide ?? ''")
        expect(processSource).toContain("chatGuide: risuChatParser(chat?.risuBardWikiGuide ?? ''")
    })

    test('keeps twelve recent messages as the default', () => {
        expect(normalizeNarrativeWorkingMessageLimit(undefined)).toBe(12)
    })

    test('includes the resolved first message in the bounded wiki analysis window', () => {
        expect(processSource).toContain('resolveNarrativeFirstMessageEvidence(')
        expect(processSource).toContain('projectMemoryAnalysisEvidence(')
        expect(processSource).toContain('firstMessageEvidence')
    })

    test('keeps chat analysis and response-history controls together', () => {
        expect(settingsData).toContain("bindKey: 'risuBardRecentMessageCount'")
        expect(settingsData).toContain("bindKey: 'risuBardResponseMessageCount'")
        expect(settingsData).toContain("bindKey: 'risuBardResponseExcludeUserMessages'")
        expect(processSource).toContain(
            '!resolvedRisuBardSettings(currentChat).risuBardResponseExcludeUserMessages'
        )
        expect(settingsData).toContain('min: 1')
        const currentChatSettings = readFileSync(
            resolve(process.cwd(), 'src/lib/Others/RisuBardCurrentChatSettings.svelte'), 'utf8',
        )
        expect(currentChatSettings.match(/\bmax="\d+"/g)).toEqual(['max="32"'])
        expect(currentChatSettings).toContain('risuBardHistoricalSourceMatchLimit')
        expect(memoryWiki).not.toContain('data-memory-recent-message-count')
        expect(memoryWiki).not.toContain('data-response-recent-message-count')
        expect(memoryWiki).not.toContain('data-response-include-user-messages')
    })

    test('exposes bounded automatic canon analysis controls without review mode', () => {
        expect(settingsData).toContain("id: 'risubard.chat.inquiryTargetTokenBudget'")
        expect(settingsData).toContain("id: 'risubard.chat.inquiryMaximumTokenBudget'")
        expect(settingsData).toContain('risuBardInquiryTargetTokenBudget')
        expect(settingsData).toContain('risuBardInquiryMaximumTokenBudget')
        expect(settingsData).toContain("bindKey: 'risuBardAnalysisTokenLimit'")
        expect(settingsData).toContain("bindKey: 'risuBardAdditionalSearchLimit'")
        expect(settingsData).toContain("bindKey: 'risuBardCanonicalTargetLimit'")
        expect(settingsData).not.toContain("bindKey: 'risuBardCanonicalMode'")
        expect(memoryWiki).not.toContain('RisuBardCanonicalAudit')
        expect(memoryWiki).not.toContain('unreviewedCount')
    })

    test('places the request context notification toggle in RisuBard chat settings', () => {
        expect(settingsData).toContain("bindKey: 'showRequestStatus'")
        expect(settingsData).toContain("id: 'risubard.chat.showRequestStatus'")
        expect(displaySettings).not.toContain("id: 'display.showRequestStatus'")
    })

    test('renders common and legacy chat routes as one settings page', () => {
        expect(existsSync(chatPagePath)).toBe(false)
        expect(workspace).toContain('SettingsRoute.RisuBardCommon')
        expect(workspace).toContain('SettingsRoute.RisuBardChat')
        expect(workspace).toContain('<RisuBardCommonSettings />')
        expect(workspace).not.toContain('RisuBardChatSettings')
    })

    test('orders the unified page by chat, analysis, Archplotter, writing, saves, then Arca export', () => {
        const sectionIds = [
            'risubard.common.chatResponse',
            'risubard.common.wikiAnalysis',
            'risubard.common.arcPlotter',
            'risubard.common.wikiWriting',
            'risubard.common.saveAndLoad',
            'risubard.common.arcaChatExporter',
        ]

        expect(sectionIds.map((id) => settingsData.indexOf(`id: '${id}'`)))
            .toEqual([...sectionIds.map((id) => settingsData.indexOf(`id: '${id}'`))].sort((a, b) => a - b))
        expect(sectionIds.every((id) => settingsData.includes(`id: '${id}'`))).toBe(true)
        expect(commonPage).toContain('risuBardArcPlotterSettingsItems')
        expect(commonPage).not.toContain('layout="stacked"')
        expect(settingsData).toContain("componentId: 'RisuBardArcPlotterPresets'")
        expect(settingsData).toContain("helpKey: 'risuBardArcPlotter'")
        expect(arcPlotterPreset).toContain('data-setting-row')
        expect(arcPlotterPreset).not.toContain('w-full justify-center')
        expect(arcPlotterPreset.indexOf('ARC_PLOTTER_BUILT_IN_PRESETS'))
            .toBeLessThan(arcPlotterPreset.indexOf('value="__separator"'))
        expect(arcPlotterPreset).toContain('disabled={!selectedCustomPreset}')
        expect(databaseSource).toContain('risuBardArcPlotterCustomPresets?:')
        expect(databaseSource).toContain('normalizeArcPlotterCustomPresets(')
        expect(processSource).toContain(
            'arcPlotterSettings: resolvedArcPlotterSettings()'
        )
    })

    test('exposes one shared canonical writing style page', () => {
        expect(commonPage).toContain('risuBardCommonSettingsAfterArcPlotterItems')
        expect(databaseSource).toContain('risuBardCanonicalWritingStyle?:')
        expect(databaseSource).toContain('risuBardCanonicalCustomStyle?: string')
        expect(settingsData).toContain("bindKey: 'risuBardCanonicalWritingStyle'")
        expect(settingsData).toContain("bindKey: 'risuBardWikiWritingLanguage'")
        expect(databaseSource).toContain('data.risuBardWikiWritingLanguage = normalizeWikiWritingLanguage(')
        expect(processSource).toContain('wikiWritingLanguage: settings.risuBardWikiWritingLanguage')
        expect(processSource).toContain("wikiWritingLanguage: job.writingLanguage ?? 'ko'")
        expect(settingsData).toContain("value: 'standard'")
        expect(settingsData).toContain("value: 'concise'")
        expect(settingsData).toContain("value: 'ultra-concise'")
        expect(settingsData).toContain("value: 'custom'")
        expect(settingsData).toContain("bindKey: 'risuBardCanonicalCustomStyle'")
        expect(settingsData).toContain("db.risuBardCanonicalWritingStyle === 'custom'")
        expect(settingsData).toContain('normalizeRisuBardCanonicalCustomStyle(value)')
    })

    test('exposes Grimoire metadata language and the active code-owned instruction', () => {
        const customComponents = readFileSync(
            resolve(process.cwd(), 'src/ts/setting/customComponents.ts'),
            'utf8',
        )
        const korean = readFileSync(resolve(process.cwd(), 'src/lang/ko.ts'), 'utf8')
        const english = readFileSync(resolve(process.cwd(), 'src/lang/en.ts'), 'utf8')

        expect(databaseSource).toContain('risuBardGrimoireLanguage?:')
        expect(databaseSource).toContain('normalizeBardLoreAnalysisLanguage(')
        expect(settingsData).toContain("id: 'risubard.common.grimoire'")
        expect(settingsData).toContain("componentId: 'RisuBardGrimoireLanguageSettings'")
        expect(settingsData.indexOf("id: 'risubard.common.wikiWriting'"))
            .toBeLessThan(settingsData.indexOf("id: 'risubard.common.grimoire'"))
        expect(settingsData.indexOf("id: 'risubard.common.grimoire'"))
            .toBeLessThan(settingsData.indexOf("id: 'risubard.common.saveAndLoad'"))
        expect(customComponents).toContain('RisuBardGrimoireLanguageSettings')
        expect(grimoireLanguagePage).toContain('buildBardLoreAnalysisInstructions(')
        expect(grimoireLanguagePage).toContain("value=\"follow-bardwiki\"")
        expect(grimoireLanguagePage).toContain("value=\"en\"")
        expect(grimoireLanguagePage).toContain("value=\"ko\"")
        expect(grimoireLanguagePage).toContain("value=\"bilingual\"")
        expect(grimoireLanguagePage).toContain('readonly')
        expect(grimoireLanguagePage).toContain('resizable')
        expect(korean).toContain('risuBardGrimoireSettings: "Grimoire 옵션"')
        expect(english).toContain('risuBardGrimoireSettings: "Grimoire options"')
    })

    test('exposes global Arca chat saver dimensions in common settings', () => {
        const settingsData = readFileSync(
            resolve(process.cwd(), 'src/ts/setting/risuBardCommonSettingsData.ts'),
            'utf8',
        )
        const korean = readFileSync(resolve(process.cwd(), 'src/lang/ko.ts'), 'utf8')
        const english = readFileSync(resolve(process.cwd(), 'src/lang/en.ts'), 'utf8')

        expect(databaseSource).toContain('risuBardArcaChatImageWidthPercent?: number')
        expect(databaseSource).toContain('risuBardArcaChatFontSizePx?: number')
        expect(databaseSource).toContain('risuBardArcaChatParagraphSpacingPercent?: number')
        expect(databaseSource).toContain('risuBardArcaChatShowTitleImage?: boolean')
        expect(databaseSource).toContain('risuBardArcaChatTitleImageStyle?:')
        expect(databaseSource).toContain('risuBardArcaChatIncludeUserMessages?: boolean')
        expect(databaseSource).toContain('risuBardArcaChatDialogSize?:')
        expect(databaseSource).toContain('normalizeArcaChatImageWidthPercent(')
        expect(databaseSource).toContain('normalizeArcaChatFontSizePx(')
        expect(databaseSource).toContain('normalizeArcaChatParagraphSpacingPercent(')
        expect(databaseSource).toContain('normalizeArcaChatShowTitleImage(')
        expect(databaseSource).toContain('normalizeArcaChatTitleImageStyle(')
        expect(databaseSource).toContain('normalizeArcaChatIncludeUserMessages(')
        expect(databaseSource).toContain('normalizeArcaChatDialogSize(')
        expect(settingsData).toContain("id: 'risubard.common.arcaChatExporter'")
        expect(settingsData).toContain("type: 'header'")
        expect(settingsData).toContain("bindKey: 'risuBardArcaChatImageWidthPercent'")
        expect(settingsData).toContain("bindKey: 'risuBardArcaChatFontSizePx'")
        expect(settingsData).toContain("bindKey: 'risuBardArcaChatParagraphSpacingPercent'")
        expect(settingsData).toContain("bindKey: 'risuBardArcaChatShowTitleImage'")
        expect(settingsData).toContain("bindKey: 'risuBardArcaChatTitleImageStyle'")
        expect(settingsData).toContain("value: 'oval', labelKey: 'risuBardArcaChatTitleImageOval'")
        expect(settingsData).toContain("value: 'square', labelKey: 'risuBardArcaChatTitleImageSquare'")
        expect(settingsData).toContain("value: 'thumbnail-title', labelKey: 'risuBardArcaChatTitleImageThumbnailTitle'")
        expect(settingsData).toContain('ctx.db.risuBardArcaChatShowTitleImage !== false')
        expect(settingsData).toContain('min: 10, max: 100, step: 1')
        expect(settingsData).toContain('min: 10, max: 32, step: 1')
        expect(settingsData).toContain('min: 0, max: 300, step: 10')
        expect(korean).toContain('risuBardArcaChatExporter: "아카라이브 챗 추출기"')
        expect(korean).toContain('risuBardArcaChatParagraphSpacingPercent: "개행 간격 (%)"')
        expect(korean).toContain('risuBardArcaChatShowTitleImage: "타이틀 이미지 표시"')
        expect(korean).toContain('risuBardArcaChatTitleImageThumbnailTitle: "썸네일 + 타이틀"')
        expect(english).toContain('risuBardArcaChatExporter: "Arca Chat Extractor"')
        expect(english).toContain('risuBardArcaChatParagraphSpacingPercent: "Paragraph spacing (%)"')
    })

})
