// ── NodeOnly: server-side JWT ────────────────────────────────────────────────
// Upstream uses client-side ECDSA JWT (crypto.subtle) which requires Secure
// Context (HTTPS/localhost). NodeOnly needs HTTP remote access, so JWT
// signing is moved to the server. The client only caches and forwards
// server-issued tokens. If upstream changes its auth flow, sync manually.
// Server counterpart: server/node/server.cjs (createServerJwt, checkAuth,
// /api/login, /api/token/refresh)
import { language } from "src/lang"
import { alertInput, waitAlert, notifyError } from "../alert"
import { decodeRisuSave, encodeRisuSaveLegacy } from "./risuSave"
import { getDatabase, normalizeChat, type Chat, type Message } from "./database.svelte"
import {
    assembleChatContentPages,
    getRemainingChatContentPageOffsets,
    type ChatContentPageEnvelope,
} from './chatContentPage'
import { isCanonicalFilesChangedResponse } from './canonicalConflict'
import { uploadChatContent } from './chatContentUpload'
import { subscribeLiveFileEvents } from './liveFileEvents'

const CHAT_CONTENT_TRANSFER_PAGE_SIZE = 200
const CHAT_CONTENT_TRANSFER_CONCURRENCY = 4

// ── User intent for the write lock ─────────────────────────────────────────
// The server moves the single-writer lock only on writes that follow a real
// user gesture in this page lifetime (x-user-active header). Untouched pages
// also write automatically during boot or backgrounding; those writes must
// not claim ownership. A page that has been used still has to pass the
// server's freshness check before it can claim the lock.
// A slow generation or authentication must not expire the action that caused
// a save. This resets on reload; server freshness still rejects stale pages.
let hasUserGesture = false
if (typeof window !== 'undefined') {
    const markGesture = () => { hasUserGesture = true }
    window.addEventListener('pointerdown', markGesture, { capture: true, passive: true })
    window.addEventListener('keydown', markGesture, { capture: true, passive: true })
}
function isUserActive(): boolean {
    return hasUserGesture
}

// Custom error class for database conflict detection
export class ConflictError extends Error {
    currentEtag: string | null
    canonicalFilesChanged: boolean
    externalEditMode: boolean
    constructor(
        message: string,
        currentEtag: string | null,
        canonicalFilesChanged = false,
        externalEditMode = false,
    ) {
        super(message)
        this.name = 'ConflictError'
        this.currentEtag = currentEtag
        this.canonicalFilesChanged = canonicalFilesChanged
        this.externalEditMode = externalEditMode
    }
}

// Warning the server attaches to /api/patch responses when the most recent
// debounced persist failed (Stage 1 visibility — see issues.md).
export interface PersistWarning {
    timestamp: number
    message: string
    attemptedSize: number | null
    source: string
}

export interface PatchItemResult {
    success: boolean
    etag?: string
    persistWarning?: PersistWarning
    /** Set when the server's chat-internal-field guard rejected the patch. */
    chatGuardRejected?: boolean
    /** Set when file-native canonical entities changed outside RisuBard. */
    canonicalFilesChanged?: boolean
    /** Set while browser persistence is paused for external canonical-file editing. */
    externalEditMode?: boolean
}

export interface ExternalEditModeStatus {
    active: boolean
    baselineRevision?: string | null
    adopted?: boolean
    revision?: string | null
}

export interface LiveFileMonitoringStatus {
    enabled: boolean
    defaultEnabled: boolean
}

export interface ExportBackupOptions {
    /** Strip NodeOnly-only inlay namespaces so upstream RisuAI can import it. */
    target?: 'upstream'
    /** Drop characters, chats and inlay images — a seed for a fresh instance. */
    mode?: 'settings'
    /**
     * Carry asset-pack module images. Defaults to true; set false to leave out
     * what is usually the bulk of a settings backup. Only meaningful with
     * `mode: 'settings'`.
     */
    moduleAssets?: boolean
}

/** Size breakdown backing the settings-only confirm dialog. */
export interface SettingsBackupEstimate {
    dbBytes: number
    baseAssets: { count: number, bytes: number }
    moduleAssets: { count: number, bytes: number, moduleCount: number }
}

export type BackupImportPhase = 'processing' | 'validating' | 'publishing' | 'finalizing'

export class NodeStorage{
    importProgressId?: string

    async observeImportProgress(id: string, onEvent: (event: import('../importProgress').ServerImportEvent) => void, onLost: () => void) {
        this.importProgressId = id
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const stop = () => { controller.abort(); if (this.importProgressId === id) this.importProgressId = undefined }
        try {
            const response = await this.authFetch(`/api/import-progress/${id}`, { signal: controller.signal })
            clearTimeout(timeout)
            if (!response.ok || !response.body) throw new Error('Progress stream unavailable')
            const reader = response.body.getReader()
            void (async () => {
                const decoder = new TextDecoder()
                let pending = ''
                try {
                    while (true) {
                        const { value, done } = await reader.read()
                        if (done) { if (!controller.signal.aborted) onLost(); break }
                        pending += decoder.decode(value, { stream: true })
                        const lines = pending.split('\n')
                        pending = lines.pop() ?? ''
                        for (const line of lines) {
                            const event = JSON.parse(line)
                            if (event.type === 'heartbeat' || event.type === 'progress') onEvent(event)
                        }
                    }
                } catch { if (!controller.signal.aborted) onLost() }
                finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
            })()
        } catch { clearTimeout(timeout); onLost() }
        return stop
    }
    private static readonly BULK_WRITE_CLIENT_BATCH = 200
    // Server tokens live five minutes; renew with two minutes left.
    private static readonly TOKEN_RENEW_AHEAD_MS = 120_000

    // Cross-device single-writer lock identity. Persisted in sessionStorage so
    // a reload or an OS tab restore of the SAME tab keeps the same identity —
    // a phone tab resurrected in the background must not look like a new
    // device (which used to silently steal the write lock from a PC
    // mid-session). Still per-tab: a genuinely new tab gets a new id, and
    // same-device multi-tab is handled by the BroadcastChannel lock.
    private static sessionId: string = (() => {
        const KEY = 'risu-writer-session-id'
        const minted = crypto?.randomUUID?.() ?? (Date.now().toString(36) + Math.random().toString(36).slice(2))
        try {
            const stored = sessionStorage.getItem(KEY)
            if (stored) return stored
            sessionStorage.setItem(KEY, minted)
        } catch { /* storage unavailable (rare privacy modes) — per-load id */ }
        return minted
    })()

    _lastDbEtag: string | null = null
    authChecked = false
    private cachedJwt: { token: string; expiresAt: number } | null = null
    private static sessionInitialized = false
    private static sessionPending: Promise<void> | null = null
    private refreshPending: Promise<string> | null = null
    private liveMonitoringCache: { status: LiveFileMonitoringStatus, expiresAt: number } | null = null
    private liveMonitoringPending: Promise<LiveFileMonitoringStatus> | null = null
    private liveMonitoringGeneration = 0
    private liveSnapshotRequired = false
    pendingSaveRequests = 0

    private connectionFetch(path: string, init: RequestInit) {
        // No time limit: a busy server answers late, it is not broken.
        return fetch(path, init)
    }

    // Saves wait for the server however long it takes. Aborting transport
    // never undoes a write, so a time limit only reported false failures.
    private async saveRequest(path: string, init: RequestInit) {
        this.pendingSaveRequests++
        try {
            return await this.authFetch(path, init)
        } finally {
            this.pendingSaveRequests--
        }
    }

    async flushDatabase(keepalive = false, canonicalOnly = false, signal?: AbortSignal): Promise<void> {
        const path = canonicalOnly ? '/api/db/flush?mode=canonical' : '/api/db/flush'
        const init: RequestInit = { method: 'POST', keepalive, credentials: 'same-origin', signal }
        // Use the same renewable auth as writes. The asset cookie can expire
        // independently in a long-lived tab. Page-hide remains best effort.
        // A cancellable flush (import install) stops when the user cancels.
        const response = keepalive
            ? await this.authFetch(path, init)
            : await this.saveRequest(path, init)
        if (!response.ok) throw new Error(`Server database flush failed (${response.status})`)
    }

    private renewTimer: ReturnType<typeof setTimeout> | undefined
    private renewOnReturnInstalled = false

    private setCachedJwt(token: string) {
        this.cachedJwt = { token, expiresAt: Date.now() + 5 * 60 * 1000 }
        if (typeof document === 'undefined') return
        // Keep a visible tab's token fresh; a returning tab renews at once.
        clearTimeout(this.renewTimer)
        this.renewTimer = setTimeout(() => {
            if (document.visibilityState === 'visible') void this._refreshToken().catch(() => {})
        }, 5 * 60 * 1000 - NodeStorage.TOKEN_RENEW_AHEAD_MS)
        if (this.renewOnReturnInstalled) return
        this.renewOnReturnInstalled = true
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible' || !this.cachedJwt) return
            if (this.cachedJwt.expiresAt - Date.now() <= NodeStorage.TOKEN_RENEW_AHEAD_MS) {
                void this._refreshToken().catch(() => {})
            }
        })
    }

    async createAuth(){
        const remaining = this.cachedJwt ? this.cachedJwt.expiresAt - Date.now() : 0
        if (this.cachedJwt && remaining > NodeStorage.TOKEN_RENEW_AHEAD_MS) {
            return this.cachedJwt.token
        }
        // Renew in the background while the current token is still usable, so
        // a send never waits behind a refresh queued among long requests.
        if (this.cachedJwt && remaining > 30_000) {
            void this._refreshToken().catch(() => {})
            return this.cachedJwt.token
        }
        const token = await this._refreshToken()
        return token
    }

    // Called once after JWT auth is confirmed. Issues a session cookie so that
    // <img src="/api/asset/..."> can be served without JS-injected headers.
    private async initSession() {
        if (NodeStorage.sessionInitialized) return
        if (NodeStorage.sessionPending) return NodeStorage.sessionPending
        NodeStorage.sessionPending = this._doInitSession()
        return NodeStorage.sessionPending
    }

    private async _doInitSession() {
        try {
            const res = await this.connectionFetch('/api/session', {
                method: 'POST',
                headers: {
                    'risu-auth': await this.createAuth(),
                    'x-session-id': NodeStorage.sessionId,
                },
            })
            if (res.ok) {
                NodeStorage.sessionInitialized = true
            }
            // Non-ok (400/401/500): will retry on next checkAuth() call.
        } catch {
            // Network error: will retry on next checkAuth() call.
        } finally {
            NodeStorage.sessionPending = null
        }
    }

    private async _refreshToken(): Promise<string> {
        if (this.refreshPending) return this.refreshPending
        this.refreshPending = this._doRefreshToken()
        try { return await this.refreshPending }
        finally { this.refreshPending = null }
    }

    private async _doRefreshToken(): Promise<string> {
        let res: Response
        try {
            res = await this.connectionFetch('/api/token/refresh', {
                method: 'POST',
                headers: { 'risu-auth': this.cachedJwt?.token ?? '' }
            })
        } catch (error) {
            // A slow refresh is not a failed session while the old token still works.
            if (this.cachedJwt && this.cachedJwt.expiresAt - Date.now() > 5_000) return this.cachedJwt.token
            throw error
        }
        if (res.ok) {
            const data = await res.json()
            this.setCachedJwt(data.token)
            return data.token
        }
        return this.cachedJwt?.token ?? ''
    }

    private async loginWithPassword(password: string) {
        const response = await this.connectionFetch('/api/login', {
            method: "POST",
            body: JSON.stringify({ password }),
            headers: {
                'content-type': 'application/json'
            }
        })

        if(response.status === 429){
            notifyError(`Too many attempts. Please wait and try again later.`)
            await waitAlert()
            throw new Error('Too many login attempts')
        }

        if(response.status < 200 || response.status >= 300){
            let message = 'Node login failed'
            try {
                const data = await response.json()
                message = data.error ?? message
            } catch {
                // noop
            }
            throw new Error(message)
        }

        const data = await response.json()
        if (data.token) {
            this.setCachedJwt(data.token)
        }
        this.authChecked = true
    }

    private async shouldRetryAuth(response: Response) {
        if(response.status !== 400 && response.status !== 401){
            return false
        }

        try {
            const data = await response.clone().json()
            return [
                'No auth header',
                'Invalid Signature',
                'Token Expired'
            ].includes(data?.error)
        } catch {
            return false
        }
    }

    private async authFetch(input: RequestInfo | URL, init: RequestInit = {}, retry = true) {
        init.signal?.throwIfAborted()
        await this.checkAuth()
        init.signal?.throwIfAborted()
        const headers = new Headers(init.headers)
        headers.set('risu-auth', await this.createAuth())
        init.signal?.throwIfAborted()
        headers.set('x-session-id', NodeStorage.sessionId)
        if (this.importProgressId) headers.set('x-import-id', this.importProgressId)
        if (isUserActive()) headers.set('x-user-active', '1')

        const response = await fetch(input, {
            ...init,
            headers
        })
        init.signal?.throwIfAborted()

        if (response.status === 423) {
            window.dispatchEvent(new CustomEvent('risu-session-deactivated'))
        }

        if(retry && await this.shouldRetryAuth(response)){
            init.signal?.throwIfAborted()
            this.authChecked = false
            this.cachedJwt = null
            await this.checkAuth()
            return this.authFetch(input, init, false)
        }

        return response
    }

    async setItem(key:string, value:Uint8Array, etag?:string): Promise<string | null> {
        const headers: Record<string, string> = {
            'content-type': 'application/octet-stream',
            'file-path': Buffer.from(key, 'utf-8').toString('hex')
        }
        if (etag) {
            headers['x-if-match'] = etag
        }
        const da = await this.saveRequest('/api/write', {
            method: "POST",
            body: value as any,
            headers
        })
        if(da.status === 409){
            const data = await da.json()
            throw new ConflictError(
                data.error,
                data.currentEtag ?? null,
                isCanonicalFilesChangedResponse(data),
                data.code === 'EXTERNAL_EDIT_MODE' || data.externalEditMode === true,
            )
        }
        if(da.status < 200 || da.status >= 300){
            throw "setItem Error"
        }
        const data = await da.json()
        if(data.error){
            throw data.error
        }
        const nextEtag = data.etag as string | undefined
        if (key === 'database/database.bin' && nextEtag) {
            this._lastDbEtag = nextEtag
        }
        return nextEtag ?? null
    }
    async setItemConditional(key: string, value: Uint8Array, etag: string): Promise<string | null> {
        return await this.setItem(key, value, etag)
    }
    async getItemWithEtag(key:string):Promise<{ value: Buffer | null, etag: string | null }> {
        const headers: Record<string, string> = {
            'file-path': Buffer.from(key, 'utf-8').toString('hex')
        }

        const da = await this.authFetch('/api/read', { method: "GET", headers })
        if(da.status < 200 || da.status >= 300){
            // Keep the server's reason, e.g. which hand-edited file is broken and where.
            const body = await da.text().catch(() => '')
            let detail = body
            try { detail = JSON.parse(body)?.error ?? body } catch {}
            throw detail ? `getItem Error: ${detail}` : "getItem Error"
        }

        // Capture ETag for database.bin
        const dbEtag = da.headers.get('x-db-etag')
        const itemEtag = da.headers.get('x-item-etag') ?? dbEtag
        if (dbEtag) {
            this._lastDbEtag = dbEtag
        }

        const data = Buffer.from(await da.arrayBuffer())
        if (data.length === 0){
            return { value: null, etag: null }
        }

        return { value: data, etag: itemEtag }
    }
    async getItem(key:string):Promise<Buffer> {
        return (await this.getItemWithEtag(key)).value as Buffer
    }
    /** Reads many `cache/` keys in one request per 256 keys; missing keys are null. */
    async getCacheItems(keys: readonly string[]): Promise<(Buffer | null)[]> {
        const values: (Buffer | null)[] = []
        for (let offset = 0; offset < keys.length; offset += 256) {
            const da = await this.authFetch('/api/read-many', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ keys: keys.slice(offset, offset + 256) }),
            })
            if (da.status < 200 || da.status >= 300) {
                throw new Error(`readMany failed with status ${da.status}`)
            }
            // Binary frames: uint32 LE length per key (0xFFFFFFFF = missing), then bytes.
            const body = Buffer.from(await da.arrayBuffer())
            const expected = Math.min(256, keys.length - offset)
            let cursor = 0
            for (let index = 0; index < expected; index++) {
                if (cursor + 4 > body.length) throw new Error('Invalid readMany response')
                const length = body.readUInt32LE(cursor)
                cursor += 4
                if (length === 0xFFFFFFFF) {
                    values.push(null)
                    continue
                }
                if (cursor + length > body.length) throw new Error('Invalid readMany response')
                values.push(body.subarray(cursor, cursor + length))
                cursor += length
            }
            if (cursor !== body.length) throw new Error('Invalid readMany response')
        }
        return values
    }
    /** Writes many `cache/` entries in one request per 256 entries. */
    async setCacheItems(entries: readonly { key: string; value: Uint8Array }[]): Promise<void> {
        for (let offset = 0; offset < entries.length; offset += 256) {
            const da = await this.authFetch('/api/write-many', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ entries: entries.slice(offset, offset + 256).map((entry) => ({
                    key: entry.key,
                    value: Buffer.from(entry.value).toString('base64'),
                })) }),
            })
            if (da.status < 200 || da.status >= 300) {
                throw new Error(`writeMany failed with status ${da.status}`)
            }
        }
    }
    async keys(prefix: string = ''):Promise<string[]>{
        const headers: Record<string, string> = {
        }
        if (prefix) {
            headers['key-prefix'] = prefix
        }
        const da = await this.authFetch('/api/list', {
            method: "GET",
            headers
        })
        if(da.status < 200 || da.status >= 300){
            throw "listItem Error"
        }
        const data = await da.json()
        if(data.error){
            throw data.error
        }
        return data.content
    }
    async removeItem(key:string, etag?: string){
        const headers: Record<string, string> = {
            'file-path': Buffer.from(key, 'utf-8').toString('hex')
        }
        if (etag) {
            headers['x-if-match'] = etag
        }
        const da = await this.authFetch('/api/remove', {
            method: "GET",
            headers
        })
        if(da.status === 409){
            const data = await da.json()
            throw new ConflictError(
                data.error,
                data.currentEtag ?? null,
                isCanonicalFilesChangedResponse(data),
                data.code === 'EXTERNAL_EDIT_MODE' || data.externalEditMode === true,
            )
        }
        if(da.status < 200 || da.status >= 300){
            throw "removeItem Error"
        }
        const data = await da.json()
        if(data.error){
            throw data.error
        }
    }

    private async checkAuth(){

        if(!this.authChecked){
            const data = await (await this.connectionFetch('/api/test_auth',{
                headers: {
                    'risu-auth': this.cachedJwt?.token ?? ''
                }
            })).json()

            if(data.status === 'unset'){
                const input = await digestPassword(await alertInput(language.setNodePassword))
                const response = await this.connectionFetch('/api/set_password',{
                    method: "POST",
                    body:JSON.stringify({
                        password: input 
                    }),
                    headers: {
                        'content-type': 'application/json'
                    }
                })

                if(response.status < 200 || response.status >= 300){
                    throw new Error('Failed to set node password')
                }

                await this.loginWithPassword(input)
                await this.initSession()
                return
            }
            else if(data.status === 'incorrect'){
                const input = await digestPassword(await alertInput(language.inputNodePassword))
                await this.loginWithPassword(input)
                await this.initSession()
                return
            }
            else{
                if (data.token) {
                    this.setCachedJwt(data.token)
                }
                this.authChecked = true
            }
        }
        await this.initSession()
    }

    listItem = this.keys

    /** Set cached ETag for database.bin */
    setDbEtag(etag: string | null) {
        this._lastDbEtag = etag
    }

    /** Writer-lock state of THIS session (side-effect free; reload-on-return
     *  check). 'stale' = another device wrote after this page booted — our
     *  in-memory copy is outdated and must reload before writing again. */
    async getWriterLockState(): Promise<'free' | 'active' | 'fresh' | 'stale' | 'unknown'> {
        try {
            const res = await this.authFetch('/api/session/lock-status')
            if (!res.ok) return 'unknown'
            const data = await res.json()
            return data?.state ?? 'unknown'
        } catch {
            return 'unknown'
        }
    }

    private cacheLiveFileMonitoring(status: LiveFileMonitoringStatus) {
        if (!status.enabled || this.liveMonitoringCache?.status.enabled === false) {
            this.liveSnapshotRequired = true
        }
        this.liveMonitoringCache = { status, expiresAt: Date.now() + 30_000 }
        return status
    }

    async subscribeLiveFileChanges(onChange: () => void): Promise<() => void> {
        return subscribeLiveFileEvents({
            authenticate: async () => {
                const response = await this.authFetch('/api/session', { method: 'POST' })
                if (!response.ok) throw new Error(`Live file session failed (${response.status})`)
            },
            onEvent: event => {
                this.liveMonitoringGeneration++
                this.liveMonitoringPending = null
                if (event.reason === 'ready') this.liveSnapshotRequired = true
                this.cacheLiveFileMonitoring({ enabled: event.enabled, defaultEnabled: event.defaultEnabled })
                onChange()
            },
            onFallback: () => {
                if (this.liveMonitoringCache) this.liveMonitoringCache.expiresAt = 0
                onChange()
            },
        })
    }

    // Metadata reconciliation reads wait for a busy server without a time limit.
    private async readLiveFileJson(path: string, init: RequestInit) {
        const response = await this.authFetch(path, init)
        return { response, data: await response.json() }
    }

    async getLiveFileMonitoring(force = false): Promise<LiveFileMonitoringStatus> {
        if (!force && this.liveMonitoringCache && this.liveMonitoringCache.expiresAt > Date.now()) {
            return this.liveMonitoringCache.status
        }
        if (this.liveMonitoringPending) return this.liveMonitoringPending
        const generation = this.liveMonitoringGeneration
        const pending = (async () => {
            const { response, data } = await this.readLiveFileJson('/api/live-files/monitoring', { method: 'GET' })
            if (!response.ok) throw new Error(data?.error || `Live file monitoring request failed (${response.status})`)
            if (generation === this.liveMonitoringGeneration) this.cacheLiveFileMonitoring(data)
            return this.liveMonitoringCache?.status ?? data
        })()
        this.liveMonitoringPending = pending
        try {
            return await pending
        } finally {
            if (this.liveMonitoringPending === pending) this.liveMonitoringPending = null
        }
    }

    async setLiveFileMonitoring(enabled: boolean): Promise<LiveFileMonitoringStatus> {
        const generation = this.liveMonitoringGeneration
        const response = await this.authFetch('/api/live-files/monitoring', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data?.error || `Live file monitoring request failed (${response.status})`)
        // Events and POST responses travel on separate connections; re-read the
        // authoritative setting when their ordering is ambiguous.
        if (generation !== this.liveMonitoringGeneration) return this.getLiveFileMonitoring(true)
        this.liveMonitoringGeneration++
        this.liveMonitoringPending = null
        return this.cacheLiveFileMonitoring(data)
    }

    async syncLiveFiles(revision?: string): Promise<import('./liveFileSync').LiveFileSyncResult> {
        if (!(await this.getLiveFileMonitoring()).enabled) {
            return { revision: revision ?? '', etag: null, enabled: false }
        }
        const generation = this.liveMonitoringGeneration
        const { response, data } = await this.readLiveFileJson('/api/live-files/sync', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ revision: this.liveSnapshotRequired ? undefined : revision }),
        })
        if (!response.ok) {
            if (data?.code === 'LIVE_FILES_INACTIVE') {
                window.dispatchEvent(new CustomEvent('risu-session-deactivated'))
            }
            throw Object.assign(new Error(data?.error || `Live file sync failed (${response.status})`), { code: data?.code })
        }
        if (data.enabled === false && generation === this.liveMonitoringGeneration) {
            this.cacheLiveFileMonitoring({ enabled: false, defaultEnabled: this.liveMonitoringCache?.status.defaultEnabled ?? true })
        } else if (!data.error && generation === this.liveMonitoringGeneration) {
            this.liveSnapshotRequired = false
        }
        return data
    }

    private async externalEditRequest(path: string, method: 'GET' | 'POST'): Promise<ExternalEditModeStatus> {
        const response = await this.authFetch(path, { method })
        if (!response.ok) {
            const data = await response.json().catch(() => ({}))
            throw new Error(data?.error || `External edit request failed (${response.status})`)
        }
        return await response.json()
    }

    async getExternalEditModeStatus(): Promise<ExternalEditModeStatus> {
        return await this.externalEditRequest('/api/external-edit/status', 'GET')
    }

    async startExternalEditMode(): Promise<ExternalEditModeStatus> {
        return await this.externalEditRequest('/api/external-edit/start', 'POST')
    }

    async finishExternalEditMode(): Promise<ExternalEditModeStatus> {
        return await this.externalEditRequest('/api/external-edit/finish', 'POST')
    }

    async patchItem(key: string, patchData: { patch: any[], expectedHash: string }): Promise<PatchItemResult> {
        const da = await this.saveRequest('/api/patch', {
            method: "POST",
            body: JSON.stringify(patchData),
            headers: {
                'content-type': 'application/json',
                'file-path': Buffer.from(key, 'utf-8').toString('hex')
            }
        })

        if (da.status === 409) {
            const data = await da.json()
            const currentEtag = data.currentEtag as string | undefined
            if (key === 'database/database.bin' && currentEtag) {
                this._lastDbEtag = currentEtag
            }
            // Server signals chat-guard rejection via explicit fields. The
            // error string fallback is kept for forward-compat with deployed
            // servers that haven't shipped the explicit fields yet.
            const rejectedByChatGuard = data.chatGuardRejected === true
                || data.code === 'CHAT_GUARD_REJECTED'
                || (typeof data.error === 'string' && data.error.includes('chat-internal field ops'))
            return {
                success: false,
                etag: currentEtag,
                chatGuardRejected: rejectedByChatGuard,
                canonicalFilesChanged: isCanonicalFilesChangedResponse(data),
                externalEditMode: data.code === 'EXTERNAL_EDIT_MODE' || data.externalEditMode === true,
            }
        }
        if (da.status < 200 || da.status >= 300) {
            return { success: false }
        }
        const data = await da.json()
        if (data.error) {
            return { success: false }
        }
        const nextEtag = data.etag as string | undefined
        if (key === 'database/database.bin' && nextEtag) {
            this._lastDbEtag = nextEtag
        }
        const persistWarning = data.persistWarning as PersistWarning | undefined
        return { success: true, etag: nextEtag, persistWarning }
    }

    // ── Bulk asset operations (3-2-B) ──────────────────────────────────────────
    async getItems(keys: string[]): Promise<{key: string, value: Buffer}[]> {
        const da = await this.authFetch('/api/assets/bulk-read', {
            method: 'POST',
            body: JSON.stringify(keys),
            headers: {
                'content-type': 'application/json',
                'accept': 'application/octet-stream'
            }
        })
        if (da.status < 200 || da.status >= 300) throw 'getItems Error'

        const ct = da.headers.get('content-type') || ''
        if (ct.includes('application/octet-stream')) {
            // Binary protocol: [count(4)] then per entry: [keyLen(4)][key][valLen(4)][value]
            const buf = Buffer.from(await da.arrayBuffer())
            let offset = 0
            const count = buf.readUInt32BE(offset); offset += 4
            const results: {key: string, value: Buffer}[] = []
            for (let i = 0; i < count; i++) {
                const keyLen = buf.readUInt32BE(offset); offset += 4
                const key = buf.subarray(offset, offset + keyLen).toString('utf-8'); offset += keyLen
                const valLen = buf.readUInt32BE(offset); offset += 4
                const value = buf.subarray(offset, offset + valLen) as Buffer; offset += valLen
                results.push({ key, value })
            }
            return results
        }

        // Fallback: JSON+base64
        const results: {key: string, value: string}[] = await da.json()
        return results.map(r => ({ key: r.key, value: Buffer.from(r.value, 'base64') }))
    }

    async cleanupImportAssets(keys: string[], id: string, retainAssets = false) {
        const response = await this.saveRequest('/api/assets/import-rollback', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ keys, id, retainAssets }),
        })
        if (!response.ok) {
            const body = await response.json().catch(() => null)
            const detail = typeof body?.error === 'string' ? `: ${body.error}` : ''
            throw new Error(`Import rollback failed (${response.status})${detail}`)
        }
        return response.json()
    }

    async prepareImportRollback(id: string) {
        const response = await this.saveRequest('/api/assets/import-rollback/prepare', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }),
        })
        if (!response.ok) {
            const body = await response.json().catch(() => null)
            const detail = typeof body?.error === 'string' ? `: ${body.error}` : ''
            throw new Error(`Import rollback preparation failed (${response.status})${detail}`)
        }
    }

    async setItems(entries: {key: string, value: Uint8Array}[]) {
        for (let i = 0; i < entries.length; i += NodeStorage.BULK_WRITE_CLIENT_BATCH) {
            const batch = entries.slice(i, i + NodeStorage.BULK_WRITE_CLIENT_BATCH)
            const body = batch.map(e => ({
                key: e.key,
                value: Buffer.from(e.value).toString('base64')
            }))
            const da = await this.authFetch('/api/assets/bulk-write', {
                method: 'POST',
                body: JSON.stringify(body),
                headers: {
                    'content-type': 'application/json'
                }
            })
            if (da.status < 200 || da.status >= 300) throw 'setItems Error'
        }
    }

    // Let the browser own the network-to-disk transfer. A fetch/read/write loop
    // keeps downloads dependent on the tab's background scheduling.
    private async startBrowserDownload(url: string): Promise<void> {
        // Refresh even in a long-lived tab: the cached session cookie can expire.
        // Credentials stay in an HttpOnly cookie, never in the download URL.
        const session = await this.authFetch('/api/session', { method: 'POST' })
        if (!session.ok) throw new Error(`Download authentication failed: ${session.status}`)
        const link = document.createElement('a')
        link.href = url
        link.download = '' // Use the server's Content-Disposition filename.
        document.body.appendChild(link)
        try { link.click() }
        finally { link.remove() }
    }

    async exportBackup(opts?: ExportBackupOptions): Promise<void> {
        const params = new URLSearchParams()
        if (opts?.target === 'upstream') params.set('target', 'upstream')
        if (opts?.mode === 'settings') params.set('mode', 'settings')
        if (opts?.moduleAssets === false) params.set('moduleAssets', '0')
        const query = params.toString()
        const url = query ? `/api/backup/export?${query}` : '/api/backup/export'
        await this.startBrowserDownload(url)
    }

    async settingsBackupEstimate(): Promise<SettingsBackupEstimate> {
        const da = await this.authFetch('/api/backup/export/settings-estimate')
        if (da.status < 200 || da.status >= 300) throw `settings estimate error: ${da.status}`
        return await da.json()
    }

    async prepareImport(size: number): Promise<void> {
        const da = await this.authFetch('/api/backup/import/prepare', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ size }),
        })
        if (da.status === 409) throw new Error('Another import is already in progress')
        if (da.status === 413) throw new Error('Backup file is too large')
        if (da.status === 507) {
            const body = await da.json().catch(() => ({}))
            const avail = body.available != null ? ` (available: ${Math.round(body.available / 1024 / 1024)} MB)` : ''
            throw new Error(`Insufficient disk space${avail}`)
        }
        if (da.status < 200 || da.status >= 300) throw new Error(`backup prepare error: ${da.status}`)
    }

    async importBackup(
        file: Blob,
        onProgress?: (loaded: number, total: number, phase?: BackupImportPhase) => void
    ): Promise<{ok: boolean, assetsRestored: number, coldStorageFailed?: number}> {
        await this.prepareImport(file.size)
        const authHeader = await this.createAuth()

        return await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            xhr.open('POST', '/api/backup/import')
            xhr.setRequestHeader('content-type', 'application/x-risu-backup')
            xhr.setRequestHeader('risu-auth', authHeader)
            xhr.setRequestHeader('x-session-id', NodeStorage.sessionId)
            if (isUserActive()) xhr.setRequestHeader('x-user-active', '1')
            // Opt into NDJSON streaming so the server keeps the response socket
            // alive during long post-upload work — prevents reverse-proxy 502s.
            xhr.setRequestHeader('accept', 'application/x-ndjson')

            let uploadComplete = false
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    onProgress?.(event.loaded, event.total)
                }
            }
            xhr.upload.onload = () => { uploadComplete = true }

            let parsedIndex = 0
            let leftover = ''
            let result: {ok: boolean, assetsRestored: number, coldStorageFailed?: number} | null = null
            let serverErrorMsg: string | null = null

            const drainNdjson = () => {
                const text = xhr.responseText
                if (text.length <= parsedIndex) return
                leftover += text.slice(parsedIndex)
                parsedIndex = text.length
                const lines = leftover.split('\n')
                leftover = lines.pop() ?? ''
                for (const line of lines) {
                    if (!line) continue
                    let msg: any
                    try { msg = JSON.parse(line) } catch { continue }
                    if (msg.type === 'progress' && uploadComplete) {
                        // After upload finishes, surface server-side processing
                        // progress through the same callback for UI continuity.
                        onProgress?.(msg.bytes, msg.totalBytes)
                    } else if (msg.type === 'phase') {
                        onProgress?.(msg.bytes, msg.totalBytes, msg.phase)
                    } else if (msg.type === 'done') {
                        result = msg
                    } else if (msg.type === 'error') {
                        serverErrorMsg = typeof msg.message === 'string' ? msg.message : 'backup import failed'
                    }
                    // Ignore 'heartbeat' and unknown event types.
                }
            }

            xhr.onprogress = drainNdjson
            xhr.onerror = () => reject(new Error('backup import request failed'))
            xhr.onload = () => {
                if (xhr.status < 200 || xhr.status >= 300) {
                    let msg = `backup import error: ${xhr.status}`
                    try {
                        const body = JSON.parse(xhr.responseText)
                        if (body?.error) msg = String(body.error)
                    } catch {}
                    reject(new Error(msg))
                    return
                }
                drainNdjson()
                if (serverErrorMsg) reject(new Error(serverErrorMsg))
                else if (result) resolve(result)
                else reject(new Error('backup import: no result received'))
            }

            xhr.send(file)
        })
    }

    async characterAssetTransition(characterId: string, action: 'status' | 'migrate' | 'disable') {
        const response = action === 'status'
            ? await this.authFetch(`/api/character-assets/status?characterId=${encodeURIComponent(characterId)}`)
            : await this.authFetch('/api/character-assets/transition', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ characterId, action }),
            })
        if (!response.ok) throw new Error(`Asset transition failed: ${response.status}`)
        return response.json()
    }

    async characterPackageTransition(characterId: string, action: 'status' | 'migrate' | 'refresh' | 'rollback' | 'retire-kv' | 'restore-kv') {
        const response = action === 'status'
            ? await this.authFetch(`/api/character-packages/status?characterId=${encodeURIComponent(characterId)}`)
            : await this.authFetch('/api/character-packages/transition', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ characterId, action }),
            })
        if (!response.ok) throw new Error(`Character package transition failed: ${response.status}`)
        return response.json()
    }

    async storagePackageOverview() {
        const response = await this.authFetch('/api/storage-packages/overview')
        if (!response.ok) throw new Error(`Storage package overview failed: ${response.status}`)
        return response.json()
    }

    async moduleAssetTransition(moduleId: string, action: 'status' | 'migrate' | 'disable' | 'retire-kv' | 'restore-kv') {
        const response = action === 'status'
            ? await this.authFetch(`/api/module-assets/status?moduleId=${encodeURIComponent(moduleId)}`)
            : await this.authFetch('/api/module-assets/transition', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ moduleId, action }),
            })
        if (!response.ok) throw new Error(`Module asset transition failed: ${response.status}`)
        return response.json()
    }

    // ── Server-side backup ─────────────────────────────────────────────────────

    async saveServerBackup(
        onProgress?: (current: number, total: number, bytes: number, totalBytes: number) => void
    ): Promise<{ok: boolean, filename: string, size: number}> {
        const da = await this.authFetch('/api/backup/server/save', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-session-id': NodeStorage.sessionId,
            },
        })
        if (da.status < 200 || da.status >= 300) {
            const body = await da.json().catch(() => ({}))
            throw new Error(body.error || `server backup save error: ${da.status}`)
        }

        const reader = da.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let result: {ok: boolean, filename: string, size: number} | null = null

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop()!
            for (const line of lines) {
                if (!line) continue
                const msg = JSON.parse(line)
                if (msg.type === 'progress') {
                    onProgress?.(msg.current, msg.total, msg.bytes, msg.totalBytes)
                } else if (msg.type === 'done') {
                    result = msg
                } else if (msg.type === 'error') {
                    throw new Error(msg.message)
                }
            }
        }
        if (!result) throw new Error('Server backup: no result received')
        return result
    }

    async listServerBackups(): Promise<{backups: Array<{filename: string, size: number, createdAt: number}>}> {
        const da = await this.authFetch('/api/backup/server/list')
        if (da.status < 200 || da.status >= 300) throw new Error(`server backup list error: ${da.status}`)
        return da.json()
    }

    async restoreServerBackup(
        filename: string,
        onProgress?: (bytes: number, totalBytes: number, phase?: BackupImportPhase) => void
    ): Promise<{ok: boolean, assetsRestored: number, coldStorageFailed?: number}> {
        const da = await this.authFetch('/api/backup/server/restore', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-session-id': NodeStorage.sessionId,
            },
            body: JSON.stringify({ filename }),
        })
        if (da.status === 404) throw new Error('Backup file not found')
        if (da.status === 409) throw new Error('Another import is already in progress')
        if (da.status < 200 || da.status >= 300) {
            const body = await da.json().catch(() => ({}))
            throw new Error(body.error || `server backup restore error: ${da.status}`)
        }

        const reader = da.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let result: {ok: boolean, assetsRestored: number, coldStorageFailed?: number} | null = null

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop()!
            for (const line of lines) {
                if (!line) continue
                const msg = JSON.parse(line)
                if (msg.type === 'progress') {
                    onProgress?.(msg.bytes, msg.totalBytes)
                } else if (msg.type === 'phase') {
                    onProgress?.(msg.bytes, msg.totalBytes, msg.phase)
                } else if (msg.type === 'done') {
                    result = msg
                } else if (msg.type === 'error') {
                    throw new Error(msg.message)
                }
            }
        }
        if (!result) throw new Error('Server backup restore: no result received')
        return result
    }

    async deleteServerBackup(filename: string): Promise<void> {
        const da = await this.authFetch(`/api/backup/server/${encodeURIComponent(filename)}`, {
            method: 'DELETE',
        })
        if (da.status === 404) throw new Error('Backup file not found')
        if (da.status < 200 || da.status >= 300) throw new Error(`server backup delete error: ${da.status}`)
    }

    async downloadServerBackup(filename: string): Promise<void> {
        await this.startBrowserDownload(`/api/backup/server/download/${encodeURIComponent(filename)}`)
    }

    // ── Chat content (runtime lazy load) ────────────────────────────────────

    private async fetchFullChatContent(chaId: string, chatIndex: number, chatId: string): Promise<any | null> {
        const da = await this.authFetch(`/api/chat-content/${encodeURIComponent(chaId)}/${chatIndex}`, {
            headers: { 'x-chat-id': chatId },
        })
        if (da.status === 404) return null
        if (da.status < 200 || da.status >= 300) throw new Error(`fetchChatContent error: ${da.status}`)
        const buffer = new Uint8Array(await da.arrayBuffer())
        return normalizeChat(await decodeRisuSave(buffer))
    }

    async fetchChatContent(chaId: string, chatIndex: number, chatId: string): Promise<any | null> {
        const pages: ChatContentPageEnvelope<Message, Omit<Chat, 'message'>>[] = []
        const fetchPage = async (offset: number) => {
            const da = await this.authFetch(
                `/api/chat-content/${encodeURIComponent(chaId)}/${chatIndex}/page?offset=${offset}&limit=${CHAT_CONTENT_TRANSFER_PAGE_SIZE}`,
                { headers: { 'x-chat-id': chatId } },
            )
            if (da.status < 200 || da.status >= 300) {
                throw new Error(`fetchChatContent page error: ${da.status}`)
            }

            const buffer = new Uint8Array(await da.arrayBuffer())
            return await decodeRisuSave(buffer) as ChatContentPageEnvelope<Message, Omit<Chat, 'message'>>
        }

        const firstResponse = await this.authFetch(
            `/api/chat-content/${encodeURIComponent(chaId)}/${chatIndex}/page?offset=0&limit=${CHAT_CONTENT_TRANSFER_PAGE_SIZE}`,
            { headers: { 'x-chat-id': chatId } },
        )
        if (firstResponse.status === 404) {
            return this.fetchFullChatContent(chaId, chatIndex, chatId)
        }
        if (firstResponse.status < 200 || firstResponse.status >= 300) {
            throw new Error(`fetchChatContent page error: ${firstResponse.status}`)
        }
        const firstBuffer = new Uint8Array(await firstResponse.arrayBuffer())
        const firstPage = await decodeRisuSave(firstBuffer) as ChatContentPageEnvelope<Message, Omit<Chat, 'message'>>
        if (firstPage.total > 0 && firstPage.messages.length === 0) {
            throw new Error('fetchChatContent page made no progress')
        }
        pages.push(firstPage)

        const offsets = getRemainingChatContentPageOffsets(
            firstPage.total,
            firstPage.offset + firstPage.messages.length,
            CHAT_CONTENT_TRANSFER_PAGE_SIZE,
        )
        for (let index = 0; index < offsets.length; index += CHAT_CONTENT_TRANSFER_CONCURRENCY) {
            pages.push(...await Promise.all(
                offsets.slice(index, index + CHAT_CONTENT_TRANSFER_CONCURRENCY).map(fetchPage),
            ))
        }

        return normalizeChat(assembleChatContentPages(pages))
    }

    async saveChatContent(chaId: string, chatIndex: number, chatId: string, chat: any): Promise<void> {
        const encoded = encodeRisuSaveLegacy(chat)
        const da = await uploadChatContent(
            (url, init) => init.method === 'DELETE' ? this.authFetch(url, init) : this.saveRequest(url, init), chaId, chatIndex, chatId, encoded,
            getDatabase().chatUploadChunkMiB,
            getDatabase().chatUploadChunkEnabled === true,
        )
        if (da.status === 409) {
            const data = await da.json()
            throw new ConflictError(
                data.error,
                data.currentEtag ?? null,
                isCanonicalFilesChangedResponse(data),
                data.code === 'EXTERNAL_EDIT_MODE' || data.externalEditMode === true,
            )
        }
        if (da.status < 200 || da.status >= 300) throw new Error(`saveChatContent error: ${da.status}`)
    }

    // ── Save-folder migration ─────────────────────────────────────────────────

    async scanSaveFolder(folderPath?: string): Promise<{count: number, totalSize: number, hasDatabase: boolean}> {
        const da = await this.authFetch('/api/migrate/save-folder/scan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: folderPath }),
        })
        if (da.status < 200 || da.status >= 300) {
            const body = await da.json().catch(() => ({}))
            throw new Error(body.error || `scan error: ${da.status}`)
        }
        return da.json()
    }

    async executeSaveFolderImport(folderPath?: string): Promise<{ok: boolean, imported: number}> {
        const da = await this.authFetch('/api/migrate/save-folder/execute', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: folderPath }),
        })
        if (da.status === 409) throw new Error('Another import is already in progress')
        if (da.status < 200 || da.status >= 300) {
            const body = await da.json().catch(() => ({}))
            throw new Error(body.error || `import error: ${da.status}`)
        }
        return da.json()
    }

    async uploadSaveFolderZip(
        file: Blob,
        onProgress?: (loaded: number, total: number) => void
    ): Promise<{ok: boolean, imported: number}> {
        const authHeader = await this.createAuth()

        return await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            xhr.open('POST', '/api/migrate/save-folder/upload')
            xhr.setRequestHeader('content-type', 'application/zip')
            xhr.setRequestHeader('risu-auth', authHeader)
            xhr.setRequestHeader('x-session-id', NodeStorage.sessionId)
            if (isUserActive()) xhr.setRequestHeader('x-user-active', '1')

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    onProgress?.(event.loaded, event.total)
                }
            }

            xhr.onerror = () => reject(new Error('zip upload failed'))
            xhr.onload = () => {
                if (xhr.status < 200 || xhr.status >= 300) {
                    let msg = `zip import error: ${xhr.status}`
                    try { msg = JSON.parse(xhr.responseText).error || msg } catch {}
                    reject(new Error(msg))
                    return
                }
                try {
                    resolve(JSON.parse(xhr.responseText))
                } catch (error) {
                    reject(error)
                }
            }

            xhr.send(file)
        })
    }

    async scanCleanup(): Promise<{count: number, totalSize: number}> {
        const da = await this.authFetch('/api/migrate/save-folder/cleanup/scan', {
            method: 'POST',
        })
        if (da.status < 200 || da.status >= 300) {
            const body = await da.json().catch(() => ({}))
            throw new Error(body.error || `cleanup scan error: ${da.status}`)
        }
        return da.json()
    }

    async executeCleanup(): Promise<{ok: boolean, removed: number, freedBytes: number}> {
        const da = await this.authFetch('/api/migrate/save-folder/cleanup/execute', {
            method: 'POST',
        })
        if (da.status < 200 || da.status >= 300) {
            const body = await da.json().catch(() => ({}))
            throw new Error(body.error || `cleanup error: ${da.status}`)
        }
        return da.json()
    }

}

async function digestPassword(message:string) {
    const res = await fetch('/api/crypto', {
        body: JSON.stringify({
            data: message
        }),
        headers: {
            'content-type': 'application/json'
        },
        method: "POST"
    })
    if(res.status < 200 || res.status >= 300){
        throw new Error(`Password hashing failed (${res.status})`)
    }
    return await res.text()
}
