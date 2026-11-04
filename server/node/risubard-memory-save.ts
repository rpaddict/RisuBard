import * as nodeFs from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
    completeMemoryWorkspaceFork,
    forkMemoryWorkspace,
    replaceMemoryWorkspace,
    resolveMemoryReplacementStaging,
    type MemoryForkReceipt,
} from './risubard-memory-fork'
import { resolveMemoryWorkspace } from './risubard-memory-workspace'
import {
    SAVE_FILES,
    parseSavedFiles,
    releaseStorePages,
    restoreWorkspaceFromStore,
    saveStoreDirectory,
    serializeSavedFiles,
    snapshotWorkspaceToStore,
} from './risubard-memory-save-store'

const SAVE_MANIFEST = 'risubard-save.json'
const SAVE_CHAT = 'chat.bin'
const SAVE_PREFIX = 'save-slot:'
const SAVE_DIRECTORY_PREFIX = `id-${Buffer.from(
    SAVE_PREFIX.slice(0, -1), 'utf8'
).toString('base64url')}`

export interface MemorySaveEventPreview {
    title: string
    excerpt: string
}

export interface MemorySaveSlotSummary {
    saveId: string
    sourceChatId: string
    sourceChatName: string
    createdAt: string
    turnCount: number
    latestMessageId?: string
    latestEvent?: MemorySaveEventPreview
}

// 1: the slot holds a full workspace copy. 2: the slot holds a page list
// (SAVE_FILES) whose pages live in the character's shared save store.
interface StoredMemorySaveManifest extends MemorySaveSlotSummary {
    schemaVersion: 1 | 2
}

type SaveFileSystem = Pick<
    typeof nodeFs,
    'lstat' | 'mkdir' | 'readdir' | 'readFile' | 'rm' | 'writeFile'
    | 'copyFile' | 'rename' | 'realpath'
>

function required(value: unknown, label: string, maximum = 1_024): string {
    if (typeof value !== 'string'
        || value.trim().length === 0
        || value.length > maximum) {
        throw new Error(`${label} must be a non-empty bounded string`)
    }
    return value
}

export function memorySaveWorkspaceId(saveId: string): string {
    return `${SAVE_PREFIX}${required(saveId, 'saveId')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseEventPreview(value: unknown): MemorySaveEventPreview {
    if (!isRecord(value)
        || Object.keys(value).length !== 2
        || typeof value.title !== 'string'
        || value.title.trim().length === 0
        || value.title.length > 512
        || typeof value.excerpt !== 'string'
        || value.excerpt.length > 1_000) {
        throw new Error('Invalid memory save event preview')
    }
    return { title: value.title, excerpt: value.excerpt }
}

function parseManifest(value: unknown): StoredMemorySaveManifest {
    if (!isRecord(value)) throw new Error('Invalid memory save manifest')
    const hasEvent = value.latestEvent !== undefined
    const hasLatestMessageId = value.latestMessageId !== undefined
    const keys = [
        'schemaVersion', 'saveId', 'sourceChatId', 'sourceChatName',
        'createdAt', 'turnCount',
        ...(hasLatestMessageId ? ['latestMessageId'] : []),
        ...(hasEvent ? ['latestEvent'] : []),
    ]
    if (Object.keys(value).length !== keys.length
        || !keys.every((key) => Object.hasOwn(value, key))
        || (value.schemaVersion !== 1 && value.schemaVersion !== 2)
        || typeof value.saveId !== 'string'
        || typeof value.sourceChatId !== 'string'
        || typeof value.sourceChatName !== 'string'
        || typeof value.createdAt !== 'string'
        || !Number.isFinite(Date.parse(value.createdAt))
        || !Number.isSafeInteger(value.turnCount)
        || (value.turnCount as number) < 0) {
        throw new Error('Invalid memory save manifest')
    }
    return {
        schemaVersion: value.schemaVersion as 1 | 2,
        saveId: required(value.saveId, 'saved saveId'),
        sourceChatId: required(value.sourceChatId, 'saved sourceChatId'),
        sourceChatName: required(value.sourceChatName, 'saved chat name', 512),
        createdAt: value.createdAt,
        turnCount: value.turnCount as number,
        ...(hasLatestMessageId ? {
            latestMessageId: required(
                value.latestMessageId,
                'saved latest message ID'
            ),
        } : {}),
        ...(hasEvent ? { latestEvent: parseEventPreview(value.latestEvent) } : {}),
    }
}

function summaryOf(manifest: StoredMemorySaveManifest): MemorySaveSlotSummary {
    const { schemaVersion: _schemaVersion, ...summary } = manifest
    return summary
}

function workspaceFor(
    userDataDirectory: string,
    characterId: string,
    saveId: string
) {
    return resolveMemoryWorkspace(
        userDataDirectory,
        characterId,
        memorySaveWorkspaceId(saveId)
    )
}

async function safeFile(
    fileSystem: SaveFileSystem,
    path: string,
    label: string
): Promise<void> {
    const status = await fileSystem.lstat(path)
    if (status.isSymbolicLink() || !status.isFile()) {
        throw new Error(`${label} is unsafe`)
    }
}

async function saveSlotDirectories(
    fileSystem: SaveFileSystem,
    userDataDirectory: string,
    characterId: string
): Promise<string[]> {
    const chatsDirectory = dirname(resolveMemoryWorkspace(
        userDataDirectory, characterId, 'save-list-probe'
    ).directory)
    let entries
    try {
        entries = await fileSystem.readdir(chatsDirectory, { withFileTypes: true })
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
    }
    // Staged and backup slot directories share the prefix and keep their pages.
    return entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()
            && entry.name.startsWith(SAVE_DIRECTORY_PREFIX))
        .map((entry) => join(chatsDirectory, entry.name))
}

async function slotPageHashes(
    fileSystem: SaveFileSystem,
    directory: string
): Promise<string[]> {
    try {
        return parseSavedFiles(await fileSystem.readFile(
            join(directory, SAVE_FILES), 'utf8'
        )).map((entry) => entry.hash)
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
    }
}

async function validatedSave(
    fileSystem: SaveFileSystem,
    input: { userDataDirectory: string; characterId: string; saveId: string }
): Promise<{
    directory: string
    manifestPath: string
    chatPath: string
    manifest: StoredMemorySaveManifest
}> {
    const characterId = required(input.characterId, 'characterId')
    const saveId = required(input.saveId, 'saveId')
    const workspace = workspaceFor(input.userDataDirectory, characterId, saveId)
    const manifestPath = join(workspace.directory, SAVE_MANIFEST)
    const chatPath = join(workspace.directory, SAVE_CHAT)
    await safeFile(fileSystem, manifestPath, 'Memory save manifest')
    await safeFile(fileSystem, chatPath, 'Memory save chat')
    const manifest = parseManifest(JSON.parse(
        await fileSystem.readFile(manifestPath, 'utf8')
    ))
    if (manifest.saveId !== saveId) {
        throw new Error('Invalid memory save manifest')
    }
    return {
        directory: workspace.directory,
        manifestPath,
        chatPath,
        manifest,
    }
}

export async function createMemorySaveSlot(input: {
    userDataDirectory: string
    characterId: string
    sourceChatId: string
    saveId: string
    overwrite?: boolean
    sourceChatName: string
    turnCount: number
    latestMessageId?: string
    chatBytes: Uint8Array
    createdAt?: string
    latestEvent?: MemorySaveEventPreview
}, options: { fileSystem?: SaveFileSystem } = {}): Promise<MemorySaveSlotSummary> {
    const fileSystem = options.fileSystem ?? nodeFs
    const saveId = required(input.saveId, 'saveId')
    const sourceChatId = required(input.sourceChatId, 'sourceChatId')
    let sourceChatName = required(input.sourceChatName, 'sourceChatName', 512)
    let replacedPages: string[] = []
    if (input.overwrite) {
        const saved = await validatedSave(fileSystem, input)
        if (saved.manifest.sourceChatId !== sourceChatId) {
            throw new Error('Cannot overwrite a save from a different chat')
        }
        sourceChatName = saved.manifest.sourceChatName
        replacedPages = await slotPageHashes(fileSystem, saved.directory)
    }
    const store = saveStoreDirectory(
        workspaceFor(input.userDataDirectory, input.characterId, saveId).directory
    )
    // Unchanged pages are already in the store; only new pages are copied.
    const populate = async (staging: string, sourceDirectory: string | null) => {
        const entries = sourceDirectory
            ? await snapshotWorkspaceToStore(fileSystem, sourceDirectory, store)
            : []
        await fileSystem.writeFile(
            join(staging, SAVE_FILES),
            serializeSavedFiles(entries),
            { encoding: 'utf8', flag: 'wx', mode: 0o600 }
        )
    }
    if (!Number.isSafeInteger(input.turnCount) || input.turnCount < 0) {
        throw new Error('turnCount must be a non-negative safe integer')
    }
    if (!(input.chatBytes instanceof Uint8Array)
        || input.chatBytes.byteLength === 0) {
        throw new Error('chatBytes must not be empty')
    }
    const createdAt = input.createdAt ?? new Date().toISOString()
    if (!Number.isFinite(Date.parse(createdAt))) {
        throw new Error('createdAt must be an ISO-compatible date')
    }
    const manifest: StoredMemorySaveManifest = {
        schemaVersion: 2,
        saveId,
        sourceChatId,
        sourceChatName,
        createdAt,
        turnCount: input.turnCount,
        ...(input.latestMessageId ? {
            latestMessageId: required(
                input.latestMessageId,
                'latestMessageId'
            ),
        } : {}),
        ...(input.latestEvent
            ? { latestEvent: parseEventPreview(input.latestEvent) }
            : {}),
    }
    const destinationChatId = memorySaveWorkspaceId(saveId)
    let receipt: MemoryForkReceipt | undefined
    try {
        const forkInput = {
            userDataDirectory: input.userDataDirectory,
            characterId: required(input.characterId, 'characterId'),
            sourceChatId,
            destinationChatId,
        }
        receipt = input.overwrite
            ? await replaceMemoryWorkspace(forkInput, { fileSystem, populate })
            : await forkMemoryWorkspace({ ...forkInput, mode: 'copy' }, { fileSystem, populate })
        const directory = input.overwrite
            ? resolveMemoryReplacementStaging(
                input.userDataDirectory, input.characterId,
                destinationChatId, receipt.forkToken
            )
            : workspaceFor(input.userDataDirectory, input.characterId, saveId).directory
        await fileSystem.writeFile(
            join(directory, SAVE_CHAT),
            input.chatBytes,
            { flag: 'wx', mode: 0o600 }
        )
        await fileSystem.writeFile(
            join(directory, SAVE_MANIFEST),
            JSON.stringify(manifest),
            { encoding: 'utf8', flag: 'wx', mode: 0o600 }
        )
        await completeMemoryWorkspaceFork({
            userDataDirectory: input.userDataDirectory,
            characterId: input.characterId,
            destinationChatId,
            forkToken: receipt.forkToken,
            action: 'finalize',
        }, { fileSystem })
        // Pages only the replaced version used are released; a failure leaves
        // unused pages behind but never damages a slot.
        await releaseStorePages(fileSystem, store, replacedPages,
            await saveSlotDirectories(fileSystem, input.userDataDirectory, input.characterId)
        ).catch(() => undefined)
        return summaryOf(manifest)
    }
    catch (error) {
        if (receipt) {
            await completeMemoryWorkspaceFork({
                userDataDirectory: input.userDataDirectory,
                characterId: input.characterId,
                destinationChatId,
                forkToken: receipt.forkToken,
                action: 'discard',
            }, { fileSystem }).catch(() => undefined)
        }
        throw error
    }
}

export async function listMemorySaveSlots(input: {
    userDataDirectory: string
    characterId: string
    sourceChatId: string
}, options: { fileSystem?: SaveFileSystem } = {}): Promise<MemorySaveSlotSummary[]> {
    const fileSystem = options.fileSystem ?? nodeFs
    const sourceChatId = required(input.sourceChatId, 'sourceChatId')
    const probe = resolveMemoryWorkspace(
        input.userDataDirectory,
        required(input.characterId, 'characterId'),
        'save-list-probe'
    )
    const chatsDirectory = dirname(probe.directory)
    let entries
    try {
        entries = await fileSystem.readdir(chatsDirectory, { withFileTypes: true })
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
    }
    // Every slot of the character is read to find this chat's; read them
    // concurrently instead of one file at a time.
    const read = async (entry: (typeof entries)[number]): Promise<MemorySaveSlotSummary | null> => {
        if (!entry.isDirectory()
            || entry.isSymbolicLink()
            || !entry.name.startsWith(SAVE_DIRECTORY_PREFIX)) return null
        const directory = join(chatsDirectory, entry.name)
        const manifestPath = join(directory, SAVE_MANIFEST)
        const chatPath = join(directory, SAVE_CHAT)
        try {
            // Both checks run together; the manifest's failure still wins.
            const checks = await Promise.allSettled([
                safeFile(fileSystem, manifestPath, 'Memory save manifest'),
                safeFile(fileSystem, chatPath, 'Memory save chat'),
            ])
            for (const check of checks) if (check.status === 'rejected') throw check.reason
            const manifest = parseManifest(JSON.parse(
                await fileSystem.readFile(manifestPath, 'utf8')
            ))
            if (manifest.sourceChatId !== sourceChatId) return null
            if (workspaceFor(
                input.userDataDirectory, input.characterId, manifest.saveId
            ).directory !== directory) return null
            return summaryOf(manifest)
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
            if (error instanceof SyntaxError
                || (error instanceof Error
                    && error.message.startsWith('Invalid memory save'))) return null
            throw error
        }
    }
    const summaries = (await Promise.all(entries.map(read)))
        .filter((summary): summary is MemorySaveSlotSummary => summary !== null)
    return summaries.sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt)
        || left.saveId.localeCompare(right.saveId)
    )
}

export async function readMemorySaveChat(input: {
    userDataDirectory: string
    characterId: string
    saveId: string
}, options: { fileSystem?: SaveFileSystem } = {}): Promise<Buffer> {
    const fileSystem = options.fileSystem ?? nodeFs
    const saved = await validatedSave(fileSystem, input)
    return Buffer.from(await fileSystem.readFile(saved.chatPath))
}

export async function renameMemorySaveSlot(input: {
    userDataDirectory: string
    characterId: string
    saveId: string
    name: string
}, options: { fileSystem?: SaveFileSystem } = {}): Promise<MemorySaveSlotSummary> {
    const fileSystem = options.fileSystem ?? nodeFs
    const name = required(input.name, 'saved file name', 512)
    const saved = await validatedSave(fileSystem, input)
    const manifest: StoredMemorySaveManifest = {
        ...saved.manifest,
        sourceChatName: name,
    }
    await fileSystem.writeFile(
        saved.manifestPath,
        JSON.stringify(manifest),
        { encoding: 'utf8', mode: 0o600 }
    )
    return summaryOf(manifest)
}

export async function deleteMemorySaveSlot(input: {
    userDataDirectory: string
    characterId: string
    saveId: string
}, options: { fileSystem?: SaveFileSystem } = {}): Promise<void> {
    const fileSystem = options.fileSystem ?? nodeFs
    const saved = await validatedSave(fileSystem, input)
    const pages = await slotPageHashes(fileSystem, saved.directory)
    await fileSystem.rm(saved.directory, { recursive: true, force: false })
    await releaseStorePages(fileSystem, saveStoreDirectory(saved.directory), pages,
        await saveSlotDirectories(fileSystem, input.userDataDirectory, input.characterId)
    ).catch(() => undefined)
}

export async function prepareMemorySaveLoad(input: {
    userDataDirectory: string
    characterId: string
    saveId: string
    destinationChatId: string
}, options: { fileSystem?: SaveFileSystem } = {}): Promise<{
    chatBytes: Buffer
    save: MemorySaveSlotSummary
    fork: MemoryForkReceipt
}> {
    const fileSystem = options.fileSystem ?? nodeFs
    const sourceChatId = memorySaveWorkspaceId(input.saveId)
    const workspace = workspaceFor(
        input.userDataDirectory, input.characterId, input.saveId
    )
    const manifestPath = join(workspace.directory, SAVE_MANIFEST)
    const chatPath = join(workspace.directory, SAVE_CHAT)
    await safeFile(fileSystem, manifestPath, 'Memory save manifest')
    await safeFile(fileSystem, chatPath, 'Memory save chat')
    const manifest = parseManifest(JSON.parse(
        await fileSystem.readFile(manifestPath, 'utf8')
    ))
    const chatBytes = Buffer.from(await fileSystem.readFile(chatPath))
    const pages = manifest.schemaVersion === 2
        ? parseSavedFiles(await fileSystem.readFile(
            join(workspace.directory, SAVE_FILES), 'utf8'
        ))
        : null
    const fork = await replaceMemoryWorkspace({
        userDataDirectory: input.userDataDirectory,
        characterId: required(input.characterId, 'characterId'),
        sourceChatId,
        destinationChatId: required(
            input.destinationChatId, 'destinationChatId'
        ),
    }, {
        fileSystem: fileSystem as typeof nodeFs,
        ...(pages ? {
            populate: (staging: string) => restoreWorkspaceFromStore(
                fileSystem, pages, saveStoreDirectory(workspace.directory), staging
            ),
        } : {}),
    })
    try {
        if (!pages) {
            const destinationDirectory = resolveMemoryReplacementStaging(
                input.userDataDirectory,
                input.characterId,
                input.destinationChatId,
                fork.forkToken
            )
            await fileSystem.rm(join(destinationDirectory, SAVE_MANIFEST), {
                force: false,
            })
            await fileSystem.rm(join(destinationDirectory, SAVE_CHAT), {
                force: false,
            })
        }
        return { chatBytes, save: summaryOf(manifest), fork }
    }
    catch (error) {
        await completeMemoryWorkspaceFork({
            userDataDirectory: input.userDataDirectory,
            characterId: input.characterId,
            destinationChatId: input.destinationChatId,
            forkToken: fork.forkToken,
            action: 'discard',
        }).catch(() => undefined)
        throw error
    }
}
