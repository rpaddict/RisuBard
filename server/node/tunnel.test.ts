import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('./server.cjs', import.meta.url), 'utf8')
const startSource = source.slice(source.indexOf('function startTunnelProcess('), source.indexOf("app.post('/api/tunnel/stop'"))

function setup() {
    vi.useFakeTimers()
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn() })
    const spawn = vi.fn(() => child)
    const context = {
        spawn, process: { env: {} }, DEFAULT_PORT: 7777,
        tunnelProcess: null, tunnelStatus: 'off', tunnelUrl: null, tunnelError: null,
        tunnelStartTimeout: null, setTimeout, clearTimeout,
        console: { log: vi.fn() }, logger: { error: vi.fn() },
    }
    runInNewContext(startSource + '\nstartTunnelProcess("cloudflared");', context)
    return { child, context, spawn }
}

afterEach(() => vi.useRealTimers())

describe('Quick Tunnel readiness', () => {
    it('explicitly enables protocol fallback for Quick Tunnels', () => {
        const { spawn } = setup()
        expect(spawn).toHaveBeenCalledWith(
            'cloudflared',
            ['tunnel', '--protocol', 'auto', '--url', 'http://localhost:7777'],
            { stdio: ['ignore', 'pipe', 'pipe'] },
        )
    })

    it('waits for a registered connection before publishing the URL', () => {
        const { child, context } = setup()
        child.stderr.emit('data', Buffer.from('https://test-link.trycloudflare.com\n'))
        expect(context.tunnelStatus).toBe('starting')
        expect(context.tunnelUrl).toBeNull()
        child.stderr.emit('data', Buffer.from('INF Registered tunnel connection connIndex=0\n'))
        expect(context.tunnelStatus).toBe('running')
        expect(context.tunnelUrl).toBe('https://test-link.trycloudflare.com')
    })

    it('handles log lines split across chunks', () => {
        const { child, context } = setup()
        for (const text of ['https://test-link.trycloud', 'flare.com\nINF Registered tunnel con', 'nection connIndex=0\n']) {
            child.stderr.emit('data', Buffer.from(text))
        }
        expect(context.tunnelStatus).toBe('running')
        expect(context.tunnelUrl).toBe('https://test-link.trycloudflare.com')
    })

    it('times out when a URL is allocated but no connection is established', () => {
        const { child, context } = setup()
        child.stderr.emit('data', Buffer.from('https://test-link.trycloudflare.com\n'))
        vi.advanceTimersByTime(30_000)
        expect(context.tunnelStatus).toBe('error')
        expect(context.tunnelUrl).toBeNull()
        expect(child.kill).toHaveBeenCalled()
    })

    it('removes the URL when the connected process exits', () => {
        const { child, context } = setup()
        child.stderr.emit('data', Buffer.from('https://test-link.trycloudflare.com\nINF Registered tunnel connection connIndex=0\n'))
        child.emit('exit', 1)
        expect(context.tunnelStatus).toBe('error')
        expect(context.tunnelUrl).toBeNull()
    })
})
