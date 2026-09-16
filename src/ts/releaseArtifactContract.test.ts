import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('release artifact contract', () => {
    it('declares GPLv3 and redistributes the license and inherited notice', () => {
        const packageJson = JSON.parse(readFileSync(
            resolve('package.json'),
            'utf8',
        )) as { license?: string }
        const workflow = readFileSync(
            resolve('.github/workflows/release.yml'),
            'utf8',
        )

        expect(packageJson.license).toBe('GPL-3.0-only')
        expect(workflow).toMatch(/^\s+LICENSE\s*$/m)
        expect(workflow).toMatch(/^\s+NOTICE\.md\s*$/m)
    })

    it('ships runtime source trees and smoke-tests the portable server', () => {
        const workflow = readFileSync(
            resolve('.github/workflows/release.yml'),
            'utf8',
        )

        expect(workflow).toMatch(/^\s+packages\/risubard-core\/\s*$/m)
        expect(workflow).toMatch(/^\s+src\/ts\/risubard\/\s*$/m)
        expect(workflow).toContain('name: Smoke test portable server')
        expect(workflow).toContain('node server/node/server.cjs')
    })

    it('runs every release verification gate before building artifacts', () => {
        const packageJson = JSON.parse(readFileSync(
            resolve('package.json'),
            'utf8',
        )) as { scripts?: Record<string, string> }
        const workflow = readFileSync(
            resolve('.github/workflows/release.yml'),
            'utf8',
        )

        expect(packageJson.scripts?.['verify:release']).toBe(
            'npm run check && npm test && npm run test:compat && npm run build',
        )
        expect(workflow).toContain('name: Verify release')
        expect(workflow).toContain('run: pnpm verify:release')
        expect(workflow.indexOf('run: pnpm verify:release')).toBeLessThan(
            workflow.indexOf('name: Upload build artifact'),
        )
    })

    it('ships runtime source trees in the Docker image', () => {
        const dockerfile = readFileSync(resolve('Dockerfile'), 'utf8')

        expect(dockerfile).toMatch(
            /^COPY --from=builder \/app\/packages\/risubard-core \.\/packages\/risubard-core$/m,
        )
        expect(dockerfile).toMatch(
            /^COPY --from=builder \/app\/src\/ts\/risubard \.\/src\/ts\/risubard$/m,
        )
        expect(dockerfile).toContain('CMD ["node", "server/node/server.cjs"]')
        expect(dockerfile).not.toContain('CMD ["pnpm", "runserver"]')
    })

    it('publishes only RisuBard artifacts and container images', () => {
        const releaseWorkflow = readFileSync(
            resolve('.github/workflows/release.yml'),
            'utf8',
        )
        const dockerWorkflow = readFileSync(
            resolve('.github/workflows/docker-build.yml'),
            'utf8',
        )

        expect(releaseWorkflow).not.toContain('RisuAI-NodeOnly')
        expect(dockerWorkflow).not.toContain('mrbart3885/risuai-nodeonly')
        expect(dockerWorkflow).not.toContain('GHCR_LEGACY_PAT')
    })
})
