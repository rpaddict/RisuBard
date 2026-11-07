// Applies the selected app skin to the document and manages the installed list.
// The default skin is "no skin": no style element and no data attribute.

import { get } from 'svelte/store'
import { language } from 'src/lang'
import { getDatabase } from '../storage/database.svelte'
import { downloadFile, loadAsset, saveAsset } from '../globalApi.svelte'
import { BufferToText, selectSingleFile } from '../util'
import { alertConfirm, notifyError, notifySuccess, notifyWarning } from '../alert'
import { SafeModeStore } from '../stores.svelte'
import { compileAppSkinCss, validateAppSkin, type AppSkin, type AppSkinFont } from './appSkin'
import { detectInstalledFont, fontBytesToDataUrl, fontDataUrlToBytes, sniffFontFormat } from './appSkinFonts'

export const APP_SKIN_STYLE_ID = 'risu-app-skin'
let lastReportedBrokenSkin = ''
// Embedded fonts registered for the applied skin, removed when the skin changes.
let loadedFontKey = ''
let loadedFaces: FontFace[] = []

/** Safe mode, or `?safeskin=1` in the address, starts with the default skin. */
export function isAppSkinSuppressed() {
    if (get(SafeModeStore)) return true
    try {
        return new URLSearchParams(globalThis.location?.search ?? '').has('safeskin')
    } catch {
        return false
    }
}

function unloadSkinFonts() {
    for (const face of loadedFaces) document.fonts?.delete(face)
    loadedFaces = []
    loadedFontKey = ''
}

function clearAppliedSkin() {
    document.getElementById(APP_SKIN_STYLE_ID)?.remove()
    delete document.documentElement.dataset.risuSkin
    unloadSkinFonts()
}

/** Registers the skin's embedded fonts with the browser. Missing assets fall back silently to the role stack. */
async function loadSkinFonts(skin: AppSkin) {
    const embedded = (skin.fonts ?? []).filter((font) => font.asset)
    const key = `${skin.id}:${embedded.map((font) => `${font.family}@${font.asset}`).join('|')}`
    if (key === loadedFontKey) return
    unloadSkinFonts()
    loadedFontKey = key
    if (typeof FontFace === 'undefined' || !document.fonts) return
    const faces: FontFace[] = []
    for (const font of embedded) {
        try {
            const bytes = await loadAsset(font.asset!)
            if (!bytes || !sniffFontFormat(bytes)) continue
            // Copy into a plain ArrayBuffer: storage may hand back a view on a shared or larger buffer.
            const face = new FontFace(font.family, new Uint8Array(bytes).buffer, {
                weight: font.weight ?? '100 900',
                style: font.style ?? 'normal',
                display: 'swap',
            })
            await face.load()
            if (loadedFontKey !== key) return
            document.fonts.add(face)
            faces.push(face)
        } catch (error) {
            console.warn('[app skin] font failed to load', font.family, error)
        }
    }
    if (loadedFontKey === key) loadedFaces = faces
    else for (const face of faces) document.fonts.delete(face)
}

/** Declared fonts this device does not have. Embedded fonts and undetectable ones are not counted. */
export function missingSkinFonts(skin: AppSkin): AppSkinFont[] {
    return (skin.fonts ?? []).filter((font) => !font.asset && detectInstalledFont(font.family) === 'missing')
}

const MISSING_FONT_NOTICE_KEY = 'risubard-app-skin-missing-font-notices'

/** Warns once per device for each skin and set of missing fonts. */
function noticeMissingFonts(skin: AppSkin) {
    const missing = missingSkinFonts(skin)
    if (!missing.length) return
    const families = missing.map((font) => font.family)
    const key = `${skin.id}:${[...families].sort().join(',')}`
    let seen: string[] = []
    try {
        seen = JSON.parse(localStorage.getItem(MISSING_FONT_NOTICE_KEY) ?? '[]')
        if (!Array.isArray(seen)) seen = []
    } catch {
        seen = []
    }
    if (seen.includes(key)) return
    try {
        const next = [...seen.filter((entry) => !entry.startsWith(`${skin.id}:`)), key].slice(-30)
        localStorage.setItem(MISSING_FONT_NOTICE_KEY, JSON.stringify(next))
    } catch {
        // Storage can be unavailable; the notice may then repeat, which is harmless.
    }
    notifyWarning(
        language.appSkin.missingFontsNotice.replace('{name}', skin.name).replace('{count}', String(missing.length)),
        { description: `${families.join(', ')}
${language.appSkin.missingFontsWhere}`, source: 'app-skin' },
    )
}

export function applyAppSkin(db = getDatabase()) {
    if (typeof document === 'undefined') return
    const id = db.appSkinId ?? ''
    const stored = id && !isAppSkinSuppressed() ? db.appSkins?.find((skin) => skin?.id === id) : undefined
    if (!stored) {
        clearAppliedSkin()
        return
    }
    const result = validateAppSkin(stored, { stored: true })
    if (!result.ok || !result.skin) {
        clearAppliedSkin()
        if (lastReportedBrokenSkin !== id) {
            lastReportedBrokenSkin = id
            notifyError(`${language.appSkin.brokenSkin} (${result.errors[0] ?? id})`)
        }
        return
    }
    let style = document.getElementById(APP_SKIN_STYLE_ID) as HTMLStyleElement | null
    if (!style) {
        style = document.createElement('style')
        style.id = APP_SKIN_STYLE_ID
        // Head, so the user's custom CSS (appended to body) still comes later.
        document.head.appendChild(style)
    }
    style.textContent = compileAppSkinCss(result.skin)
    document.documentElement.dataset.risuSkin = result.skin.id
    void loadSkinFonts(result.skin)
    noticeMissingFonts(result.skin)
}

export function selectAppSkin(id: string) {
    const db = getDatabase()
    db.appSkinId = id
    applyAppSkin(db)
}

/** Moves embedded font data into asset storage so the saved settings stay small. */
async function storeEmbeddedFonts(fonts: AppSkinFont[] | undefined): Promise<AppSkinFont[] | undefined | null> {
    if (!fonts) return fonts
    const stored: AppSkinFont[] = []
    for (const font of fonts) {
        if (!font.data) {
            stored.push(font)
            continue
        }
        const bytes = fontDataUrlToBytes(font.data)
        const format = sniffFontFormat(bytes)
        if (!format) {
            notifyError(language.appSkin.invalidFontFile.replace('{}', font.family))
            return null
        }
        const { data: _data, ...rest } = font
        stored.push({ ...rest, asset: await saveAsset(bytes, '', `skin-font.${format}`) })
    }
    return stored
}

/** Adds or replaces a skin from JSON text. Returns the stored skin, or null after reporting why. */
export async function installAppSkinFromText(text: string): Promise<AppSkin | null> {
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        notifyError(language.appSkin.invalidJson)
        return null
    }
    const result = validateAppSkin(parsed)
    if (!result.ok || !result.skin) {
        notifyError(`${language.appSkin.invalidSkin}\n${result.errors.slice(0, 5).join('\n')}`)
        return null
    }
    const db = getDatabase()
    const existing = (db.appSkins ?? []).findIndex((entry) => entry.id === result.skin!.id)
    if (existing >= 0 && !await alertConfirm(language.appSkin.replaceConfirm.replace('{}', db.appSkins[existing].name))) return null
    const fonts = await storeEmbeddedFonts(result.skin.fonts)
    if (fonts === null) return null
    const skin: AppSkin = { ...result.skin, ...(fonts ? { fonts } : {}) }
    const skins = [...(db.appSkins ?? [])]
    const index = skins.findIndex((entry) => entry.id === skin.id)
    if (index >= 0) skins[index] = skin
    else skins.push(skin)
    db.appSkins = skins
    if (db.appSkinId === skin.id) applyAppSkin(db)
    notifySuccess(language.appSkin.installed.replace('{}', skin.name))
    return skin
}

export async function importAppSkinFile() {
    const file = await selectSingleFile(['risuskin', 'json'])
    if (!file) return null
    return installAppSkinFromText(BufferToText(file.data))
}

/** Builds the shareable file: installed font assets go back in as embedded data. */
export async function buildAppSkinFile(skin: AppSkin): Promise<AppSkin> {
    if (!skin.fonts?.length) return skin
    const fonts: AppSkinFont[] = []
    for (const font of skin.fonts) {
        const { asset, ...rest } = font
        if (!asset) {
            fonts.push(rest)
            continue
        }
        const bytes = await loadAsset(asset)
        const format = bytes ? sniffFontFormat(bytes) : null
        fonts.push(format ? { ...rest, data: fontBytesToDataUrl(bytes, format) } : rest)
    }
    return { ...skin, fonts }
}

export async function exportAppSkin(id: string) {
    const skin = getDatabase().appSkins?.find((entry) => entry.id === id)
    if (!skin) return
    downloadFile(`${skin.id}.risuskin`, JSON.stringify(await buildAppSkinFile(skin), null, 2))
}

export async function removeAppSkin(id: string) {
    const db = getDatabase()
    const skin = db.appSkins?.find((entry) => entry.id === id)
    if (!skin || !await alertConfirm(language.appSkin.removeConfirm.replace('{}', skin.name))) return
    db.appSkins = (db.appSkins ?? []).filter((entry) => entry.id !== id)
    if (db.appSkinId === id) db.appSkinId = ''
    applyAppSkin(db)
}
