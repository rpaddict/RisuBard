// Font helpers for app skins: file sniffing, data URL conversion, and
// detection of locally installed fonts. No database access.

export type SkinFontFormat = 'woff2' | 'woff' | 'ttf' | 'otf'

const mimeByFormat: Record<SkinFontFormat, string> = {
    woff2: 'font/woff2',
    woff: 'font/woff',
    ttf: 'font/ttf',
    otf: 'font/otf',
}

/** Identifies a font file by its signature, so a renamed image or script is rejected. */
export function sniffFontFormat(bytes: Uint8Array): SkinFontFormat | null {
    if (bytes.length < 4) return null
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
    if (tag === 'wOF2') return 'woff2'
    if (tag === 'wOFF') return 'woff'
    if (tag === 'OTTO') return 'otf'
    if (tag === 'true' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) return 'ttf'
    return null
}

export function fontDataUrlToBytes(dataUrl: string): Uint8Array {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

export function fontBytesToDataUrl(bytes: Uint8Array, format: SkinFontFormat): string {
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return `data:${mimeByFormat[format]};base64,${btoa(binary)}`
}

export type FontAvailability = 'installed' | 'missing' | 'unknown'

const probeText = 'mmmmmmmmmmlli WwQq 0123 한글가나다'

function measure(context: CanvasRenderingContext2D, font: string) {
    context.font = font
    return context.measureText(probeText).width
}

const availabilityCache = new Map<string, FontAvailability>()

/** Cached per session: a font installed while the app is open shows up after a reload. */
export function detectInstalledFont(family: string): FontAvailability {
    const cached = availabilityCache.get(family)
    if (cached) return cached
    const result = measureInstalledFont(family)
    availabilityCache.set(family, result)
    return result
}

/**
 * Checks whether a font family renders differently from the generic families,
 * which means the system has it. Browsers that hide installed fonts for privacy
 * make every font look missing; a set of common system fonts detects that case.
 */
function measureInstalledFont(family: string): FontAvailability {
    if (typeof document === 'undefined') return 'unknown'
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return 'unknown'
    const differs = (name: string) => ['monospace', 'serif', 'sans-serif'].some((generic) =>
        measure(context, `72px "${name}", ${generic}`) !== measure(context, `72px ${generic}`))
    if (differs(family)) return 'installed'
    const controls = ['Arial', 'Times New Roman', 'Malgun Gothic', 'Apple SD Gothic Neo', 'Helvetica', 'Noto Sans KR', 'DejaVu Sans', 'Roboto']
    return controls.some(differs) ? 'missing' : 'unknown'
}
