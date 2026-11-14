import { describe, expect, test } from 'vitest'
import { applyCanonicalSectionPatches } from './risubard-markdown-section-patch'
import { annotateCanonicalUnits, resolveCanonicalUnitPatches, stampUnit, stripUnitMarkers } from './risubard-canonical-unit-edit'
import type { CanonicalSectionPatch } from './risubard-memory-writer'

const doc = [
    '## Alice',
    '',
    '### Current State',
    '',
    '- At home.',
    '',
    '### Knowledge',
    '',
    '- Knows the gate code.',
    '- Knows the cellar key is under the stone.',
    '- Distrusts [[Bob]] after the market.',
].join('\n')

const edit = (edits: Partial<NonNullable<CanonicalSectionPatch['edits']>>, heading = 'Knowledge'): CanonicalSectionPatch => ({
    heading, operation: 'edit', content: '', edits: { add: [], replace: [], remove: [], ...edits },
})

function apply(patches: CanonicalSectionPatch[], allowSupersede = false, rewrite = false) {
    const resolution = resolveCanonicalUnitPatches({ markdown: doc, title: 'Alice', patches, allowSupersede, rewrite })
    return { ...resolution, markdown: applyCanonicalSectionPatches({ markdown: doc, title: 'Alice', patches: resolution.patches }) }
}

describe('canonical unit edits', () => {
    test('numbers units for the model and strips numbers the model copies back', () => {
        const annotated = annotateCanonicalUnits(doc)
        expect(annotated).toContain('- [0] Knows the gate code.')
        expect(annotated).toContain('- [2] Distrusts [[Bob]] after the market.')
        expect(annotated).toContain('- [0] At home.')
        expect(stripUnitMarkers(annotated)).toBe(doc)
    })

    test('changes only the units an edit names', () => {
        const result = apply([edit({
            add: ['- [9] Knows the bell rings at noon.'],
            replace: [{ index: 0, text: '[0] Knows the new gate code.' }],
        })])
        expect(result.markdown).toContain('- Knows the new gate code.\n- Knows the cellar key is under the stone.\n- Distrusts [[Bob]] after the market.\n- Knows the bell rings at noon.')
        expect(result).toMatchObject({ restored: 0, rejected: 0, removed: 0 })
    })

    test('removes a unit only with a valid reason', () => {
        const merged = apply([edit({
            replace: [{ index: 0, text: 'Knows the gate code and that the cellar key is under the stone.' }],
            remove: [{ index: 1, reason: 'merged', mergedInto: 0 }],
        })])
        expect(merged.markdown).not.toContain('- Knows the cellar key is under the stone.')
        expect(merged.removed).toBe(1)

        const unsupported = apply([edit({ remove: [{ index: 1, reason: 'superseded', mergedInto: null }] })])
        expect(unsupported.markdown).toBe(doc)
        expect(unsupported.rejected).toBe(1)

        const superseded = apply([edit({ remove: [{ index: 1, reason: 'superseded', mergedInto: null }] })], true)
        expect(superseded.markdown).not.toContain('cellar key')

        const outOfRange = apply([edit({ remove: [{ index: 9, reason: 'corrected', mergedInto: null }] })])
        expect(outOfRange).toMatchObject({ rejected: 1, removed: 0 })
        expect(outOfRange.markdown).toBe(doc)
    })

    test('drops a unit as covered only when an over-budget card\'s cover events hold its words', () => {
        const covered = edit({ remove: [{ index: 1, reason: 'covered', mergedInto: null }] })
        const resolve = (coverContent?: string) => {
            const resolution = resolveCanonicalUnitPatches({
                markdown: doc, title: 'Alice', patches: [covered], allowSupersede: false,
                ...(coverContent === undefined ? {} : { coverContent }),
            })
            return { ...resolution, markdown: applyCanonicalSectionPatches({ markdown: doc, title: 'Alice', patches: resolution.patches }) }
        }
        // Not over budget: no cover events were offered.
        expect(resolve()).toMatchObject({ rejected: 1, removed: 0 })
        // The event says something else.
        expect(resolve('Alice bought bread at the market.').markdown).toContain('cellar key')
        const supported = resolve('Bob told Alice the cellar key is under the stone by the well.')
        expect(supported.markdown).not.toContain('cellar key')
        expect(supported.removed).toBe(1)
    })

    test('lets a unit go when another section still names its person, or when its link is only an event', () => {
        const card = [
            '## Alice', '',
            '### Relationships', '', '- Trusts [[Bob]].', '',
            '### Knowledge', '', '- Learned the code from [[Bob]].', '- Saw the fire at [[The Night Market]].',
        ].join('\n')
        const removeBoth = edit({ remove: [
            { index: 0, reason: 'corrected', mergedInto: null },
            { index: 1, reason: 'corrected', mergedInto: null },
        ] })
        const resolve = (eventTitles?: string[]) => resolveCanonicalUnitPatches({
            markdown: card, title: 'Alice', patches: [removeBoth], allowSupersede: false,
            ...(eventTitles ? { eventTitles } : {}),
        })
        // Bob stays in Relationships, so his link survives; the market is an event.
        expect(resolve(['The Night Market'])).toMatchObject({ removed: 2, restored: 0 })
        // Without knowing it is an event, the market line keeps the only link to it.
        expect(resolve()).toMatchObject({ removed: 1, restored: 1 })
    })

    test('never drops an open-thread unit as covered, and strips the tag the model copies back', () => {
        const isOpen = (unit: string) => unit.includes('cellar key')
        expect(annotateCanonicalUnits(doc, isOpen)).toContain('- [1] [open] Knows the cellar key is under the stone.')
        const resolution = resolveCanonicalUnitPatches({
            markdown: doc, title: 'Alice', allowSupersede: false, isOpen,
            coverContent: 'Bob told Alice the cellar key is under the stone by the well.',
            patches: [edit({
                replace: [{ index: 0, text: '[0] [open] Knows the new gate code.' }],
                remove: [{ index: 1, reason: 'covered', mergedInto: null }],
            })],
        })
        const markdown = applyCanonicalSectionPatches({ markdown: doc, title: 'Alice', patches: resolution.patches })
        expect(markdown).toContain('cellar key')
        expect(markdown).toContain('- Knows the new gate code.')
        expect(markdown).not.toContain('[open]')
        expect(resolution).toMatchObject({ rejected: 1, removed: 0 })
    })

    test('extends a merged range instead of adding a second mark', () => {
        expect(stampUnit('Quit the night job. (#17–#19)', 19)).toBe('Quit the night job. (#17–#19)')
        expect(stampUnit('Quit the night job. (#17–#19)', 30)).toBe('Quit the night job. (#17–#30)')
        expect(stampUnit('Quit the night job. (#17–#19) (#19)', 19)).toBe('Quit the night job. (#17–#19)')
        expect(stampUnit('Knows the code. (#4)', 9)).toBe('Knows the code. (#9)')
        expect(stampUnit('Knows the code.', 9)).toBe('Knows the code. (#9)')
    })

    test('keeps a removed unit whose link would disappear', () => {
        const result = apply([edit({ remove: [{ index: 2, reason: 'corrected', mergedInto: null }] })])
        expect(result.markdown).toContain('Distrusts [[Bob]]')
        expect(result).toMatchObject({ restored: 1, removed: 0 })
    })

    test('restores units a whole-section rewrite silently dropped', () => {
        const result = apply([{ heading: 'Knowledge', operation: 'upsert', content: '- Knows the gate code.\n- Knows the bell.' }])
        expect(result.markdown).toContain('- Knows the gate code.\n- Knows the bell.\n- Knows the cellar key is under the stone.\n- Distrusts [[Bob]] after the market.')
        expect(result.restored).toBe(2)
    })

    test('does not take a similar line for a dropped one', () => {
        const clues = '## Alice\n\n### Knowledge\n\n- 북문에서 단서 6를 확인했다. (#6)\n- 북문에서 단서 12를 확인했다. (#12)'
        const resolution = resolveCanonicalUnitPatches({ markdown: clues, title: 'Alice', allowSupersede: false,
            patches: [{ heading: 'Knowledge', operation: 'upsert', content: '- 북문에서 단서 12를 확인했다.\n- 북문에서 단서 18를 확인했다.' }] })
        expect(resolution.restored).toBe(1)
        expect(applyCanonicalSectionPatches({ markdown: clues, title: 'Alice', patches: resolution.patches }))
            .toContain('단서 6를 확인했다')
    })

    test('keeps a deleted section unless its facts moved elsewhere', () => {
        const blocked = apply([{ heading: 'Knowledge', operation: 'delete', content: '' }])
        expect(blocked.markdown).toBe(doc)
        expect(blocked.restored).toBe(3)

        const moved = apply([
            { heading: 'Knowledge', operation: 'delete', content: '' },
            { heading: 'Knowledge and Secrets', operation: 'upsert', content: '- Knows the gate code.\n- Knows the cellar key is under the stone.\n- Distrusts [[Bob]] after the market.' },
        ])
        expect(moved.markdown).not.toContain('### Knowledge\n')
        expect(moved.restored).toBe(0)
    })

    test('replaces the current-state snapshot and rewrite targets as written', () => {
        const state = apply([{ heading: 'Current State', operation: 'upsert', content: '- At the gate.' }])
        expect(state.markdown).toContain('### Current State\n\n- At the gate.')
        expect(state.markdown).not.toContain('At home')

        const rewrite = apply([{ heading: 'Knowledge', operation: 'upsert', content: '- Knows the gate code.' }], false, true)
        expect(rewrite.markdown).not.toContain('cellar key')
        expect(rewrite.restored).toBe(0)
    })

    test('turns an edit of a missing section into a new section', () => {
        const result = apply([edit({ add: ['Owns a lantern.'] }, 'Equipment')])
        expect(result.markdown).toContain('### Equipment\n\n- Owns a lantern.')
    })
})
