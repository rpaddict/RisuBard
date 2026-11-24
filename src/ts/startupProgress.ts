import { ChecksumMismatchError, type ChecksumMismatch } from './storage/checksumMismatch'

interface StartupProgress {
    text: string
    error: string
    /** Set when a file's checksum blocks startup, so the screen can offer a fix. */
    checksumMismatch?: ChecksumMismatch | null
}

export async function advanceStartupStage(state: StartupProgress, label: string): Promise<void> {
    state.text = label
    state.error = ''
    if ('checksumMismatch' in state) state.checksumMismatch = null
    // Let Svelte flush and the browser paint before synchronous decoding/setup.
    await new Promise<void>(resolve => setTimeout(resolve, 0))
}

export function failStartupStage(state: StartupProgress, error: unknown): void {
    state.error = error instanceof Error ? error.message : String(error)
    const mismatch = error instanceof ChecksumMismatchError ? error.mismatch : null
    if (mismatch || 'checksumMismatch' in state) state.checksumMismatch = mismatch
}
