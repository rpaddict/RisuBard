/**
 * How a confirmMulti prompt ended, from the alert slot's final message: the
 * chosen action's index, 'cancel' when the user closed it, or 'replaced' when
 * another alert took the one alert slot before the prompt was answered.
 */
export function readConfirmMultiOutcome(raw: unknown): number | 'cancel' | 'replaced' {
    const n = parseInt(String(raw))
    if (!isNaN(n)) return n
    return raw === 'cancel' ? 'cancel' : 'replaced'
}
