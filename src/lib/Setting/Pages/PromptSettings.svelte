<script lang="ts">
    import { ArrowLeft, PlusIcon, TrashIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import SettingPage from "src/lib/UI/GUI/SettingPage.svelte";
    import SettingTabs from "src/lib/UI/GUI/SettingTabs.svelte";
    import PromptDataItem from "src/lib/UI/PromptDataItem.svelte";
    import { tokenizePreset, type PromptItem } from "src/ts/process/prompt";
    import { templateCheck } from "src/ts/process/templates/templateCheck";
    
    import { DBState } from 'src/ts/stores.svelte';
    import Check from "src/lib/UI/GUI/CheckInput.svelte";
    import TextInput from "src/lib/UI/GUI/TextInput.svelte";
    import NumberInput from "src/lib/UI/GUI/NumberInput.svelte";
    import Help from "src/lib/Others/Help.svelte";
    import TextAreaInput from "src/lib/UI/GUI/TextAreaInput.svelte";
    import SelectInput from "src/lib/UI/GUI/SelectInput.svelte";
    import OptionInput from "src/lib/UI/GUI/OptionInput.svelte";
    import Accordion from "src/lib/UI/Accordion.svelte";
    import ModelList from "src/lib/UI/ModelList.svelte";
    import { onDestroy, onMount } from "svelte";
    import {defaultAutoSuggestPrompt} from "../../../ts/storage/defaultPrompts";
    import type { botPreset } from "src/ts/storage/database.svelte";
    import { safeStructuredClone } from "src/ts/polyfill";

    let sorted = 0
    let warns: string[] = $state([])
    let tokens = $state(0)
    let extokens = $state(0)
    let draggedIndex = $state(-1)
    let dragOverIndex = $state(-1)
    let openedItemIndices = $state(new Set<number>())
  interface Props {
    onGoBack?: () => void;
    mode?: 'independent'|'inline';
    subMenu?: number;
    getPreset?: () => botPreset | null | undefined;
  }

  let { onGoBack = () => {}, mode = 'independent', subMenu = $bindable(0), getPreset }: Props = $props();
  let settings = $derived.by(() => {
    const scoped = getPreset?.();
    if (!scoped) return DBState.db as any;
    scoped.promptSettings ??= safeStructuredClone(DBState.db.promptSettings);
    scoped.fallbackModels ??= safeStructuredClone(DBState.db.fallbackModels);
    return scoped as any;
  });

    async function executeTokenize(prest: PromptItem[]){
        tokens = await tokenizePreset(prest, true)
        extokens = await tokenizePreset(prest, false)
    }

    $effect.pre(() => {
    warns = templateCheck(settings)
  });
  $effect.pre(() => {
    executeTokenize(settings.promptTemplate ?? [])
  });

  function getDisplayTemplate() {
    return (settings.promptTemplate ?? []).map((item: PromptItem, i: number) => ({
      item,
      originalIndex: i,
      displayIndex: i
    }))
  }

  function getReorderedTemplate() {
    if (draggedIndex === -1 || dragOverIndex === -1 || draggedIndex === dragOverIndex) {
      return getDisplayTemplate()
    }

    const items = getDisplayTemplate()
    const [movedItem] = items.splice(draggedIndex, 1)

    const adjustedDropIndex = draggedIndex < dragOverIndex ? dragOverIndex - 1 : dragOverIndex
    items.splice(adjustedDropIndex, 0, movedItem)

    return items.map((item, displayIndex) => ({
      ...item,
      displayIndex
    }))
  }

  function handlePromptDrop() {
    if (draggedIndex === -1 || dragOverIndex === -1 || draggedIndex === dragOverIndex) {
      return
    }

    const templates = [...(settings.promptTemplate ?? [])]
    const [movedItem] = templates.splice(draggedIndex, 1)

    const adjustedDropIndex = draggedIndex < dragOverIndex ? dragOverIndex - 1 : dragOverIndex
    templates.splice(adjustedDropIndex, 0, movedItem)

    const newOpenedIndices = new Set<number>()
    openedItemIndices.forEach((index) => {
      if (index === draggedIndex) {
        newOpenedIndices.add(adjustedDropIndex)
      } else if (draggedIndex < adjustedDropIndex) {
        if (index > draggedIndex && index <= adjustedDropIndex) {
          newOpenedIndices.add(index - 1)
        } else {
          newOpenedIndices.add(index)
        }
      } else {
        if (index >= adjustedDropIndex && index < draggedIndex) {
          newOpenedIndices.add(index + 1)
        } else {
          newOpenedIndices.add(index)
        }
      }
    })
    openedItemIndices = newOpenedIndices

    settings.promptTemplate = templates
    draggedIndex = -1
    dragOverIndex = -1
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.altKey && e.key === 'o') {
      if (openedItemIndices.size === (settings.promptTemplate ?? []).length) {
        openedItemIndices = new Set<number>()
      } else {
        openedItemIndices = new Set((settings.promptTemplate ?? []).map((_: PromptItem, i: number) => i))
      }
    }
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown)
  })

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeyDown)
  })
</script>
<SettingPage title={language.promptTemplate} showTitle={mode === 'independent'}>
{#if mode === 'independent'}
    <SettingTabs
        tabs={[
            { label: language.template, value: 0 },
            { label: language.settings, value: 1 },
        ]}
        bind:selected={subMenu}
        variant="prominent"
    />
{/if}
{#if warns.length > 0 && subMenu === 0}
    <div class="text-danger flex flex-col items-start p-2 rounded-md border-danger-border border mt-4">
        <h2 class="text-xl font-bold">Warning</h2>
        <div class="border-b border-b-danger-border mt-1 mb-2 w-full"></div>
        {#each warns as warn}
            <span class="ml-4">{warn}</span>
        {/each}
    </div>
{/if}

{#if subMenu === 0}
    <div class="prompt-template-list contain w-full max-w-full flex flex-col">
        {#if (settings.promptTemplate ?? []).length === 0}
                <div class="text-textcolor2">No Format</div>
        {/if}
        {#key sorted}
            {#each getReorderedTemplate() as { item: prompt, originalIndex, displayIndex }}
                <PromptDataItem
                    bind:promptItem={settings.promptTemplate[originalIndex]}
                    isDragging={draggedIndex === originalIndex}
                    isOpened={openedItemIndices.has(originalIndex)}
                    bind:draggedIndex
                    bind:dragOverIndex
                    bind:openedItemIndices
                    currentIndex={originalIndex}
                    displayIndex={displayIndex}
                    onDrop={handlePromptDrop}
                    onRemove={() => {
                        let templates = settings.promptTemplate
                        templates.splice(originalIndex, 1)
                        settings.promptTemplate = templates

                        const newOpenedIndices = new Set<number>()
                        openedItemIndices.forEach((index) => {
                            if (index === originalIndex) {
                                return
                            } else if (index > originalIndex) {
                                newOpenedIndices.add(index - 1)
                            } else {
                                newOpenedIndices.add(index)
                            }
                        })
                        openedItemIndices = newOpenedIndices

                        draggedIndex = -1
                        dragOverIndex = -1
                    }}
                    moveDown={() => {
                        if(originalIndex === settings.promptTemplate.length - 1){
                            return
                        }
                        let templates = settings.promptTemplate
                        let temp = templates[originalIndex]
                        templates[originalIndex] = templates[originalIndex + 1]
                        templates[originalIndex + 1] = temp
                        settings.promptTemplate = templates

                        const newOpenedIndices = new Set<number>()
                        openedItemIndices.forEach((index) => {
                            if (index === originalIndex) {
                                newOpenedIndices.add(originalIndex + 1)
                            } else if (index === originalIndex + 1) {
                                newOpenedIndices.add(originalIndex)
                            } else {
                                newOpenedIndices.add(index)
                            }
                        })
                        openedItemIndices = newOpenedIndices
                    }}
                    moveUp={() => {
                        if(originalIndex === 0){
                            return
                        }
                        let templates = settings.promptTemplate
                        let temp = templates[originalIndex]
                        templates[originalIndex] = templates[originalIndex - 1]
                        templates[originalIndex - 1] = temp
                        settings.promptTemplate = templates

                        const newOpenedIndices = new Set<number>()
                        openedItemIndices.forEach((index) => {
                            if (index === originalIndex) {
                                newOpenedIndices.add(originalIndex - 1)
                            } else if (index === originalIndex - 1) {
                                newOpenedIndices.add(originalIndex)
                            } else {
                                newOpenedIndices.add(index)
                            }
                        })
                        openedItemIndices = newOpenedIndices
                    }} />
            {/each}
        {/key}
    </div>

    <button class="font-medium cursor-pointer hover:text-primary" onclick={() => {
        let value = settings.promptTemplate ?? []
        value.push({
            type: "plain",
            text: "",
            role: "system",
            type2: 'normal'
        })
        settings.promptTemplate = value
    }}><PlusIcon /></button>

    <span class="text-textcolor2 text-sm mt-2">{tokens} {language.fixedTokens}</span>
    <span class="text-textcolor2 mb-6 text-sm mt-2">{extokens} {language.exactTokens}</span>
{:else}
    <span class="text-textcolor mt-4">{language.postEndInnerFormat} <Help key="postEndInnerFormat"/></span>
    <TextInput className="mt-2" bind:value={settings.promptSettings.postEndInnerFormat}/>

    <Check bind:check={settings.promptSettings.sendChatAsSystem} name={language.sendChatAsSystem} className="mt-4"/>
    <Check bind:check={settings.promptSettings.sendName} name={language.formatGroupInSingle} className="mt-4"/>
    <Check bind:check={settings.promptSettings.trimStartNewChat} name={language.trimStartNewChat} className="mt-4"/>
    <Check bind:check={settings.promptSettings.utilOverride} name={language.utilOverride} className="mt-4"/>
    <Check bind:check={settings.jsonSchemaEnabled} name={language.enableJsonSchema} className="mt-4"/>
    <Check bind:check={settings.outputImageModal} name={language.outputImageModal} className="mt-4"/>

    <Check bind:check={settings.strictJsonSchema} name={language.strictJsonSchema} className="mt-4"/>

    {#if DBState.db.showUnrecommended}
        <Check bind:check={settings.promptSettings.customChainOfThought} name={language.customChainOfThought} className="mt-4">
            <Help unrecommended key='customChainOfThought' />
        </Check>
    {/if}
    <div>
        <span class="text-textcolor mt-4">{language.maxThoughtTagDepth} <Help key="maxThoughtTagDepth"/></span>
        <NumberInput className="mt-2" bind:value={settings.promptSettings.maxThoughtTagDepth}/>
    </div>
    <span class="text-textcolor mt-4">{language.customPromptTemplateToggle} <Help key='customPromptTemplateToggle' /></span>
    <TextAreaInput className="mt-2 mb-4" bind:value={settings.customPromptTemplateToggle}/>
    <span class="text-textcolor mt-4">{language.defaultVariables} <Help key='defaultVariables' /></span>
    <TextAreaInput className="mt-2 mb-4" bind:value={settings.templateDefaultVariables}/>
    <span class="text-textcolor mt-4">{language.predictedOutput} <Help key="predictedOutput"/></span>
    <TextAreaInput className="mt-2 mb-4" bind:value={DBState.db.OAIPrediction}/>
    <span class="text-textcolor mt-4">{language.autoSuggest} <Help key='autoSuggest' /></span>
    <TextAreaInput className="mt-2 mb-4" bind:value={settings.autoSuggestPrompt} placeholder={defaultAutoSuggestPrompt}/>
    <span class="text-textcolor mt-4">{language.groupInnerFormat} <Help key='groupInnerFormat' /></span>
    <TextAreaInput className="mt-2 mb-4" placeholder={`<{{char}}\'s Message>\n{{slot}}\n</{{char}}\'s Message>`} bind:value={settings.groupTemplate}/>
    <span class="text-textcolor mt-4">{language.systemContentReplacement} <Help key="systemContentReplacement"/></span>
    <TextAreaInput className="mt-2 mb-4" bind:value={settings.systemContentReplacement}/>
    <span class="text-textcolor mt-4">{language.systemRoleReplacement} <Help key="systemRoleReplacement"/></span>
    <SelectInput className="mt-2 mb-4" bind:value={settings.systemRoleReplacement}>
        <OptionInput value="user">User</OptionInput>
        <OptionInput value="assistant">assistant</OptionInput>
    </SelectInput>
    {#if settings.jsonSchemaEnabled}
        <span class="text-textcolor mt-4">{language.jsonSchema} <Help key='jsonSchema' /></span>
        <TextAreaInput className="mt-2 mb-4" bind:value={settings.jsonSchema}/>
        <span class="text-textcolor mt-4">{language.extractJson} <Help key='extractJson' /></span>
        <TextInput className="mt-2" bind:value={settings.extractJson}/>
    {/if}


    {#snippet fallbackModelList(arg:'model'|'memory'|'translate'|'emotion'|'otherAx')}
        {#each settings.fallbackModels[arg] as model, i}
            <span class="text-textcolor mt-4">
                {language.model} {i + 1}
            </span>
            <ModelList bind:value={settings.fallbackModels[arg][i]} blankable />
        {/each}
        <div class="flex gap-2">
            <button class="bg-selected text-textcolor p-2 rounded-md" onclick={() => {
                let value = settings.fallbackModels[arg] ?? []
                value.push('')
                settings.fallbackModels[arg] = value
            }}><PlusIcon /></button>
            <button class="bg-danger text-on-danger p-2 rounded-md" onclick={() => {
                let value = settings.fallbackModels[arg] ?? []
                value.pop()
                settings.fallbackModels[arg] = value
            }}><TrashIcon /></button>
        </div>
    {/snippet}

    <Accordion name={language.fallbackModel} styled>
        <Check bind:check={settings.fallbackWhenBlankResponse} name={language.fallbackWhenBlankResponse} className="mt-4"/>
        <Check bind:check={DBState.db.doNotChangeFallbackModels} name={language.doNotChangeFallbackModels} className="mt-4"/>

        <Accordion name={language.model} styled>
            {@render fallbackModelList('model')}
        </Accordion>
        <Accordion name={"Memory"} styled>
            {@render fallbackModelList('memory')}
        </Accordion>
        <Accordion name={"Translations"} styled>
            {@render fallbackModelList('translate')}
        </Accordion>
        <Accordion name={"Emotion"} styled>
            {@render fallbackModelList('emotion')}
        </Accordion>
        <Accordion name={"OtherAx"} styled>
            {@render fallbackModelList('otherAx')}
        </Accordion>
    </Accordion>

{/if}
</SettingPage>

<style>
    .prompt-template-list {
        overflow: hidden;
        margin-bottom: 1rem;
        border: 1px solid var(--settings-border, var(--risu-theme-darkborderc));
        border-radius: var(--settings-radius, var(--risu-radius-xl));
        background: var(--settings-surface, var(--risu-theme-bgcolor));
    }

    :global(.prompt-template-list > [data-prompt-divider]) {
        height: 0;
    }

    :global(.prompt-template-list > [data-settings-list-item]) {
        border-width: 1px 0 0;
        border-radius: 0;
        background: transparent;
    }

    :global(.prompt-template-list > [data-settings-list-item]:first-of-type) {
        border-top: 0;
    }
</style>
