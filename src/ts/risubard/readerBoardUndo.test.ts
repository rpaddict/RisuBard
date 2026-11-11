import { beforeEach, describe, expect, it, vi } from 'vitest'

const kv = new Map<string, unknown>()
vi.mock('../storage/persistentKv', () => ({
    readPersistentJson: async (key: string) => structuredClone(kv.get(key) ?? null),
    writePersistentJson: async (key: string, value: unknown) => { kv.set(key, structuredClone(value)) },
    removePersistentKey: async (key: string) => { kv.delete(key) },
}))
vi.mock('../process/request/request', () => ({ requestChatData: vi.fn() }))
vi.mock('../util', () => ({ getUserName: () => 'user' }))
vi.mock('../globalApi.svelte', () => ({ forageStorage: {} }))
vi.mock('./memoryWiki', () => ({ loadNarrativeMemoryWiki: vi.fn() }))

const { loadRunUndo, newReaderBoard, popRunUndo, saveRunUndo, trimRunUndo } = await import('./readerBoardStore')

function boardAt(updatedAt: number) {
    const board = newReaderBoard({ name: 'b', characterId: 'c' })
    board.id = 'board'
    board.updatedAt = updatedAt
    return board
}
const run = (after: number) => ({ chatKey: 'k', ranges: [], after, savedAt: after })

describe('reader board undo stack', () => {
    beforeEach(() => kv.clear())

    it('keeps chained runs up to the depth and undoes them in order', async () => {
        expect(await saveRunUndo(boardAt(1), run(2), 3)).toBe(1)
        expect(await saveRunUndo(boardAt(2), run(3), 3)).toBe(2)
        expect(await saveRunUndo(boardAt(3), run(4), 3)).toBe(3)
        expect(await saveRunUndo(boardAt(4), run(5), 3)).toBe(3)
        let top = await loadRunUndo('board')
        expect(top?.board.updatedAt).toBe(4)
        await popRunUndo('board')
        top = await loadRunUndo('board')
        expect(top?.run.after).toBe(4)
        expect(top?.depth).toBe(2)
    })

    it('replaces the latest run when it is rolled again', async () => {
        await saveRunUndo(boardAt(1), run(2), 3)
        await saveRunUndo(boardAt(2), run(3), 3)
        // Reroll starts again from the board before the latest run.
        expect(await saveRunUndo(boardAt(2), run(9), 3)).toBe(2)
        expect((await loadRunUndo('board'))?.run.after).toBe(9)
    })

    it('drops runs that no longer lead to the board', async () => {
        await saveRunUndo(boardAt(1), run(2), 5)
        await saveRunUndo(boardAt(7), run(8), 5)
        expect((await loadRunUndo('board'))?.depth).toBe(1)
    })

    it('reads the old one-level file and trims to a lower depth', async () => {
        kv.set('risubard/reader-board/boards/board.undo.json', { board: boardAt(1), run: run(2) })
        expect((await loadRunUndo('board'))?.depth).toBe(1)
        await saveRunUndo(boardAt(2), run(3), 5)
        await saveRunUndo(boardAt(3), run(4), 5)
        expect(await trimRunUndo('board', 1)).toBe(1)
        expect((await loadRunUndo('board'))?.run.after).toBe(4)
    })
})
