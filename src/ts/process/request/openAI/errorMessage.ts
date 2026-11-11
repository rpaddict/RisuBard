// OpenRouter puts the upstream provider's real reason in error.metadata.raw;
// error.message alone is only "Provider returned error".
export function formatOpenAIErrorMessage(error: { message: string; metadata?: unknown }): string {
    const metadata = error.metadata && typeof error.metadata === 'object'
        ? error.metadata as { raw?: unknown; provider_name?: unknown }
        : undefined
    if (!metadata || metadata.raw === undefined || metadata.raw === null) {
        return error.message
    }
    let raw = typeof metadata.raw === 'string' ? metadata.raw : JSON.stringify(metadata.raw)
    if (raw.length > 1000) {
        raw = raw.slice(0, 1000) + '…'
    }
    const provider = typeof metadata.provider_name === 'string' ? ` (${metadata.provider_name})` : ''
    return `${error.message}${provider}: ${raw}`
}
