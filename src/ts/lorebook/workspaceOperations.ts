import type { loreBook } from '../storage/database.svelte'

export type LorebookFilter = {
    query: string
    target: 'name' | 'keys' | 'all'
    enabled: 'all' | 'enabled' | 'disabled'
}

export type LorebookDropPosition = 'before' | 'after' | 'inside'
export type LorebookKeyField = 'key' | 'secondkey'

type FolderNode = {
    kind: 'folder'
    entry: loreBook
    index: number
    children: ChildNode[]
}

type ChildNode = {
    entry: loreBook
    index: number
}

type RootNode = {
    kind: 'root'
    entry: loreBook
    index: number
}

type WorkspaceNode = FolderNode | RootNode

const hasId = (entry: loreBook): entry is loreBook & { id: string } =>
    typeof entry.id === 'string' && entry.id.trim() !== ''

const isFolder = (entry: loreBook) => entry.mode === 'folder'
const isBatchEditable = (entry: loreBook) => entry.mode !== 'folder' && entry.mode !== 'child'

function parseKeys(values: string[]): string[] {
    return values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean)
}

function uniqueFolderLookup(entries: loreBook[]): Map<string, loreBook> {
    const folders = new Map<string, loreBook>()
    const duplicates = new Set<string>()

    for (const entry of entries) {
        if (!isFolder(entry) || !entry.key) continue
        if (folders.has(entry.key)) {
            folders.delete(entry.key)
            duplicates.add(entry.key)
        }
        else if (!duplicates.has(entry.key)) {
            folders.set(entry.key, entry)
        }
    }

    return folders
}

function hasDuplicateFolderKeys(entries: loreBook[]): boolean {
    const keys = new Set<string>()
    for (const entry of entries) {
        if (!isFolder(entry) || !entry.key) continue
        if (keys.has(entry.key)) return true
        keys.add(entry.key)
    }
    return false
}

function buildWorkspace(entries: loreBook[]): WorkspaceNode[] {
    const folders: FolderNode[] = []
    const nodesByEntry = new Map<loreBook, FolderNode>()

    entries.forEach((entry, index) => {
        if (isFolder(entry)) {
            const folder = { kind: 'folder' as const, entry, index, children: [] }
            folders.push(folder)
            nodesByEntry.set(entry, folder)
        }
    })
    const foldersByKey = new Map(
        [...uniqueFolderLookup(entries)].map(([key, entry]) => [key, nodesByEntry.get(entry)!]),
    )

    const roots: RootNode[] = []
    entries.forEach((entry, index) => {
        if (isFolder(entry)) return

        const folder = entry.folder ? foldersByKey.get(entry.folder) : undefined
        if (folder) {
            folder.children.push({ entry, index })
        }
        else {
            roots.push({ kind: 'root', entry, index })
        }
    })

    return [...folders, ...roots].sort((left, right) => left.index - right.index)
}

function emitWorkspace(nodes: WorkspaceNode[]): loreBook[] {
    const positioned: Array<{ entry: loreBook; parentKey?: string }> = []

    for (const node of nodes) {
        if (node.kind === 'root') {
            positioned.push({ entry: node.entry })
            continue
        }

        positioned.push({ entry: node.entry })
        const folderKey = node.entry.key
        for (const child of node.children) {
            positioned.push({ entry: child.entry, parentKey: folderKey })
        }
    }

    return positioned.map(({ entry, parentKey }, index) => {
        const insertorder = (index + 1) * 10
        const hasParent = !isFolder(entry) && parentKey !== undefined
        const folderUnchanged = hasParent ? entry.folder === parentKey : entry.folder === undefined
        if (entry.insertorder === insertorder && folderUnchanged) return entry

        const next = { ...entry, insertorder }
        if (!hasParent) {
            delete next.folder
        }
        else {
            next.folder = parentKey!
        }
        return next
    })
}

export function ensureLorebookIds(entries: loreBook[], createId: () => string): loreBook[] {
    const used = new Set(entries.filter(hasId).map((entry) => entry.id))
    const retained = new Set<string>()

    return entries.map((entry) => {
        if (hasId(entry) && !retained.has(entry.id)) {
            retained.add(entry.id)
            return entry
        }

        let id = createId()
        while (!id.trim() || used.has(id)) id = createId()
        used.add(id)
        return { ...entry, id }
    })
}

export function addLorebookEntry(entries: loreBook[], entry: loreBook): loreBook[] {
    if (!hasId(entry) || entries.some((current) => current.id === entry.id)) return entries
    return [...entries, entry]
}

export function deleteLorebookEntries(entries: loreBook[], selected: Set<string>): loreBook[] {
    if (selected.size === 0) return entries

    const folderKeys = new Set(
        entries
            .filter((entry) => isFolder(entry) && hasId(entry) && selected.has(entry.id))
            .map((entry) => entry.key)
            .filter(Boolean),
    )
    const next = entries.filter((entry) => {
        if (hasId(entry) && selected.has(entry.id)) return false
        return isFolder(entry) || !entry.folder || !folderKeys.has(entry.folder)
    })
    return next.length === entries.length ? entries : next
}

export function updateLorebookEntry(
    entries: loreBook[],
    id: string,
    patch: Partial<loreBook>,
): loreBook[] {
    const index = entries.findIndex((entry) => entry.id === id)
    if (index < 0) return entries
    return entries.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry)
}

export function filterLorebookEntries(entries: loreBook[], filter: LorebookFilter): loreBook[] {
    const query = filter.query.trim().toLocaleLowerCase()
    const folders = uniqueFolderLookup(entries)
    const included = new Set<loreBook>()

    for (const entry of entries) {
        const isEnabled = (entry as loreBook & { enabled?: boolean }).enabled !== false
        if (
            filter.enabled === 'enabled' && !isEnabled
            || filter.enabled === 'disabled' && isEnabled
        ) {
            continue
        }
        if (isFolder(entry) && filter.target !== 'name' && query) {
            continue
        }

        const searchable = filter.target === 'name'
            ? entry.comment
            : filter.target === 'keys'
                ? `${entry.key},${entry.secondkey}`
                : `${entry.comment}\n${entry.key}\n${entry.secondkey}\n${entry.content}`
        if (query && !searchable.toLocaleLowerCase().includes(query)) continue

        included.add(entry)
        if (!isFolder(entry) && entry.folder) {
            const parent = folders.get(entry.folder)
            if (parent) included.add(parent)
        }
    }

    return entries.filter((entry) => included.has(entry))
}

export function orderLorebookEntriesForDisplay(entries: loreBook[]): loreBook[] {
    const ordered: loreBook[] = []
    for (const node of buildWorkspace(entries)) {
        ordered.push(node.entry)
        if (node.kind === 'folder') ordered.push(...node.children.map((child) => child.entry))
    }
    return ordered
}

export function applyBatchPatch(entries: loreBook[], selected: Set<string>, patch: Partial<loreBook>): loreBook[] {
    return entries.map((entry) =>
        isBatchEditable(entry) && hasId(entry) && selected.has(entry.id) ? { ...entry, ...patch } : entry,
    )
}

export function addKeysToEntries(
    entries: loreBook[],
    selected: Set<string>,
    field: LorebookKeyField,
    keys: string[],
): loreBook[] {
    const additions = parseKeys(keys)
    return entries.map((entry) => {
        if (!isBatchEditable(entry) || !hasId(entry) || !selected.has(entry.id)) return entry

        const current = [...new Set(parseKeys([entry[field]]))]
        const next = [...current]
        for (const key of additions) {
            if (!next.includes(key)) next.push(key)
        }
        const value = next.join(', ')
        return value === entry[field] ? entry : { ...entry, [field]: value }
    })
}

export function removeKeysFromEntries(
    entries: loreBook[],
    selected: Set<string>,
    field: LorebookKeyField,
    keys: string[],
): loreBook[] {
    const removals = new Set(parseKeys(keys))
    return entries.map((entry) => {
        if (!isBatchEditable(entry) || !hasId(entry) || !selected.has(entry.id)) return entry

        const value = [...new Set(parseKeys([entry[field]]).filter((key) => !removals.has(key)))].join(', ')
        return value === entry[field] ? entry : { ...entry, [field]: value }
    })
}

export function moveLorebookEntries(
    entries: loreBook[],
    sourceIds: string[],
    targetId: string,
    position: LorebookDropPosition,
): loreBook[] {
    if (sourceIds.length === 0) return entries

    const byId = new Map<string, { entry: loreBook; index: number }>()
    for (const [index, entry] of entries.entries()) {
        if (!hasId(entry) || byId.has(entry.id)) return entries
        byId.set(entry.id, { entry, index })
    }

    const sourceSet = new Set(sourceIds)
    const target = byId.get(targetId)
    if (!target || sourceSet.has(targetId) || [...sourceSet].some((id) => !byId.has(id))) return entries
    if (position === 'inside' && isFolder(target.entry) && !target.entry.key) return entries
    if (hasDuplicateFolderKeys(entries)) return entries

    const selectedFolderIds = new Set(
        [...sourceSet].filter((id) => isFolder(byId.get(id)!.entry)),
    )
    const selectedFolderKeys = new Set(
        [...selectedFolderIds].map((id) => byId.get(id)!.entry.key).filter(Boolean),
    )
    const moved = new Set(sourceSet)
    for (const { entry } of byId.values()) {
        if (!isFolder(entry) && entry.folder && selectedFolderKeys.has(entry.folder) && hasId(entry)) {
            moved.add(entry.id)
        }
    }
    if (hasId(target.entry) && moved.has(target.entry.id)) return entries

    const nodes = buildWorkspace(entries)
    const folders = new Map(
        nodes.filter((node): node is FolderNode => node.kind === 'folder').map((node) => [node.entry.key, node]),
    )
    const targetFolderId = isFolder(target.entry)
        ? targetId
        : target.entry.folder && folders.get(target.entry.folder)?.entry.id
            ? folders.get(target.entry.folder)!.entry.id
            : undefined
    const targetIsChild = !isFolder(target.entry) && Boolean(targetFolderId)
    const movedFolders: FolderNode[] = []
    const movedRoots: RootNode[] = []
    const movedChildren: ChildNode[] = []
    const remaining: WorkspaceNode[] = []

    for (const node of nodes) {
        if (node.kind === 'folder') {
            if (hasId(node.entry) && selectedFolderIds.has(node.entry.id)) {
                movedFolders.push(node)
                continue
            }

            const children = node.children.filter((child) => {
                if (hasId(child.entry) && moved.has(child.entry.id)) {
                    movedChildren.push(child)
                    return false
                }
                return true
            })
            remaining.push({ ...node, children })
            continue
        }

        if (hasId(node.entry) && moved.has(node.entry.id)) {
            movedRoots.push(node)
        }
        else {
            remaining.push(node)
        }
    }

    const movedTop: WorkspaceNode[] = [
        ...movedFolders,
        ...movedRoots,
        ...movedChildren.map((child) => ({ kind: 'root' as const, entry: child.entry, index: child.index })),
    ].sort((left, right) => left.index - right.index)
    const movedLeaves = [...movedRoots, ...movedChildren]
        .sort((left, right) => left.index - right.index)
        .map(({ entry, index }) => ({ entry, index }))

    const targetFolder = targetFolderId
        ? remaining.find((node): node is FolderNode => node.kind === 'folder' && node.entry.id === targetFolderId)
        : undefined

    const childDestination = targetFolder && (targetIsChild || position === 'inside' && isFolder(target.entry))
    if (childDestination) {
        const leaves = movedLeaves.map(({ entry, index }) => ({ entry, index }))
        const targetChildIndex = targetFolder.children.findIndex((child) => child.entry.id === targetId)
        const insertAt = targetIsChild && position !== 'inside'
            ? targetChildIndex + (position === 'after' ? 1 : 0)
            : targetFolder.children.length
        targetFolder.children.splice(insertAt, 0, ...leaves)
    }

    const topInsertions = childDestination
        ? movedFolders
        : movedTop
    if (topInsertions.length > 0) {
        let insertAt: number
        if (targetIsChild) {
            insertAt = remaining.findIndex((node) => node.kind === 'folder' && node.entry.id === targetFolderId) + 1
        }
        else {
            const targetTopIndex = remaining.findIndex((node) => node.entry.id === targetId)
            insertAt = targetTopIndex + (position === 'before' ? 0 : 1)
        }
        remaining.splice(insertAt, 0, ...topInsertions)
    }

    return emitWorkspace(remaining)
}
