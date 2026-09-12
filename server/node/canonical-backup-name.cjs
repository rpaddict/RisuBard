'use strict';

const LEGACY_CANONICAL_BACKUP_PREFIX = 'risubard-data/';
const FLAT_CANONICAL_BACKUP_PREFIX = 'risubard-canonical-v1_';

function encodeCanonicalBackupName(portablePath) {
    return `${FLAT_CANONICAL_BACKUP_PREFIX}${Buffer.from(portablePath, 'utf8').toString('base64url')}`;
}

function decodeCanonicalBackupName(name) {
    if (name.startsWith(LEGACY_CANONICAL_BACKUP_PREFIX)) {
        return name.slice(LEGACY_CANONICAL_BACKUP_PREFIX.length);
    }
    if (!name.startsWith(FLAT_CANONICAL_BACKUP_PREFIX)) return null;
    const encoded = name.slice(FLAT_CANONICAL_BACKUP_PREFIX.length);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
    try {
        const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
        return Buffer.from(decoded, 'utf8').toString('base64url') === encoded ? decoded : null;
    } catch {
        return null;
    }
}

module.exports = {
    encodeCanonicalBackupName,
    decodeCanonicalBackupName,
};
