import { get } from "svelte/store";
import { getChatVar, setChatVar } from '../parser/chatVar.svelte';
import {selectedCharID} from '../stores.svelte'
import { type Message, type character, type loreBook } from "../storage/database.svelte";
import { DBState } from '../stores.svelte';
import { tokenize } from "../tokenizer";
import { risuChatParser } from "../parser/parser.svelte";
import { findCharacterbyId, pickHashRand, selectSingleFile } from "../util";
import { alertError, notifySuccess } from "../alert";
import { getCurrentLocale, language } from "../../lang";
import { downloadFile } from "../globalApi.svelte";
import { getModuleLorebooksWithSources } from "./modules";
import { CCardLib } from "@risuai/ccardlib";
import { v4 } from "uuid";
import { canRunLorebookSweep, isLorebookEntryEnabled } from './lorebookActivation';
import { ensureStableLorebookOwnerId } from '../lorebook/ownerIdentity';
import {
    matchesLorebookKey,
    resolveLorebookMatchingMode,
    type LorebookMatchingMode,
} from './lorebookMatching';
import { BardLoreBudgetError, selectBardLoreEntries } from '../lorebook/bardLoreRetrieval';
import { createBardLoreSettings, materializeBardLoreEntries, type BardLoreEntry } from '../lorebook/bardLore';
import type { RequestInjectionKind } from '../status/requestStatus';

export function addLorebook(type:number) {
    const selectedID = get(selectedCharID)
    if(type === 0){
        DBState.db.characters[selectedID].globalLore.push({
            key: '',
            comment: `New Lore ${DBState.db.characters[selectedID].globalLore.length + 1}`,
            content: '',
            mode: 'normal',
            insertorder: 100,
            alwaysActive: false,
            secondkey: "",
            selective: false
        })
    }
    else{
        const page = DBState.db.characters[selectedID].chatPage
        DBState.db.characters[selectedID].chats[page].localLore.push({
            key: '',
            comment: `New Lore ${DBState.db.characters[selectedID].chats[page].localLore.length + 1}`,
            content: '',
            mode: 'normal',
            insertorder: 100,
            alwaysActive: false,
            secondkey: "",
            selective: false
        })
    }
}

export function addLorebookFolder(type:number) {
    const selectedID = get(selectedCharID)
    const id = v4()
    if(type === 0){
        DBState.db.characters[selectedID].globalLore.push({
            key: '\uf000folder:' + id,
            comment: `New Folder`,
            content: '',
            mode: 'folder',
            insertorder: 100,
            alwaysActive: false,
            secondkey: "",
            selective: false,
        })
    }
    else{
        const page = DBState.db.characters[selectedID].chatPage
        DBState.db.characters[selectedID].chats[page].localLore.push({
            key: '\uf000folder:' + id,
            comment: `New Folder`,
            content: '',
            mode: 'folder',
            insertorder: 100,
            alwaysActive: false,
            secondkey: "",
            selective: false,
        })
    }
}

// An explicit search uses only the supplied text and character lore, without
// reading chat history/local lore or changing persistent activation flags.
export async function loadLoreBookV3Prompt(search?: { character: character; text: string }){
    const char = search?.character ?? DBState.db.characters[get(selectedCharID)]
    const page = char.chatPage
    const currentChatState = char.chats[page]
    const currentChat: Message[] = search ? [{ role: 'user', data: search.text }] : currentChatState.message
    const loreDepth = search ? 1 : (char.loreSettings?.scanDepth ?? DBState.db.loreBookDepth)
    const characterScopeId = `character:${char.chaId}`
    const bardSelectedIds = new Set<string>()
    const bardMatchLog:{
        prompt: string,
        source: string
        activated: string
    }[] = []
    let characterLore = char.globalLore ?? []
    const bardState = char.bardLore?.mode === 'bard' ? char.bardLore : undefined
    const bardSettings = bardState ? createBardLoreSettings(bardState.settings) : undefined
    const bardEntries = bardState ? materializeBardLoreEntries(bardState, characterLore) : []

    if(bardState && bardSettings){
        const tokenCounts: Record<string, number> = {}
        await Promise.all(bardEntries.filter((entry) => entry.bard.injection !== 'index-only').map(async (entry) => {
            tokenCounts[entry.id] = await tokenize(risuChatParser(entry.content, {chara: char}))
        }))
        const disabledThrough = currentChat.findLastIndex((message) => message.disabled === 'allBefore')
        const activeMessages = currentChat.slice(disabledThrough + 1)
            .filter((message) => !message.disabled && !message.isComment)
        const recentMessages = activeMessages
            .slice(Math.max(0, activeMessages.length - bardSettings.contextMessages))
            .map((message) => message.data)
        const selectedGreeting = !search
            && disabledThrough < 0
            && bardSettings.contextMessages > 0
            && activeMessages.length <= bardSettings.contextMessages
            && !currentChatState.firstMessageDisabled
            ? (currentChatState.fmIndex ?? -1) === -1
                ? char.firstMessage
                : char.alternateGreetings?.[currentChatState.fmIndex ?? 0] ?? ''
            : ''
        const firstMessageEvidence = selectedGreeting
            ? risuChatParser(selectedGreeting, { chara: char })
            : ''
        const query = [firstMessageEvidence, ...recentMessages].filter(Boolean).join('\n')
        let priorityQuery = ''
        for (let index = activeMessages.length - 1; index >= 0; index -= 1) {
            const message = activeMessages[index]
            if (message.role === 'user') {
                priorityQuery = message.data
                break
            }
        }
        const selection = selectBardLoreEntries({
            query,
            priorityQuery,
            routingEvidence: firstMessageEvidence,
            entries: bardEntries,
            tokenCounts,
            settings: bardSettings,
            scopeAliases: [char.name],
        })
        bardMatchLog.push({
            prompt: selection.plan.query,
            source: 'Grimoire query plan',
            activated: [
                `intent=${selection.plan.intent}`,
                selection.plan.targetKinds.length > 0 ? `kinds=${selection.plan.targetKinds.join(',')}` : '',
                selection.plan.requestedCount !== undefined ? `count=${selection.plan.requestedCount}` : '',
                ...selection.plan.constraints.map((item) => `${item.key}=${item.value}`),
            ].filter(Boolean).join(' · '),
        })
        characterLore = selection.selected.map(({ entry, reason, path, lane }) => {
            bardSelectedIds.add(entry.id)
            bardMatchLog.push({
                prompt: query,
                source: path ? `Grimoire link ${path.join(' -> ')}` : 'Grimoire retrieval',
                activated: `${entry.comment || entry.id} (${lane} · ${reason})`,
            })
            return {
                ...entry,
                alwaysActive: true,
            }
        })
        for (const { entry, reason } of selection.excluded) {
            if (reason === 'no-match' || reason === 'ineligible') continue
            bardMatchLog.push({
                prompt: selection.plan.query,
                source: 'Grimoire excluded',
                activated: `${entry.comment || entry.id} (${reason})`,
            })
        }
    }

    const loreSources = [
        ...characterLore.map((entry) => ({
            scopeId: characterScopeId,
            entry,
        })),
        ...(search ? [] : (char.chats[page].localLore ?? []).map((entry) => ({
            scopeId: `chat:${char.chats[page].id ?? page}`,
            entry,
        }))),
        ...(search ? [] : getModuleLorebooksWithSources()),
    ].filter((source) => isLorebookEntryEnabled(source.entry)
        && (!search || (source.entry.mode !== 'folder' && source.entry.content.trim().length > 0)))
    const fullLore = safeStructuredClone(loreSources.map((source) => source.entry))
    const loreScopes = loreSources.map((source) => source.scopeId)
    const loreToken = char.loreSettings?.tokenBudget ?? DBState.db.loreBookToken
    const matchingModeSetting = resolveLorebookMatchingMode(
        char.loreSettings?.matchingMode,
        char.loreSettings?.fullWordMatching,
    )
    const matchingLocale = getCurrentLocale()
    const chatLength = currentChat.length + 1 //includes first message
    const recursiveScanning = char.loreSettings?.recursiveScanning ?? true
    const maxRecursionSteps = Math.max(0, char.loreSettings?.maxRecursionSteps ?? 0)
    let recursivePrompt:{
        prompt: string,
        source: string,
        data: string
    }[] = []
    let matchLog:{
        prompt: string,
        source: string
        activated: string
    }[] = bardMatchLog

    const searchMatch = (messages:Message[],arg:{
        keys:string[],
        searchDepth:number,
        regex:boolean
        matchingMode:LorebookMatchingMode
        all?:boolean
        dontSearchWhenRecursive: boolean
        recursivePrompts: typeof recursivePrompt
    }) => {
        const sliced = messages.slice(messages.length - arg.searchDepth,messages.length)
        const newKeys = []
        for (const key of arg.keys) {
            const trimmed = key.trim()
            if (trimmed.length > 0) {
                newKeys.push(trimmed)
            }
        }
        arg.keys = newKeys
        let mList:{
            source:string
            prompt:string
            data:string
        }[] = sliced.map((msg, i) => {
            if(msg.role === 'user'){
                return {
                    source: `message ${i} by user`,
                    prompt: `\x01{{${DBState.db.username}}}:` + msg.data + '\x01',
                    data: msg.data
                }
            }
            else{
                return {
                    source: `message ${i} by char`,
                    prompt: `\x01{{${msg.name ?? (msg.saying ? findCharacterbyId(msg.saying)?.name : null) ?? char.name}}}:` + msg.data + '\x01',
                    data: msg.data
                }
            }
        }).concat(
            arg.dontSearchWhenRecursive ? [] : arg.recursivePrompts.map((msg) => {
                return {
                    source: 'lorebook ' + msg.source,
                    prompt: msg.prompt,
                    data: msg.data
                }
            }))    

        if(arg.regex){
            for(const mText of mList){
                for(const regexString of arg.keys){
                    if(!regexString.startsWith('/')){
                        return false
                    }
                    const regexFlag = regexString.split('/').pop()
                    if(regexFlag){
                        arg.keys[0] = regexString.replace('/'+regexFlag,'')
                        try {
                            const regex = new RegExp(arg.keys[0],regexFlag)
                            const d = regex.test(mText.data)
                            if(d){
                                matchLog.push({
                                    prompt: mText.prompt,
                                    source: mText.source,
                                    activated: regexString
                                })
                                return true
                            }
                        } catch (error) {
                            return false
                        }
                    }
                }
            }
            return false
        }

        mList = mList.map((m) => {
            return {
                source: m.source,
                prompt: m.prompt.toLocaleLowerCase().replace(/\{\{\/\/(.+?)\}\}/g,'').replace(/\{\{comment:(.+?)\}\}/g,''),
                data: m.data.toLocaleLowerCase().replace(/\{\{\/\/(.+?)\}\}/g,'').replace(/\{\{comment:(.+?)\}\}/g,'')
            }
        })

        let allMode = arg.all ?? false
        let allModeMatched = true

        for(const m of mList){
            for(const key of arg.keys){
                if(matchesLorebookKey(m.data, key, arg.matchingMode, matchingLocale)){
                    matchLog.push({
                        prompt: m.prompt,
                        source: m.source,
                        activated: key
                    })
                    if(!allMode){
                        return true
                    }
                }
                else if(allMode){
                    allModeMatched = false
                }
            }
        }
        if(allMode && allModeMatched){
            return true
        }
        return false
    
    }

    let matching = true
    let actives:{
        depth:number,
        pos:string,
        prompt:string
        role:'system'|'user'|'assistant'
        order:number
        tokens:number
        priority:number
        source:string
        requestStatusKind:RequestInjectionKind
        inject:{
            operation:'append'|'prepend'|'replace',
            location:string,
            param:string
            lore:boolean
        }|null
        sourceIdentity:{
            scopeId:string
            entry:loreBook
        }
    }[] = []
    let activatedIndexes:number[] = []
    let disabledUIPrompts:string[] = []
    let matchTimes = 0
    let keepActivateAfterMatch = false
    let dontActivateAfterMatch = false
    let completedSweeps = 0
    while(matching && canRunLorebookSweep(completedSweeps, maxRecursionSteps)){
        completedSweeps++
        const recursivePromptsAtSweepStart = recursivePrompt.slice()
        matching = false
        for(let i=0;i<fullLore.length;i++){
            if(activatedIndexes.includes(i)){
                continue
            }
            if(!fullLore[i].alwaysActive && !fullLore[i].key){
                continue
            }
            let activated = true
            let pos = ''
            let inject:{
                operation:'append'|'prepend'|'replace',
                location:string,
                param:string
                lore:boolean
            } = null
            let depth = 0
            let scanDepth = loreDepth
            let order = fullLore[i].insertorder
            let priority = fullLore[i].insertorder
            let forceState:string = 'none'
            let role:'system'|'user'|'assistant' = 'system'
            let searchQueries:{
                keys:string[],
                negative:boolean,
                all?:boolean
            }[] = []
            let matchingMode = matchingModeSetting
            let dontSearchWhenRecursive = false
            
            if(fullLore[i].mode === 'child'){
                activated = false
                for(let j=0;j<i;j++){
                    if(fullLore[j].id === fullLore[i].id){
                        if(!activatedIndexes.includes(j)){
                            fullLore[i].comment = fullLore[j].comment
                            fullLore[i].content = fullLore[j].content
                            fullLore[i].alwaysActive = true
                            activated = true
                        }
                        break
                    }
                }
            }
            let itemRecursive:'global'|true|false =
                loreScopes[i] === characterScopeId && bardSelectedIds.has(fullLore[i].id ?? '')
                    ? false
                    : 'global'
            const content = CCardLib.decorator.parse(fullLore[i].content, (name, arg) => {
                switch(name){
                    case 'end':{
                        pos = 'depth'
                        depth = 0
                        return
                    }
                    case 'activate_only_after':{
                        const int = parseInt(arg[0])
                        if(Number.isNaN(int)){
                            return false
                        }
                        if(chatLength < int){
                            activated = false
                        }
                        return
                    }
                    case 'activate_only_every': {
                        const int = parseInt(arg[0])
                        if(Number.isNaN(int)){
                            return false
                        }
                        if(chatLength % int !== 0){
                            activated = false
                        }
                        return
                    }
                    case 'keep_activate_after_match':{
                        const vara = search ? 'null' : getChatVar('__internal_ka_' + (fullLore[i].id ?? pickHashRand(5555,fullLore[i].content).toString()))
                        if(vara === 'true'){
                            forceState = 'activate'
                        }
                        else{
                            keepActivateAfterMatch = true
                        }
                        return false
                    }
                    case 'dont_activate_after_match': {
                        const vara = search ? 'null' : getChatVar('__internal_da_' + (fullLore[i].id ?? pickHashRand(5555,fullLore[i].content).toString()))
                        if(vara === 'true'){
                            forceState = 'deactivate'
                        }
                        else{
                            dontActivateAfterMatch = true
                        }
                        return false
                    }
                    case 'depth':
                    case 'reverse_depth':{
                        const int = parseInt(arg[0])
                        if(Number.isNaN(int)){
                            return false
                        }
                        depth = int
                        pos = name === 'depth' ? 'depth' : 'reverse_depth'
                        return
                    }
                    case 'instruct_depth':
                    case 'reverse_instruct_depth':
                    case 'instruct_scan_depth':{
                        //the instruct mode does not exists in risu
                        return false
                    }
                    case 'role':{
                        if(arg[0] === 'user' || arg[0] === 'assistant' || arg[0] === 'system'){
                            role = arg[0]
                            return
                        }
                        return false
                    }
                    case 'scan_depth':{
                        scanDepth = parseInt(arg[0])
                        return
                    }
                    case 'is_greeting':{
                        const int = parseInt(arg[0])
                        if(Number.isNaN(int)){
                            return false
                        }
                        if(search || ((char.chats[page].fmIndex ?? -1) + 1) !== int){
                            activated = false
                        }
                        return
                    }
                    case 'position':{
                        if(arg[0].startsWith('pt_') || ["after_desc", "before_desc", "personality", "scenario"].includes(arg[0])){
                            pos = arg[0]
                            return
                        }
                        return false
                    }
                    case 'inject_lore':{
                        inject ??= {
                            operation: 'append',
                            location: '',
                            param: '',
                            lore: true
                        }
                        inject.location = arg.join(' ')
                        inject.lore = true
                        return
                    }
                    case 'inject_at':{
                        inject??= {
                            operation: 'append',
                            location: '',
                            param: '',
                            lore: false
                        }
                        inject.location = arg.join(' ')
                        inject.lore = false
                        return
                    }
                    case 'inject_replace':{
                        inject??= {
                            operation: 'replace',
                            location: '',
                            param: '',
                            lore: false
                        }
                        inject.operation = 'replace'
                        inject.param = arg.join(' ')
                        return
                    }
                    case 'inject_prepend':{
                        inject??= {
                            operation: 'prepend',
                            location: '',
                            param: '',
                            lore: false
                        }
                        inject.operation = 'prepend'
                        inject.param = arg.join(' ')
                        return
                    }
                    case 'ignore_on_max_context':{
                        priority = -1000
                        return
                    }
                    case 'additional_keys':{
                        searchQueries.push({
                            keys: arg,
                            negative: false
                        })
                        return
                    }
                    case 'exclude_keys':{
                        searchQueries.push({
                            keys: arg,
                            negative: true
                        })
                        return
                    }
                    case 'exclude_keys_all':{
                        searchQueries.push({
                            keys: arg,
                            negative: true,
                            all: true
                        })
                        return
                    }
                    case 'match_full_word':{
                        matchingMode = 'whitespace'
                        return
                    }
                    case 'match_partial_word':{
                        matchingMode = 'partial'
                        return
                    }
                    case 'match_word_boundary':{
                        matchingMode = 'word-boundary'
                        return
                    }
                    case 'is_user_icon':{
                        //TODO
                        return false
                    }
                    case 'activate':{
                        forceState = 'activate'
                        return
                    }
                    case 'dont_activate':{
                        forceState = 'deactivate'
                        return
                    }
                    case 'disable_ui_prompt':{
                        if(['post_history_instructions','system_prompt'].includes(arg[0])){
                            disabledUIPrompts.push(arg[0])
                            return
                        }
                        return false
                    }
                    case 'probability':{
                        if(Math.random() * 100 > parseInt(arg[0])){
                            activated = false
                        }
                        return
                    }
                    case 'priority':{
                        priority = parseInt(arg[0])
                        return
                    }
                    //We can already do it with search depth, but its more readable and performant this way
                    case 'unrecursive':{
                        itemRecursive = false
                        return
                    }
                    case 'recursive':{
                        itemRecursive = true
                        return
                    }
                    case 'no_recursive_search':{
                        dontSearchWhenRecursive = true
                        return
                    }
                    default:{
                        return false
                    }
                }
            })
            

            if(!activated || forceState !== 'none' || fullLore[i].alwaysActive){
                //if the lore is not activated or force activated, skip the search
            }
            else{
                searchQueries.push({
                    keys: fullLore[i].key.split(','),
                    negative: false
                })

                if(fullLore[i].secondkey && fullLore[i].selective){
                    searchQueries.push({
                        keys: fullLore[i].secondkey.split(','),
                        negative: false
                    })
                }
    
                for(const query of searchQueries){
                    const result = searchMatch(currentChat, {
                        keys: query.keys,
                        searchDepth: scanDepth,
                        regex: fullLore[i].useRegex,
                        matchingMode: matchingMode,
                        all: query.all,
                        dontSearchWhenRecursive: dontSearchWhenRecursive,
                        recursivePrompts: recursivePromptsAtSweepStart,
                    })
                    if(query.negative){
                        if(result){
                            activated = false
                            break
                        }
                    }
                    else{
                        if(!result){
                            activated = false
                            break
                        }
                    }
                }
            }

            if(forceState === 'activate'){
                activated = true
            }
            else if(forceState === 'deactivate'){
                activated = false
            }

            if(activated){
                const sourceEntry = fullLore[i]
                const bardEntry = loreScopes[i] === characterScopeId
                    && 'bard' in sourceEntry
                    ? sourceEntry as BardLoreEntry
                    : undefined
                const requestStatusKind: RequestInjectionKind = bardEntry
                    ? (bardEntry.bard.activation === 'required' ? 'grimoireRequired' : 'grimoire')
                    : 'lorebook'
                actives.push({
                    depth: depth,
                    pos: pos,
                    prompt: content,
                    role: role,
                    order: order,
                    // Count tokens against the CBS-evaluated text (e.g. {{#if}}, {{getglobalvar}})
                    // so cutoff reflects what actually reaches the context, not the unevaluated source.
                    // runVar is left false (matching the output path in index.svelte.ts), so this
                    // evaluation has no side effects like setvar.
                    tokens: await tokenize(risuChatParser(content, {chara: char})),
                    priority: priority,
                    source: fullLore[i].comment || `lorebook ${i}`,
                    requestStatusKind,
                    inject: inject ?? null,
                    sourceIdentity: {
                        scopeId: loreScopes[i],
                        entry: safeStructuredClone(fullLore[i]),
                    },
                })
                activatedIndexes.push(i)

                if(keepActivateAfterMatch && !search){
                    setChatVar('__internal_ka_' + (fullLore[i].id ?? pickHashRand(5555,fullLore[i].content).toString()), 'true')
                }
                if(dontActivateAfterMatch && !search){
                    setChatVar('__internal_da_' + (fullLore[i].id ?? pickHashRand(5555,fullLore[i].content).toString()), 'true')
                }


                let recursive = recursiveScanning
                if(itemRecursive !== 'global'){
                    recursive = itemRecursive
                }

                if(recursive){
                    matching = true
                    recursivePrompt.push({
                        prompt: content,
                        data: content,
                        source: fullLore[i].comment || `lorebook ${i}`,
                    })
                }
            }
        }
    }

    const activesSorted = actives.sort((a,b) => {
        return b.priority - a.priority
    })

    let usedTokens = 0
    let bardUsedTokens = 0

    const activesFiltered = activesSorted.filter((act) => {
        const isBardCharacterLore = act.sourceIdentity.scopeId === characterScopeId
            && 'bard' in act.sourceIdentity.entry
        if(isBardCharacterLore && bardSettings){
            if(bardUsedTokens + act.tokens > bardSettings.maximumTokens){
                throw new BardLoreBudgetError('Selected Grimoire entries exceed the configured hard limit after prompt rendering.')
            }
            bardUsedTokens += act.tokens
            return true
        }
        if(usedTokens + act.tokens <= loreToken){
            usedTokens += act.tokens
            return true
        }
        return false
    })

    let activesResorted = activesFiltered.sort((a,b) => {
        return b.order - a.order
    })


    const loreinjectionLores = activesResorted.filter((act) => {
        return act?.inject?.lore
    })

    activesResorted = activesResorted.filter((act) => {
        return !act?.inject?.lore
    })
    const activeSources = activesFiltered.map((active) => ({
        sourceIdentity: active.sourceIdentity,
    }))
    const bardWikiEntityHints = activesFiltered.flatMap((active) => {
        if (active.sourceIdentity.scopeId !== characterScopeId) return []
        const entry = active.sourceIdentity.entry
        const bardEntry = 'bard' in entry ? entry as BardLoreEntry : undefined
        if (bardEntry && bardEntry.bard.kind !== 'character') return []
        const rawNames = bardEntry
            ? [entry.comment, ...bardEntry.bard.aliases]
            : [
                entry.comment,
                ...(typeof entry.key === 'string' ? entry.key.split(',') : []),
                ...(typeof entry.secondkey === 'string' ? entry.secondkey.split(',') : []),
            ]
        const seen = new Set<string>()
        const names = rawNames.flatMap((value) => {
            if (typeof value !== 'string') return []
            const name = value.trim().slice(0, 128)
            const key = name.normalize('NFKC').toLocaleLowerCase()
            if (!name || seen.has(key)) return []
            seen.add(key)
            return [name]
        }).slice(0, 16)
        return names.length > 0 ? [{
            kind: 'character' as const,
            names,
        }] : []
    }).slice(0, 12)

    //I know this will make token count wrong, but performance is more important here

    console.log('loreinjectionLores', loreinjectionLores)
    for(const lore of loreinjectionLores){
        const foundLoreIndex = activesResorted.findIndex((l) => {
            return l.source === lore.inject.location
        })
        if(foundLoreIndex !== -1){
            const foundLore = activesResorted[foundLoreIndex]
            switch(lore.inject.operation){
                case 'append':{
                    foundLore.prompt += ' ' + lore.prompt
                    break
                }
                case 'prepend':{
                    foundLore.prompt = lore.prompt + ' ' + foundLore.prompt
                    break
                }
                case 'replace':{
                    foundLore.prompt = foundLore.prompt.replace(lore.inject.param, lore.prompt)
                    break
                }
            }
        }
    }

    return {
        actives: activesResorted.reverse(),
        activeSources,
        bardWikiEntityHints,
        matchLog: matchLog,
    }

}

export async function importLoreBook(mode:'global'|'local'|'sglobal'){
    const selectedID = get(selectedCharID)
    const character = DBState.db.characters[selectedID]
    const characterId = character?.chaId
    const selectedChat = mode === 'local'
        ? character?.chats[character.chatPage]
        : undefined
    const chatId = selectedChat
        ? ensureStableLorebookOwnerId(selectedChat, v4)
        : undefined
    const selectedGlobalPage = DBState.db.loreBook[DBState.db.loreBookPage]
    const globalPageId = selectedGlobalPage
        ? ensureStableLorebookOwnerId(selectedGlobalPage, v4)
        : undefined
    const selectedFile = await selectSingleFile(['json', 'lorebook'])
    if(!selectedFile?.data){
        return
    }
    try {
        const importedlore = JSON.parse(Buffer.from(selectedFile.data).toString('utf-8'))
        const imported = convertImportedLorebook(importedlore)
        if(mode === 'sglobal'){
            const target = DBState.db.loreBook.find((page) =>
                page === selectedGlobalPage && page.id === globalPageId
            )
            if(!target) return
            target.data = [...target.data, ...imported]
        }
        else if(mode === 'global'){
            const target = DBState.db.characters.find((entry) =>
                entry === character && entry.chaId === characterId
            )
            if(!target) return
            target.globalLore = [...target.globalLore, ...imported]
        }
        else{
            const targetCharacter = DBState.db.characters.find((entry) =>
                entry === character && entry.chaId === characterId
            )
            const targetChat = targetCharacter?.chats.find((entry) =>
                entry === selectedChat && entry.id === chatId
            )
            if(!targetChat) return
            targetChat.localLore = [...targetChat.localLore, ...imported]
        }
    } catch (error) {
        alertError(error)
    }
}

export function convertImportedLorebook(importedLore: {
    type?: string
    data?: unknown
    entries?: Record<string, CCLorebook>
} | null | undefined): loreBook[] {
    if (importedLore?.type === 'risu' && Array.isArray(importedLore.data)) {
        return importedLore.data as loreBook[]
    }
    if (importedLore?.entries && typeof importedLore.entries === 'object') {
        return convertExternalLorebook(importedLore.entries)
    }
    return []
}

export interface CCLorebook{
    enabled?: boolean
    key:string[]
    comment:string
    content:string
    order:number
    constant:boolean,
    name:string,
    keywords:string[],
    priority:number
    entry:string
    secondary_keys:string[]
    selective:boolean
    forceActivation:boolean
    keys:string[]
    displayName:string
    text:string
    contextConfig?: {
        budgetPriority:number
        prefix:string
        suffix:string
    }
}

export function convertExternalLorebook(entries:{[key:string]:CCLorebook}){
    let lore:loreBook[] = []
    for(const key in entries){
        const currentLore = entries[key]
        lore.push({
            enabled: currentLore.enabled ?? true,
            key: currentLore.key ? currentLore.key.join(', ') :
                currentLore.keys ? currentLore.keys.join(', ') :
                currentLore.keywords ? currentLore.keywords.join(', ') : '',
            insertorder: currentLore.order ?? currentLore.priority ?? currentLore?.contextConfig?.budgetPriority ?? 0,
            comment: currentLore.comment || currentLore.name || currentLore.displayName || '',
            content: currentLore.content || currentLore.entry || currentLore.text || '',
            mode: "normal",
            alwaysActive: currentLore.constant ?? currentLore.forceActivation ?? false,
            secondkey: currentLore.secondary_keys ? currentLore.secondary_keys.join(', ') : "",
            selective: currentLore.selective ?? false
        })
    }
    return lore
}

export async function exportLoreBook(mode:'global'|'local'|'sglobal'){
    try {
        const selectedID = get(selectedCharID)
        const globalPage = DBState.db.loreBookPage
        const page = mode === 'sglobal' ? -1 : DBState.db.characters[selectedID].chatPage
        const lore = 
            mode === 'sglobal' ? DBState.db.loreBook[globalPage].data :
            mode === 'global' ? DBState.db.characters[selectedID].globalLore :
            DBState.db.characters[selectedID].chats[page].localLore        
        const stringl = Buffer.from(JSON.stringify({
            type: 'risu',
            ver: 1,
            data: lore
        }), 'utf-8')

        await downloadFile(`lorebook_export.json`, stringl)

        notifySuccess(language.successExport)
    } catch (error) {
        alertError(error)
    }
}
