// App skin format, validator, and CSS compiler. Pure: no DOM, no database.
// A skin is tokens (color, font, radius, shadow) plus optional CSS that may
// target only the stable hooks in uiSkinParts.ts. Everything is scoped under
// :root[data-risu-skin="<id>"], so removing the attribute restores the default.

import { uiThemeTokens } from './uiThemeTokens'
import { uiSkinTokenDefinitions } from './uiSkinTokens'
import { UI_SKIN_API_VERSION, uiSkinParts } from './uiSkinParts'

export interface AppSkin {
    skinApi: number
    id: string
    name: string
    description?: string
    /** Bot or work the skin was modeled on, shown to the user. */
    source?: string
    base?: 'dark' | 'light'
    /** Keys are color token names without the --risu-theme- prefix. */
    colors?: Record<string, string>
    /** Chat prose colors: standard, bold, italic, italicBold, quote1, quote2. */
    chatText?: Record<string, string>
    /** Keys are skin token names without the --risu- prefix (radius-md, shadow-lg, font-ui...). */
    tokens?: Record<string, string>
    partsCss?: string
}

export interface AppSkinValidation {
    ok: boolean
    errors: string[]
    warnings: string[]
    skin?: AppSkin
}

export const APP_SKIN_MAX_JSON_BYTES = 512 * 1024
export const APP_SKIN_MAX_PARTS_CSS = 64 * 1024

const baseColorKeys = ['bgcolor', 'darkbg', 'borderc', 'selected', 'draculared', 'textcolor', 'textcolor2', 'darkborderc', 'darkbutton', 'primary', 'accenttext']
export const appSkinColorKeys: ReadonlySet<string> = new Set([...baseColorKeys, ...uiThemeTokens.map(({ token }) => token)])
export const appSkinTokenKeys: ReadonlySet<string> = new Set(uiSkinTokenDefinitions.map(({ token }) => token))
const chatTextVariables: Record<string, string> = {
    standard: '--FontColorStandard',
    bold: '--FontColorBold',
    italic: '--FontColorItalic',
    italicBold: '--FontColorItalicBold',
    quote1: '--FontColorQuote1',
    quote2: '--FontColorQuote2',
}
const knownParts: ReadonlySet<string> = new Set(uiSkinParts.map(({ part }) => part))
const knownTopLevel = new Set(['skinApi', 'id', 'name', 'description', 'source', 'base', 'colors', 'chatText', 'tokens', 'partsCss'])

const skinIdPattern = /^[a-z0-9][a-z0-9-]{0,47}$/
// Color values: hex, functional notations, and theme variables. The character
// allowlist keeps a value from closing its declaration or rule.
const colorValuePattern = /^[#a-zA-Z0-9(),.%\s/-]{1,200}$/
const tokenValuePattern = /^[^;{}<>\\]{1,400}$/
const forbiddenValue = /expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:|@import/i
const allowedAtRules = new Set(['media', 'supports', 'keyframes'])
const allowedAttributes = /^(?:data-skin-(?:part|state|role|variant)|aria-[a-z]+|disabled|open|checked|data-state)$/
const allowedPseudoClasses = new Set([
    'hover', 'focus', 'focus-visible', 'focus-within', 'active', 'disabled', 'enabled', 'checked',
    'first-child', 'last-child', 'only-child', 'first-of-type', 'last-of-type', 'nth-child', 'nth-of-type',
    'nth-last-child', 'empty', 'placeholder-shown', 'not', 'is', 'where', 'has',
])
const allowedPseudoElements = new Set(['before', 'after', 'placeholder', 'selection', 'marker', 'first-line', 'first-letter'])
const selectorListPseudo = new Set(['not', 'is', 'where', 'has'])

function bytes(text: string) {
    return new TextEncoder().encode(text).length
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function urlsAreDataImages(value: string) {
    const urls = [...value.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)]
    const bareUrlCount = (value.match(/url\(/gi) ?? []).length
    if (urls.length !== bareUrlCount) return false
    return urls.every((match) => /^data:image\/(?:png|jpeg|webp|gif|svg\+xml|avif)[;,]/i.test(match[2]))
}

/** Split on a separator at depth 0, ignoring parentheses, brackets and quotes. */
function splitTopLevel(text: string, separator: string): string[] {
    const parts: string[] = []
    let depth = 0
    let quote = ''
    let start = 0
    for (let i = 0; i < text.length; i++) {
        const char = text[i]
        if (quote) {
            if (char === '\\') i++
            else if (char === quote) quote = ''
            continue
        }
        if (char === '"' || char === "'") quote = char
        else if (char === '(' || char === '[') depth++
        else if (char === ')' || char === ']') depth--
        else if (char === separator && depth === 0) {
            parts.push(text.slice(start, i))
            start = i + 1
        }
    }
    parts.push(text.slice(start))
    return parts
}

function findMatching(text: string, open: number): number {
    let depth = 0
    let quote = ''
    for (let i = open; i < text.length; i++) {
        const char = text[i]
        if (quote) {
            if (char === '\\') i++
            else if (char === quote) quote = ''
            continue
        }
        if (char === '"' || char === "'") quote = char
        else if (char === '{') depth++
        else if (char === '}') {
            depth--
            if (depth === 0) return i
        }
    }
    return -1
}

/** Validates one selector list. Returns errors; requireHook demands a data-skin-part per complex selector. */
function validateSelectorList(list: string, requireHook: boolean, errors: string[]) {
    for (const raw of splitTopLevel(list, ',')) {
        const selector = raw.trim()
        if (!selector) {
            errors.push('빈 선택자가 있습니다.')
            continue
        }
        let hasHook = false
        let i = 0
        while (i < selector.length) {
            const rest = selector.slice(i)
            let match: RegExpMatchArray | null
            if ((match = rest.match(/^\s*[>+~]\s*|^\s+/))) {
                i += match[0].length
            } else if ((match = rest.match(/^\*/)) || (match = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/))) {
                i += match[0].length
            } else if ((match = rest.match(/^\[\s*([a-zA-Z-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([a-zA-Z0-9_-]+)))?\s*\]/))) {
                const attribute = match[1]
                if (!allowedAttributes.test(attribute)) {
                    errors.push(`허용되지 않은 속성 선택자입니다: [${attribute}]`)
                    return
                }
                if (attribute === 'data-skin-part') {
                    const value = match[3] ?? match[4] ?? match[5]
                    if (match[2] === '=' && value !== undefined && !knownParts.has(value)) {
                        errors.push(`등록되지 않은 스킨 부품입니다: ${value}`)
                        return
                    }
                    hasHook = true
                }
                i += match[0].length
            } else if ((match = rest.match(/^::([a-zA-Z-]+)/))) {
                if (!allowedPseudoElements.has(match[1])) {
                    errors.push(`허용되지 않은 가상 요소입니다: ::${match[1]}`)
                    return
                }
                i += match[0].length
            } else if ((match = rest.match(/^:([a-zA-Z-]+)/))) {
                const name = match[1]
                if (!allowedPseudoClasses.has(name)) {
                    errors.push(`허용되지 않은 가상 클래스입니다: :${name}`)
                    return
                }
                i += match[0].length
                if (selector[i] === '(') {
                    let depth = 0
                    let end = i
                    for (; end < selector.length; end++) {
                        if (selector[end] === '(') depth++
                        else if (selector[end] === ')' && --depth === 0) break
                    }
                    const inner = selector.slice(i + 1, end)
                    if (selectorListPseudo.has(name)) {
                        const before = errors.length
                        validateSelectorList(inner, false, errors)
                        if (errors.length > before) return
                        if (name !== 'not' && /data-skin-part/.test(inner)) hasHook = true
                    } else if (!/^[\s0-9n+\-a-z]*$/i.test(inner)) {
                        errors.push(`잘못된 :${name}() 인자입니다.`)
                        return
                    }
                    i = end + 1
                }
            } else {
                errors.push(`스킨 CSS는 클래스나 id 대신 data-skin-part 훅만 겨눌 수 있습니다: ${selector}`)
                return
            }
        }
        if (requireHook && !hasHook) {
            errors.push(`선택자마다 data-skin-part 훅이 하나 이상 있어야 합니다: ${selector}`)
        }
    }
}

function validateDeclarations(body: string, errors: string[], decorationOnly = false) {
    for (const raw of splitTopLevel(body, ';')) {
        const declaration = raw.trim()
        if (!declaration) continue
        const colon = declaration.indexOf(':')
        if (colon < 1) {
            errors.push(`잘못된 선언입니다: ${declaration}`)
            continue
        }
        const property = declaration.slice(0, colon).trim().toLowerCase()
        const value = declaration.slice(colon + 1).trim().replace(/\s*!important$/i, '').toLowerCase()
        if (!/^(?:--[a-z0-9-]+|-?[a-z][a-z0-9-]*)$/.test(property)) {
            errors.push(`잘못된 속성 이름입니다: ${property}`)
            continue
        }
        if (forbiddenValue.test(value) || !urlsAreDataImages(value)) {
            errors.push(`허용되지 않은 값입니다(외부 주소나 스크립트): ${property}`)
            continue
        }
        if (property === 'position' && value === 'fixed') errors.push('position: fixed는 쓸 수 없습니다.')
        // Hiding is allowed only on generated decoration (::before/::after), never on app parts.
        if (!decorationOnly && ((property === 'display' && value === 'none') || (property === 'visibility' && /^(?:hidden|collapse)$/.test(value)) || (property === 'opacity' && /^0*(?:\.0+)?%?$/.test(value)))) {
            errors.push(`앱 부품을 숨기는 선언은 쓸 수 없습니다: ${property}: ${value}`)
        }
    }
}

function validateCssBlock(css: string, errors: string[], inKeyframes = false) {
    let i = 0
    while (i < css.length) {
        const open = css.indexOf('{', i)
        const prelude = (open < 0 ? css.slice(i) : css.slice(i, open)).trim()
        if (open < 0) {
            if (prelude) errors.push(`블록 없이 끝난 CSS가 있습니다: ${prelude.slice(0, 60)}`)
            return
        }
        const close = findMatching(css, open)
        if (close < 0) {
            errors.push('중괄호가 맞지 않습니다.')
            return
        }
        const body = css.slice(open + 1, close)
        if (inKeyframes) {
            if (!/^(?:from|to|\d{1,3}(?:\.\d+)?%)(?:\s*,\s*(?:from|to|\d{1,3}(?:\.\d+)?%))*$/.test(prelude)) {
                errors.push(`잘못된 키프레임 선택자입니다: ${prelude}`)
            }
            validateDeclarations(body, errors)
        } else if (prelude.startsWith('@')) {
            const name = prelude.slice(1).split(/[\s(]/)[0].toLowerCase()
            if (!allowedAtRules.has(name)) {
                errors.push(`허용되지 않은 @규칙입니다: @${name}`)
            } else if (name === 'keyframes') {
                if (!/^@keyframes\s+[a-zA-Z][\w-]*$/.test(prelude)) errors.push(`잘못된 @keyframes 이름입니다: ${prelude}`)
                validateCssBlock(body, errors, true)
            } else {
                if (/[{};]|url\(/i.test(prelude)) errors.push(`잘못된 @${name} 조건입니다.`)
                validateCssBlock(body, errors)
            }
        } else {
            validateSelectorList(prelude, true, errors)
            const decorationOnly = splitTopLevel(prelude, ',').every((selector) => /::(?:before|after)\s*$/.test(selector.trim()))
            if (body.includes('{')) errors.push(`중첩 규칙은 쓸 수 없습니다: ${prelude}`)
            else validateDeclarations(body, errors, decorationOnly)
        }
        i = close + 1
    }
}

export function stripCssComments(css: string) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

export function validateSkinCss(css: string): string[] {
    const errors: string[] = []
    if (/<|\\/.test(css)) errors.push('스킨 CSS에 < 또는 \\ 문자는 쓸 수 없습니다.')
    if (bytes(css) > APP_SKIN_MAX_PARTS_CSS) errors.push('스킨 CSS가 64KB를 넘습니다.')
    if (errors.length) return errors
    validateCssBlock(stripCssComments(css), errors)
    return errors
}

export function validateAppSkin(input: unknown): AppSkinValidation {
    const errors: string[] = []
    const warnings: string[] = []
    if (!isPlainRecord(input)) return { ok: false, errors: ['스킨 형식이 아닙니다(JSON 객체가 필요합니다).'], warnings }
    if (bytes(JSON.stringify(input)) > APP_SKIN_MAX_JSON_BYTES) errors.push('스킨 파일이 512KB를 넘습니다.')

    if (input.skinApi !== UI_SKIN_API_VERSION) {
        errors.push(`지원하지 않는 스킨 버전입니다(skinApi ${String(input.skinApi)}, 지원 ${UI_SKIN_API_VERSION}).`)
    }
    if (typeof input.id !== 'string' || !skinIdPattern.test(input.id)) {
        errors.push('id는 영문 소문자, 숫자, 하이픈으로 된 48자 이하여야 합니다.')
    }
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) {
        errors.push('name은 1~80자 문자열이어야 합니다.')
    }
    for (const key of ['description', 'source'] as const) {
        if (input[key] !== undefined && (typeof input[key] !== 'string' || (input[key] as string).length > 500)) {
            errors.push(`${key}는 500자 이하 문자열이어야 합니다.`)
        }
    }
    if (input.base !== undefined && input.base !== 'dark' && input.base !== 'light') errors.push('base는 dark 또는 light여야 합니다.')
    for (const key of Object.keys(input)) {
        if (!knownTopLevel.has(key)) warnings.push(`알 수 없는 항목은 무시합니다: ${key}`)
    }

    const checkMap = (field: 'colors' | 'chatText' | 'tokens', keys: ReadonlySet<string>, pattern: RegExp) => {
        const value = input[field]
        if (value === undefined) return
        if (!isPlainRecord(value)) {
            errors.push(`${field}는 객체여야 합니다.`)
            return
        }
        for (const [key, entry] of Object.entries(value)) {
            if (!keys.has(key)) {
                errors.push(`${field}에 알 수 없는 이름이 있습니다: ${key}`)
            } else if (
                typeof entry !== 'string' || !pattern.test(entry) || forbiddenValue.test(entry) || !urlsAreDataImages(entry)
                || (entry.match(/"/g) ?? []).length % 2 !== 0 || (entry.match(/'/g) ?? []).length % 2 !== 0
            ) {
                errors.push(`${field}.${key} 값이 올바르지 않습니다.`)
            }
        }
    }
    checkMap('colors', appSkinColorKeys, colorValuePattern)
    checkMap('chatText', new Set(Object.keys(chatTextVariables)), colorValuePattern)
    checkMap('tokens', appSkinTokenKeys, tokenValuePattern)

    if (input.partsCss !== undefined) {
        if (typeof input.partsCss !== 'string') errors.push('partsCss는 문자열이어야 합니다.')
        else errors.push(...validateSkinCss(input.partsCss))
    }

    if (errors.length) return { ok: false, errors, warnings }
    const skin: AppSkin = {
        skinApi: input.skinApi as number,
        id: input.id as string,
        name: (input.name as string).trim(),
        ...(input.description !== undefined ? { description: input.description as string } : {}),
        ...(input.source !== undefined ? { source: input.source as string } : {}),
        ...(input.base !== undefined ? { base: input.base as 'dark' | 'light' } : {}),
        ...(input.colors !== undefined ? { colors: { ...(input.colors as Record<string, string>) } } : {}),
        ...(input.chatText !== undefined ? { chatText: { ...(input.chatText as Record<string, string>) } } : {}),
        ...(input.tokens !== undefined ? { tokens: { ...(input.tokens as Record<string, string>) } } : {}),
        ...(input.partsCss !== undefined ? { partsCss: input.partsCss as string } : {}),
    }
    return { ok: true, errors, warnings, skin }
}

function scopeSelectorList(list: string, scope: string) {
    return splitTopLevel(list, ',').map((selector) => `${scope} ${selector.trim()}`).join(', ')
}

function scopeCss(css: string, scope: string, inKeyframes = false): string {
    let out = ''
    let i = 0
    while (i < css.length) {
        const open = css.indexOf('{', i)
        if (open < 0) break
        const close = findMatching(css, open)
        const prelude = css.slice(i, open).trim()
        const body = css.slice(open + 1, close)
        if (inKeyframes || /^@keyframes\b/.test(prelude)) {
            out += `${prelude}{${body}}\n`
        } else if (prelude.startsWith('@')) {
            out += `${prelude}{\n${scopeCss(body, scope)}}\n`
        } else {
            out += `${scopeSelectorList(prelude, scope)}{${body.trim()}}\n`
        }
        i = close + 1
    }
    return out
}

export function appSkinScope(id: string) {
    return `:root[data-risu-skin="${id}"]`
}

/** Compiles a validated skin. Token overrides use !important so they beat the
 * inline values the color scheme writes on :root; the scope keeps them inert
 * until the root carries the skin's data attribute. */
export function compileAppSkinCss(skin: AppSkin): string {
    const scope = appSkinScope(skin.id)
    const declarations: string[] = []
    if (skin.base) declarations.push(`color-scheme: ${skin.base} !important;`)
    for (const [key, value] of Object.entries(skin.colors ?? {})) declarations.push(`--risu-theme-${key}: ${value} !important;`)
    for (const [key, value] of Object.entries(skin.chatText ?? {})) declarations.push(`${chatTextVariables[key]}: ${value} !important;`)
    for (const [key, value] of Object.entries(skin.tokens ?? {})) declarations.push(`--risu-${key}: ${value} !important;`)
    let css = declarations.length ? `${scope}{\n  ${declarations.join('\n  ')}\n}\n` : ''
    if (skin.partsCss) css += scopeCss(stripCssComments(skin.partsCss), scope)
    return css
}
