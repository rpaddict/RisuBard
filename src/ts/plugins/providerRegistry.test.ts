import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { upsertProviderModel, withProviderName } from './providerRegistry'

describe('plugin provider re-registration', () => {
    it('does not repeat a provider name registered again', () => {
        let names: string[] = []
        for (const round of [1, 2, 3]) {
            for (const name of ['[PM] a (Vertex AI)', '[PM] a (Vertex AI 2)']) {
                names = withProviderName(names, name)
            }
            expect(names, `round ${round}`).toEqual(['[PM] a (Vertex AI)', '[PM] a (Vertex AI 2)'])
        }
    })

    it('replaces the model entry in place, keeping order and the newest metadata', () => {
        const models: { id: string, name: string }[] = []
        upsertProviderModel(models, { id: 'pluginmodel:::a', name: 'old a' })
        upsertProviderModel(models, { id: 'pluginmodel:::b', name: 'b' })
        upsertProviderModel(models, { id: 'pluginmodel:::a', name: 'new a' })
        expect(models).toEqual([
            { id: 'pluginmodel:::a', name: 'new a' },
            { id: 'pluginmodel:::b', name: 'b' },
        ])
    })

    it('is used by both addProvider implementations', () => {
        const v2 = readFileSync(resolve(process.cwd(), 'src/ts/plugins/plugins.svelte.ts'), 'utf8')
        const v3 = readFileSync(resolve(process.cwd(), 'src/ts/plugins/apiV3/v3.svelte.ts'), 'utf8')
        expect(v2).toContain('withProviderName(get(customProviderStore), name)')
        expect(v3).toContain('withProviderName(get(customProviderStore), name)')
        expect(v3).toContain('upsertProviderModel(customV3ProviderMetaStore, modelData)')
        expect(v3).not.toContain('customV3ProviderMetaStore.push(')
    })
})
