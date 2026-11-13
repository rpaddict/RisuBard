export interface PluginAnalysisLoreRequest {
    characterId: string
    chatId: string
    targetMessageId: string
    messages: { messageId?: string; role: string; content: string }[]
}
export type PluginAnalysisLoreSnapshot = Omit<PluginAnalysisLoreRequest, 'targetMessageId'>

/** The host must not attach a reference to a different or edited conversation. */
export async function capturePluginAnalysisLoreReference<T extends { title: string; content: string }>(
    input: PluginAnalysisLoreRequest,
    snapshot: () => PluginAnalysisLoreSnapshot,
    collect: () => Promise<T[] | undefined>,
) {
    const project = (value: PluginAnalysisLoreSnapshot) => JSON.stringify({
        characterId: value.characterId,
        chatId: value.chatId,
        messages: value.messages.map(({ messageId, role, content }) => ({ messageId, role, content })),
    })
    const expected = project(input)
    const before = snapshot()
    if (project(before) !== expected || !before.messages.some(message => message.messageId === input.targetMessageId))
        throw new Error('Lore reference source changed')
    const reference = await collect()
    if (project(snapshot()) !== expected) throw new Error('Lore reference source changed')
    return reference ?? []
}
