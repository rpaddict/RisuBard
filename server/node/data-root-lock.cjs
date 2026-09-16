'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCK_DIRECTORY_NAME = '.risubard-server.lock';
const OWNER_FILE_NAME = 'owner.json';
const INCOMPLETE_LOCK_GRACE_MS = 5000;

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error?.code !== 'ESRCH';
    }
}

function readOwner(lockPath) {
    try {
        const raw = fs.readFileSync(path.join(lockPath, OWNER_FILE_NAME), 'utf8');
        const owner = JSON.parse(raw);
        if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0) return null;
        return owner;
    } catch {
        return null;
    }
}

function createInUseError(dataRoot, owner) {
    const ownerDescription = owner?.pid ? ` (PID ${owner.pid})` : '';
    const error = new Error(
        `DATA_ROOT_IN_USE: Another RisuBard server${ownerDescription} is already using ${dataRoot}`,
    );
    error.code = 'DATA_ROOT_IN_USE';
    error.dataRoot = dataRoot;
    error.owner = owner || null;
    return error;
}

function quarantineStaleLock(lockPath) {
    const quarantinePath = `${lockPath}.stale-${process.pid}-${crypto.randomUUID()}`;
    try {
        fs.renameSync(lockPath, quarantinePath);
    } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
    fs.rmSync(quarantinePath, { recursive: true, force: true });
    return true;
}

function acquireDataRootLock(dataRoot) {
    const resolvedDataRoot = path.resolve(dataRoot);
    const lockPath = path.join(resolvedDataRoot, LOCK_DIRECTORY_NAME);
    const token = crypto.randomUUID();
    const owner = {
        pid: process.pid,
        token,
        startedAt: new Date().toISOString(),
    };

    fs.mkdirSync(resolvedDataRoot, { recursive: true });

    while (true) {
        try {
            fs.mkdirSync(lockPath);
            try {
                fs.writeFileSync(
                    path.join(lockPath, OWNER_FILE_NAME),
                    `${JSON.stringify(owner, null, 2)}\n`,
                    { encoding: 'utf8', flag: 'wx' },
                );
            } catch (error) {
                fs.rmSync(lockPath, { recursive: true, force: true });
                throw error;
            }
            break;
        } catch (error) {
            if (error?.code !== 'EEXIST') throw error;

            const existingOwner = readOwner(lockPath);
            if (existingOwner && isProcessAlive(existingOwner.pid)) {
                throw createInUseError(resolvedDataRoot, existingOwner);
            }

            if (!existingOwner) {
                try {
                    const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
                    if (ageMs < INCOMPLETE_LOCK_GRACE_MS) {
                        throw createInUseError(resolvedDataRoot, null);
                    }
                } catch (statError) {
                    if (statError?.code === 'ENOENT') continue;
                    throw statError;
                }
            }

            quarantineStaleLock(lockPath);
        }
    }

    let released = false;
    const signalHandlers = new Map();
    const release = () => {
        if (released) return;
        released = true;
        process.removeListener('exit', release);
        for (const [signal, handler] of signalHandlers) {
            process.removeListener(signal, handler);
        }

        const currentOwner = readOwner(lockPath);
        if (currentOwner?.token !== token) return;
        fs.rmSync(lockPath, { recursive: true, force: true });
    };

    for (const signal of ['SIGINT', 'SIGTERM']) {
        const handler = () => {
            release();
            process.kill(process.pid, signal);
        };
        signalHandlers.set(signal, handler);
        process.once(signal, handler);
    }

    process.once('exit', release);
    return { lockPath, owner, release };
}

module.exports = {
    LOCK_DIRECTORY_NAME,
    acquireDataRootLock,
};
