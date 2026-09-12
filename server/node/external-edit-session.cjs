'use strict';

function createExternalEditSession(options = {}) {
    const flush = options.flush;
    const getRevision = options.getRevision;
    const adopt = options.adopt;
    if (typeof flush !== 'function' || typeof getRevision !== 'function' || typeof adopt !== 'function') {
        throw new Error('External edit session requires flush, revision, and adoption handlers');
    }

    let active = false;
    let baselineRevision = null;

    function status() {
        return { active, baselineRevision };
    }

    async function start() {
        if (active) return status();
        await flush();
        baselineRevision = getRevision() || null;
        active = true;
        return status();
    }

    async function finish() {
        const adopted = await adopt();
        const revision = adopted?.revision || getRevision() || null;
        active = false;
        baselineRevision = null;
        return { active: false, adopted: Boolean(adopted), revision };
    }

    return {
        finish,
        isActive: () => active,
        start,
        status,
    };
}

module.exports = { createExternalEditSession };
