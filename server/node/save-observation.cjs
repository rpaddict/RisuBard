'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const STRING_FIELDS = new Set([
    'kind', 'trigger', 'outcome', 'operationId', 'errorStage', 'errorCode', 'errorName',
]);
const NUMBER_FIELDS = new Set([
    'durationMs', 'decodeMs', 'ensureChatStoreMs', 'reassembleMs', 'integrityCheckMs', 'encodeMs',
    'kvWriteMs', 'canonicalSyncMs', 'refreshMs', 'databaseBytes', 'characterCount',
    'chatCount', 'messageCount', 'plannedFiles', 'publishedFiles', 'skippedFiles',
    'stagedBytes', 'overlappingPersists', 'queuedOperations',
]);
const BOOLEAN_FIELDS = new Set(['sameAsPreviousPersist']);
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function createSaveObservation(options = {}) {
    const dataRoot = path.resolve(options.dataRoot || path.join(process.cwd(), 'save'));
    const logRoot = path.join(dataRoot, 'logs');
    const logFile = path.join(logRoot, 'storage-observation.jsonl');
    const previousLogFile = path.join(logRoot, 'storage-observation.previous.jsonl');
    const maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
        ? options.maxBytes
        : DEFAULT_MAX_BYTES;
    const sessionId = String(options.sessionId || crypto.randomUUID()).slice(0, 128);
    const now = options.now || Date.now;
    let pending = Promise.resolve();

    function normalize(input) {
        const row = { schemaVersion: 1, timestamp: now(), sessionId };
        for (const [key, value] of Object.entries(input || {})) {
            if (STRING_FIELDS.has(key) && typeof value === 'string') row[key] = value.slice(0, 128);
            else if (NUMBER_FIELDS.has(key) && Number.isFinite(value) && value >= 0) row[key] = value;
            else if (BOOLEAN_FIELDS.has(key) && typeof value === 'boolean') row[key] = value;
        }
        return row;
    }

    function record(input) {
        const line = `${JSON.stringify(normalize(input))}\n`;
        pending = pending.then(async () => {
            await fs.mkdir(logRoot, { recursive: true });
            let currentBytes = 0;
            try { currentBytes = (await fs.stat(logFile)).size; }
            catch (error) { if (error?.code !== 'ENOENT') throw error; }
            if (currentBytes > 0 && currentBytes + Buffer.byteLength(line, 'utf8') > maxBytes) {
                await fs.rm(previousLogFile, { force: true });
                await fs.rename(logFile, previousLogFile);
            }
            await fs.appendFile(logFile, line, { encoding: 'utf8', mode: 0o600 });
        }).catch(() => {});
    }

    return { record, flush: () => pending };
}

module.exports = { createSaveObservation };
