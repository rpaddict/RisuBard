'use strict';

const fs = require('fs');
const path = require('path');
const { atomicWriteFileChunks, atomicWriteJson, readVerifiedJson } = require('./file-store.cjs');
const { maskSensitive } = require('./logs.cjs');

const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MIN_ROWS = 50;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_BATCH_SIZE = 50;
const ROTATE_EVERY_N_ROWS = 20;
const CATEGORIES = ['llm', 'tts', 'image', 'translate', 'embedding', 'other'];
const ROUTES = ['direct', 'proxy', 'job'];
const SOURCES = ['main', 'translate', 'memory', 'emotion', 'sub', 'wiki-admin', 'preview', 'test', 'tts', 'image', 'plugin', 'other'];
// Keep in sync with RequestPurpose in src/ts/requestPurpose.ts; values missing
// here are stored as null and show up as "기타" in the request log.
const PURPOSES = [
    'chat-response',
    'bardwiki-analysis',
    'bardwiki-bard-chan-rerank',
    'bardwiki-canonical-update',
    'bardwiki-source-rerank',
    'bardwiki-admin',
    'persona-builder',
    'lore-builder',
    'bard-painter',
    'bard-lore-analysis',
    'prompt-assistant',
    'character-assistant',
    'input-assistant',
    'reader-board',
];
const READ_CHUNK_BYTES = 1024 * 1024;
const BODY_FIELDS = ['requestHeaders', 'requestBody', 'responseBody'];
const USAGE_FIELDS = ['id', 'timestamp', 'category', 'source', 'purpose', 'chatId', 'sessionChatId', 'generationId', 'model', 'provider', 'status', 'success', 'aborted', 'route', 'streaming', 'durationMs', 'firstTokenMs', 'inputTokens', 'outputTokens', 'cachedTokens', 'reasoningTokens', 'clientId'];
const INJECTION_KINDS =new Set(['systemPrompt', 'jailbreak', 'globalNote', 'authorNote', 'character', 'persona', 'lorebook', 'wiki', 'memory', 'exampleDialogue', 'chatHistory', 'instruction', 'tool', 'other']);

function truncateBody(value, maxBytes) {
    if (typeof value !== 'string') return { text: value, truncated: false };
    if (Buffer.byteLength(value, 'utf8') <= maxBytes) return { text: value, truncated: false };
    const half = Math.floor(maxBytes / 2);
    const buf = Buffer.from(value, 'utf8');
    const omitted = Math.round((buf.length - maxBytes) / 1024);
    return { text: `${buf.subarray(0, half).toString('utf8')}\n\n...[${omitted} KB omitted]...\n\n${buf.subarray(buf.length - half).toString('utf8')}`, truncated: true };
}

function truncateTail(value, maxBytes) {
    if (typeof value !== 'string') return { text: value, truncated: false };
    if (Buffer.byteLength(value, 'utf8') <= maxBytes) return { text: value, truncated: false };
    return { text: Buffer.from(value, 'utf8').subarray(0, maxBytes).toString('utf8') + '...[truncated]', truncated: true };
}

function toInt(value) { return Number.isFinite(value) ? Math.round(value) : null; }
function toNonNegInt(value) { const n = toInt(value); return n != null && n >= 0 ? n : 0; }
function str(value, max) { if (value == null) return null; const s = String(value); return max ? s.slice(0, max) : s; }

function normalizeInjectionManifest(value) {
    let raw = value;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return null; } }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null;
    const items = raw.items.slice(0, 256).flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        return [{ kind: INJECTION_KINDS.has(item.kind) ? item.kind : 'other', ...(item.name != null ? { name: str(item.name, 256) } : {}), tokens: toNonNegInt(item.tokens) }];
    });
    return { totalTokens: toNonNegInt(raw.totalTokens), items, ...(raw.estimated ? { estimated: true } : {}) };
}

function dayKey(timestamp) {
    const d = new Date(timestamp);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function normalizeEntry(entry) {
    const timestamp = typeof entry.timestamp === 'number' ? entry.timestamp : Date.now();
    const headers = entry.requestHeaders != null ? truncateTail(maskSensitive(String(entry.requestHeaders)), MAX_HEADER_BYTES) : { text: null, truncated: false };
    const body = entry.requestBody != null ? truncateBody(maskSensitive(String(entry.requestBody)), MAX_BODY_BYTES) : { text: null, truncated: false };
    const response = entry.responseBody != null ? truncateTail(maskSensitive(String(entry.responseBody)), MAX_BODY_BYTES) : { text: null, truncated: false };
    const injectionManifest = normalizeInjectionManifest(entry.injectionManifest);
    const sizeBytes = Buffer.byteLength(headers.text ?? '', 'utf8') + Buffer.byteLength(body.text ?? '', 'utf8') + Buffer.byteLength(response.text ?? '', 'utf8') + Buffer.byteLength(injectionManifest ? JSON.stringify(injectionManifest) : '', 'utf8');
    return {
        timestamp, category: CATEGORIES.includes(entry.category) ? entry.category : 'other', source: SOURCES.includes(entry.source) ? entry.source : 'other', purpose: PURPOSES.includes(entry.purpose) ? entry.purpose : null,
        chatId: str(entry.chatId, 128), sessionChatId: str(entry.sessionChatId, 128), generationId: str(entry.generationId, 128), model: str(entry.model, 128), provider: str(entry.provider, 64),
        url: str(maskSensitive(entry.url ?? ''), 2048) ?? '', method: str(entry.method, 16), status: toInt(entry.status), success: !!entry.success, aborted: !!entry.aborted,
        route: ROUTES.includes(entry.route) ? entry.route : null, streaming: !!entry.streaming, durationMs: toInt(entry.durationMs), firstTokenMs: toInt(entry.firstTokenMs),
        inputTokens: toInt(entry.inputTokens), outputTokens: toInt(entry.outputTokens), cachedTokens: toInt(entry.cachedTokens), reasoningTokens: toInt(entry.reasoningTokens),
        injectionManifest, requestHeaders: headers.text, requestBody: body.text, responseBody: response.text, responseType: str(entry.responseType, 32),
        errorMessage: entry.errorMessage != null ? maskSensitive(String(entry.errorMessage)).slice(0, 2000) : null,
        truncated: headers.truncated || body.truncated || response.truncated, sizeBytes, clientId: str(entry.clientId, 64),
    };
}

// Both files can reach hundreds of MB, so they are read in fixed chunks and
// parsed one line at a time; only what each caller keeps stays in memory.
function forEachJsonl(file, onRow) {
    if (!fs.existsSync(file)) return;
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    let parts = []; let lineStart = 0; let lineNumber = 0; let position = 0;
    const emit = (bytes, end) => {
        lineNumber++;
        const text = bytes.toString('utf8').replace(/\r$/, '');
        if (text) {
            let row;
            try { row = JSON.parse(text); } catch { throw new Error(`Invalid JSONL at ${file}:${lineNumber}`); }
            onRow(row, lineStart, end - lineStart);
        }
        lineStart = end;
    };
    try {
        for (let read; (read = fs.readSync(fd, buffer, 0, buffer.length, position)) > 0; position += read) {
            const chunk = buffer.subarray(0, read);
            let from = 0;
            for (let nl = chunk.indexOf(10); nl !== -1; nl = chunk.indexOf(10, from)) {
                parts.push(chunk.subarray(from, nl));
                emit(Buffer.concat(parts), position + nl + 1);
                parts = []; from = nl + 1;
            }
            if (from < read) parts.push(Buffer.from(chunk.subarray(from)));
        }
        if (parts.length) emit(Buffer.concat(parts), position);
    } finally { fs.closeSync(fd); }
}

function readJsonlRange(file, offset, length) {
    const buffer = Buffer.allocUnsafe(length);
    const fd = fs.openSync(file, 'r');
    try { let done = 0; while (done < length) { const read = fs.readSync(fd, buffer, done, length - done, offset + done); if (!read) break; done += read; } }
    finally { fs.closeSync(fd); }
    return JSON.parse(buffer.toString('utf8').trim());
}

// Returns where each row landed so the bodies can be read back later.
function appendJsonl(file, rows) {
    if (!rows.length) return [];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lines = rows.map(row => Buffer.from(JSON.stringify(row) + '\n', 'utf8'));
    const fd = fs.openSync(file, 'a', 0o600);
    try {
        let offset = fs.fstatSync(fd).size;
        const spans = lines.map(line => { const span = { offset, length: line.length }; offset += line.length; return span; });
        fs.writeSync(fd, Buffer.concat(lines)); fs.fsyncSync(fd);
        return spans;
    } finally { fs.closeSync(fd); }
}

function withoutBodies(row) {
    const result = { ...row };
    for (const field of BODY_FIELDS) delete result[field];
    return result;
}

// Statistics only need these fields. Older usage rows also carried the full
// request and response bodies, so they are projected on read.
function toUsageRow(row) {
    const result = {};
    for (const field of USAGE_FIELDS) if (row[field] !== undefined) result[field] = row[field];
    return result;
}

function summarize(rows) {
    const durationRows = rows.filter(row => row.durationMs != null);
    return {
        requests: rows.length, failed: rows.filter(row => !row.success).length,
        inputTokens: rows.reduce((n, row) => n + toNonNegInt(row.inputTokens), 0), outputTokens: rows.reduce((n, row) => n + toNonNegInt(row.outputTokens), 0),
        cachedTokens: rows.reduce((n, row) => n + toNonNegInt(row.cachedTokens), 0), reasoningTokens: rows.reduce((n, row) => n + toNonNegInt(row.reasoningTokens), 0),
        avgDurationMs: durationRows.length ? Math.round(durationRows.reduce((n, row) => n + row.durationMs, 0) / durationRows.length) : null,
    };
}

const parseCsv = value => typeof value === 'string' && value.length ? value.split(',').filter(Boolean) : undefined;
const parseNum = value => value ? Number(value) : undefined;

function createRequestLogs(opts = {}) {
    const saveDir = opts.saveDir || path.join(process.cwd(), 'save');
    const root = path.join(saveDir, 'request-logs');
    const requestsFile = path.join(root, 'requests.jsonl');
    const usageFile = path.join(root, 'usage.jsonl');
    const stateFile = path.join(root, 'state.json');
    const maxTotalBytes = opts.maxTotalBytes ?? MAX_TOTAL_BYTES;
    const minRows = opts.minRows ?? MIN_ROWS;
    const rotateEvery = opts.rotateEveryNRows ?? ROTATE_EVERY_N_ROWS;
    fs.mkdirSync(root, { recursive: true });
    // Body-free request rows with the byte span of each full row in requests.jsonl;
    // bodies are read back from disk only when asked for.
    let requests = null;
    let usage = null;
    let state = fs.existsSync(stateFile) ? readVerifiedJson(root, 'state.json') : { schemaVersion: 1, nextId: 1 };
    let insertedSinceRotate = 0;
    const saveState = () => atomicWriteJson(root, 'state.json', state);
    const rewrite = (relative, rows, options) => atomicWriteFileChunks(root, relative, write => {
        for (let index = 0; index < rows.length; index += 500) write(rows.slice(index, index + 500).map(row => JSON.stringify(row) + '\n').join(''));
    }, options);
    const readFullRow = entry => readJsonlRange(requestsFile, entry.offset, entry.length);

    function loadRequests() {
        const entries = [];
        forEachJsonl(requestsFile, (row, offset, length) => entries.push({ row: withoutBodies(row), offset, length }));
        return entries;
    }

    function loadUsage() {
        const rows = []; let legacy = false;
        forEachJsonl(usageFile, row => { const compact = toUsageRow(row); if (Object.keys(row).length !== Object.keys(compact).length) legacy = true; rows.push(compact); });
        // Rewrite once without the bodies older versions stored here. Reading
        // already succeeded, so a failed rewrite only retries on the next start.
        if (legacy) { try { rewrite('usage.jsonl', rows, { backup: false }); } catch {} }
        return rows;
    }

    const getRequests = () => requests ??= loadRequests();
    const getUsage = () => usage ??= loadUsage();

    function rotateNow() {
        insertedSinceRotate = 0;
        const entries = getRequests();
        let bytes = 0; let keepFrom = entries.length;
        for (let index = entries.length - 1; index >= 0; index--) {
            bytes += entries[index].row.sizeBytes || 0;
            const count = entries.length - index;
            if (bytes <= maxTotalBytes || count <= minRows) keepFrom = index; else break;
        }
        if (keepFrom > 0) {
            // Copy the kept tail of the file as bytes instead of re-serializing rows.
            const start = entries[keepFrom]?.offset ?? fs.statSync(requestsFile).size;
            atomicWriteFileChunks(root, 'requests.jsonl', write => {
                const fd = fs.openSync(requestsFile, 'r'); const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
                try { for (let read, position = start; (read = fs.readSync(fd, buffer, 0, buffer.length, position)) > 0; position += read) write(buffer.subarray(0, read)); }
                finally { fs.closeSync(fd); }
            });
            requests = entries.slice(keepFrom).map(entry => ({ ...entry, offset: entry.offset - start }));
        }
    }

    function addRequestLogBatch(entries) {
        if (!Array.isArray(entries) || !entries.length) return 0;
        const rows = entries.slice(-MAX_BATCH_SIZE).filter(entry => entry && typeof entry === 'object' && typeof entry.url === 'string').map(entry => ({ id: state.nextId++, ...normalizeEntry(entry) }));
        if (!rows.length) return 0;
        const requestCache = getRequests();
        const usageRows = rows.filter(row => row.category === 'llm').map(toUsageRow);
        const usageCache = getUsage();
        const spans = appendJsonl(requestsFile, rows); rows.forEach((row, index) => requestCache.push({ row: withoutBodies(row), ...spans[index] }));
        appendJsonl(usageFile, usageRows); usageCache.push(...usageRows);
        saveState(); insertedSinceRotate += rows.length;
        if (insertedSinceRotate >= rotateEvery) rotateNow();
        return rows.length;
    }

    function matches(row, query = {}) {
        if (query.categories?.length && !query.categories.includes(row.category)) return false;
        if (query.sources?.length && !query.sources.includes(row.source)) return false;
        if (query.models?.length && !query.models.includes(row.model)) return false;
        if (query.chatId && row.chatId !== String(query.chatId)) return false;
        if (query.sessionChatId && row.sessionChatId !== String(query.sessionChatId)) return false;
        if (query.successOnly && !row.success) return false;
        if (query.failedOnly && row.success) return false;
        if (typeof query.since === 'number' && row.timestamp < query.since) return false;
        if (typeof query.until === 'number' && row.timestamp > query.until) return false;
        return true;
    }

    function queryRequestLogs(query = {}) {
        const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);
        return getRequests().filter(({ row }) => matches(row, query) && !(typeof query.beforeId === 'number' && row.id >= query.beforeId)).sort((a, b) => b.row.id - a.row.id).slice(0, limit)
            .map(entry => query.withBodies ? readFullRow(entry) : { ...entry.row });
    }

    const countRequestLogs = (query = {}) => getRequests().filter(({ row }) => matches(row, query)).length;
    const getRequestLog = id => { const entry = getRequests().find(({ row }) => row.id === id); return entry ? readFullRow(entry) : null; };
    function clearRequestLogs() { requests = []; rewrite('requests.jsonl', []); insertedSinceRotate = 0; }

    function queryUsage(query = {}) {
        const rows = getUsage().filter(row => matches(row, query));
        const group = (keyFn, decorate) => {
            const groups = new Map();
            for (const row of rows) { const key = keyFn(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
            return [...groups.entries()].map(([key, values]) => ({ ...decorate(key, values[0]), ...summarize(values) }));
        };
        const daily = group(row => dayKey(row.timestamp), day => ({ day })).sort((a, b) => a.day.localeCompare(b.day));
        const byModel = group(row => `${row.model ?? ''}\u0000${row.provider ?? ''}`, (_key, row) => ({ model: row.model, provider: row.provider })).sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens));
        const bySource = group(row => row.source, source => ({ source })).sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens));
        return { total: summarize(rows), daily, byModel, bySource };
    }

    function usageDimensions() {
        const rows = getUsage(); const distinct = key => [...new Set(rows.map(row => row[key]).filter(value => value != null))].sort();
        return { models: distinct('model'), categories: distinct('category'), sources: distinct('source') };
    }
    function clearUsage() { usage = []; rewrite('usage.jsonl', []); }
    function storageStats() { const rows = getRequests(); return { requestCount: rows.length, requestBytes: rows.reduce((n, { row }) => n + (row.sizeBytes || 0), 0), usageCount: getUsage().length, maxTotalBytes }; }

    function registerRoutes(app, { auth, activeSession } = {}) {
        const guard = auth ?? (async () => true); const sessionGuard = activeSession ?? (() => true);
        app.post('/api/request-logs', async (req, res, next) => { if (!await guard(req, res)) return; try { res.send({ success: true, written: addRequestLogBatch(Array.isArray(req.body) ? req.body : [req.body]) }); } catch (error) { next(error); } });
        app.get('/api/request-logs', async (req, res, next) => { if (!await guard(req, res)) return; try { const filter = { categories: parseCsv(req.query.categories), sources: parseCsv(req.query.sources), chatId: req.query.chat_id, sessionChatId: req.query.session_chat_id, successOnly: req.query.success === '1', failedOnly: req.query.failed === '1', since: parseNum(req.query.since), until: parseNum(req.query.until) }; res.send({ success: true, content: queryRequestLogs({ ...filter, beforeId: parseNum(req.query.before_id), limit: parseNum(req.query.limit), withBodies: req.query.bodies === '1' }), total: countRequestLogs(filter) }); } catch (error) { next(error); } });
        app.get('/api/request-logs/usage', async (req, res, next) => { if (!await guard(req, res)) return; try { res.send({ success: true, ...queryUsage({ categories: parseCsv(req.query.categories), sources: parseCsv(req.query.sources), models: parseCsv(req.query.models), since: parseNum(req.query.since), until: parseNum(req.query.until), successOnly: req.query.success === '1' }), dimensions: usageDimensions() }); } catch (error) { next(error); } });
        app.get('/api/request-logs/stats', async (req, res, next) => { if (!await guard(req, res)) return; try { res.send({ success: true, ...storageStats() }); } catch (error) { next(error); } });
        app.get('/api/request-logs/:id', async (req, res, next) => { if (!await guard(req, res)) return; try { const entry = getRequestLog(Number(req.params.id)); if (!entry) return res.status(404).send({ error: 'not found' }); res.send({ success: true, content: entry }); } catch (error) { next(error); } });
        app.delete('/api/request-logs', async (req, res, next) => { if (!await guard(req, res) || !sessionGuard(req, res)) return; try { clearRequestLogs(); if (req.query.usage === '1') clearUsage(); res.send({ success: true }); } catch (error) { next(error); } });
    }

    try { rotateNow(); } catch {}
    return { addRequestLogBatch, queryRequestLogs, countRequestLogs, getRequestLog, clearRequestLogs, queryUsage, usageDimensions, clearUsage, storageStats, rotateNow, registerRoutes, close: () => {} };
}

module.exports = { createRequestLogs, CATEGORIES, SOURCES, ROUTES, MAX_BODY_BYTES, MAX_TOTAL_BYTES, MIN_ROWS, truncateBody, truncateTail, dayKey };
