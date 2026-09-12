'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

async function stageBackupEntries(dataSource, options) {
    const {
        stagingDir,
        maxBytes = 0,
        totalBytes = 0,
        maxNameBytes = 64 * 1024,
        onProgress = null,
        onStaged = null,
        onEntry,
    } = options;
    if (typeof onEntry !== 'function') throw new Error('Backup entry handler is required');

    await fs.mkdir(stagingDir, { recursive: true });
    let bytesReceived = 0;
    let entriesCompleted = 0;
    let header = Buffer.alloc(0);
    let headerTarget = 4;
    let current = null;
    const stagedEntries = [];

    async function finishEntry() {
        const finished = current;
        current = null;
        await finished.handle.sync();
        await finished.handle.close();
        stagedEntries.push({
            name: finished.name,
            sourcePath: finished.sourcePath,
            size: finished.size,
        });
        entriesCompleted += 1;
    }

    try {
        for await (const rawChunk of dataSource) {
            const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
            bytesReceived += chunk.length;
            if (maxBytes > 0 && bytesReceived > maxBytes) {
                throw new Error(`Backup exceeds max allowed size (${maxBytes} bytes)`);
            }
            if (onProgress) onProgress(bytesReceived, totalBytes);

            let offset = 0;
            while (offset < chunk.length) {
                if (!current) {
                    const take = Math.min(headerTarget - header.length, chunk.length - offset);
                    if (take > 0) {
                        header = Buffer.concat([header, chunk.subarray(offset, offset + take)]);
                        offset += take;
                    }
                    if (header.length < headerTarget) continue;

                    if (headerTarget === 4) {
                        const nameLength = header.readUInt32LE(0);
                        if (nameLength === 0 || nameLength > maxNameBytes) {
                            throw new Error(`Invalid backup entry name length: ${nameLength}`);
                        }
                        headerTarget = 8 + nameLength;
                        continue;
                    }

                    const nameLength = header.readUInt32LE(0);
                    const name = header.subarray(4, 4 + nameLength).toString('utf8');
                    const size = header.readUInt32LE(4 + nameLength);
                    const sourcePath = path.join(stagingDir, `${entriesCompleted}-${crypto.randomUUID()}.entry`);
                    const handle = await fs.open(sourcePath, 'wx', 0o600);
                    current = { name, sourcePath, size, remaining: size, handle };
                    header = Buffer.alloc(0);
                    headerTarget = 4;
                    if (size === 0) await finishEntry();
                    continue;
                }

                const take = Math.min(current.remaining, chunk.length - offset);
                if (take > 0) {
                    await current.handle.write(chunk.subarray(offset, offset + take));
                    current.remaining -= take;
                    offset += take;
                }
                if (current.remaining === 0) await finishEntry();
            }
        }

        if (current || header.length > 0) {
            throw new Error('Backup stream ended with incomplete entry');
        }
        if (onStaged) await onStaged({ bytesReceived, entriesCompleted });
        for (const entry of stagedEntries) {
            await onEntry(entry);
        }
        return { bytesReceived, entriesCompleted };
    } catch (error) {
        if (current) {
            await current.handle.close().catch(() => {});
            await fs.rm(current.sourcePath, { force: true }).catch(() => {});
        }
        throw error;
    }
}

module.exports = { stageBackupEntries };
