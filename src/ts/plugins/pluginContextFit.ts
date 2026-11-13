/** Versioned contract for adding context before the host's native token fitting. */
export const CONTEXT_FIT_CAPABILITIES = Object.freeze({
    version: 1 as const,
    hook: 'beforeContextFit' as const,
    requiredContext: true as const,
    requestState: true as const,
})

export interface ContextFitMessage {
    role: string
    content: string
    removable?: boolean
    requiredContext?: boolean
}

export type ContextFitReplacer<Message extends ContextFitMessage> = (
    messages: Message[], type: string, request?: { requestId: string },
) => Message[] | Promise<Message[]>

export function registerContextFitReplacer<Message extends ContextFitMessage>(
    callbacks: Set<ContextFitReplacer<Message>>, callback: ContextFitReplacer<Message>,
): () => void {
    callbacks.add(callback)
    return () => { callbacks.delete(callback) }
}

const requests = new Map<string, AbortSignal>()

/** Only the in-flight hook receives this opaque request ID; no prompt data is exposed. */
export function getContextFitRequestState(requestId: string): {
    requestId: string, status: 'active' | 'aborted',
} | null {
    const signal = requests.get(requestId)
    return signal ? { requestId, status: signal.aborted ? 'aborted' : 'active' } : null
}

/** Called once for the assembled chat request, before token counts and provider retries. */
export async function runPluginContextFit<Message extends ContextFitMessage>(
    messages: Message[], callbacks: Iterable<ContextFitReplacer<Message>>, signal?: AbortSignal,
): Promise<Message[]> {
    signal?.throwIfAborted()
    const request = signal ? { requestId: crypto.randomUUID() } : undefined
    if (request && signal) requests.set(request.requestId, signal)
    try {
        let result = messages
        for (const callback of [...callbacks]) {
            signal?.throwIfAborted()
            const pending = Promise.resolve(request ? callback(result, 'model', request) : callback(result, 'model'))
            const next = signal ? await untilAborted(pending, signal) : await pending
            signal?.throwIfAborted()
            if (!Array.isArray(next) || next.some(message => !message
                || typeof message.role !== 'string' || typeof message.content !== 'string')) {
                throw new Error('A beforeContextFit plugin returned invalid prompt messages')
            }
            result = next
        }
        return result.map(message => message.requiredContext === true
            ? { ...message, removable: false } : message)
    } finally {
        if (request) requests.delete(request.requestId)
    }
}

function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'))
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
}

export function hasRequiredPluginContext(messages: readonly ContextFitMessage[]): boolean {
    return messages.some(message => message.requiredContext === true)
}

/** Fitting metadata must never become an upstream provider request field. */
export function stripPluginContextFitMarkers<Message extends ContextFitMessage>(messages: readonly Message[]): Message[] {
    return messages.map(message => {
        if (!Object.hasOwn(message, 'requiredContext')) return message
        const { requiredContext: _requiredContext, ...rest } = message
        return rest as Message
    })
}
