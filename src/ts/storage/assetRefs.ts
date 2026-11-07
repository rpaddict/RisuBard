type RecordValue = Record<string, unknown>

function asRecord(value: unknown): RecordValue | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as RecordValue
        : null
}

function addAssetReference(value: unknown, refs: Set<string>) {
    if (typeof value !== 'string') return
    const path = value.replace(/\\/g, '/')
    let found = false
    for (const match of path.matchAll(/(?:^|[^A-Za-z0-9_:/.-])(assets\/[^\s"'<>\\)\],}]+)(?=$|[\s"'<>\\)\],}])/g)) {
        refs.add(match[1])
        found = true
    }
    if (!found && path.startsWith('assets/')) refs.add(path)
}

export function collectNestedAssetReferences(value: unknown, refs = new Set<string>()): Set<string> {
    const seen = new WeakSet<object>()
    const pending: unknown[] = [value]

    while (pending.length > 0) {
        const current = pending.pop()
        if (typeof current === 'string') {
            addAssetReference(current, refs)
            continue
        }
        if (!current || typeof current !== 'object' || seen.has(current)) continue
        seen.add(current)

        if (Array.isArray(current)) {
            for (const item of current) pending.push(item)
            continue
        }
        for (const key of Object.keys(current)) {
            try {
                pending.push((current as RecordValue)[key])
            } catch {
                // Plugin storage can contain hostile accessors; skip only that value.
            }
        }
    }
    return refs
}

export function collectDatabaseAssetReferences(db: unknown): Set<string> {
    const refs = new Set<string>()
    const data = asRecord(db)
    if (!data) return refs
    const add = (value: unknown) => addAssetReference(value, refs)
    const addModuleAssets = (value: unknown) => {
        const module = asRecord(value)
        if (!module) return
        for (const asset of Array.isArray(module.assets) ? module.assets : []) add(Array.isArray(asset) ? asset[1] : undefined)
        add(module.icon)
    }
    const addPersonaAssets = (value: unknown) => {
        const persona = asRecord(value)
        if (!persona) return
        add(persona.image)
        add(persona.icon)
        addModuleAssets(persona.embeddedModule)
    }

    add(data.customBackground)
    // Legacy personas used this global fallback before persona records had icons.
    add(data.userIcon)
    add(data.messageSound)
    add(data.translateSound)

    for (const sound of Array.isArray(data.customSounds) ? data.customSounds : []) {
        add(asRecord(sound)?.path)
    }
    for (const character of Array.isArray(data.characters) ? data.characters : []) {
        const char = asRecord(character)
        if (!char) continue
        add(char.image)
        for (const image of Array.isArray(char.emotionImages) ? char.emotionImages : []) add(Array.isArray(image) ? image[1] : undefined)
        for (const asset of Array.isArray(char.additionalAssets) ? char.additionalAssets : []) add(Array.isArray(asset) ? asset[1] : undefined)
        const vits = asRecord(char.vits)
        const files = asRecord(vits?.files)
        if (files) for (const value of Object.values(files)) add(value)
        for (const asset of Array.isArray(char.ccAssets) ? char.ccAssets : []) add(asRecord(asset)?.uri)
        add(asRecord(asRecord(char.gptSoVitsConfig)?.ref_audio_data)?.assetId)
        for (const persona of Array.isArray(char.personas) ? char.personas : []) addPersonaAssets(persona)
    }
    for (const module of Array.isArray(data.modules) ? data.modules : []) {
        addModuleAssets(module)
    }
    for (const persona of Array.isArray(data.personas) ? data.personas : []) {
        addPersonaAssets(persona)
    }
    for (const item of Array.isArray(data.characterOrder) ? data.characterOrder : []) add(asRecord(item)?.imgFile)
    // Fonts embedded in installed app skins live in asset storage.
    for (const skin of Array.isArray(data.appSkins) ? data.appSkins : []) {
        const fonts = asRecord(skin)?.fonts
        for (const font of Array.isArray(fonts) ? fonts : []) add(asRecord(font)?.asset)
    }

    const nai = asRecord(data.NAIImgConfig)
    add(nai?.character_image)
    add(nai?.image)
    add(asRecord(data.wavespeedImage)?.reference_image)
    collectNestedAssetReferences(data.pluginCustomStorage, refs)
    return refs
}

export function isAutoAssetCleanupEnabled(db: unknown): boolean {
    return asRecord(db)?.nodeOnlyAutoCleanAssets === true
}

export function canDeleteAssetsAfterPluginStorageScan(
    autoCleanAssets: boolean,
    pluginStorageScanSucceeded: boolean,
): boolean {
    return autoCleanAssets && pluginStorageScanSucceeded
}

export function shouldDeleteUnreferencedAsset(
    storageKey: string,
    autoCleanAssets: boolean,
    referencedBasenames: ReadonlySet<string>,
): boolean {
    if (!autoCleanAssets || !storageKey.startsWith('assets/')) return false
    const basename = storageKey.replace(/\\/g, '/').split('/').pop() ?? ''
    return !referencedBasenames.has(basename)
}
