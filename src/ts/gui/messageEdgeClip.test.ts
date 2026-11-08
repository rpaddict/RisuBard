import { describe, expect, it } from 'vitest'
import { edgeClipPath } from './messageEdgeClip'

describe('edgeClipPath', () => {
    it('rounds the top cut at the card edges and keeps room for shadows elsewhere', () => {
        expect(edgeClipPath(400, 1000, 24, 300, null)).toBe(
            'path("M -32 324 L 0 324 A 24 24 0 0 1 24 300 L 376 300 A 24 24 0 0 1 400 324 L 432 324 L 432 1032 L -32 1032 Z")',
        )
    })

    it('rounds both cuts and shrinks the radius when the visible slice is short', () => {
        expect(edgeClipPath(400, 1000, 24, 100, 120)).toBe(
            'path("M -32 110 L 0 110 A 10 10 0 0 1 10 100 L 390 100 A 10 10 0 0 1 400 110 L 432 110 L 432 110 L 400 110 A 10 10 0 0 1 390 120 L 10 120 A 10 10 0 0 1 0 110 L -32 110 Z")',
        )
    })
})
