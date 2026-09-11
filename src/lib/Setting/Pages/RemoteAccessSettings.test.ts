import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import RemoteAccessSettings from './RemoteAccessSettings.svelte'

vi.mock('src/lang', () => ({
    language: {
        remoteAccessRetry: 'Retry',
        remoteAccessError: 'Connection failed',
        remoteAccessDnsHelp: 'If Firefox for Android says server not found, turn off DNS over HTTPS in Firefox settings.'
    }
}))
vi.mock('src/ts/globalApi.svelte', () => ({ forageStorage: { createAuth: async () => 'test-auth' } }))
vi.mock('src/ts/alert', () => ({ alertConfirm: async () => true }))
vi.mock('src/ts/secureContext', () => ({ isSecureContext: true }))
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,test' } }))

describe('remote connection status', () => {
    let component: ReturnType<typeof mount> | undefined
    const request = vi.fn()
    const running = { status: 'running', url: 'https://test-link.trycloudflare.com' }
    const response = (data: object) => ({ ok: true, json: async () => data })

    beforeEach(() => {
        vi.useFakeTimers()
        request.mockReset()
        vi.stubGlobal('fetch', request)
        document.body.innerHTML = ''
    })
    afterEach(async () => {
        if (component) await unmount(component)
        component = undefined
        vi.unstubAllGlobals()
        vi.useRealTimers()
    })

    async function open() {
        component = mount(RemoteAccessSettings, { target: document.body })
        flushSync()
        await vi.advanceTimersByTimeAsync(0)
        expect(document.querySelector('img')).not.toBeNull()
    }

    it('shows Firefox DNS over HTTPS troubleshooting beside the remote link', async () => {
        request.mockResolvedValue(response(running))
        await open()
        expect(document.body.textContent).toContain('DNS over HTTPS')
        expect(document.body.textContent).toContain('Firefox for Android')
    })

    it('replaces the QR code with an error after the tunnel exits', async () => {
        request.mockResolvedValueOnce(response(running))
            .mockResolvedValue(response({ status: 'error', url: null, error: 'Tunnel exited' }))
        await open()
        await vi.advanceTimersByTimeAsync(2000)
        expect(document.querySelector('img')).toBeNull()
        expect(document.body.textContent).toContain('Tunnel exited')
        expect(document.body.textContent).toContain('Retry')
    })

    it('hides the QR code if the local server becomes unreachable', async () => {
        request.mockResolvedValueOnce(response(running)).mockRejectedValue(new Error('Network error'))
        await open()
        await vi.advanceTimersByTimeAsync(2000)
        expect(document.querySelector('img')).toBeNull()
        expect(document.body.textContent).toContain('Retry')
    })

    it('stops polling when the settings page closes', async () => {
        request.mockResolvedValue(response(running))
        await open()
        await unmount(component!)
        component = undefined
        await vi.advanceTimersByTimeAsync(4000)
        expect(request).toHaveBeenCalledTimes(1)
    })
})
