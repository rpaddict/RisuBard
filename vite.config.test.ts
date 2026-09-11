import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import viteConfig from './vite.config'

function serveConfig() {
    if (typeof viteConfig !== 'function') throw new Error('Expected a Vite config factory')
    return viteConfig({
        command: 'serve',
        mode: 'development',
        isSsrBuild: false,
        isPreview: false,
    })
}

describe('development workflow', () => {
    test('offers a Node watch command for automatic backend restarts', () => {
        const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

        expect(pkg.scripts['dev:server']).toBe(
            'node --watch-path=server/node --watch-preserve-output server/node/server.cjs',
        )
    })

    test('proxies backend HTTP and WebSocket routes from the Vite server', () => {
        const proxy = serveConfig().server?.proxy as Record<string, { target?: string; ws?: boolean }>

        expect(proxy['/api']?.target).toBe('http://localhost:7777')
        expect(proxy['/proxy']?.target).toBe('http://localhost:7777')
        expect(proxy['/hub-proxy']?.target).toBe('http://localhost:7777')
        expect(proxy['/proxy-stream-jobs']).toMatchObject({
            target: 'http://localhost:7777',
            ws: true,
        })
    })

    test('uses port 7777 across supported server launch paths', () => {
        const server = readFileSync('server/node/server.cjs', 'utf8')
        const installScript = readFileSync('install.sh', 'utf8')
        const portableLauncher = readFileSync('scripts/portable/launcher.c', 'utf8')
        const termuxBuild = readFileSync('scripts/termux/build.sh', 'utf8')
        const dockerfile = readFileSync('Dockerfile', 'utf8')
        const compose = readFileSync('docker-compose.yml', 'utf8')

        expect(server).not.toContain('process.env.PORT || 6001')
        expect(server).toContain('const DEFAULT_PORT = 7777')
        expect(server).toContain('process.env.PORT || DEFAULT_PORT')
        expect(installScript).toContain('PORT="${PORT:-7777}"')
        expect(portableLauncher).toContain('wcscpy(port, L"7777")')
        expect(termuxBuild).toContain('http://localhost:7777')
        expect(dockerfile).toContain('EXPOSE 7777')
        expect(compose).toContain('- 7777:7777')
    })

    test('marks the HMR page as connected to the Node backend', async () => {
        const plugins = serveConfig().plugins?.flat().filter(Boolean) ?? []
        const plugin = plugins.find(candidate => candidate && typeof candidate === 'object'
            && 'name' in candidate && candidate.name === 'risubard-node-dev-globals')
        if (!plugin || !('transformIndexHtml' in plugin) || typeof plugin.transformIndexHtml !== 'function') {
            throw new Error('Missing development globals plugin')
        }

        const html = await plugin.transformIndexHtml('<html><head></head><body></body></html>')
        expect(String(html)).toContain('globalThis.__NODE__ = true')
        expect(String(html)).toContain('globalThis.__PATCH_SYNC__ = true')
    })
})
