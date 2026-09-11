import { language } from "src/lang"
import { alertClear, alertConfirm, alertError, alertModuleSelect, alertNormal, alertStore, alertWait, notifySuccess } from "../alert"
import { getCurrentCharacter, getCurrentChat, getDatabase, setCurrentCharacter, setDatabase, type customscript, type loreBook, type triggerscript } from "../storage/database.svelte"
import { AppendableBuffer, downloadFile, forageStorage, LocalWriter, readImage, saveAsset, VirtualWriter } from "../globalApi.svelte"
import { checkPersonaBinded, selectSingleFile, sleep } from "../util"
import { v4 } from "uuid"
import { convertExternalLorebook } from "./lorebook.svelte"
import { compressImage } from '../media'
import { decodeRPack, decodeRPackBatch, encodeRPack } from "../rpack/rpack_js"
import { HideIconStore, moduleBackgroundEmbedding, ReloadGUIPointer } from "../stores.svelte"
import {get} from "svelte/store"
import { convertCharacterToModule, convertModuleToCharacter } from "../interchangeability"
import { exportCharacterCard, importCharacterProcess } from "../characterCards"
import { hasher } from "../parser/parser.svelte"

export interface MCPModule{
    url: string
}

export interface RisuModule{
    name: string
    description: string
    lorebook?: loreBook[]
    regex?: customscript[]
    cjs?: string
    trigger?: triggerscript[]
    id: string
    lowLevelAccess?: boolean
    hideIcon?: boolean
    backgroundEmbedding?:string
    assets?:[string,string,string][]
    namespace?:string
    customModuleToggle?:string
    mcp?:MCPModule
    icon?:string
}

export async function exportModule(module:RisuModule, arg:{
    alertEnd?:boolean
} = {}){
    const alertEnd = arg.alertEnd ?? true

    const char = convertModuleToCharacter(module)
    if(!char.image){
        const res = await fetch('/none.webp')
        const data = new Uint8Array(await res.arrayBuffer())
        char.image = await saveAsset(data)
        char.extentions ??= {}
        char.extentions['moduleNoneImage'] = true
    }
    const writer = new LocalWriter()
    await writer.init(module.name + '.module', ['charx'])
    await exportCharacterCard(char, 'charx', {
        spec: 'v3',
        writer
    })
    if(alertEnd){
        alertNormal(language.successExport)
    }
}

export async function exportModuleLegacy(module:RisuModule, arg:{
    alertEnd?:boolean
    saveData?:boolean
} = {}){
    const alertEnd = arg.alertEnd ?? true
    const saveData = arg.saveData ?? true
    const apb = new AppendableBuffer()
    const writeLength = (len:number) => {
        const lenbuf = Buffer.alloc(4)
        lenbuf.writeUInt32LE(len, 0)
        apb.append(lenbuf)
    }
    const writeByte = (byte:number) => {
        //byte is 0-255
        const buf = Buffer.alloc(1)
        buf.writeUInt8(byte, 0)
        apb.append(buf)
    }

    const assets = module.assets ?? []
    module = safeStructuredClone(module)
    module.assets ??= []
    module.assets = module.assets.map((asset) => {
        return [asset[0], '', asset[2]] as [string,string,string]
    })

    const mainbuf = await encodeRPack(Buffer.from(JSON.stringify({
        module: module,
        type: 'risuModule'
    }, null, 2), 'utf-8'))

    writeByte(111) //magic number
    writeByte(0) //version
    writeLength(mainbuf.length)
    apb.append(mainbuf)

    for(let i=0;i<assets.length;i++){
        const asset = assets[i]
        writeByte(1) //mark as asset
        alertStore.set({
            type: 'wait',
            msg: `Loading... (Adding Assets ${i} / ${assets.length})`
        })
        const rData = await readImage(asset[1])
        if (!rData?.length) {
            throw new Error(`Missing module asset: ${asset[0]}`)
        }
        let encoded = await encodeRPack(Buffer.from(await compressImage(rData)))
        writeLength(encoded.length)
        apb.append(encoded)
    }

    writeByte(0) //end of file

    if(saveData){
        await downloadFile(module.name + '.risum', apb.buffer)
    }
    if(alertEnd){
        notifySuccess(language.successExport)
    }

    return apb.buffer
}

export async function readModule(buf:Buffer):Promise<RisuModule> {
    let pos = 0

    const readLength = () => {
        if (pos + 4 > buf.length) throw new Error('Truncated module length')
        const len = buf.readUInt32LE(pos)
        pos += 4
        return len
    }
    const readByte = () => {
        if (pos >= buf.length) throw new Error('Truncated module payload')
        const byte = buf.readUInt8(pos)
        pos += 1
        return byte
    }
    const readData = (len:number) => {
        if (!Number.isSafeInteger(len) || len < 0 || pos + len > buf.length) throw new Error('Truncated module payload')
        const data = buf.subarray(pos, pos + len)
        pos += len
        return data
    }

    if(readByte() !== 111){
        console.error("Invalid magic number")
        alertError(language.errors.noData)
        return
    }
    if(readByte() !== 0){ //Version check
        console.error("Invalid version")
        alertError(language.errors.noData)
        return
    }

    const mainLen = readLength()
    const mainData = readData(mainLen)
    const main:{
        type:'risuModule'
        module:RisuModule
    } = JSON.parse(Buffer.from(await decodeRPack(mainData)).toString())

    if(main.type !== 'risuModule'){
        console.error("Invalid module type")
        alertError(language.errors.noData)
        return
    }

    let module = main.module

    // Keep decoded results bounded to the worker-pool size so mobile browsers do
    // not retain dozens of expanded assets while waiting for one large batch.
    const maxAssetDecodeBatchSize = 8
    const maxAssetPersistBatchSize = 200
    const maxAssetBatchBytes = 32 * 1024 * 1024
    const retryDelayMs = 5000
    const maxRetries = 3
    const totalAssets = module.assets?.length ?? 0
    let completed = 0

    type AssetTask = {
        index: number
        data: Uint8Array
    }

    type DecodedAssetTask = {
        task: AssetTask
        data: Uint8Array
    }

    const runAssetTasks = async (tasks: AssetTask[]) => {
        if (tasks.length === 0) {
            return []
        }
        const failed: AssetTask[] = []

        const persistBatch = async (batch: DecodedAssetTask[]) => {
            if (batch.length === 1 && batch[0].data.length > maxAssetBatchBytes) {
                const { task, data } = batch[0]
                try {
                    if (!module.assets?.[task.index]) {
                        throw new Error(`Missing asset metadata for index ${task.index}`)
                    }
                    module.assets[task.index][1] = await saveAsset(data)
                    completed += 1
                } catch {
                    failed.push(task)
                } finally {
                    alertWait(language.fileDropImport.moduleAssets(completed, totalAssets))
                }
                return
            }
            try {
                const prepared = await Promise.all(batch.map(async ({ task, data }) => {
                    if (!module.assets?.[task.index]) {
                        throw new Error(`Missing asset metadata for index ${task.index}`)
                    }
                    let id: string
                    try {
                        id = await hasher(data)
                    } catch {
                        id = v4()
                    }
                    return {
                        task,
                        key: `assets/${id}.png`,
                        value: data,
                    }
                }))
                await forageStorage.setItems(prepared.map(({ key, value }) => ({ key, value })))
                for (const { task, key } of prepared) {
                    module.assets[task.index][1] = key
                    completed += 1
                }
            } catch {
                failed.push(...batch.map(({ task }) => task))
            } finally {
                alertWait(language.fileDropImport.moduleAssets(completed, totalAssets))
            }
        }

        let persistQueue: DecodedAssetTask[] = []
        let persistQueueBytes = 0
        const flushPersistQueue = async () => {
            if (persistQueue.length === 0) return
            const batch = persistQueue
            persistQueue = []
            persistQueueBytes = 0
            await persistBatch(batch)
        }

        for (let offset = 0; offset < tasks.length; offset += maxAssetDecodeBatchSize) {
            const decodeGroup = tasks.slice(offset, offset + maxAssetDecodeBatchSize)
            let decoded: DecodedAssetTask[]
            try {
                const decodedData = await decodeRPackBatch(decodeGroup.map(task => task.data))
                decoded = []
                for (let index = 0; index < decodeGroup.length; index++) {
                    const data = decodedData[index]
                    if (!data || data.length === 0) {
                        failed.push(decodeGroup[index])
                        continue
                    }
                    decoded.push({ task: decodeGroup[index], data })
                }
            } catch {
                failed.push(...decodeGroup)
                continue
            }

            for (const decodedTask of decoded) {
                if (persistQueue.length > 0 && (
                    persistQueue.length >= maxAssetPersistBatchSize
                    || persistQueueBytes + decodedTask.data.length > maxAssetBatchBytes
                )) {
                    await flushPersistQueue()
                }
                persistQueue.push(decodedTask)
                persistQueueBytes += decodedTask.data.length
                if (persistQueue.length >= maxAssetPersistBatchSize
                    || persistQueueBytes >= maxAssetBatchBytes) await flushPersistQueue()
            }
        }
        await flushPersistQueue()
        return failed
    }

    const tasks: AssetTask[] = []
    let i = 0
    while(true){
        const mark = readByte()
        if(mark === 0){
            break
        }
        if(mark !== 1){
            alertError(language.errors.noData)
            return
        }
        const len = readLength()
        const data = readData(len)
        tasks.push({
            index: i,
            data
        })
        i++
    }

    if (tasks.length !== totalAssets) throw new Error('Module asset count does not match metadata')
    try {
        let failed = await runAssetTasks(tasks)
        let retryCount = 0
        while (failed.length > 0 && retryCount < maxRetries) {
            await sleep(retryDelayMs)
            retryCount += 1
            failed = await runAssetTasks(failed)
        }
        if (failed.length > 0) {
            throw new Error(`Failed to save ${failed.length} assets`)
        }
    } finally {
        alertClear()
    }

    module.id = v4()
    return module
}

export async function importModule(){
    const f = await selectSingleFile(['json', 'lorebook', 'risum', 'charx'])
    if(!f){
        return
    }
    let fileData = f.data
    const db = getDatabase()
    if(f.name.endsWith('.charx')){
        try {
            const buf = Buffer.from(fileData)
            const char = await importCharacterProcess({
                name: f.name,
                data: buf,
                returnCharacter: true
            })
            if(!char || typeof char === 'number'){
                alertError(language.errors.noData)
                return
            }
            const module = convertCharacterToModule(char)
            db.modules.push(module)
        } catch (error) {
            console.error(error)
            alertError(language.errors.noData)
        }
        notifySuccess(language.successImport)
        return
    }
    if(f.name.endsWith('.risum')){
        try {
            const buf = Buffer.from(fileData)
            const module = await readModule(buf)
            db.modules.push(module)
            notifySuccess(language.successImport)
        } catch (error) {
            console.error(error)
            alertError(language.errors.noData)
        }
        return
    }
    try {
        const importData = JSON.parse(Buffer.from(fileData).toString())
        if(importData.type === 'risuModule'){
            if(
                (!importData.name)
                || (!importData.id)
            ){
                alertError(language.errors.noData)
                return
            }
            importData.id = v4()

            if(importData.lowLevelAccess){
                const conf = await alertConfirm(language.lowLevelAccessConfirm)
                if(!conf){
                    return false
                }
            }
            db.modules.push(importData)
            notifySuccess(language.successImport)
            return
        }
        // importData.type === 'risu' in conflict with HypaV3 preset exports
        // difference: record vs. array
        if(importData.type === 'risu' && importData.data && Array.isArray(importData.data)){
            const lores:loreBook[] = importData.data
            const importModule = {
                name: importData.name || 'Imported Lorebook',
                description: importData.description || 'Converted from risu lorebook',
                lorebook: lores,
                id: v4()
            }
            db.modules.push(importModule)
            notifySuccess(language.successImport)
            return
        }
        if(importData.entries){
            const lores:loreBook[] = convertExternalLorebook(importData.entries)
            const importModule = {
                name: importData.name || 'Imported Lorebook',
                description: importData.description || 'Converted from external lorebook',
                lorebook: lores,
                id: v4()
            }
            db.modules.push(importModule)
            notifySuccess(language.successImport)
            return
        }
        if(importData.type === 'regex'  && importData.data){
            const regexs:customscript[] = importData.data
            const importModule = {
                name: importData.name || 'Imported Regex',
                description: importData.description || 'Converted from risu regex',
                regex: regexs,
                id: v4()
            }
            db.modules.push(importModule)
            notifySuccess(language.successImport)
            return
        }
    } catch (error) {
        console.error(error)
    }

    alertNormal(language.errors.noData)
}

function getModuleById(id:string){
    const db = getDatabase()
    for(let i=0;i<db.modules.length;i++){
        if(db.modules[i].id === id){
            return db.modules[i]
        }
    }

    if(id === '$embedded'){
        const persona = checkPersonaBinded()
        if(persona && persona.embeddedModule){
            return persona.embeddedModule
        }
    }
    return null
}

function getModuleByIds(ids:string[]){
    const db = getDatabase()
    const idSet = new Set(ids)
    const modules = (db.modules ?? []).filter(m =>
        idSet.has(m.id) || (m.namespace && idSet.has(m.namespace))
    )
    return deduplicateModuleById(modules)
}

function deduplicateModuleById(modules:RisuModule[]){
    let ids:string[] = []
    let newModules:RisuModule[] = []
    for(let i=0;i<modules.length;i++){
        if(ids.includes(modules[i].id)){
            continue
        }
        ids.push(modules[i].id)
        newModules.push(modules[i])
    }
    return newModules
}

let lastModules = ''
let lastModuleData:RisuModule[] = []
let lastModuleDatabase:ReturnType<typeof getDatabase> | null = null
let lastModuleSourceRefs:RisuModule[] = []

export interface ModuleIdScopes {
    globalIds?: readonly string[]
    activePersonaId?: string | null
    personaEnabledModules?: Record<string, string[]> | null
    chatIds?: readonly string[]
    characterIds?: readonly string[]
    embeddedPersonaModuleId?: string | null
    integrationIds?: readonly string[]
}

export function resolveModuleIds(scopes:ModuleIdScopes):string[] {
    const personaIds = scopes.activePersonaId
        ? scopes.personaEnabledModules?.[scopes.activePersonaId] ?? []
        : []
    const orderedScopes = [
        scopes.globalIds,
        personaIds,
        scopes.chatIds,
        scopes.characterIds,
        scopes.embeddedPersonaModuleId ? [scopes.embeddedPersonaModuleId] : [],
        scopes.integrationIds,
    ]
    const seen = new Set<string>()
    const resolved:string[] = []
    for(const ids of orderedScopes){
        for(const id of ids ?? []){
            if(typeof id !== 'string' || id.length === 0 || seen.has(id)) continue
            seen.add(id)
            resolved.push(id)
        }
    }
    return resolved
}

export function getModules(){
    const currentChat = getCurrentChat()
    const character = getCurrentCharacter()
    const db = getDatabase()
    const persona = checkPersonaBinded() ?? db.personas?.[db.selectedPersona ?? 0] ?? null
    const ids = resolveModuleIds({
        globalIds: db.enabledModules,
        activePersonaId: persona?.id,
        personaEnabledModules: db.personaEnabledModules,
        chatIds: currentChat?.modules,
        characterIds: character?.modules,
        embeddedPersonaModuleId: persona?.embeddedModule?.id,
        integrationIds: db.moduleIntergration?.split(',').map((s) => s.trim()).filter(Boolean),
    })
    const activePersonaAssignments = persona?.id ? db.personaEnabledModules?.[persona.id] ?? [] : []
    const cacheKey = JSON.stringify([persona?.id ?? null, activePersonaAssignments, ids])
    const moduleSourceRefs = [
        ...(db.modules ?? []),
        ...(persona?.embeddedModule ? [persona.embeddedModule] : []),
    ]
    const sourceRefsUnchanged = lastModuleDatabase === db
        && lastModuleSourceRefs.length === moduleSourceRefs.length
        && lastModuleSourceRefs.every((module, index) => module === moduleSourceRefs[index])
    if(lastModules === cacheKey && sourceRefsUnchanged){
        return lastModuleData
    }

    let modules:RisuModule[] = getModuleByIds(ids)
    if(persona?.embeddedModule && !modules.some((module) => module.id === persona.embeddedModule?.id)){
        modules.push(persona.embeddedModule)
    }
    lastModules = cacheKey
    lastModuleDatabase = db
    lastModuleSourceRefs = moduleSourceRefs
    lastModuleData = modules
    return modules

}


export function getModuleLorebooks() {
    return getModuleLorebooksWithSources().map((item) => item.entry)
}

export function getModuleLorebooksWithSources() {
    const modules = getModules()
    const lorebooks: { scopeId: string, entry: loreBook }[] = []
    for (const module of modules) {
        if(!module){
            continue
        }
        if (module.lorebook) {
            lorebooks.push(...module.lorebook.map((entry) => ({
                scopeId: `module:${module.id}`,
                entry,
            })))
        }
    }
    return lorebooks
}

export function getModuleAssets() {
    const modules = getModules()
    let assets: [string,string,string][] = []
    for (const module of modules) {
        if(!module){
            continue
        }
        if (module.assets) {
            assets = assets.concat(module.assets)
        }
    }
    return assets
}


export function getModuleTriggers() {
    const modules = getModules()
    let triggers: triggerscript[] = []
    for (const module of modules) {
        if(!module){
            continue
        }
        if (module.trigger) {
            // Copy rather than mutate: getModules() caches the RisuModule objects
            // (lastModuleData), so writing onto `t` writes into the stored module
            // and would leak runtime-only fields (moduleId) into .risum exports.
            triggers = triggers.concat(module.trigger.map((t) => ({
                ...t,
                lowLevelAccess: module.lowLevelAccess,
                moduleId: module.id,
            })))
        }
    }
    return triggers
}

export function getModuleRegexScripts() {
    const modules = getModules()
    let customscripts: customscript[] = []
    for (const module of modules) {
        if(!module){
            continue
        }
        if (module.regex) {
            customscripts = customscripts.concat(module.regex)
        }
    }
    return customscripts
}

export function getModuleToggles() {
    const modules = getModules()
    let costomModuleToggles: string = ''
    for (const module of modules) {
        if(!module){
            continue
        }
        if (module.customModuleToggle) {
            costomModuleToggles += '\n' + module.customModuleToggle + '\n'
        }
    }
    return costomModuleToggles
}

export function getModuleMcps() {
    const modules = getModules()

    return modules.map((v) => v.mcp?.url).filter((v) => v)
}

export async function applyModule() {
    const sel = await alertModuleSelect()
    if (!sel) {
        return
    }

    const module = safeStructuredClone(getModuleById(sel))
    if (!module) {
        return
    }

    const currentChar = getCurrentCharacter()
    if (!currentChar) {
        return
    }
    if (module.lorebook) {
        for (const lore of module.lorebook) {
            currentChar.globalLore.push(lore)
        }
    }
    if (module.regex) {
        for (const regex of module.regex) {
            currentChar.customscript.push(regex)
        }
    }
    if (module.trigger) {
        for (const trigger of module.trigger) {
            currentChar.triggerscript.push(trigger)
        }
    }

    setCurrentCharacter(currentChar)

    notifySuccess(language.successApplyModule)
}

let lastModuleIds:string = ''

export function moduleUpdate(){


    const m = getModules()

    const ids = m.map((m) => m.id).join('-')
    
    let moduleHideIcon = false
    let backgroundEmbedding = ''
    m.forEach((module) => {
        if(!module){
            return
        }

        if(module.hideIcon){
            moduleHideIcon = true
        }
        if(module.backgroundEmbedding){
            backgroundEmbedding += '\n' + module.backgroundEmbedding + '\n'
        }
    })

    if(backgroundEmbedding){
        moduleBackgroundEmbedding.set(backgroundEmbedding)
    }
    HideIconStore.set(getCurrentCharacter()?.hideChatIcon || moduleHideIcon)

    if(lastModuleIds !== ids){
        ReloadGUIPointer.set(get(ReloadGUIPointer) + 1)
        lastModuleIds = ids
    }
}

export function refreshModules(){
    lastModules = ''
    lastModuleDatabase = null
    lastModuleSourceRefs = []
    lastModuleData = []
}
