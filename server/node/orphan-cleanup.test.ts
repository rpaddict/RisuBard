import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const modulePath = path.join(process.cwd(), 'server/node/orphan-cleanup.cjs')
const cleanup = fs.existsSync(modulePath) ? require(modulePath) : {}

describe('orphan cleanup planning', () => {
    it('preserves every supported database and plugin asset reference', () => {
        expect(typeof cleanup.collectDatabaseAssetReferences).toBe('function')
        expect(typeof cleanup.collectNestedAssetReferences).toBe('function')
        expect(typeof cleanup.findUnreferencedAssets).toBe('function')
        if (typeof cleanup.collectDatabaseAssetReferences !== 'function') return

        const referenced = cleanup.collectDatabaseAssetReferences({
            customBackground: 'assets/background.png',
            userIcon: 'assets/user.png',
            messageSound: 'assets/message.wav',
            translateSound: 'assets/translate.wav',
            customSounds: [{ path: 'assets/custom.wav' }],
            uiSoundClickSound: 'assets/ui-click.mp3',
            uiSoundHoverSound: 'assets/ui-hover.mp3',
            customUiSounds: [{ path: 'assets/ui-upload.mp3' }],
            NAIImgConfig: {
                character_image: 'assets/nai-character.png',
                image: 'assets/nai-image.png',
            },
            wavespeedImage: { reference_image: 'assets/wavespeed.png' },
            characters: [{
                image: 'assets/character.png',
                emotionImages: [['happy', 'assets/emotion.png']],
                additionalAssets: [['prop', 'assets/additional.png']],
                vits: { files: { voice: 'assets/voice.wav' } },
                ccAssets: [{ uri: 'assets/cc.png' }],
                gptSoVitsConfig: { ref_audio_data: { assetId: 'assets/reference.wav' } },
                personas: [{
                    image: 'assets/scoped-persona-image.png',
                    icon: 'assets/scoped-persona-icon.png',
                    embeddedModule: {
                        icon: 'assets/scoped-module-icon.png',
                        assets: [['pack', 'assets/scoped-module-asset.png']],
                    },
                }],
            }],
            modules: [{
                icon: 'assets/module-icon.png',
                assets: [['pack', 'assets/module-asset.png']],
            }],
            personas: [{
                image: 'assets/persona-image.png',
                icon: 'assets/persona-icon.png',
                embeddedModule: {
                    icon: 'assets/persona-module-icon.png',
                    assets: [['pack', 'assets/persona-module-asset.png']],
                },
            }],
            characterOrder: [{ imgFile: 'assets/order.png' }],
            pluginCustomStorage: { markup: '<img src="assets/db-plugin.webp">' },
        })
        cleanup.collectNestedAssetReferences({
            nested: ['background:url(assets/persistent-plugin.webp)'],
        }, referenced)
        cleanup.collectNestedAssetReferences(new Map([
            ['chat', { content: 'assets/chat-message.webp' }],
        ]), referenced)

        expect(referenced).toEqual(new Set([
            'background.png', 'user.png', 'message.wav', 'translate.wav', 'custom.wav',
            'ui-click.mp3', 'ui-hover.mp3', 'ui-upload.mp3',
            'nai-character.png', 'nai-image.png', 'wavespeed.png', 'character.png',
            'emotion.png', 'additional.png', 'voice.wav', 'cc.png', 'reference.wav',
            'scoped-persona-image.png', 'scoped-persona-icon.png', 'scoped-module-icon.png',
            'scoped-module-asset.png', 'module-icon.png', 'module-asset.png',
            'persona-image.png', 'persona-icon.png', 'persona-module-icon.png',
            'persona-module-asset.png', 'order.png', 'db-plugin.webp',
            'persistent-plugin.webp', 'chat-message.webp',
        ]))
        expect(cleanup.findUnreferencedAssets([
            { key: 'assets/character.png', size: 10 },
            { key: 'assets/orphan.png', size: 20 },
            { key: 'cache/not-an-asset', size: 30 },
        ], referenced)).toEqual([{ key: 'assets/orphan.png', size: 20 }])
    })

    it('marks only Hypa vectors absent from current summary text', () => {
        expect(typeof cleanup.collectHypaSummaryTexts).toBe('function')
        expect(typeof cleanup.findUnusedHypaVectors).toBe('function')
        if (typeof cleanup.collectHypaSummaryTexts !== 'function') return

        const chats = new Map([
            ['char', new Map([
                ['chat', { hypaV3Data: { summaries: [{ text: 'alpha beta' }, { text: 'gamma' }] } }],
            ])],
        ])
        const summaries = cleanup.collectHypaSummaryTexts(chats)
        const unused = cleanup.findUnusedHypaVectors([
            { key: 'cache/hypa-vector/alpha', size: 10, payload: { value: { content: 'alpha' } } },
            { key: 'cache/hypa-vector/gamma', size: 20, payload: { value: { content: 'gamma' } } },
            { key: 'cache/hypa-vector/orphan', size: 30, payload: { value: { content: 'delta' } } },
            { key: 'cache/hypa-vector/invalid', size: 40, payload: {} },
        ], summaries)

        expect(summaries).toEqual(['alpha beta', 'gamma'])
        expect(unused).toEqual([
            { key: 'cache/hypa-vector/orphan', size: 30, payload: { value: { content: 'delta' } } },
            { key: 'cache/hypa-vector/invalid', size: 40, payload: {} },
        ])
    })

    it('wires an authenticated, serialized cleanup route', () => {
        const server = fs.readFileSync(path.join(process.cwd(), 'server/node/server.cjs'), 'utf8')
        const start = server.indexOf("app.post('/api/db/orphans/cleanup'")

        expect(start).toBeGreaterThan(-1)
        if (start < 0) return
        const route = server.slice(start, server.indexOf('\n});', start) + 4)
        expect(route).toContain('checkAuth')
        expect(route).toContain('checkActiveSession')
        expect(route).toContain('queueStorageOperation')
        expect(route).toContain('collectNestedAssetReferences(database')
        expect(route).toContain('collectNestedAssetReferences(fullChatStore')
        expect(route).toContain('collectNestedAssetReferences')
        expect(route).toContain('kvDelMany')
        expect(route).toContain('gcChunks()')
    })
})
