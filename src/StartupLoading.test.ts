import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { languageEnglish } from './lang/en'
import { languageKorean } from './lang/ko'

const app = readFileSync(resolve(process.cwd(), 'src/App.svelte'), 'utf8')
const bootstrap = readFileSync(resolve(process.cwd(), 'src/ts/bootstrap.ts'), 'utf8')
const main = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8')
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')

describe('localized startup screen', () => {
    test('applies the saved language before mounting and localizes every bootstrap status', () => {
        expect(main.indexOf('applyEarlyLanguage()')).toBeLessThan(main.indexOf('mount(App'))
        expect(bootstrap).not.toMatch(/LoadingStatusState\.text\s*=\s*[`\"](?:Loading|Decoding|Reading|Checking|Updating)/)
        expect(languageEnglish.startupLoading.localSave).toBe('Loading local save file...')
        expect(languageKorean.startupLoading?.localSave).toBe('로컬 저장 파일을 불러오는 중...')
    })

    test('shows the startup logo in both loading phases and localizes the preloader for Korean', () => {
        expect(app).toContain('src="/assets/risubard-startup.webp"')
        expect(html).toContain('src="/assets/risubard-startup.webp"')
        expect(html).toContain("localStorage.getItem('risu-lang') === 'ko'")
        expect(existsSync(resolve(process.cwd(), 'public/assets/risubard-startup.webp'))).toBe(true)
    })

    test('preloads the startup logo before render-blocking styles', () => {
        const preload = '<link rel="preload" as="image" href="/assets/risubard-startup.webp" fetchpriority="high" />'
        expect(html).toContain(preload)
        expect(html.indexOf(preload)).toBeLessThan(html.indexOf('rel="stylesheet"'))
        expect(html).toContain('src="/assets/risubard-startup.webp" fetchpriority="high"')
        expect(app).toContain('src="/assets/risubard-startup.webp" fetchpriority="high"')
    })

    test('shows the package version directly below both startup logos', () => {
        expect(viteConfig).toContain("html.replaceAll('__RISUBARD_APP_VERSION__', pkg.version)")
        expect(html).toMatch(/risubard-startup\.webp[^>]*>\s*<span[^>]*data-startup-version[^>]*>v__RISUBARD_APP_VERSION__<\/span>/)
        expect(app).toMatch(/import\s*\{[^}]*nodeOnlyVer[^}]*\}\s*from '\.\/ts\/storage\/database\.svelte'/)
        expect(app).toMatch(/risubard-startup\.webp[^>]*\/>\s*<span[^>]*data-startup-version[^>]*>v\{nodeOnlyVer\}<\/span>/)
    })
})
