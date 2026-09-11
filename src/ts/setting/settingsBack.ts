const handlers: Array<() => boolean> = []

export function registerSettingsBack(handler: () => boolean) {
    handlers.push(handler)
    return () => {
        const index = handlers.indexOf(handler)
        if (index >= 0) handlers.splice(index, 1)
    }
}

export function goBackInSettings() {
    for (const handler of [...handlers].reverse()) {
        if (handler()) return true
    }
    return false
}
