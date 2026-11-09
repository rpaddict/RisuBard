'use strict';

function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function addAssetReference(value, references) {
    if (typeof value !== 'string') return;
    const normalized = value.replace(/\\/g, '/');
    let found = false;
    for (const match of normalized.matchAll(/(?:^|[^A-Za-z0-9_:/.-])(assets\/[^\s"'<>\\)\],}]+)(?=$|[\s"'<>\\)\],}])/g)) {
        const basename = match[1].split('/').pop();
        if (basename) references.add(basename);
        found = true;
    }
    if (!found && normalized.startsWith('assets/')) {
        const basename = normalized.split('/').pop();
        if (basename) references.add(basename);
    }
}

function collectNestedAssetReferences(value, references = new Set()) {
    const seen = new WeakSet();
    const pending = [value];
    while (pending.length > 0) {
        const current = pending.pop();
        if (typeof current === 'string') {
            addAssetReference(current, references);
            continue;
        }
        if (!current || typeof current !== 'object' || seen.has(current)) continue;
        seen.add(current);
        if (Array.isArray(current)) {
            pending.push(...current);
            continue;
        }
        if (current instanceof Map) {
            for (const [key, value] of current) pending.push(key, value);
            continue;
        }
        if (current instanceof Set) {
            pending.push(...current);
            continue;
        }
        for (const key of Object.keys(current)) {
            try { pending.push(current[key]); } catch {}
        }
    }
    return references;
}

function collectDatabaseAssetReferences(database, options = {}) {
    const references = new Set();
    const data = asRecord(database);
    if (!data) return references;
    const includeModuleAssets = options.includeModuleAssets !== false;
    const add = value => addAssetReference(value, references);
    const addModule = value => {
        const module = asRecord(value);
        if (!module) return;
        add(module.icon);
        if (includeModuleAssets) {
            for (const asset of Array.isArray(module.assets) ? module.assets : []) {
                add(Array.isArray(asset) ? asset[1] : undefined);
            }
        }
    };
    const addPersona = value => {
        const persona = asRecord(value);
        if (!persona) return;
        add(persona.image);
        add(persona.icon);
        addModule(persona.embeddedModule);
    };

    add(data.customBackground);
    add(data.userIcon);
    add(data.messageSound);
    add(data.translateSound);
    for (const sound of Array.isArray(data.customSounds) ? data.customSounds : []) add(asRecord(sound)?.path);
    add(data.uiSoundClickSound);
    add(data.uiSoundHoverSound);
    for (const sound of Array.isArray(data.customUiSounds) ? data.customUiSounds : []) add(asRecord(sound)?.path);

    for (const value of Array.isArray(data.characters) ? data.characters : []) {
        const character = asRecord(value);
        if (!character) continue;
        add(character.image);
        for (const image of Array.isArray(character.emotionImages) ? character.emotionImages : []) add(Array.isArray(image) ? image[1] : undefined);
        for (const asset of Array.isArray(character.additionalAssets) ? character.additionalAssets : []) add(Array.isArray(asset) ? asset[1] : undefined);
        const files = asRecord(asRecord(character.vits)?.files);
        if (files) for (const file of Object.values(files)) add(file);
        for (const asset of Array.isArray(character.ccAssets) ? character.ccAssets : []) add(asRecord(asset)?.uri);
        add(asRecord(asRecord(character.gptSoVitsConfig)?.ref_audio_data)?.assetId);
        for (const persona of Array.isArray(character.personas) ? character.personas : []) addPersona(persona);
    }
    for (const module of Array.isArray(data.modules) ? data.modules : []) addModule(module);
    for (const persona of Array.isArray(data.personas) ? data.personas : []) addPersona(persona);
    for (const item of Array.isArray(data.characterOrder) ? data.characterOrder : []) add(asRecord(item)?.imgFile);

    const nai = asRecord(data.NAIImgConfig);
    add(nai?.character_image);
    add(nai?.image);
    add(asRecord(data.wavespeedImage)?.reference_image);
    collectNestedAssetReferences(data.pluginCustomStorage, references);
    return references;
}

function findUnreferencedAssets(entries, referencedBasenames) {
    return entries.filter(entry => {
        if (!entry?.key?.startsWith('assets/')) return false;
        const basename = entry.key.replace(/\\/g, '/').split('/').pop() ?? '';
        return !referencedBasenames.has(basename);
    });
}

function collectHypaSummaryTexts(chatStore) {
    const summaries = [];
    if (!(chatStore instanceof Map)) return summaries;
    for (const chats of chatStore.values()) {
        if (!(chats instanceof Map)) continue;
        for (const chat of chats.values()) {
            for (const summary of chat?.hypaV3Data?.summaries ?? []) {
                if (typeof summary?.text === 'string' && summary.text.trim()) summaries.push(summary.text);
            }
        }
    }
    return summaries;
}

function findUnusedHypaVectors(entries, summaryTexts) {
    return entries.filter(entry => {
        const content = entry?.payload?.value?.content;
        if (typeof content !== 'string' || !content) return true;
        return !summaryTexts.some(summary => summary === content || summary.includes(content));
    });
}

module.exports = {
    collectDatabaseAssetReferences,
    collectNestedAssetReferences,
    collectHypaSummaryTexts,
    findUnreferencedAssets,
    findUnusedHypaVectors,
};
