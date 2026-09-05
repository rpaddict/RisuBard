<script lang="ts">
    import { language } from 'src/lang'
    import TextAreaInput from 'src/lib/UI/GUI/TextAreaInput.svelte'
    import { buildBardLoreAnalysisInstructions } from 'src/ts/lorebook/bardLoreAnalysis'
    import {
        normalizeBardLoreAnalysisLanguage,
    } from 'src/ts/lorebook/bardLoreLanguage'
    import type { WikiWritingLanguage } from 'src/ts/risubard/wikiWritingLanguage'
    import { normalizeWikiWritingLanguage } from 'src/ts/risubard/wikiWritingLanguage'
    import { DBState } from 'src/ts/stores.svelte'

    let selectedLanguage = $derived(normalizeBardLoreAnalysisLanguage(
        DBState.db.risuBardGrimoireLanguage
    ))
    let wikiLanguage = $derived<WikiWritingLanguage>(
        normalizeWikiWritingLanguage(DBState.db.risuBardWikiWritingLanguage)
    )
    let instruction = $derived(buildBardLoreAnalysisInstructions(
        undefined,
        selectedLanguage,
        wikiLanguage,
    ))

    function setLanguage(value: string): void {
        DBState.db.risuBardGrimoireLanguage = normalizeBardLoreAnalysisLanguage(value)
    }
</script>

<div
    data-setting-row
    data-setting-id="risubard.grimoire.language"
    class="settings-standard-row flex items-center justify-between gap-4 border-t border-darkborderc"
>
    <div class="flex min-w-0 flex-col">
        <label class="text-sm text-textcolor" for="risubard-grimoire-language">
            {language.risuBardGrimoireLanguage}
        </label>
        <p class="mt-0.5 whitespace-pre-line text-xs text-textcolor2">
            {language.risuBardGrimoireLanguageDescription}
        </p>
    </div>
    <select
        id="risubard-grimoire-language"
        class="w-56 max-w-full shrink-0 rounded-md border border-darkborderc bg-transparent px-3 py-1.5 text-sm text-textcolor shadow-xs transition-colors focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
        value={selectedLanguage}
        onchange={(event) => setLanguage(event.currentTarget.value)}
    >
        <option value="follow-bardwiki" class="bg-darkbg">{language.risuBardGrimoireLanguageFollowWiki}</option>
        <option value="en" class="bg-darkbg">{language.risuBardGrimoireLanguageEnglish}</option>
        <option value="ko" class="bg-darkbg">{language.risuBardGrimoireLanguageKorean}</option>
        <option value="ja" class="bg-darkbg">日本語</option>
        <option value="bilingual" class="bg-darkbg">{language.risuBardGrimoireLanguageBilingual}</option>
    </select>
</div>

<div
    data-setting-row
    data-setting-id="risubard.grimoire.instruction"
    class="settings-standard-row flex flex-col gap-3 border-t border-darkborderc"
>
    <div class="flex min-w-0 flex-col">
        <span class="text-sm text-textcolor">{language.risuBardGrimoireInstruction}</span>
        <p class="mt-0.5 whitespace-pre-line text-xs text-textcolor2">
            {language.risuBardGrimoireInstructionDescription}
        </p>
    </div>
    <TextAreaInput
        value={instruction}
        fullwidth
        height="32"
        autocomplete="off"
        readonly
        resizable
        actionBar={false}
    />
</div>
