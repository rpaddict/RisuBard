// Client for the server's music-folder routes (server/node/bgm-folders.cjs).

export interface BgmFolder {
    id: string
    path: string
    name: string
}

export type BgmFolderError = { index: number; reason: 'not-absolute' | 'missing' | 'not-directory' | 'duplicate' | 'invalid-list' }

async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const { forageStorage } = await import('../globalApi.svelte')
    return fetch(path, {
        ...init,
        headers: {
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            'risu-auth': await forageStorage.createAuth(),
            ...(init.headers ?? {}),
        },
    })
}

export function bgmFoldersAvailable(): boolean {
    return !!(globalThis as { __NODE__?: boolean }).__NODE__
}

export async function listBgmFolders(): Promise<BgmFolder[]> {
    const response = await request('/api/bgm/folders')
    if (!response.ok) throw new Error(`Music folders unavailable (${response.status})`)
    return (await response.json()).folders
}

export async function saveBgmFolders(folders: Array<{ id?: string; path: string; name?: string }>): Promise<{ folders: BgmFolder[] } | { errors: BgmFolderError[] }> {
    const response = await request('/api/bgm/folders', { method: 'PUT', body: JSON.stringify({ folders }) })
    if (response.status === 400) return response.json()
    if (!response.ok) throw new Error(`Music folders could not be saved (${response.status})`)
    return response.json()
}

export async function scanBgmFolder(folderId: string): Promise<{ files: string[]; truncated: boolean }> {
    const response = await request(`/api/bgm/folders/${encodeURIComponent(folderId)}/files`)
    if (!response.ok) throw new Error(`Folder could not be read (${response.status})`)
    return response.json()
}

/** Maps a pasted absolute path to a registered folder; null when it is outside every folder. */
export async function locateBgmFile(path: string): Promise<{ folderId: string; relPath: string } | null> {
    const response = await request('/api/bgm/locate', { method: 'POST', body: JSON.stringify({ path }) })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Path could not be checked (${response.status})`)
    return response.json()
}
