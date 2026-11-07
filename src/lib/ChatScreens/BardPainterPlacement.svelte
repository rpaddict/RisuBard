<script lang="ts">
    import { onDestroy, tick, untrack } from 'svelte'
    import { get } from 'svelte/store'
    import { v4 } from 'uuid'
    import { DBState } from 'src/ts/stores.svelte'
    import { resolvePersonaById } from 'src/ts/personaScopes'
    import { painterInsertionRequest } from 'src/ts/bardPainter/selectionState'
    import { getPainterParagraphStops, nearestPainterParagraphStop, type PainterParagraphStop } from 'src/ts/bardPainter/placement'

    let { characterId, chatId }: { characterId: string; chatId: string } = $props()
    let marker = $state<PainterParagraphStop | undefined>()
    /** An image in the message under the pointer; clicking it swaps it for the new illustration. */
    let swap = $state<{ top: number; left: number; width: number; height: number } | undefined>()
    let saving = $state(false), error = $state('')
    function portal(node: HTMLElement) {
        document.body.appendChild(node)
        return { destroy: () => node.remove() }
    }
    onDestroy(() => {
        const request = get(painterInsertionRequest)
        if (request?.characterId === characterId && request.chatId === chatId) painterInsertionRequest.set(null)
    })

    $effect(() => {
        const request = $painterInsertionRequest
        const matches = request?.characterId === characterId && request?.chatId === chatId
        if (!request) return
        if (!matches) { painterInsertionRequest.set(null); return }
        return untrack(() => {
            let disposed = false
            let focused: HTMLElement | undefined, originalTabIndex: string | null = null
            let cache = new WeakMap<HTMLElement, { source: string; stops: PainterParagraphStop[] }>()
            const sizes = new WeakMap<Element, string>()
            const resizeObserver = new ResizeObserver(entries => {
                let changed = false
                for (const entry of entries) {
                    const size = `${entry.contentRect.width}:${entry.contentRect.height}`
                    if (sizes.has(entry.target) && sizes.get(entry.target) !== size) changed = true
                    sizes.set(entry.target, size)
                }
                if (changed) invalidate()
            })
            const previousFocus = document.activeElement as HTMLElement | null
            saving = false; error = ''; marker = undefined
            const current = () => {
                const character = DBState.db.characters.find(item => item.chaId === characterId)
                const chat = character?.chats.find(item => item.id === chatId)
                return { character, chat }
            }
            const position = (root: HTMLElement, clientY?: number, refresh = false, preferredOffset = request.preferredOffset ?? 0) => {
                const { character, chat } = current()
                const message = chat?.message?.[Number(root.dataset.painterMessage)]
                if (!character || !chat || !message || chat.isStreaming) return
                let cached = cache.get(root)
                if (refresh || !cached || cached.source !== message.data) {
                    resizeObserver.observe(root)
                    if (root.parentElement) resizeObserver.observe(root.parentElement)
                    const user = resolvePersonaById(DBState.db, character, chat.bindedPersona)?.persona.name ?? DBState.db.username ?? 'User'
                    const bot = character.nickname || character.name
                    cached = { source: message.data, stops: getPainterParagraphStops(root, message.data, { user, char: bot, bot }) }
                    cache.set(root, cached)
                }
                const stop = clientY === undefined
                    ? cached.stops.filter(item => item.offset !== null).reduce<PainterParagraphStop | undefined>((best, item) => !best || Math.abs(item.offset! - preferredOffset) < Math.abs(best.offset! - preferredOffset) ? item : best, undefined)
                    : nearestPainterParagraphStop(cached.stops, clientY)
                return stop ? { root, message, source: message.data, stop, stops: cached.stops } : undefined
            }
            let candidate: ReturnType<typeof position>
            const cancel = () => {
                if (get(painterInsertionRequest) === request) painterInsertionRequest.set(null)
                if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
            }
            const rootOf = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLElement>('[data-painter-message]') : null
            const imageOf = (event: Event) => {
                if (!request.replace || !(event.target instanceof Element) || event.target.closest('button')) return null
                return event.target.closest('.inlay-image-control')?.querySelector<HTMLImageElement>('img[data-inlay-image-id]')
                    ?? event.target.closest<HTMLImageElement>('img[data-inlay-image-id]')
            }
            const replaceImage = async (root: HTMLElement, image: HTMLImageElement) => {
                if (saving || disposed || !request.replace) return
                const { chat } = current()
                const message = chat?.message?.[Number(root.dataset.painterMessage)]
                const id = image.dataset.inlayImageId!, occurrence = Number(image.dataset.inlayOccurrence)
                // Display scripts can hide or repeat images; replace only when the rendered images match the source.
                const sourceCount = [...(message?.data ?? '').matchAll(/{{(?:inlay|inlayed|inlayeddata)::(.+?)}}/g)].filter(match => match[1] === id).length
                const rendered = [...root.querySelectorAll<HTMLElement>('img[data-inlay-image-id]')].filter(element => element.dataset.inlayImageId === id)
                if (!message?.chatId || !Number.isInteger(occurrence) || sourceCount !== rendered.length) {
                    error = '이 그림의 원문 위치를 확인하지 못했습니다. 다른 그림을 고르거나 문단 사이에 삽입해 주세요.'
                    return
                }
                saving = true; error = ''
                try {
                    const success = await request.replace({ messageId: message.chatId, inlayId: id, occurrence })
                    if (disposed) return
                    if (success) cancel()
                    else error = request.error?.() || '그림을 바꾸지 못했습니다.'
                } catch (cause) { if (!disposed) error = cause instanceof Error ? cause.message : String(cause) }
                finally { if (!disposed) saving = false }
            }
            const move = (event: PointerEvent) => {
                if (saving) return
                const root = rootOf(event)
                const image = root ? imageOf(event) : null
                if (image) {
                    const box = image.getBoundingClientRect()
                    swap = { top: box.top, left: box.left, width: box.width, height: box.height }
                    marker = undefined; candidate = undefined; return
                }
                swap = undefined
                if (!root) { marker = undefined; candidate = undefined; return }
                candidate = position(root, event.clientY)
                marker = candidate?.stop.offset != null ? candidate.stop : undefined
            }
            const insert = async (point: NonNullable<typeof candidate>) => {
                if (saving || disposed) return
                if (point.stop.offset === null || point.message.data !== point.source) {
                    error = '이 문단의 삽입 위치를 확인하지 못했습니다. 다른 문단 사이를 선택해 주세요.'
                    marker = undefined
                    return
                }
                saving = true; error = ''
                point.message.chatId ||= v4()
                try {
                    const success = await request.insert({ characterId, chatId, messageId: point.message.chatId, start: point.stop.offset, end: point.stop.offset, text: '' })
                    if (disposed) return
                    if (success) cancel()
                    else error = request.error?.() || '삽입하지 못했습니다. 위치를 다시 선택해 주세요.'
                } catch (cause) { if (!disposed) error = cause instanceof Error ? cause.message : String(cause) }
                finally { if (!disposed) saving = false }
            }
            let press: { root: HTMLElement; x: number; y: number } | undefined
            const pointerdown = (event: PointerEvent) => {
                const root = rootOf(event)
                press = !saving && root && event.button === 0 ? { root, x: event.clientX, y: event.clientY } : undefined
                if (press) event.preventDefault()
            }
            const click = (event: MouseEvent) => {
                const root = rootOf(event)
                if (!root || event.button !== 0) return
                event.preventDefault(); event.stopImmediatePropagation()
                const started = press; press = undefined
                if (event.detail === 0 || started?.root !== root || Math.hypot(started.x - event.clientX, started.y - event.clientY) > 8) return
                const image = imageOf(event)
                if (image) { void replaceImage(root, image); return }
                const point = position(root, event.clientY, true)
                if (point) { candidate = point; marker = point.stop.offset !== null ? point.stop : undefined; void insert(point) }
                else error = '메시지를 표시한 뒤 다시 위치를 선택해 주세요.'
            }
            const keydown = (event: KeyboardEvent) => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); return }
                if (saving || event.repeat || event.isComposing || !rootOf(event)) return
                if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return
                event.preventDefault(); event.stopImmediatePropagation()
                if (event.key === 'Enter' && !candidate) return
                const root = candidate?.root ?? rootOf(event)!
                const point = position(root, candidate?.stop.top ?? marker?.top, true)
                if (!point) return
                if (event.key === 'Enter') { void insert(point); return }
                const index = point.stops.indexOf(point.stop)
                const stop = point.stops[Math.max(0, Math.min(point.stops.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]
                candidate = { ...point, stop }; marker = stop.offset !== null ? stop : undefined
            }
            const invalidate = () => {
                cache = new WeakMap()
                swap = undefined
                const previous = candidate
                candidate = undefined; marker = undefined
                // scrollIntoView, image loads and dock resizing change client geometry,
                // not the selected source boundary. Keep the line at that boundary.
                if (previous?.root.isConnected && previous.stop.offset !== null) {
                    const updated = position(previous.root, undefined, true, previous.stop.offset)
                    if (updated?.source === previous.source && updated.stop.offset === previous.stop.offset) {
                        candidate = updated; marker = updated.stop
                    }
                }
            }
            const contextmenu = (event: MouseEvent) => {
                event.preventDefault(); event.stopImmediatePropagation(); cancel()
            }
            document.addEventListener('pointermove', move)
            document.addEventListener('pointerdown', pointerdown, true)
            document.addEventListener('click', click, true)
            document.addEventListener('keydown', keydown, true)
            document.addEventListener('contextmenu', contextmenu, true)
            document.addEventListener('scroll', invalidate, true)
            document.addEventListener('load', invalidate, true)
            window.addEventListener('resize', invalidate)
            document.body.classList.add('painter-placing')
            void tick().then(() => {
                if (disposed) return
                const { chat } = current()
                const roots = [...document.querySelectorAll<HTMLElement>('[data-painter-message]')]
                const target = roots.find(root => chat?.message?.[Number(root.dataset.painterMessage)]?.chatId === request.messageId)
                // Start where the reader is looking; jumping to the scene's message loses their place.
                const middle = window.innerHeight / 2
                const onScreen = (root: HTMLElement) => { const box = root.getBoundingClientRect(); return box.bottom > 0 && box.top < window.innerHeight }
                const distance = (root: HTMLElement) => { const box = root.getBoundingClientRect(); return box.top > middle ? box.top - middle : box.bottom < middle ? middle - box.bottom : 0 }
                const visible = roots.filter(onScreen).sort((a, b) => distance(a) - distance(b))
                focused = target && visible.includes(target) ? target : visible[0] ?? target ?? roots.at(-1)
                if (!focused) { error = '삽입할 메시지가 보이도록 본문을 열어 주세요.'; return }
                originalTabIndex = focused.getAttribute('tabindex')
                focused.setAttribute('tabindex', '-1')
                focused.focus({ preventScroll: true })
                if (!visible.length) focused.scrollIntoView?.({ block: 'nearest' })
                candidate = focused === target ? position(focused) : undefined
                if (!candidate || candidate.stop.top < 0 || candidate.stop.top > window.innerHeight) candidate = position(focused, middle) ?? candidate
                marker = candidate?.stop.offset != null ? candidate.stop : undefined
            })
            return () => {
                disposed = true; marker = undefined; swap = undefined
                document.body.classList.remove('painter-placing')
                if (focused) { if (originalTabIndex === null) focused.removeAttribute('tabindex'); else focused.setAttribute('tabindex', originalTabIndex) }
                document.removeEventListener('pointermove', move)
                document.removeEventListener('pointerdown', pointerdown, true)
                document.removeEventListener('click', click, true)
                document.removeEventListener('keydown', keydown, true)
                document.removeEventListener('contextmenu', contextmenu, true)
                document.removeEventListener('scroll', invalidate, true)
                document.removeEventListener('load', invalidate, true)
                resizeObserver.disconnect()
                window.removeEventListener('resize', invalidate)
            }
        })
    })
</script>

{#if $painterInsertionRequest?.characterId === characterId && $painterInsertionRequest?.chatId === chatId}
    <div class="placement-notice" role="status" data-painter-placement use:portal>
        <div><strong>{saving ? '선택한 위치에 삽입하고 저장하는 중입니다.' : '본문에서 삽화를 넣을 위치를 클릭하세요.'}</strong><small>{saving ? '저장이 끝나면 본문에 반영됩니다.' : $painterInsertionRequest?.replace ? '파란 선 위치에 클릭하면 삽입, 본문의 그림을 클릭하면 그 그림을 교체 / Esc 또는 우클릭으로 취소' : '파란 선의 위치에 왼클릭으로 삽입 / Esc 또는 우클릭으로 취소'}</small>{#if error}<p role="alert">{error}</p>{/if}</div>
        <button type="button" disabled={saving} onclick={() => painterInsertionRequest.set(null)}>취소</button>
    </div>
    {#if swap}<div class="placement-swap" style:top="{swap.top}px" style:left="{swap.left}px" style:width="{swap.width}px" style:height="{swap.height}px" aria-hidden="true" use:portal><span>이 그림 교체</span></div>{/if}
    {#if marker}<div class="placement-marker" style:top="{marker.top}px" style:left="{marker.left}px" style:width="{marker.width}px" aria-hidden="true" use:portal><span>삽입 위치</span></div>{/if}
{/if}

<style>
    :global(body.painter-placing [data-painter-message]) { cursor: crosshair; }
    :global(body.painter-placing [data-painter-message]:focus) { outline: 2px solid var(--color-primary); outline-offset: 4px; }
    .placement-notice { position: fixed; z-index: 45; bottom: 1rem; left: 50%; transform: translateX(-50%); width: max-content; max-width: calc(100vw - 2rem); display: flex; gap: 1rem; align-items: center; padding: .8rem 1rem; border: 1px solid var(--color-primary); border-radius: calc(var(--risu-radius-lg) * 1.2); background: var(--color-darkbg); color: var(--color-textcolor); box-shadow: var(--risu-shadow-overlay, 0 6px 24px var(--color-shadowcolor)); font-size: .875rem; }
    small { display: block; margin-top: .2rem; color: var(--color-textcolor2); }
    button { flex: none; padding: .45rem .7rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-lg) * 0.8); background: var(--color-darkbutton); }
    p { color: var(--color-draculared); margin-top: .4rem; }
    .placement-marker { position: fixed; z-index: 44; height: 3px; background: var(--color-primary); pointer-events: none; }
    .placement-swap { position: fixed; z-index: 44; border: 3px solid var(--color-primary); border-radius: var(--risu-radius-sm); background: color-mix(in srgb, var(--color-primary) 18%, transparent); pointer-events: none; }
    .placement-swap span { position: absolute; top: 6px; right: 6px; padding: 2px 8px; background: var(--color-primary); color: var(--color-accenttext); border-radius: calc(var(--risu-radius-sm) * 0.75); font-size: 12px; font-weight: 600; }
    .placement-marker span { position: absolute; right: 0; bottom: 3px; padding: 2px 6px; background: var(--color-primary); color: var(--color-accenttext); border-radius: calc(var(--risu-radius-sm) * 0.75); font-size: 11px; }
</style>
