// Skins that ship with the app. They are never stored in the database and cannot be removed.
// An installed skin with the same id takes precedence over the built-in one.
// To add one, drop its .risuskin file here as <id>.json (no embedded fonts) and list it below.

import type { AppSkin } from '../appSkin'
import heroComic from './hero-comic.json'
import heroComicRounded from './hero-comic-rounded.json'
import rounded from './rounded.json'
import steelTactical from './steel-tactical.json'

export const BUILTIN_APP_SKINS: readonly AppSkin[] = [rounded, heroComic, heroComicRounded, steelTactical] as AppSkin[]

export function isBuiltinAppSkinId(id: string) {
    return BUILTIN_APP_SKINS.some((skin) => skin.id === id)
}
