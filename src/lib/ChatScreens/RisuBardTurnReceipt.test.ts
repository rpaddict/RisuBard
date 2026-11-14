import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const receipt = readFileSync(resolve(
    process.cwd(),
    'src/lib/ChatScreens/RisuBardTurnReceipt.svelte'
), 'utf8')
const chat = readFileSync(resolve(
    process.cwd(),
    'src/lib/ChatScreens/Chat.svelte'
), 'utf8')
const chats = readFileSync(resolve(
    process.cwd(),
    'src/lib/ChatScreens/Chats.svelte'
), 'utf8')
describe('per-assistant canonical turn receipt', () => {
    test('renders compact provenance without per-turn undo controls', () => {
        expect(receipt).toContain('data-risubard-turn-receipt')
        expect(receipt).not.toContain('onUndo')
        expect(receipt).not.toContain('undo(change.documentId)')
        expect(receipt).not.toContain('undoConflict')
        expect(chat).toContain('role === \'char\' && canonicalReceipt')
        expect(chats).toContain(
            'canonicalReceipt: message.risubardCanonicalReceipt'
        )
        expect(chats).toContain('JSON.stringify(message.risubardCanonicalReceipt')
        // A message mounted with a preserved reading position must still react to a later receipt,
        // so the effect reads it before the deferred mount.
        const mount = chats.slice(chats.indexOf('const messageData = message.data'), chats.indexOf('queueMicrotask(() => {'))
        expect(mount).toContain('const canonicalReceipt = message.risubardCanonicalReceipt')
        expect(mount).toContain('const memoryConfirmed = message.risubardMemoryConfirmed === true')
        expect(chat).not.toContain('onUndoCanonical')
        expect(chats).not.toContain('onUndoCanonical')
    })
})
