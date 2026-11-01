import {
    normalizeArcaChatFontSizePx,
    normalizeArcaChatShowTitleImage,
} from './arcaChatSaverSettings'
import type { ArcaClipboardColors } from './arcaExport'

export type ArcaLogRange =
    | { mode: 'all' }
    | { mode: 'page'; start: number; end: number; pageSize: number }
    | { mode: 'turn'; start: number; end: number }

export interface ArcaLogSelectableMessage {
    data?: string
    role?: 'user' | 'char'
    sourceIndex?: number
    disabled?: boolean | 'allBefore'
    isComment?: boolean
}

export interface ArcaLogSelectionOptions {
    includeUserMessages?: boolean
}

export interface ArcaLogSelection<T> {
    number: number
    message: T
}

export interface ArcaLogSelectionSummary {
    characters: number
    images: number
}

export interface ArcaLogRenderedMessage {
    number: number
    role: 'user' | 'char'
    displayName: string
    badge?: string
    iconDataUrl?: string
    bodyHtml: string
    plainText: string
}

export interface ArcaLogClipboardHtmlOptions {
    title: string
    messages: readonly ArcaLogRenderedMessage[]
    fontSizePx?: number
    showTitleImage?: boolean
    colors?: Partial<ArcaClipboardColors>
}

const DEFAULT_COLORS: ArcaClipboardColors = {
    background: '#292d3e',
    panel: '#202331',
    text: '#f7f8fc',
    mutedText: '#aeb6cc',
    border: '#454b61',
}

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
}

export function selectArcaLogMessages<T extends ArcaLogSelectableMessage>(
    messages: readonly T[],
    range: ArcaLogRange,
    options: ArcaLogSelectionOptions = {},
): ArcaLogSelection<T>[] {
    const active = messages
        .map((message, sourceOrder) => ({ message, sourceOrder }))
        .filter(({ message }) => isSelectableArcaLogMessage(message))
        .map(({ message, sourceOrder }, index) => ({ number: index + 1, message, sourceOrder }))
    if (active.length === 0) return []

    let selected = active
    if (range.mode === 'page') {
        const pageSize = Math.max(1, Math.trunc(range.pageSize) || 1)
        const maxSourceIndex = Math.max(0, ...active.map(({ message, sourceOrder }) =>
            Number.isFinite(message.sourceIndex) ? message.sourceIndex! : sourceOrder))
        const pageCount = Math.max(1, Math.ceil((maxSourceIndex + 1) / pageSize))
        const [start, end] = normalizeArcaLogBounds(range.start, range.end, pageCount)
        selected = active.filter(({ message, sourceOrder }) => {
            const sourceIndex = Number.isFinite(message.sourceIndex) ? message.sourceIndex! : sourceOrder
            const page = sourceIndex < 0 ? 1 : Math.floor(sourceIndex / pageSize) + 1
            return page >= start && page <= end
        })
    }
    else if (range.mode === 'turn') {
        let turn = 0
        const turns = active.map((entry, index) => {
            if (turn === 0 || (index > 0 && entry.message.role === 'user')) turn += 1
            return { ...entry, turn }
        })
        const [start, end] = normalizeArcaLogBounds(range.start, range.end, Math.max(1, turn))
        selected = turns.filter(entry => entry.turn >= start && entry.turn <= end)
    }

    return selected
        .filter(({ message }) => options.includeUserMessages !== false || message.role !== 'user')
        .map(({ number, message }) => ({ number, message }))
}

function isSelectableArcaLogMessage(message: ArcaLogSelectableMessage): boolean {
    if (message.disabled || message.isComment) return false
    if (typeof message.data !== 'string') return true
    const data = message.data.trim()
    return data !== '' && data !== '{{none}}' && data !== '{{blank}}'
}

function normalizeArcaLogBounds(startValue: number, endValue: number, maximum: number): [number, number] {
    const clamp = (value: number) => Math.min(maximum, Math.max(1, Math.trunc(value) || 1))
    const first = clamp(startValue)
    const last = clamp(endValue)
    return [Math.min(first, last), Math.max(first, last)]
}

export function getArcaLogTurnCount(messages: readonly ArcaLogSelectableMessage[]): number {
    let turns = 0
    messages.filter(isSelectableArcaLogMessage).forEach((message, index) => {
        if (turns === 0 || (index > 0 && message.role === 'user')) turns += 1
    })
    return turns
}

export function summarizeArcaLogMessages(
    messages: readonly ArcaLogSelectableMessage[],
): ArcaLogSelectionSummary {
    let characters = 0
    let images = 0
    for (const message of messages) {
        const data = message.data ?? ''
        const htmlImages = data.match(/<img\b[^>]*>/gi) ?? []
        const markdownImages = data.match(/!\[[^\]]*\]\([^)]*\)/g) ?? []
        images += htmlImages.length + markdownImages.length
        const visible = data
            .replace(/<img\b[^>]*>/gi, '')
            .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
            .replace(/<[^>]*>/g, '')
            .replace(/[\u180E\u200B-\u200D\u2060\uFEFF]/g, '')
        characters += Array.from(visible).length
    }
    return { characters, images }
}

// Raw text for the target-range list, shown before anything is rendered.
export function excerptArcaLogMessage(data: string | undefined, maxLength: number): string {
    const text = (data ?? '')
        .replace(/<img\b[^>]*>/gi, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/(\*{1,3}|_{2,3})(?=\S)([^*_\n]+?)\1/g, '$2')
        .replace(/[᠎​-‍⁠﻿]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    const characters = Array.from(text)
    return characters.length > maxLength ? `${characters.slice(0, maxLength).join('')}…` : text
}

export function hasVisibleArcaLogContent(root: HTMLElement): boolean {
    const visibleText = (root.textContent ?? '')
        .replace(/[\u180E\u200B-\u200D\u2060\uFEFF]/g, '')
        .trim()
    if (visibleText) return true
    return Boolean(root.querySelector('img,picture,video,audio,canvas,svg,table,hr'))
}

export function buildArcaLogClipboardHtml(options: ArcaLogClipboardHtmlOptions): string {
    const colors = { ...DEFAULT_COLORS, ...options.colors }
    const fontSizePx = normalizeArcaChatFontSizePx(options.fontSizePx)
    const showTitleImage = normalizeArcaChatShowTitleImage(options.showTitleImage)
    const title = escapeHtml(options.title)

    const messageHtml = options.messages.map((message) => {
        const name = escapeHtml(message.displayName)
        const badge = message.badge ? escapeHtml(message.badge) : ''
        const icon = showTitleImage && message.iconDataUrl
            ? `<img src="${escapeHtml(message.iconDataUrl)}" alt="" style="display:block;width:48px;height:48px;max-width:48px;object-fit:cover;border:1px solid ${colors.border};border-radius:12px;">`
            : ''
        const badgeHtml = badge
            ? `<span style="display:inline-block;margin-left:8px;padding:2px 8px;color:${colors.mutedText};background:${colors.background};border:1px solid ${colors.border};border-radius:999px;font-size:11px;line-height:1.4;vertical-align:middle;">${badge}</span>`
            : ''

        return `<section style="margin:0 0 14px 0;overflow:hidden;background:${colors.background};border:1px solid ${colors.border};border-radius:12px;">
<table style="width:100%;border-collapse:collapse;background:${colors.panel};"><tbody><tr>
${icon ? `<td style="width:64px;padding:12px 0 12px 14px;vertical-align:middle;">${icon}</td>` : ''}
<td style="padding:12px 14px;vertical-align:middle;">
<span style="display:inline-block;min-width:24px;margin-right:8px;color:${colors.mutedText};font-size:11px;font-variant-numeric:tabular-nums;">${String(message.number).padStart(2, '0')}</span>
<strong style="color:${colors.text};font-size:15px;font-weight:650;">${name}</strong>${badgeHtml}
</td>
</tr></tbody></table>
<div style="padding:16px 18px;color:${colors.text};">${message.bodyHtml}</div>
</section>`
    }).join('\n')

    return `<p><br></p>
<div style="margin:1rem 0;color:${colors.text};background:${colors.background};border:1px solid ${colors.border};border-radius:16px;font-family:'Segoe UI',Roboto,Arial,sans-serif;font-size:${fontSizePx}px;line-height:1.6;">
<div style="padding:22px;">
<header style="margin:0 0 20px 0;padding:0 0 16px 0;border-bottom:1px solid ${colors.border};">
<span style="display:block;margin-bottom:5px;color:${colors.mutedText};font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">RisuBard Chat Log</span>
<h2 style="margin:0;color:${colors.text};font-size:24px;font-weight:700;line-height:1.3;">${title}</h2>
<span style="display:block;margin-top:6px;color:${colors.mutedText};font-size:12px;">${options.messages.length} messages</span>
</header>
${messageHtml}
<footer style="margin-top:18px;padding-top:14px;border-top:1px solid ${colors.border};text-align:center;">
<span style="color:${colors.mutedText};font-size:11px;">From RisuBard</span>
</footer>
</div>
</div>
<p><br></p>`
}

export function buildArcaLogPlainText(
    title: string,
    messages: readonly ArcaLogRenderedMessage[],
): string {
    const bodies = messages.map((message) => {
        const badge = message.badge ? ` · ${message.badge}` : ''
        return `${message.number}. ${message.displayName}${badge}\n${message.plainText}`
    })
    return [title, ...bodies].join('\n\n')
}
