import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const serverSource = fileURLToPath(new URL('./server.cjs', import.meta.url))
const updaterSource = fileURLToPath(
    new URL('../../scripts/updater.cjs', import.meta.url)
)
const sourceUpdaterSource = fileURLToPath(
    new URL('../../update.sh', import.meta.url)
)
const mainMenuSource = fileURLToPath(
    new URL('../../src/lib/UI/MainMenu.svelte', import.meta.url)
)
const bootstrapSource = fileURLToPath(
    new URL('../../src/ts/bootstrap.ts', import.meta.url)
)
const publicStatsSource = fileURLToPath(
    new URL('../../src/ts/publicStats.ts', import.meta.url)
)
const updaterDocsSource = fileURLToPath(
    new URL('../../docs/architecture/automatic-updater.md', import.meta.url)
)
const releaseWorkflowSource = fileURLToPath(
    new URL('../../.github/workflows/release.yml', import.meta.url)
)
const windowsUpdaterSource = fileURLToPath(
    new URL('../../scripts/portable/update.bat', import.meta.url)
)
const updaterRecoverySource = fileURLToPath(
    new URL('../../scripts/updater-recovery.cjs', import.meta.url)
)
const require = createRequire(import.meta.url)
const languageSources = ['en.ts', 'ko.ts', 'zh-Hant.ts'].map(name =>
    fileURLToPath(new URL(`../../src/lang/${name}`, import.meta.url))
)

describe('RisuBard release updater target', () => {
    test('checks and downloads releases from rpaddict/RisuBard', () => {
        const server = readFileSync(serverSource, 'utf8')
        const updater = readFileSync(updaterSource, 'utf8')
        const sourceUpdater = readFileSync(sourceUpdaterSource, 'utf8')

        expect(server).toContain("const GITHUB_REPO = 'rpaddict/RisuBard';")
        expect(server).toContain(
            'https://api.github.com/repos/${GITHUB_REPO}/releases/latest'
        )
        expect(updater).toContain("const REPO = 'rpaddict/RisuBard';")
        expect(sourceUpdater).toContain('REPO="rpaddict/RisuBard"')
    })

    test('does not expose inherited upstream public statistics', () => {
        const server = readFileSync(serverSource, 'utf8')
        const mainMenu = readFileSync(mainMenuSource, 'utf8')
        const bootstrap = readFileSync(bootstrapSource, 'utf8')
        const updaterDocs = readFileSync(updaterDocsSource, 'utf8')
        const languages = languageSources.map(source => readFileSync(source, 'utf8'))
        const offenders = [
            existsSync(publicStatsSource) && 'src/ts/publicStats.ts',
            server.includes('PUBLIC_STATS_URL') && 'server PUBLIC_STATS_URL',
            server.includes("app.get('/api/public-stats'") && 'server /api/public-stats',
            mainMenu.includes('publicStatsStore') && 'MainMenu publicStatsStore',
            bootstrap.includes('fetchPublicStats') && 'bootstrap fetchPublicStats',
            updaterDocs.includes('RISU_PUBLIC_STATS_URL') && 'updater docs public stats',
            updaterDocs.includes('공개 통계') && 'updater docs public stats wording',
            ...languages.flatMap((source, index) =>
                ['statsUsersToday', 'statsYesterday', 'statsVisitsToday']
                    .filter(key => source.includes(key))
                    .map(key => `${languageSources[index]}: ${key}`)
            ),
        ].filter(Boolean)

        expect(offenders).toEqual([])
    })

    test('keeps Windows portable updates recoverable and runtime binaries deterministic', () => {
        const updater = readFileSync(updaterSource, 'utf8')
        const workflow = readFileSync(releaseWorkflowSource, 'utf8')

        expect(existsSync(windowsUpdaterSource)).toBe(true)
        const windowsUpdater = readFileSync(windowsUpdaterSource, 'utf8')

        expect(updater).toContain('    assertNoOtherWindowsRuntimeProcesses();')
        expect(updater).toContain("process.argv.includes('--rollback')")
        expect(windowsUpdater).toContain('scripts\\updater.cjs\" --rollback')
        expect(windowsUpdater).not.toContain('xcopy /E /I /Y \"%~dp0.update-tmp\\new-bin\\*\" \"%~dp0bin\\\" >nul')
        expect(workflow).toContain('CLOUDFLARED_VERSION=\"2026.9.0\"')
        expect(workflow).toContain('cp scripts/portable/update.bat portable/update.bat')
        expect(workflow).toContain('cp scripts/updater-recovery.cjs portable/scripts/updater-recovery.cjs')
        expect(workflow).not.toContain('cloudflared/releases/latest/download')
    })

    test('validates a requested version before creating its release tag', () => {
        const workflow = readFileSync(releaseWorkflowSource, 'utf8').replace(/\r\n/g, '\n')

        expect(workflow).toContain('workflow_dispatch:\n    inputs:\n      version:')
        expect(workflow).not.toContain("push:\n    tags:\n      - 'v*'")
        expect(workflow).toContain('if [ "$GITHUB_REF" != "refs/heads/main" ]')
        expect(workflow).toContain('PACKAGE_VERSION="$(node -p')
        expect(workflow).toContain('patchnote/${PACKAGE_VERSION}.md')
        expect(workflow).toContain('run: pnpm verify:release')
        expect(workflow).toContain('git tag -a "v${VERSION}" "$GITHUB_SHA"')
        expect(workflow).toContain('git push origin "v${VERSION}"')
        expect(workflow).toContain('target_commitish: ${{ github.sha }}')
        expect(workflow).toContain('body_path: patchnote/${{ needs.build.outputs.version }}.md')
        expect(workflow).toContain('tag_name: v${{ needs.build.outputs.version }}')
    })

    test('restores interrupted app files without replacing the running update launcher', () => {
        expect(existsSync(updaterRecoverySource)).toBe(true)
        const { rollbackInterruptedUpdate } = require(updaterRecoverySource)
        const root = mkdtempSync(join(tmpdir(), 'risubard-updater-recovery-'))

        try {
            const backup = join(root, '.update-tmp', 'backup')
            mkdirSync(backup, { recursive: true })
            writeFileSync(join(root, 'package.json'), 'new app')
            writeFileSync(join(root, 'update.bat'), 'new recovery launcher')
            writeFileSync(join(backup, 'package.json'), 'old app')
            writeFileSync(join(backup, 'update.bat'), 'old launcher')

            rollbackInterruptedUpdate(root)

            expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe('old app')
            expect(readFileSync(join(root, 'update.bat'), 'utf8')).toBe('new recovery launcher')
            expect(existsSync(join(root, '.update-tmp'))).toBe(false)
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })
})
