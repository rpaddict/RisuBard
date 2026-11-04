import type { Chat, character } from '../storage/database.svelte'
import { invokeBrowserFetch } from './browserFetch'
import { validateWikiPackage, type WikiPackage } from './wikiTransferPackage'
export { createWikiPackage, serializeWikiPackage, parseWikiPackage, isPortableWikiDocument, WIKI_PACKAGE_MAX_BYTES } from './wikiTransferPackage'
export type { WikiPackage } from './wikiTransferPackage'

async function request(path: string, body: unknown, input: { fetchImpl: typeof fetch; createAuth(): Promise<string> }): Promise<unknown> {
    const response = await invokeBrowserFetch(input.fetchImpl, path, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'risu-auth': await input.createAuth() },
        body: JSON.stringify(body),
    })
    const value = await response.json().catch(() => null)
    if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : `위키 이동 실패 (${response.status})`)
    return value
}

export async function importWikiPackage(input: {
    characterId: string; chatId: string; package: WikiPackage; fetchImpl: typeof fetch; createAuth(): Promise<string>
}): Promise<{ imported: number }> {
    const pack = validateWikiPackage(input.package)
    const value = await request('/api/risubard/memory/wiki/import', {
        characterId: input.characterId, chatId: input.chatId, package: pack,
    }, input) as { imported?: unknown } | null
    if (!value || value.imported !== pack.documents.length) throw new Error('위키 들여오기 결과를 확인할 수 없습니다. 위키를 새로 확인해 주세요.')
    return { imported: pack.documents.length }
}

export function buildWikiContinuationChat(source: Chat, id: string): Chat {
    if (!source.id || source._placeholder || source.isStreaming || source.risuBardWikiReboot) throw new Error('챗을 불러오고 진행 중인 작업을 마친 뒤 다시 시도해 주세요.')
    // Explicit settings allowlist keeps future transcript-derived fields out of a
    // blank continuation. Callers pass a non-reactive snapshot.
    const settings: Partial<Chat> = {}
    const keys = ['note', 'localLore', 'scriptstate', 'modules', 'bindedPersona', 'bindedBotPreset', 'fmIndex', 'folderId',
        'risuBardWikiGuide', 'risuBardSettings', 'savedToggleValues', 'togglePresetBaseline',
        'useLocallySetGlobalVariables', 'GLGlobalVariables', 'useModelPreset', 'modelBinding', 'usePromptPresetParams'] as const
    for (const key of keys) {
        if (source[key] !== undefined) Object.assign(settings, { [key]: structuredClone(source[key]) })
    }
    return { note: '', localLore: [], ...settings, id, name: `${source.name} (이어가기)`, message: [], firstMessageDisabled: true }
}

export async function publishWikiContinuation(
    owner: Pick<character, 'chats' | 'chatPage'>, chat: Chat,
    deps: { inherit(): Promise<string>; complete(token: string, action: 'finalize' | 'discard'): Promise<unknown>; save(): Promise<unknown> },
): Promise<void> {
    const token = await deps.inherit()
    // Append so the user's currently selected chat index remains valid.
    owner.chats = [...owner.chats, chat]
    try { await deps.save() }
    catch (error) {
        owner.chats = owner.chats.filter(item => item.id !== chat.id)
        const results = await Promise.allSettled([deps.complete(token, 'discard'), deps.save()])
        const failures = results.flatMap(result => result.status === 'rejected' ? [String(result.reason)] : [])
        if (failures.length) throw new Error(`${String(error)}; 복구 실패: ${failures.join('; ')}`)
        throw error
    }
    try { await deps.complete(token, 'finalize') }
    catch {
        try { await deps.complete(token, 'finalize') }
        catch (error) { throw new Error(`새 챗은 저장되었지만 위키 마무리를 확인하지 못했습니다: ${String(error)}`) }
    }
}

export async function startChatWithWiki(input: { characterId: string; chatId: string }): Promise<void> {
    const [{ DBState, selIdState }, api, { v4 }, { get }, generation, wikiGeneration, { safeStructuredClone }] = await Promise.all([
        import('../stores.svelte'), import('../globalApi.svelte'), import('uuid'), import('svelte/store'),
        import('../process/generationState'), import('./wikiGenerationState'), import('../polyfill'),
    ])
    if (get(generation.isAnyGenerating) || get(wikiGeneration.isWikiGenerating)) throw new Error('진행 중인 생성 작업을 마친 뒤 다시 시도해 주세요.')
    const owner = DBState.db.characters.find(item => item.chaId === input.characterId)
    const source = owner?.chats.find(item => item.id === input.chatId)
    if (!owner || !source) throw new Error('원본 챗을 찾을 수 없습니다.')
    const chat = buildWikiContinuationChat(safeStructuredClone(source), v4())
    const baseName = chat.name
    let suffix = 2
    while (owner.chats.some(item => item.name === chat.name)) chat.name = `${baseName} ${suffix++}`
    const operationId = `wiki-inherit:${chat.id}`
    wikiGeneration.beginWikiGeneration(operationId)
    try {
        const { completeMemoryWikiFork } = await import('./memoryWikiFork')
        await publishWikiContinuation(owner, chat, {
            inherit: async () => {
                const value = await request('/api/risubard/memory/wiki/inherit', {
                    characterId: input.characterId, sourceChatId: input.chatId, destinationChatId: chat.id,
                }, { fetchImpl: fetch, createAuth: () => api.forageStorage.createAuth() }) as Record<string, unknown> | null
                if (!value || value.mode !== 'copy' || value.sourceExists !== true || value.destinationChatId !== chat.id
                    || typeof value.forkToken !== 'string' || !value.forkToken || value.forkToken.length > 1024) throw new Error('위키 승계 결과를 확인할 수 없습니다.')
                return value.forkToken
            },
            complete: (forkToken, action) => completeMemoryWikiFork({ characterId: input.characterId, destinationChatId: chat.id!, forkToken, action, fetchImpl: fetch, createAuth: () => api.forageStorage.createAuth() }),
            // The new chat is stored by ID; a rollback save sends just the shorter list.
            save: async () => {
                if (owner.chats.some(item => item.id === chat.id)) api.trackChatForSave(input.characterId, chat.id!)
                await api.requestImmediateSave({ rejectOnFailure: true })
            },
        })
        const activeOwner = DBState.db.characters[selIdState.selId]
        if (activeOwner?.chaId === input.characterId && activeOwner.chats[activeOwner.chatPage]?.id === input.chatId) api.changeChatTo(chat.id!)
    }
    finally { wikiGeneration.endWikiGeneration(operationId) }
}
