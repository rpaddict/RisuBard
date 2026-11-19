import { beforeEach, describe, expect, it, vi } from 'vitest'
import { startWithBranding } from './startupScreen'

describe('first startup screen', () => {
    beforeEach(() => {
        document.documentElement.lang = 'ko'
        document.body.innerHTML = '<img data-startup-logo="preloader"><span id="preloading-status"></span><p id="preloading-error" hidden></p>'
    })

    it('decodes the banner before loading the app and reports the real stage', async () => {
        let finishDecode!: () => void
        const logo = document.querySelector('img')!
        logo.decode = () => new Promise<void>(resolve => { finishDecode = resolve })
        const loadApp = vi.fn(async () => {
            expect(document.getElementById('preloading-status')?.textContent).toContain('앱 코드')
        })
        const startup = startWithBranding(loadApp)
        expect(loadApp).not.toHaveBeenCalled()
        expect(document.getElementById('preloading-status')?.textContent).toContain('배너')
        finishDecode()
        await startup
        expect(loadApp).toHaveBeenCalledOnce()
    })

    it('continues if the banner fails and leaves module failures visible as text', async () => {
        document.querySelector('img')!.decode = async () => { throw new Error('Image unavailable') }
        await startWithBranding(async () => { throw new Error('<failed chunk>') })
        expect(document.getElementById('preloading-status')?.textContent).toContain('앱 코드')
        const error = document.getElementById('preloading-error')!
        expect(error.hidden).toBe(false)
        expect(error.textContent).toContain('<failed chunk>')
        expect(error.children).toHaveLength(0)
    })

    describe('stylesheet preload failure', () => {
        const cssError = () => new Error('Unable to preload CSS for /assets/ShButton-x.css')
        const settings = (window as any).happyDOM.settings
        const setRetryLoads = (loads: boolean) => { settings.handleDisabledFileLoadingAsSuccess = loads }

        beforeEach(() => {
            settings.disableCSSFileLoading = true
            setRetryLoads(false)
            document.head.innerHTML = '<link rel="stylesheet" href="/assets/ShButton-x.css">'
            setRetryLoads(true)
            return () => {
                settings.disableCSSFileLoading = false
                settings.handleDisabledFileLoadingAsSuccess = false
            }
        })

        it('downloads the stylesheet again with a fresh URL and resumes the app import', async () => {
            const loadApp = vi.fn(async () => { if (loadApp.mock.calls.length === 1) throw cssError() })
            await startWithBranding(loadApp)
            expect(loadApp).toHaveBeenCalledTimes(2)
            const hrefs = [...document.head.querySelectorAll('link')].map(link => link.getAttribute('href'))
            expect(hrefs).toHaveLength(1)
            expect(hrefs[0]).toMatch(/\/assets\/ShButton-x\.css\?retry=\d+$/)
            expect(document.getElementById('preloading-error')!.hidden).toBe(true)
        })

        it('reloads once when the server no longer has the asset (stale cached build)', async () => {
            setRetryLoads(false)
            sessionStorage.clear()
            vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404, headers: { 'content-type': 'text/html' } })))
            const reload = vi.fn()
            await startWithBranding(async () => { throw cssError() }, reload)
            expect(reload).toHaveBeenCalledOnce()
            expect(document.getElementById('preloading-error')!.hidden).toBe(true)
            vi.unstubAllGlobals()
        })

        it('does not reload for a non-404 failure', async () => {
            setRetryLoads(false)
            sessionStorage.clear()
            vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 502, headers: { 'content-type': 'text/html' } })))
            const reload = vi.fn()
            await startWithBranding(async () => { throw cssError() }, reload)
            expect(reload).not.toHaveBeenCalled()
            expect(document.getElementById('preloading-error')!.textContent).toContain('HTTP 502')
            vi.unstubAllGlobals()
        })

        it('shows the server response when the retry also fails', async () => {
            setRetryLoads(false)
            sessionStorage.setItem('risubard-stale-build-reload', String(Date.now()))
            vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404, headers: { 'content-type': 'text/html' } })))
            const loadApp = vi.fn(async () => { throw cssError() })
            const reload = vi.fn()
            await startWithBranding(loadApp, reload)
            expect(reload).not.toHaveBeenCalled()
            expect(loadApp).toHaveBeenCalledOnce()
            const error = document.getElementById('preloading-error')!
            expect(error.hidden).toBe(false)
            expect(error.textContent).toContain('다시 받기 실패: /assets/ShButton-x.css HTTP 404, Content-Type: text/html')
            vi.unstubAllGlobals()
        })

        it('reports a blocked request when the server cannot be reached', async () => {
            setRetryLoads(false)
            vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
            await startWithBranding(async () => { throw cssError() })
            expect(document.getElementById('preloading-error')!.textContent).toContain('요청 차단 또는 연결 실패 (Failed to fetch)')
            vi.unstubAllGlobals()
        })
    })
})
