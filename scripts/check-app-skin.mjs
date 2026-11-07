#!/usr/bin/env node
// Validates app skin files with the same checks the app runs on install.
// Usage: pnpm check:skin <file.risuskin> [more files...]
// Prints errors and warnings per file, plus the compiled CSS size. Exit 1 on any invalid file.
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = process.argv.slice(2)
if (files.length === 0) {
    console.error('Usage: pnpm check:skin <file.risuskin> [...]')
    process.exit(2)
}

const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
})
let failed = false
try {
    const { validateAppSkin, compileAppSkinCss } = await server.ssrLoadModule('/src/ts/gui/appSkin.ts')
    for (const file of files) {
        let parsed
        try {
            parsed = JSON.parse(await readFile(resolve(file), 'utf8'))
        } catch (error) {
            failed = true
            console.log(`✗ ${file}\n  JSON을 읽을 수 없습니다: ${error.message}`)
            continue
        }
        const result = validateAppSkin(parsed)
        if (!result.ok) {
            failed = true
            console.log(`✗ ${file}`)
            for (const message of result.errors) console.log(`  오류: ${message}`)
        } else {
            const css = compileAppSkinCss(result.skin)
            console.log(`✓ ${file} (${result.skin.id}, CSS ${Buffer.byteLength(css)}바이트)`)
        }
        for (const message of result.warnings) console.log(`  경고: ${message}`)
    }
} finally {
    await server.close()
}
process.exit(failed ? 1 : 0)
