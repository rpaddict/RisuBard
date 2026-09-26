'use strict';

const { isDeepStrictEqual } = require('node:util');
const { normalizeJSON } = require('./utils.cjs');

function defaultScheduleTask(task) {
    const handle = setImmediate(() => { void task(); });
    handle.unref?.();
}

function createProjectionShadow(options = {}) {
    const repository = options.repository;
    const observation = options.observation;
    const scheduleTask = options.scheduleTask || defaultScheduleTask;
    const isPersisting = options.isPersisting || (() => false);
    const now = options.now || (() => performance.now());
    let pending = null;
    let scheduled = false;
    let lastMatchAt = -Infinity;

    function record(row) {
        try { observation?.record(row); } catch {}
    }
    function compared(match) {
        lastMatchAt = match ? now() : -Infinity;
        try { options.onComparison?.(match); } catch {}
    }

    async function run() {
        scheduled = false;
        const candidate = pending;
        pending = null;
        if (!candidate) return;
        if (isPersisting()) {
            record({
                kind: 'projection-shadow',
                trigger: candidate.trigger,
                outcome: 'skipped',
                errorStage: 'persist-active',
                plannedFiles: candidate.plannedFiles,
            });
            return;
        }

        const startedAt = now();
        if (candidate.allowSampling && ['chat-debounce', 'patch-debounce', 'canonical-flush'].includes(candidate.trigger)
            && options.canSkip?.() === true && startedAt - lastMatchAt < (options.minIntervalMs || 0)) {
            record({ kind: 'projection-shadow', trigger: candidate.trigger, outcome: 'skipped',
                errorStage: 'sample-interval', plannedFiles: candidate.plannedFiles });
            return;
        }
        try {
            const projected = repository.exportLegacyDatabase();
            const semanticMatch = isDeepStrictEqual(projected, normalizeJSON(candidate.database));
            compared(semanticMatch);
            record({
                kind: 'projection-shadow',
                trigger: candidate.trigger,
                outcome: semanticMatch ? 'success' : 'mismatch',
                errorStage: semanticMatch ? undefined : 'semantic-compare',
                durationMs: Math.max(0, Math.round((now() - startedAt) * 1000) / 1000),
                plannedFiles: candidate.plannedFiles,
                semanticMatch,
            });
        } catch (error) {
            compared(false);
            record({
                kind: 'projection-shadow',
                trigger: candidate.trigger,
                outcome: 'failure',
                errorStage: 'projection-read',
                errorName: String(error?.name || 'Error'),
                durationMs: Math.max(0, Math.round((now() - startedAt) * 1000) / 1000),
                plannedFiles: candidate.plannedFiles,
            });
        }
    }

    function schedule(candidate) {
        try {
            pending = {
                database: candidate.database,
                allowSampling: candidate.allowSampling !== false,
                trigger: String(candidate.trigger || 'unspecified'),
                plannedFiles: Number.isFinite(candidate.plannedFiles) && candidate.plannedFiles >= 0
                    ? candidate.plannedFiles
                    : 0,
            };
            if (!scheduled) {
                scheduled = true;
                scheduleTask(run);
            }
            return true;
        } catch (error) {
            pending = null;
            scheduled = false;
            record({
                kind: 'projection-shadow',
                trigger: String(candidate?.trigger || 'unspecified'),
                outcome: 'failure',
                errorStage: 'schedule',
                errorName: String(error?.name || 'Error'),
            });
            return false;
        }
    }

    return { schedule };
}

module.exports = { createProjectionShadow };
