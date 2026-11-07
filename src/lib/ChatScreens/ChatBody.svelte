<script lang="ts">
    import isEqual from "lodash/isEqual"
    import { DBState } from 'src/ts/stores.svelte'
    import { sleep } from "src/ts/util"
    import { alertError } from "../../ts/alert"
    import { addMetadataToElement, getDistance, ParseMarkdown, postTranslationParse, resolveInlayPlaceholders, trimMarkdown, type CbsConditions, type simpleCharacterArgument } from "../../ts/parser/parser.svelte"
    import { getLLMCache, translateHTML } from "../../ts/translator/translator"
    import { getModuleAssets } from "src/ts/process/modules";
    import { getCurrentCharacter } from "src/ts/storage/database.svelte";
    import { getFileSrc } from "src/ts/globalApi.svelte";
    import { clearGenericChatImageStyles, isFirstMessageStudioManagedImage } from './chatImageHandling'
    import { retainedChatHtml } from './retainedChatHtml'
    import { inlayImageControls } from './inlayImageControls'
    import { debugTiming } from 'src/ts/debugTiming'

    interface Props {
        character?: simpleCharacterArgument|string|null
        firstMessage?: boolean
        idx?: number
        msgDisplay?: string
        name?: string
        role: string|null
        translated: boolean
        translating: boolean
        retranslate: boolean
        bodyRoot?: HTMLElement|null
        modelShortName: string
        renderRawStreaming?: boolean
        rawStreamingText?: string
        onRemoveInlay?: (id: string, occurrence: number) => void
    }

    let {
        character = null,
        idx = 0,
        firstMessage = false,
        msgDisplay,
        role,
        translated = $bindable(false),
        translating = $bindable(false),
        retranslate = $bindable(false),
        bodyRoot,
        modelShortName = '',
        renderRawStreaming = false,
        rawStreamingText = '',
        onRemoveInlay,
    }: Props =  $props()

    // svelte-ignore non_reactive_update
    let lastParsed = ''
    let lastCharArg:string|simpleCharacterArgument = null
    let lastChatId = -10

    function getCbsCondition(){
        try{
            const cbsConditions:CbsConditions = {
                firstmsg: firstMessage ?? false,
                chatRole: role,
            }
            return cbsConditions
        }
        catch(e){
            return {
                firstmsg: firstMessage ?? false,
                chatRole: null,
            }
        }
    }

    let shouldRenderRawStreaming = $derived(renderRawStreaming && !translated && !retranslate)

    const markParsing = async (data: string, charArg: string | simpleCharacterArgument, chatID: number, tries?:number) => {
        // track 'translated' and 'retranslate' state
        translated;
        retranslate;
        let lastParsedQueue = ''
        let mode = 'notrim' as const
        try {
            if((!isEqual(lastCharArg, charArg)) || (chatID !== lastChatId)){
                lastParsedQueue = ''
                lastCharArg = charArg
                lastChatId = chatID
                let translateText = false
                try {
                    // The Auto Translation checkbox is hidden while Translator Language is
                    // Disabled (''), so a stale autoTranslate must not keep translating.
                    if(DBState.db.autoTranslate && DBState.db.translator){
                        if(DBState.db.autoTranslateCachedOnly && DBState.db.translatorType === 'llm'){
                            const cache = DBState.db.translateBeforeHTMLFormatting
                            ? await getLLMCache(data)
                            : !DBState.db.legacyTranslation
                            ? await getLLMCache(await ParseMarkdown(data, charArg, 'pretranslate', chatID, getCbsCondition()))
                            : await getLLMCache(await ParseMarkdown(data, charArg, mode, chatID, getCbsCondition()))
                  
                            translateText = cache !== null
                        }
                        else{
                            translateText = true
                        }
                    }

                    const lastTranslated = translated

                    setTimeout(() => {
                            translated = translateText
                    }, 10)

                    // State change of `translated` triggers markParsing again,
                    // causing redundant translation attempts. Return the raw
                    // message so the {#await} block never resolves undefined.
                    if (lastTranslated !== translateText) {
                        return data
                    }
                } catch (error) {
                    console.error(error)
                }
            }
            if(retranslate || translated){
                if (DBState.db.showTranslationLoading) {
                    lastParsed = `<div style="display:flex;justify-content:center;align-items:center;height:48px;"><div style="animation: spin 1s linear infinite; border-radius: 50%; height: 32px; width: 32px; border: 2px solid var(--color-primary); border-top: 2px solid transparent;"></div></div><style>@keyframes spin { to { transform: rotate(360deg); } }</style>`
                }

                let transResult
                
                if(DBState.db.translatorType === 'llm' && DBState.db.translateBeforeHTMLFormatting){
                    await sleep(100)
                    translating = true
                    data = await translateHTML(data, false, charArg, chatID, retranslate)
                    translating = false
                    const marked = await ParseMarkdown(data, charArg, mode, chatID, getCbsCondition())
                    lastParsedQueue = marked
                    lastCharArg = charArg
                    transResult = marked
                }
                else if(!DBState.db.legacyTranslation){
                    const marked = await ParseMarkdown(data, charArg, 'pretranslate', chatID, getCbsCondition())
                    translating = true
                    const translated = await postTranslationParse(await translateHTML(marked, false, charArg, chatID, retranslate))
                    translating = false
                    lastParsedQueue = translated
                    lastCharArg = charArg
                    transResult = translated
                }
                else{
                    const marked = await ParseMarkdown(data, charArg, mode, chatID, getCbsCondition())
                    translating = true
                    const translated = await translateHTML(marked, false, charArg, chatID, retranslate)
                    translating = false
                    lastParsedQueue = translated
                    lastCharArg = charArg
                    transResult = translated
                }

                setTimeout(() => {
                    retranslate = false
                }, 10);

                return transResult
            }
            else{
                const timingStart = performance.now()
                const marked = await ParseMarkdown(data, charArg, mode, chatID, getCbsCondition())
                debugTiming.render(idx, performance.now() - timingStart)
                lastParsedQueue = marked
                lastCharArg = charArg
                return marked
            }   
        } catch (error) {
            //retry
            if(tries > 2){
                const err = error as Error
                const wrapped = new Error(`Error while parsing chat message: ${err?.message ?? error}`)
                if(error instanceof Error){
                    wrapped.stack = error.stack
                }
                alertError(wrapped)
                return data
            }
            return await markParsing(data, charArg, chatID, (tries ?? 0) + 1)
        }
        finally{
            //since trimMarkdown is fast, we don't need to cache it
            lastParsed = lastParsedQueue
        }
    }

    const checkImg = () => {
        if(!DBState.db.newImageHandlingBeta || !bodyRoot){
            return
        }
        const imgs = bodyRoot.querySelectorAll('img:not([src^="data:"]):not([src^="http:"]):not([src^="https:"]):not([src^="blob:"]):not([src^="file:"]):not([src^="tauri:"]):not([src^="/"]):not([noimage])') as NodeListOf<HTMLImageElement>
        
        if (imgs.length > 0) {
            const currentCharacter = getCurrentCharacter()
            const styl = currentCharacter.prebuiltAssetStyle
            const assets = getModuleAssets().concat(currentCharacter.additionalAssets ?? [])
            const normalizedAssets = assets.map((asset) => {
                return {
                    name: asset[0].toLocaleLowerCase(),
                    path: asset[1]
                }
            })
            const exactAssets = new Map(normalizedAssets.map((asset) => [asset.name, asset.path]))

            imgs.forEach(async (img) => {
                const studioManagedImage = isFirstMessageStudioManagedImage(img)
                if (studioManagedImage) clearGenericChatImageStyles(img)
                const name = img.getAttribute('src')?.toLocaleLowerCase() || ''
                console.log(name)

                if(
                    name.length > 200 ||
                    name.includes(':')
                ){
                    img.setAttribute('noimage', 'true')
                    return
                }
                
                const foundAsset = exactAssets.get(name)
                console.log('Checking image:', name, 'Assets:', assets)
                if(foundAsset){
                    if (!studioManagedImage) {
                        img.classList.add('root-loaded-image')
                        img.classList.add('root-loaded-image-' + styl)
                    }
                    img.src = await getFileSrc(foundAsset)
                    return
                }

                if(name.length < 3){
                    img.setAttribute('noimage', 'true')
                    return
                }
                const prefixLoc = name.lastIndexOf('.')
                const prefix = prefixLoc > 0 ? name.substring(0, prefixLoc) : ''
                let currentDistance = 1000
                let currentFound = ''
                for(const asset of normalizedAssets){
                    if(!asset.name.startsWith(prefix)){
                        continue
                    }
                    const distance = getDistance(name, asset.name)
                    if(distance < currentDistance){
                        currentDistance = distance
                        currentFound = asset.path
                    }
                }
                if(currentFound){
                    const got = await getFileSrc(currentFound)
                    const name2 = img.getAttribute('src')?.toLocaleLowerCase() || ''
                    if(name === name2){
                        img.setAttribute('src', got)
                    }

                    if(!studioManagedImage && img.classList.length === 0){
                        img.classList.add('root-loaded-image')
                        img.classList.add('root-loaded-image-' + styl)
                    }
                    img.removeAttribute('noimage')
                }
                else{
                    img.setAttribute('noimage', 'true')
                }
            })
        }
    }

    let markParsingResult = $derived.by(() => markParsing(msgDisplay, character, idx))

    function onHtmlRendered() {
        checkImg()
        if (bodyRoot) resolveInlayPlaceholders(bodyRoot)
    }
</script>

{#if shouldRenderRawStreaming}
    <span class="whitespace-pre-wrap">{rawStreamingText}</span>
{:else}
    <span data-painter-body style="display: contents" use:inlayImageControls={onRemoveInlay} use:retainedChatHtml={{
        content: markParsingResult,
        format: (html) => addMetadataToElement(trimMarkdown(html), modelShortName),
        onRender: onHtmlRendered,
        pendingHtml: (translated || retranslate) && DBState.db.showTranslationLoading ? lastParsed : undefined,
    }}></span>
{/if}

<style>
    :global(.inlay-image-control) {
        position: relative;
        display: inline-block;
        max-width: 100%;
        vertical-align: middle;
    }
    :global(.inlay-image-control > img) { margin: 0; }
    :global(.x-risu-risu-inlay-image > .inlay-image-control) { width: 100%; max-width: 20rem; }
    :global(.inlay-image-remove) {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2.75rem;
        height: 2.75rem;
        border-radius: var(--risu-radius-lg);
        border: 1px solid var(--color-darkborderc);
        background: var(--color-darkbg);
        color: var(--color-textcolor);
        opacity: 0;
        pointer-events: none;
        cursor: pointer;
        transition: opacity 150ms;
    }
    :global(.inlay-image-control:hover > .inlay-image-remove),
    :global(.inlay-image-control:focus-within > .inlay-image-remove) {
        opacity: 1;
        pointer-events: auto;
    }
    :global(.inlay-image-remove:hover) { color: var(--color-danger); }
    :global(.inlay-image-remove:focus-visible) { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    @media (hover: none) { :global(.inlay-image-remove) { opacity: 1; pointer-events: auto; } }
    @media (prefers-reduced-motion: reduce) { :global(.inlay-image-remove) { transition: none; } }
</style>
