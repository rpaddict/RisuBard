import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { languageEnglish } from './lang/en'
import { languageKorean } from './lang/ko'

const source = readFileSync(resolve(process.cwd(), 'src/App.svelte'), 'utf8')
const moduleSource = readFileSync(resolve(
    process.cwd(), 'src/ts/process/modules.ts'
), 'utf8')
const readModuleSource = moduleSource.slice(
    moduleSource.indexOf('export async function readModule'),
    moduleSource.indexOf('export async function importModule')
)

describe('global file drop imports', () => {
    test('routes modules, prompt presets, and JavaScript plugins to their native importers', () => {
        expect(source).toContain("name.endsWith('.risum')")
        expect(source).toContain("name.endsWith('.risup')")
        expect(source).toContain("name.endsWith('.js')")
        expect(source).toContain('await readModule(')
        expect(source).toContain('await importPreset(')
        expect(source).toContain("await import('./ts/plugins/plugins.svelte')")
        expect(source).toContain('await importPlugin(')
    })

    test('shows localized loading, completion, and failure feedback', () => {
        expect(source).toContain('language.fileDropImport.moduleLoading')
        expect(source).toContain('language.fileDropImport.presetLoading')
        expect(source).toContain('language.fileDropImport.pluginLoading')
        expect(source).toContain('language.fileDropImport.moduleSuccess')
        expect(source).toContain('language.fileDropImport.presetSuccess')
        expect(source).toContain('language.fileDropImport.pluginSuccess')
        expect(source).toContain('language.fileDropImport.failed')
        expect(readModuleSource).toContain('language.fileDropImport.moduleAssets')
        expect(readModuleSource).not.toContain('Loading... (Adding Assets')
        expect(languageEnglish.fileDropImport.pluginSuccess).toContain('plugin list')
        expect(languageKorean.fileDropImport?.pluginSuccess).toContain('플러그인 목록')
    })
})
