// Applies the selected app skin to the document and manages the installed list.
// The default skin is "no skin": no style element and no data attribute.

import { get } from 'svelte/store'
import { language } from 'src/lang'
import { getDatabase } from '../storage/database.svelte'
import { downloadFile } from '../globalApi.svelte'
import { BufferToText, selectSingleFile } from '../util'
import { alertConfirm, notifyError, notifySuccess } from '../alert'
import { SafeModeStore } from '../stores.svelte'
import { compileAppSkinCss, validateAppSkin, type AppSkin } from './appSkin'

export const APP_SKIN_STYLE_ID = 'risu-app-skin'
let lastReportedBrokenSkin = ''

/** Safe mode, or `?safeskin=1` in the address, starts with the default skin. */
export function isAppSkinSuppressed() {
    if (get(SafeModeStore)) return true
    try {
        return new URLSearchParams(globalThis.location?.search ?? '').has('safeskin')
    } catch {
        return false
    }
}

function clearAppliedSkin() {
    document.getElementById(APP_SKIN_STYLE_ID)?.remove()
    delete document.documentElement.dataset.risuSkin
}

export function applyAppSkin(db = getDatabase()) {
    if (typeof document === 'undefined') return
    const id = db.appSkinId ?? ''
    const stored = id && !isAppSkinSuppressed() ? db.appSkins?.find((skin) => skin?.id === id) : undefined
    if (!stored) {
        clearAppliedSkin()
        return
    }
    const result = validateAppSkin(stored)
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
}

export function selectAppSkin(id: string) {
    const db = getDatabase()
    db.appSkinId = id
    applyAppSkin(db)
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
    const skin = result.skin
    const db = getDatabase()
    const skins = [...(db.appSkins ?? [])]
    const existing = skins.findIndex((entry) => entry.id === skin.id)
    if (existing >= 0) {
        if (!await alertConfirm(language.appSkin.replaceConfirm.replace('{}', skins[existing].name))) return null
        skins[existing] = skin
    } else {
        skins.push(skin)
    }
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

export function exportAppSkin(id: string) {
    const skin = getDatabase().appSkins?.find((entry) => entry.id === id)
    if (skin) downloadFile(`${skin.id}.risuskin`, JSON.stringify(skin, null, 2))
}

export async function removeAppSkin(id: string) {
    const db = getDatabase()
    const skin = db.appSkins?.find((entry) => entry.id === id)
    if (!skin || !await alertConfirm(language.appSkin.removeConfirm.replace('{}', skin.name))) return
    db.appSkins = (db.appSkins ?? []).filter((entry) => entry.id !== id)
    if (db.appSkinId === id) db.appSkinId = ''
    applyAppSkin(db)
}
