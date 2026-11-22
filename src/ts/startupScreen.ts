// Keep this entry independent of the app, its styles, stores and translations.
const CSS_PRELOAD_ERROR = /^Unable to preload CSS for (.+)$/

function errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}

function loadStylesheet(href: string): Promise<boolean> {
    return new Promise(resolve => {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.crossOrigin = ''
        link.href = href
        link.addEventListener('load', () => resolve(true))
        link.addEventListener('error', () => { link.remove(); resolve(false) })
        document.head.appendChild(link)
    })
}

// A fresh query bypasses any cached entry for the hashed /assets file.
function retryUrl(href: string): string {
    const url = new URL(href, location.href)
    url.searchParams.set('retry', String(Date.now()))
    return url.href
}

type Failure = { text: string, status?: number }

// The stylesheet error event carries no reason, so ask the server directly.
async function describeFailure(href: string, korean: boolean): Promise<Failure> {
    const path = new URL(href).pathname
    try {
        const response = await fetch(href, { cache: 'no-store' })
        return {
            text: `${path} HTTP ${response.status}, Content-Type: ${response.headers.get('content-type') || (korean ? '없음' : 'none')}`,
            status: response.status,
        }
    } catch (cause) {
        return { text: `${path} ${korean ? '요청 차단 또는 연결 실패' : 'request blocked or connection failed'} (${errorMessage(cause)})` }
    }
}

const STALE_RELOAD_KEY = 'risubard-stale-build-reload'
const STALE_RELOAD_WINDOW_MS = 60_000

// A hashed asset that the server no longer has means this page came from a
// cached copy of an older build. A reload revalidates index.html and picks up
// the current build. Reload at most once a minute so a broken server cannot loop.
function reloadForStaleBuild(reload: () => void): boolean {
    try {
        const last = Number(sessionStorage.getItem(STALE_RELOAD_KEY))
        if (last && Date.now() - last < STALE_RELOAD_WINDOW_MS) return false
        sessionStorage.setItem(STALE_RELOAD_KEY, String(Date.now()))
    } catch {
        return false
    }
    reload()
    return true
}

// Vite stops the app import at the first stylesheet that fails. Retry every
// failed stylesheet once; Vite remembers the original URLs, so a second import
// goes straight to the app code. Returns failure details, or [] on success.
async function retryFailedStylesheets(failedUrl: string, korean: boolean): Promise<Failure[]> {
    const failedLinks = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter(link => !link.sheet)
    const hrefs = new Set([new URL(failedUrl, location.href).href, ...failedLinks.map(link => link.href)])
    const results = await Promise.all([...hrefs].map(async href => ({ href, loaded: await loadStylesheet(retryUrl(href)) })))
    const stillFailed = results.filter(result => !result.loaded)
    if (stillFailed.length === 0) {
        failedLinks.forEach(link => link.remove())
        return []
    }
    return Promise.all(stillFailed.map(result => describeFailure(result.href, korean)))
}

export async function startWithBranding(loadApp: () => Promise<unknown>, reload: () => void = () => location.reload()): Promise<void> {
    const korean = document.documentElement.lang === 'ko'
    const status = document.getElementById('preloading-status')
    const logo = document.querySelector<HTMLImageElement>('[data-startup-logo="preloader"]')
    const showError = (message: string) => {
        const error = document.getElementById('preloading-error')
        if (error) {
            error.hidden = false
            error.textContent = `${korean ? '시작 실패' : 'Startup failed'}: ${message}`
        }
    }
    if (status) status.textContent = korean ? '브랜딩 배너를 준비하는 중...' : 'Preparing the branding banner...'
    try { await logo?.decode() } catch { /* A missing image must not prevent startup. */ }
    // Give the decoded banner a paint opportunity before evaluating the app.
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    if (status) status.textContent = korean ? '앱 코드와 화면 스타일을 불러오는 중...' : 'Loading app code and styles...'
    try {
        await loadApp()
        return
    } catch (cause) {
        const cssFailure = cause instanceof Error ? CSS_PRELOAD_ERROR.exec(cause.message) : null
        if (!cssFailure) {
            showError(errorMessage(cause))
            console.error('RisuBard startup failed', cause)
            return
        }
        console.warn('RisuBard stylesheet failed, retrying', cause)
        if (status) status.textContent = korean ? '화면 스타일 파일을 다시 받는 중...' : 'Downloading the style files again...'
        const failures = await retryFailedStylesheets(cssFailure[1], korean)
        if (failures.length > 0) {
            if (failures.some(failure => failure.status === 404)) {
                if (status) status.textContent = korean ? '새 버전을 불러오는 중...' : 'Loading the new version...'
                if (reloadForStaleBuild(reload)) return
            }
            showError(`${errorMessage(cause)} (${korean ? '다시 받기 실패' : 'retry failed'}: ${failures.map(failure => failure.text).join('; ')})`)
            console.error('RisuBard startup failed', cause, failures)
            return
        }
    }
    if (status) status.textContent = korean ? '앱 코드와 화면 스타일을 불러오는 중...' : 'Loading app code and styles...'
    try {
        await loadApp()
    } catch (cause) {
        showError(errorMessage(cause))
        console.error('RisuBard startup failed', cause)
    }
}
