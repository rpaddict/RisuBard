import { describe, expect, it } from 'vitest'
import { selectAnalysisLoreReference } from './analysisLoreReference'
import { pluginLoreSource } from './pluginLoreSource'

describe('plugin lore raw identity', () => {
    it('hashes the original bytes and keeps identity attached through the original priority selection', async () => {
        const source = await pluginLoreSource('character:mina', { id: 'cup', content: 'abc' })
        expect(source).toEqual({
            scopeId: 'character:mina', entryId: 'cup',
            contentHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        })
        expect(selectAnalysisLoreReference([{
            title: 'Cup', source: 'abc', rendered: 'rendered text', priority: 1, tokens: 1,
            alwaysActive: false, sourceIdentity: source,
        }], { tokenLimit: 1000, includeAlwaysActive: false, excludeWords: '' })).toEqual([
            { title: 'Cup', content: 'rendered text', source },
        ])
    })
})
