'use strict';

const crypto = require('crypto');
const path = require('path');

function createCanonicalProjectionSync(options = {}) {
    const repository = options.repository;
    const readAcceptedRevision = options.readAcceptedRevision;
    const writeAcceptedRevision = options.writeAcceptedRevision;
    if (!repository || typeof repository.getProjectionRevision !== 'function'
        || typeof repository.reconcileCanonicalProjection !== 'function') {
        throw new Error('Canonical projection repository is required');
    }
    if (typeof readAcceptedRevision !== 'function' || typeof writeAcceptedRevision !== 'function') {
        throw new Error('Canonical projection revision storage is required');
    }

    // `checkedRevision`: the revision checkExternalChanges() just scanned in
    // the same synchronous step, reused instead of scanning every file again.
    function loadExternalChanges(checkedRevision) {
        const revision = checkedRevision === undefined ? repository.getProjectionRevision() : checkedRevision;
        if (!revision || revision === readAcceptedRevision()) return null;
        // Files edited by hand while the app was closed have stale checksums.
        // Validate and adopt them like the retired live file monitor did.
        const reconciled = repository.reconcileCanonicalProjection({ externalEditing: true });
        return {
            revision: reconciled.revision,
            database: reconciled.database,
            sidebarWritten: reconciled.sidebarWritten,
        };
    }

    // Fingerprints of the files the app last accepted, so a review can list
    // every changed file, including rewrites that also refreshed the checksum.
    let acceptedFiles = null;
    const fingerprints = () => typeof repository.getProjectionFingerprints === 'function'
        ? repository.getProjectionFingerprints() : null;

    // Also returns the scanned revision for loadExternalChanges().
    function checkExternalChanges() {
        if (!acceptedFiles) {
            const state = fingerprints();
            if (state) {
                const unchanged = Boolean(state.revision) && state.revision === readAcceptedRevision();
                if (unchanged) acceptedFiles = state.files;
                return { changed: Boolean(state.revision) && !unchanged, revision: state.revision };
            }
        }
        const revision = repository.getProjectionRevision();
        return { changed: Boolean(revision && revision !== readAcceptedRevision()), revision };
    }

    function hasExternalChanges() {
        return checkExternalChanges().changed;
    }

    // Files added, removed or rewritten since the last accepted revision; null
    // when no baseline was recorded (the review then compares contents instead).
    function changedFiles() {
        const state = acceptedFiles && fingerprints();
        if (!state) return null;
        const changed = [];
        for (const [file, fingerprint] of Object.entries(state.files)) {
            if (!(file in acceptedFiles)) changed.push({ path: file, status: 'added' });
            else if (acceptedFiles[file] !== fingerprint) changed.push({ path: file, status: 'changed' });
        }
        for (const file of Object.keys(acceptedFiles)) {
            if (!(file in state.files)) changed.push({ path: file, status: 'removed' });
        }
        return changed.sort((a, b) => a.path.localeCompare(b.path));
    }

    function accept(revision) {
        const state = revision === undefined ? fingerprints() : null;
        if (revision === undefined) revision = state ? state.revision : repository.getProjectionRevision();
        if (!revision) return null;
        writeAcceptedRevision(revision);
        acceptedFiles = state && state.revision === revision ? state.files : null;
        return revision;
    }

    // One save's view of the files: their fingerprints when it began and the
    // files it wrote. A file another program changes meanwhile is neither
    // replaced by the save nor accepted with it, so the review still lists it.
    function beginSave() {
        const before = typeof repository.getFileFingerprint === 'function' ? fingerprints() : null;
        const dataRoot = path.resolve(repository.dataRoot || '.');
        const written = new Map();
        const trees = [];
        const relative = (root, target) => path.resolve(root) === dataRoot
            ? path.relative(dataRoot, target).split(path.sep).join('/') : null;
        const insideTree = file => trees.some(tree => file === tree || file.startsWith(`${tree}/`));
        const revision = before ? before.revision : repository.getProjectionRevision();
        const acceptedRevision = readAcceptedRevision();
        if (!acceptedFiles && before && revision && revision === acceptedRevision) acceptedFiles = before.files;
        return {
            revision,
            // Same answer as hasExternalChanges() at the start of the save.
            externalChanges: Boolean(revision && revision !== acceptedRevision),
            wrote(root, target) {
                const file = relative(root, target);
                if (before && file) written.set(file, repository.getFileFingerprint(file));
            },
            cleared(root, target) {
                const file = relative(root, target);
                if (file) trees.push(file);
            },
            unchanged(root, target) {
                const file = relative(root, target);
                if (!before || !file || insideTree(file)) return true;
                const expected = written.has(file) ? written.get(file) : before.files[file];
                return expected === undefined || repository.getFileFingerprint(file) === expected;
            },
            // Accepts the save's own writes. Returns the accepted revision, or
            // null when another program's change was left for review.
            settle() {
                const after = before && fingerprints();
                if (!after) return accept();
                const merged = {};
                let external = false;
                for (const file of new Set([...Object.keys(before.files), ...Object.keys(after.files)])) {
                    const was = before.files[file];
                    const now = after.files[file];
                    const own = now === was || insideTree(file)
                        || (written.has(file) && written.get(file) === (now ?? null));
                    if (!own) external = true;
                    const kept = own ? now : was;
                    if (kept !== undefined) merged[file] = kept;
                }
                if (!external) {
                    writeAcceptedRevision(after.revision);
                    acceptedFiles = after.files;
                    return after.revision;
                }
                // A record no real revision can match keeps the change pending.
                writeAcceptedRevision(crypto.createHash('sha256').update(`partial\0${after.revision}`).digest('hex'));
                acceptedFiles = merged;
                return null;
            },
        };
    }

    return { accept, beginSave, changedFiles, checkExternalChanges, hasExternalChanges, loadExternalChanges };
}

module.exports = { createCanonicalProjectionSync };
