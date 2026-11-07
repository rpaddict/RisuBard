import { describe, expect, test } from 'vitest'
import {
    collectDatabaseAssetReferences,
    collectNestedAssetReferences,
    canDeleteAssetsAfterPluginStorageScan,
    isAutoAssetCleanupEnabled,
    shouldDeleteUnreferencedAsset,
} from './assetRefs'

describe('asset references', () => {
    test('finds nested asset paths without treating arbitrary strings as assets', () => {
        const refs = collectNestedAssetReferences({
            direct: 'assets/direct.png',
            nested: [{ image: 'assets/nested.webp' }],
            unrelated: 'https://example.invalid/assets/not-local.png',
        })

        expect(refs).toEqual(new Set(['assets/direct.png', 'assets/nested.webp']))
    })

    test('asset cleanup requires an explicit opt-in', () => {
        expect(isAutoAssetCleanupEnabled({})).toBe(false)
        expect(isAutoAssetCleanupEnabled({ nodeOnlyAutoCleanAssets: false })).toBe(false)
        expect(isAutoAssetCleanupEnabled({ nodeOnlyAutoCleanAssets: true })).toBe(true)
    })

    test('deletes only unreferenced asset keys after explicit opt-in', () => {
        const referenced = new Set(['kept.png'])

        expect(shouldDeleteUnreferencedAsset('assets/unused.png', false, referenced)).toBe(false)
        expect(shouldDeleteUnreferencedAsset('assets/kept.png', true, referenced)).toBe(false)
        expect(shouldDeleteUnreferencedAsset('assets/unused.png', true, referenced)).toBe(true)
        expect(shouldDeleteUnreferencedAsset('remotes/unused.local.bin', true, referenced)).toBe(false)
    })

    test('fails closed for asset deletion when plugin-storage inspection fails', () => {
        const referenced = new Set<string>()

        expect(shouldDeleteUnreferencedAsset(
            'assets/unused.png',
            canDeleteAssetsAfterPluginStorageScan(true, false),
            referenced,
        )).toBe(false)
        expect(shouldDeleteUnreferencedAsset(
            'assets/unused.png',
            canDeleteAssetsAfterPluginStorageScan(true, true),
            referenced,
        )).toBe(true)
        expect(canDeleteAssetsAfterPluginStorageScan(false, true)).toBe(false)
    })

    test('finds asset paths embedded in serialized plugin payload strings', () => {
        const refs = collectNestedAssetReferences({
            json: '{"image":"assets/plugin-json.png"}',
            html: '<img src="assets/plugin-html.webp">',
            css: 'background-image: url(assets/plugin-css.jpg)',
            plain: 'keep assets/plugin-plain.gif visible',
            startsWithAssets: 'assets/plugin-start.png and assets/plugin-second.webp',
            customExtension: 'assets/hash.audio+json',
            terminal: 'keep assets/terminal.audio+json',
            remote: 'https://example.invalid/assets/remote.png',
        })

        expect(refs).toEqual(new Set([
            'assets/plugin-json.png',
            'assets/plugin-html.webp',
            'assets/plugin-css.jpg',
            'assets/plugin-plain.gif',
            'assets/plugin-start.png',
            'assets/plugin-second.webp',
            'assets/hash.audio+json',
            'assets/terminal.audio+json',
        ]))
    })

    test('keeps fonts embedded in installed app skins', () => {
        const refs = collectDatabaseAssetReferences({
            appSkins: [
                { id: 'a', fonts: [{ family: 'X', asset: 'assets/skin-font-a.woff2' }, { family: 'Y' }] },
                { id: 'b', fonts: [{ family: 'Z', asset: 'assets/skin-font-b.ttf' }] },
            ],
        })
        expect(refs).toEqual(new Set(['assets/skin-font-a.woff2', 'assets/skin-font-b.ttf']))
    })

    test('finds database references from image settings, audio, personas, and plugin storage', () => {
        const refs = collectDatabaseAssetReferences({
            NAIImgConfig: {
                character_image: 'assets/nai-character.png',
                image: 'assets/nai-image.png',
            },
            wavespeedImage: { reference_image: 'assets/wavespeed-reference.png' },
            characters: [{
                gptSoVitsConfig: {
                    ref_audio_data: { assetId: 'assets/gpt-sovits-reference.wav' },
                },
                personas: [{
                    image: 'assets/scoped-legacy-persona.png',
                    icon: 'assets/scoped-persona-icon.png',
                    embeddedModule: {
                        icon: 'assets/scoped-module-icon.png',
                        assets: [['preview', 'assets/scoped-module-asset.png']],
                    },
                }],
            }],
            personas: [{
                image: 'assets/legacy-persona.png',
                icon: 'assets/persona-icon.png',
                embeddedModule: {
                    icon: 'assets/global-persona-module-icon.png',
                    assets: [['preview', 'assets/global-persona-module-asset.png']],
                },
            }],
            pluginCustomStorage: {
                nested: { references: ['assets/plugin-storage.webp'] },
            },
        })

        const expected = new Set([
            'assets/legacy-persona.png',
            'assets/nai-character.png',
            'assets/nai-image.png',
            'assets/wavespeed-reference.png',
            'assets/gpt-sovits-reference.wav',
            'assets/scoped-legacy-persona.png',
            'assets/scoped-persona-icon.png',
            'assets/scoped-module-icon.png',
            'assets/scoped-module-asset.png',
            'assets/persona-icon.png',
            'assets/global-persona-module-icon.png',
            'assets/global-persona-module-asset.png',
            'assets/plugin-storage.webp',
        ])
        expect(refs).toEqual(expected)
    })
})
