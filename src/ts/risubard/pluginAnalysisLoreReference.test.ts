import { describe, expect, it, vi } from 'vitest'
import { capturePluginAnalysisLoreReference, type PluginAnalysisLoreRequest } from './pluginAnalysisLoreReference'

const request = (): PluginAnalysisLoreRequest => ({
    characterId: 'character', chatId: 'chat', targetMessageId: 'assistant',
    messages: [{ messageId: 'user', role: 'user', content: 'The cup.' },
        { messageId: 'assistant', role: 'char', content: 'It is blue.' }],
})

describe('plugin active lore snapshot', () => {
    it('returns the original full selection after checking both snapshots', async () => {
        const input = request()
        const entries = [{ title: 'Cup', content: 'The cup is blue.' }]
        const collect = vi.fn(async () => entries)
        const snapshot = vi.fn(() => input)
        expect(await capturePluginAnalysisLoreReference(input, snapshot, collect)).toBe(entries)
        expect(snapshot).toHaveBeenCalledTimes(2)
        expect(collect).toHaveBeenCalledTimes(1)
    })
    it.each(['character', 'chat', 'text', 'role', 'missing-target'])('rejects %s changes before collecting', async kind => {
        const input = request()
        const scope = structuredClone(input)
        if (kind === 'character') scope.characterId = 'another'
        if (kind === 'chat') scope.chatId = 'another'
        if (kind === 'text') scope.messages[0].content = 'changed'
        if (kind === 'role') scope.messages[0].role = 'char'
        if (kind === 'missing-target') input.targetMessageId = 'absent'
        const collect = vi.fn(async () => [])
        await expect(capturePluginAnalysisLoreReference(input, () => scope, collect)).rejects.toThrow('source changed')
        expect(collect).not.toHaveBeenCalled()
    })
    it.each(['character', 'chat', 'message'])('rejects %s changes while resolving activation', async kind => {
        const input = request()
        const scope = structuredClone(input)
        await expect(capturePluginAnalysisLoreReference(input, () => scope, async () => {
            if (kind === 'character') scope.characterId = 'another'
            if (kind === 'chat') scope.chatId = 'another'
            if (kind === 'message') scope.messages[1].content = 'edited'
            return [{ title: 'Secret', content: 'private' }]
        })).rejects.toThrow('source changed')
    })
})
