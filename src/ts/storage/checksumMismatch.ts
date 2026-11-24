/** A canonical file whose `.sha256` sidecar no longer matches its contents. */
export interface ChecksumMismatch {
    /** Absolute path on the server, for the user to find the file. */
    file: string
    /** Path under the data root; null when the startup screen cannot accept it. */
    path: string | null
    /** Checksum recorded in the sidecar; null when the sidecar is missing. */
    expected: string | null
    /** Checksum of the file as it is now. */
    actual: string
}

export class ChecksumMismatchError extends Error {
    constructor(message: string, readonly mismatch: ChecksumMismatch) {
        super(message)
        this.name = 'ChecksumMismatchError'
    }
}

const HASH = /^[a-f0-9]{64}$/i

export function readChecksumMismatch(value: unknown): ChecksumMismatch | null {
    if (!value || typeof value !== 'object') return null
    const raw = (value as Record<string, unknown>).checksumMismatch
    if (!raw || typeof raw !== 'object') return null
    const { file, path, expected, actual } = raw as Record<string, unknown>
    if (typeof file !== 'string' || typeof actual !== 'string' || !HASH.test(actual)) return null
    return {
        file,
        path: typeof path === 'string' && path ? path : null,
        expected: typeof expected === 'string' && expected ? expected : null,
        actual,
    }
}
