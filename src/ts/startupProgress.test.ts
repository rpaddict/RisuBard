import { describe, expect, it, vi } from 'vitest'
import { advanceStartupStage, failStartupStage } from './startupProgress'
import { ChecksumMismatchError, readChecksumMismatch } from './storage/checksumMismatch'

describe('startup progress', () => {
    it('publishes the next stage before yielding to let the screen update', async () => {
        vi.useFakeTimers()
        try {
            const state = { text: 'Previous step', error: '' }
            let started = false
            const work = advanceStartupStage(state, 'Reading save').then(() => { started = true })
            expect(state.text).toBe('Reading save')
            expect(started).toBe(false)
            await vi.runAllTimersAsync()
            await work
            expect(started).toBe(true)
        } finally { vi.useRealTimers() }
    })

    it('retains the failed stage and displays the error without swallowing it', () => {
        const state = { text: 'Reading save', error: '' }
        failStartupStage(state, new Error('Connection closed'))
        expect(state).toEqual({ text: 'Reading save', error: 'Connection closed' })
    })

    it('keeps checksum details for the startup screen and clears them on the next stage', async () => {
        const mismatch = { file: 'C:/data/modules/a.json', path: 'modules/a.json', expected: 'a'.repeat(64), actual: 'b'.repeat(64) }
        const state = { text: 'Reading save', error: '', checksumMismatch: null as typeof mismatch | null }
        failStartupStage(state, new ChecksumMismatchError('getItem Error: Canonical file checksum mismatch', mismatch))
        expect(state.checksumMismatch).toEqual(mismatch)
        failStartupStage(state, new Error('other'))
        expect(state.checksumMismatch).toBeNull()
        state.checksumMismatch = mismatch
        vi.useFakeTimers()
        try {
            const work = advanceStartupStage(state, 'Next')
            await vi.runAllTimersAsync()
            await work
        } finally { vi.useRealTimers() }
        expect(state.checksumMismatch).toBeNull()
    })

    it('reads only well-formed checksum details from a server response', () => {
        expect(readChecksumMismatch({ checksumMismatch: { file: 'x', path: '', expected: '', actual: 'c'.repeat(64) } }))
            .toEqual({ file: 'x', path: null, expected: null, actual: 'c'.repeat(64) })
        expect(readChecksumMismatch({ checksumMismatch: { file: 'x', actual: 'nope' } })).toBeNull()
        expect(readChecksumMismatch({ error: 'plain' })).toBeNull()
    })
})
