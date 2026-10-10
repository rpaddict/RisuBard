'use strict';

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

    function loadExternalChanges() {
        const revision = repository.getProjectionRevision();
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

    function hasExternalChanges() {
        const revision = repository.getProjectionRevision();
        return Boolean(revision && revision !== readAcceptedRevision());
    }

    function accept(revision = repository.getProjectionRevision()) {
        if (!revision) return null;
        writeAcceptedRevision(revision);
        return revision;
    }

    return { accept, hasExternalChanges, loadExternalChanges };
}

module.exports = { createCanonicalProjectionSync };
