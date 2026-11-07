<script lang="ts">
    import { onMount } from 'svelte';
    import { DBState, popUpEditorStore } from '../../ts/stores.svelte';
    import type MonacoEditorType from './MonacoEditor.svelte';
    import { language } from 'src/lang';
    import { risuChatParser } from "src/ts/parser/parser.svelte";
    import { tokenize } from 'src/ts/tokenizer';
    import Toggles from '../SideBars/Toggles.svelte';
    import { getCurrentCharacter } from 'src/ts/storage/database.svelte';
    import CbsConditionView from '../UI/GUI/CbsConditionView.svelte';
    import { createCbsVariableContext } from 'src/ts/gui/cbsVariableEditor';

    let languageMode = $state(popUpEditorStore.language || 'markdown');
    let previewing = $state(false);
    let tokens = $state(0);
    let MonacoComponent: (typeof MonacoEditorType)|null = $state(null)
    let showToggles = $state(false)
    let conditionView = $state(false)
    const variableOwner = getCurrentCharacter()
    const variableChat = variableOwner?.chats?.[variableOwner.chatPage]
    const variableContext = variableOwner ? createCbsVariableContext(
        variableOwner, variableChat, () => DBState.db.templateDefaultVariables ?? '',
        () => DBState.db.characters.includes(variableOwner) && (!variableChat || variableOwner.chats.includes(variableChat)),
    ) : undefined

    let chatParserValue = $derived.by(() => {
        if(!previewing){
            return ''
        }

        try {
            $state.snapshot(DBState.db.globalChatVariables)
        } catch (error) {

        }
        return risuChatParser(popUpEditorStore.value)
    })

    $effect(() => {
        if(!previewing){
            return
        }
        tokenize(chatParserValue).then((toks) => {
            tokens = toks
        }).catch(() => {
            tokens = 0
        })
    })

    onMount(() => {
        import('./MonacoEditor.svelte').then((module) => {
            MonacoComponent = module.default;
        });
    });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="risu-modal-overlay fixed top-0 left-0 w-full h-full bg-overlay/50 backdrop-blur-sm flex items-center justify-center z-50"
    onclick={() => (popUpEditorStore.open = false)}
>
    <div
        data-skin-part="modal"
        class="risu-modal-surface bg-darkbg rounded-lg p-4 w-11/12 h-11/12 flex flex-col gap-2"
        onclick={(e) => e.stopPropagation()}
    >
         <!-- Header Toolbar -->
         <div class="risu-modal-header flex items-center justify-between">
            <h2 class="text-xl font-bold">Popup Editor</h2>
            <div class="flex items-center gap-2">
                {#if ['markdown', 'cbs'].includes(languageMode)}
                    <button
                        type="button"
                        class="border border-darkborderc text-textcolor px-3 py-1 rounded"
                        data-cbs-view-toggle
                        aria-pressed={conditionView && !previewing}
                        onclick={() => {
                            conditionView = !conditionView
                            previewing = false
                        }}
                    >{conditionView && !previewing ? language.cbsEditor.source : language.cbsEditor.view}</button>
                    {#if !previewing}
                        <select
                            bind:value={languageMode}
                            class="bg-bgcolor border-none rounded px-2 py-1 text-sm"
                        >
                            <option value="markdown">Markdown</option>
                            <option value="cbs" disabled>CBS</option>
                        </select>
                    {/if}
                    <button
                        class="bg-primary text-accenttext px-3 py-1 rounded hover:bg-primary/90 transition"
                        onclick={() => {
                            conditionView = false
                            previewing = !previewing
                        }}
                    >
                        {previewing ? language.edit : language.preview}
                    </button>
                {:else}
                    <span class="bg-bgcolor border-none rounded px-2 py-1 text-sm">{languageMode}</span>
                {/if}
                <button
                    class="bg-danger text-on-danger px-3 py-1 rounded hover:bg-danger/85 transition"
                    onclick={() => (popUpEditorStore.open = false)}
                >
                    X
                </button>
            </div>
        </div>
        <div class="flex-1 rounded-md overflow-hidden border border-darkborderc">
            {#if previewing}
                <div class="h-full w-full flex">
                    <div class="flex-1 flex flex-col gap-4 overflow-hidden">
                        <div class="flex-1 overflow-y-auto overflow-x-auto max-w-full border border-darkborderc bg-bgcolor p-4">
                            <pre class="m-0">{chatParserValue}</pre>
                        </div>

                        <div class="text-sm p-4 text-textcolor2 flex overflow-x-auto">
                            <button class={{
                                "bg-primary text-accenttext hover:bg-primary/90": showToggles,
                                "bg-darkbutton text-textcolor hover:bg-darkbutton": !showToggles,
                                "px-3 py-1 rounded transition": true,
                            }} onclick={() => {
                                showToggles = !showToggles
                            }}>Toggles</button>
                            <span class="ml-auto">{tokens} tokens</span>
                        </div>
                    </div>
                    {#if showToggles}
                        <div class="w-64 border-l border-darkborderc overflow-y-auto p-2">
                            <Toggles chara={getCurrentCharacter()} />
                        </div>
                    {/if}
                </div>
            {:else if conditionView}
                <CbsConditionView value={popUpEditorStore.value} {variableContext} onInput={(value) => { popUpEditorStore.value = value }} />
            {:else}
                {#if MonacoComponent}
                    <MonacoComponent bind:value={popUpEditorStore.value} language={languageMode} />
                {/if}
            {/if}
        </div>
    </div>
</div>
