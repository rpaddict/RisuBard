import { get } from 'svelte/store'
import { v4 } from 'uuid'
import { language } from 'src/lang'
import { getDatabase, newChatModelDefaults, type character } from './storage/database.svelte'
import { loadAsset, saveAsset, trackCharacterForSave } from './globalApi.svelte'
import { alertWait } from './alert'
import { alertStore } from './stores.svelte'
import { ImportCancelled, type ImportTransaction } from './storage/importTransaction'
import { generationStates } from './process/generationState'
import { normalizeBardLoreOwnerState } from './lorebook/bardLore'
import { createUniqueDisplayName } from './displayName'
import { updateLorebooks } from './characters'
import { updateInlayScreen } from './process/inlayScreen'
import type { RisuModule } from './process/modules'
import { selectSingleFile } from './util'
import { readUpdateBaseFile } from './characterUpdateBaseFile'
import { editableText, editedValue, isEditable, loreFolderNames } from './characterUpdateView'
import {
    CHARACTER_UPDATE, MODULE_UPDATE, applyUpdate, baseSnapshot, findModuleUpdateCandidates, findUpdateCandidates,
    planUpdate, unresolvedItems, type UpdateCandidate, type UpdateChoice, type UpdatePlan, type UpdateSide, type UpdateSpec,
} from './characterUpdate'

export type UpdateKind = 'character' | 'module'

export interface CharacterUpdateRequest {
    kind: UpdateKind
    incomingName: string
    candidates: UpdateCandidate[]
    /** Every other installed entity, for choosing one the matcher did not find. */
    others: { id: string, name: string }[]
}

type Decision = { kind: 'new' } | { kind: 'cancel' } | { kind: 'update', id: string, plan: UpdatePlan, choices: Record<string, UpdateChoice> }

/** A side, or 'edit' for the text the user wrote (kept in edits). */
export type UpdatePick = UpdateSide | 'edit'

/** What differs between updating a bot and updating a module. */
interface Entity<T extends object> {
    kind: UpdateKind
    spec: UpdateSpec
    list(): T[]
    id(value: T): string
    name(value: T): string
    /** Offered in the "choose another" list. */
    selectable(value: T): boolean
    /** Format upgrades the app applies on its own, so they do not read as the user's edits. */
    normalize<P extends Partial<T>>(value: P): P
    /** Busy right now: updating would race a running request. */
    busy(value: T): boolean
}

const characters: Entity<character> = {
    kind: 'character',
    spec: CHARACTER_UPDATE,
    list: () => getDatabase().characters,
    id: char => char.chaId,
    name: char => char.name ?? '',
    selectable: char => !char.trashTime && (char as { type?: string }).type !== 'group',
    normalize: char => {
        // Same upgrades opening a bot applies (lore book version, inlay screen defaults).
        if (Array.isArray(char.globalLore)) char.globalLore = updateLorebooks(char.globalLore)
        if (!char.newGenData && char.viewScreen) updateInlayScreen(char as character)
        return char
    },
    busy: char => {
        const states = get(generationStates)
        return (char.chats ?? []).some(chat => chat?.id && states.has(chat.id))
    },
}

const modules: Entity<RisuModule> = {
    kind: 'module',
    spec: MODULE_UPDATE,
    list: () => getDatabase().modules ?? [],
    id: module => module.id,
    name: module => module.name ?? '',
    selectable: module => !!module?.id && !module.id.startsWith('$') && !module.mcp && !module.updateBackupOf,
    normalize: module => {
        if (Array.isArray(module.lorebook)) module.lorebook = updateLorebooks(module.lorebook)
        return module
    },
    busy: () => false,
}

class CharacterUpdateDialogState {
    request = $state.raw<CharacterUpdateRequest | null>(null)
    step = $state<'choose' | 'review'>('choose')
    target = $state('')
    targetName = $state('')
    plan = $state.raw<UpdatePlan | null>(null)
    choices = $state<Record<string, UpdatePick>>({})
    /** Text the user wrote for items picked as 'edit'. */
    edits = $state<Record<string, string>>({})
    /** Lore folder id to title, for grouping entries. */
    folders = $state.raw<Map<string, string>>(new Map())
    /** Where the base came from: the install record, an earlier file, or nowhere. */
    baseSource = $state<{ kind: 'record' | 'file' | 'none', name?: string }>({ kind: 'none' })
    showAll = $state(false)
    /** The target is generating a reply: updating now would race the reply. */
    targetBusy = $state(false)
    busy = $state(false)
    error = $state('')
}

/** State of the "update an installed bot or module?" dialog shown while importing. */
export const characterUpdateDialog = new CharacterUpdateDialogState()

let pending: { entity: Entity<any>, incoming: object, resolve: (decision: Decision) => void } | null = null

function finish(decision: Decision) {
    const current = pending
    pending = null
    characterUpdateDialog.request = null
    characterUpdateDialog.plan = null
    characterUpdateDialog.choices = {}
    characterUpdateDialog.edits = {}
    current?.resolve(decision)
}

function find<T extends object>(entity: Entity<T>, id: string) {
    const list = entity.list()
    const index = list.findIndex(value => value && entity.id(value) === id)
    return { index, value: index >= 0 ? list[index] : undefined }
}

async function loadUpdateBase<T extends object>(entity: Entity<T>, ref: string | undefined): Promise<Partial<T> | null> {
    if (!ref) return null
    try {
        const data = await loadAsset(ref)
        if (!data) return null
        const base = JSON.parse(Buffer.from(data).toString('utf-8'))
        return base && typeof base === 'object' ? entity.normalize(base) : null
    } catch (error) {
        console.warn('Update base could not be read', error)
        return null
    }
}

async function saveUpdateBase<T extends object>(entity: Entity<T>, value: T, transaction?: ImportTransaction) {
    const data = Buffer.from(JSON.stringify(baseSnapshot(entity.spec, value)), 'utf-8')
    return await saveAsset(new Uint8Array(data), '', 'base.json', transaction)
}

export function selectCharacterUpdateTarget(id: string) {
    if (characterUpdateDialog.busy) return
    characterUpdateDialog.target = id
}

/** Compares the chosen entity with the import and opens the review step. */
export async function reviewCharacterUpdate() {
    const dialog = characterUpdateDialog
    if (!pending || dialog.busy) return
    const { entity, incoming } = pending
    const { value } = find(entity, dialog.target)
    if (!value) return
    dialog.busy = true
    dialog.error = ''
    try {
        const base = await loadUpdateBase(entity, (value as { updateBase?: string }).updateBase)
        // An entity never opened since install has not had the upgrades yet.
        entity.normalize(value)
        dialog.plan = planUpdate(entity.spec, value, incoming, base)
        dialog.baseSource = { kind: base ? 'record' : 'none' }
        dialog.folders = loreFolderNames((value as any).globalLore ?? (value as any).lorebook, (incoming as any).globalLore ?? (incoming as any).lorebook)
        dialog.choices = {}
        dialog.edits = {}
        dialog.showAll = false
        dialog.targetName = entity.name(value)
        dialog.targetBusy = entity.busy(value)
        dialog.step = 'review'
    } catch (error) {
        dialog.error = error instanceof Error ? error.message : String(error)
    } finally {
        dialog.busy = false
    }
}

export function backToCharacterUpdateTargets() {
    if (characterUpdateDialog.busy) return
    characterUpdateDialog.step = 'choose'
    characterUpdateDialog.plan = null
    characterUpdateDialog.error = ''
}

export function setCharacterUpdateChoice(id: string, pick: UpdatePick) {
    const dialog = characterUpdateDialog
    if (pick === 'edit' && dialog.edits[id] === undefined) {
        // Start from the user's version: usually the one they already rewrote.
        const item = dialog.plan?.items.find(entry => entry.id === id)
        if (!item || !isEditable(item)) return
        dialog.edits = { ...dialog.edits, [id]: editableText(item, 'mine') }
    }
    dialog.choices = { ...dialog.choices, [id]: pick }
}

export function setCharacterUpdateEdit(id: string, text: string) {
    characterUpdateDialog.edits = { ...characterUpdateDialog.edits, [id]: text }
}

/**
 * Gives the listed items the same side, for a section or a search result.
 * Items the user rewrote keep their text: a section-wide choice is not meant
 * to throw that work away.
 */
export function chooseCharacterUpdateMany(ids: string[], side: UpdateSide) {
    const next = { ...characterUpdateDialog.choices }
    for (const id of ids) if (next[id] !== 'edit') next[id] = side
    characterUpdateDialog.choices = next
}

/**
 * Uses an earlier file of this bot or module as the base, for an install that
 * has no record of the version it came from. Fields the file does not carry
 * count as unchanged by the user.
 */
export async function loadCharacterUpdateBaseFile() {
    const dialog = characterUpdateDialog
    if (!pending || dialog.busy) return
    const file = await selectSingleFile(['charx', 'png', 'json', 'risum', 'jpg', 'jpeg'])
    if (!file) return
    if (!pending) return
    const { entity, incoming } = pending
    const { value } = find(entity, dialog.target)
    if (!value) return
    dialog.busy = true
    dialog.error = ''
    try {
        const parsed = entity.normalize(await readUpdateBaseFile(entity.kind, file) as Partial<typeof value>)
        const base = { ...baseSnapshot(entity.spec, value), ...parsed }
        const plan = planUpdate(entity.spec, value, incoming, base)
        const ids = new Set(plan.items.map(item => item.id))
        dialog.plan = plan
        dialog.choices = Object.fromEntries(Object.entries(dialog.choices).filter(([id]) => ids.has(id)))
        dialog.baseSource = { kind: 'file', name: file.name }
    } catch (error) {
        dialog.error = `${language.characterUpdate.baseFileFailed}: ${error instanceof Error ? error.message : String(error)}`
    } finally {
        dialog.busy = false
    }
}

export function chooseCharacterUpdate(kind: 'new' | 'cancel' | 'update') {
    const dialog = characterUpdateDialog
    if (!pending || dialog.busy) return
    if (kind !== 'update') return finish({ kind })
    const plan = dialog.plan
    if (!plan) return
    const { value } = find(pending.entity, dialog.target)
    if (!value) return
    if (pending.entity.busy(value)) {
        dialog.targetBusy = true
        return
    }
    const picks = $state.snapshot(dialog.choices)
    if (unresolvedItems(plan).some(item => !picks[item.id])) return
    const choices: Record<string, UpdateChoice> = {}
    for (const item of plan.items) {
        const pick = picks[item.id]
        if (pick === 'edit') choices[item.id] = { value: editedValue(item, dialog.edits[item.id] ?? editableText(item, 'mine')) }
        else if (pick) choices[item.id] = pick
    }
    finish({ kind: 'update', id: dialog.target, plan, choices })
}

function ask<T extends object>(entity: Entity<T>, incoming: T, candidates: UpdateCandidate[]): Promise<Decision> {
    const listed = new Set(candidates.map(candidate => candidate.id))
    const others = entity.list()
        .filter(value => value && entity.selectable(value) && !listed.has(entity.id(value)) && value !== incoming)
        .map(value => ({ id: entity.id(value), name: entity.name(value) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    const dialog = characterUpdateDialog
    dialog.step = 'choose'
    dialog.target = candidates[0].id
    dialog.plan = null
    dialog.choices = {}
    dialog.edits = {}
    dialog.showAll = false
    dialog.targetBusy = false
    dialog.busy = false
    dialog.error = ''
    dialog.request = { kind: entity.kind, incomingName: entity.name(incoming), candidates, others }
    return new Promise(resolve => { pending = { entity, incoming, resolve } })
}

/**
 * Records the import's base, and when an installed entity looks like an older
 * version of it, asks whether to update that one instead. Returns the merged
 * entity and its index, or null to install the import as new.
 */
async function offerUpdate<T extends object>(entity: Entity<T>, incoming: T, candidates: UpdateCandidate[], transaction?: ImportTransaction) {
    transaction?.check()
    const baseKey = await saveUpdateBase(entity, incoming, transaction)
    ;(incoming as { updateBase?: string }).updateBase = baseKey
    if (!candidates.length) return null

    alertStore.set({ type: 'none', msg: '' })
    entity.normalize(incoming)
    const decision = await ask(entity, incoming, candidates)
    if (decision.kind === 'cancel') throw new ImportCancelled()
    alertWait(language.characterImportApplying)
    transaction?.check()
    if (decision.kind === 'new') return null

    const { index, value: current } = find(entity, decision.id)
    if (!current) throw new Error(language.errors.noData)
    const merged = applyUpdate(entity.spec, current, incoming, decision.plan, decision.choices)
    ;(merged as { updateBase?: string }).updateBase = baseKey
    return { index, current, merged }
}

function backupOf(char: character): character {
    const { chats: _chats, chatFolders: _folders, ...card } = char
    const copy = safeStructuredClone(card) as Omit<character, 'chats' | 'chatFolders'>
    return {
        ...copy,
        chaId: v4(),
        name: `${char.name ?? ''} ${language.characterUpdate.backupSuffix}`,
        chats: [{ id: v4(), message: [], note: '', name: 'Chat 1', localLore: [], ...newChatModelDefaults() }],
        chatFolders: [],
        chatPage: 0,
        updateBase: undefined,
        trashTime: Date.now(),
    }
}

/**
 * Before a new bot is added: offers to update an installed bot it looks like
 * a new version of. Returns the updated bot's index, or null to install the
 * incoming bot as new. Throws ImportCancelled when the user cancels the import.
 */
export async function tryUpdateExistingCharacter(incoming: character, transaction?: ImportTransaction): Promise<number | null> {
    const result = await offerUpdate(characters, incoming, findUpdateCandidates(getDatabase().characters, incoming), transaction)
    if (!result) return null
    const { index, current, merged } = result
    const db = getDatabase()
    // Lore entries and BardLore link by id: rebuild the links over the merged lorebook.
    const owner = normalizeBardLoreOwnerState(current.bardLore ?? incoming.bardLore, merged.globalLore ?? [], v4)
    if (owner) {
        merged.globalLore = owner.legacyEntries
        merged.bardLore = owner.state
    }
    merged.name = createUniqueDisplayName(merged.name ?? '', db.characters, current.chaId)
    merged.imported = true

    // The trash keeps the bot as it was for three days.
    const backup = backupOf(current)
    db.characters[index] = merged
    db.characters.push(backup)
    // Only the selected bot is watched for edits; the updated one usually is not selected.
    trackCharacterForSave(current.chaId)
    trackCharacterForSave(backup.chaId)
    transaction?.onRollback(() => {
        const list = getDatabase().characters
        const at = list.findIndex(char => char?.chaId === current.chaId)
        if (at >= 0) list[at] = current
        const copy = list.findIndex(char => char?.chaId === backup.chaId)
        if (copy >= 0) list.splice(copy, 1)
        trackCharacterForSave(current.chaId)
    })
    return index
}

/**
 * Before a new module is added: offers to update an installed module instead.
 * The installed module keeps its id, so the bots, chats and enabled list that
 * point to it keep working. Returns the updated module's index, or null to
 * install the incoming module as new.
 */
export async function tryUpdateExistingModule(incoming: RisuModule, transaction?: ImportTransaction): Promise<number | null> {
    const db = getDatabase()
    db.modules ??= []
    const result = await offerUpdate(modules, incoming, findModuleUpdateCandidates(db.modules, incoming), transaction)
    if (!result) return null
    const { index, current, merged } = result

    // Keep one copy of the module as it was, replacing the copy of an earlier update.
    const previous = db.modules.findIndex(module => module?.updateBackupOf === current.id)
    const replaced = previous >= 0 ? db.modules[previous] : undefined
    const backup: RisuModule = {
        ...safeStructuredClone(current),
        id: v4(),
        name: `${current.name ?? ''} ${language.characterUpdate.backupSuffix}`,
        updateBase: undefined,
        updateBackupOf: current.id,
    }
    db.modules[index] = merged
    if (previous >= 0) db.modules.splice(previous, 1)
    db.modules.push(backup)
    transaction?.onRollback(() => {
        const list = getDatabase().modules
        const at = list.findIndex(module => module?.id === current.id)
        if (at >= 0) list[at] = current
        const copy = list.findIndex(module => module?.id === backup.id)
        if (copy >= 0) list.splice(copy, 1)
        if (replaced) list.push(replaced)
    })
    return db.modules.findIndex(module => module?.id === current.id)
}
