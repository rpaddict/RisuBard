<script lang="ts">
    import { getFileSrc } from 'src/ts/globalApi.svelte'
    import type { FirstMessageStudioImageFrame } from 'src/ts/firstMessageStudio'

    interface Props {
        assetName?: string
        assets?: [string, string, string][]
        frame: FirstMessageStudioImageFrame
        positionX: number
        positionY: number
        onPositionChange: (x: number, y: number) => void
    }

    let { assetName, assets = [], frame, positionX, positionY, onPositionChange }: Props = $props()
    let imageSrc = $state('')
    let dragStart = $state<{ clientX: number, clientY: number, positionX: number, positionY: number } | undefined>()

    $effect(() => {
        const assetPath = assetName ? assets.find((asset) => asset[0] === assetName)?.[1] : undefined
        let cancelled = false
        imageSrc = ''
        if (assetPath) {
            getFileSrc(assetPath).then((source) => {
                if (!cancelled) imageSrc = source
            })
        }
        return () => { cancelled = true }
    })

    const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value * 100) / 100))

    function beginDrag(event: PointerEvent) {
        if (frame === 'contain') return
        event.preventDefault()
        const target = event.currentTarget as HTMLElement
        target.setPointerCapture?.(event.pointerId)
        dragStart = { clientX: event.clientX, clientY: event.clientY, positionX, positionY }
    }

    function moveDrag(event: PointerEvent) {
        if (!dragStart || frame === 'contain') return
        const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
        const nextX = clamp(dragStart.positionX - ((event.clientX - dragStart.clientX) / Math.max(1, bounds.width)) * 100)
        const nextY = clamp(dragStart.positionY - ((event.clientY - dragStart.clientY) / Math.max(1, bounds.height)) * 100)
        onPositionChange(nextX, nextY)
    }

    function endDrag(event: PointerEvent) {
        const target = event.currentTarget as HTMLElement
        if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId)
        dragStart = undefined
    }
</script>

{#if assetName && imageSrc}
    <section class="crop-editor" data-studio-image-crop-editor>
        <header>
            <div><strong>크롭 위치</strong><small>{frame === 'contain' ? '원본 전체를 표시하므로 잘리는 영역이 없습니다.' : '프레임 안의 이미지를 드래그해 보일 위치를 정하세요.'}</small></div>
            {#if frame !== 'contain'}<button type="button" onclick={() => onPositionChange(50, 50)}>가운데로</button>{/if}
        </header>
        <div
            class="crop-frame frame-{frame}"
            class:draggable={frame !== 'contain'}
            class:dragging={Boolean(dragStart)}
            data-studio-image-crop-frame
            role={frame === 'contain' ? undefined : 'application'}
            aria-label={frame === 'contain' ? '원본 삽화 미리보기' : '삽화 크롭 위치 편집기'}
            onpointerdown={beginDrag}
            onpointermove={moveDrag}
            onpointerup={endDrag}
            onpointercancel={endDrag}
        >
            <img
                src={imageSrc}
                alt="크롭 미리보기"
                style:width|important={frame === 'contain' ? 'auto' : '100%'}
                style:height|important={frame === 'contain' ? 'auto' : '100%'}
                style:max-width|important={frame === 'contain' ? '100%' : 'none'}
                style:max-height|important={frame === 'contain' ? '17rem' : 'none'}
                style:margin|important="0"
                style:object-fit|important={frame === 'contain' ? 'contain' : 'cover'}
                style:object-position|important={frame === 'contain' ? '50% 50%' : `${positionX}% ${positionY}%`}
            />
            {#if frame !== 'contain'}<div class="crop-guide" data-studio-image-crop-guide aria-hidden="true"></div>{/if}
        </div>
        {#if frame !== 'contain'}<output>가로 {Math.round(positionX)}% · 세로 {Math.round(positionY)}%</output>{/if}
    </section>
{/if}

<style>
    .crop-editor{display:grid;gap:.5rem;padding:.6rem;border:1px solid var(--risu-theme-darkborderc);border-radius:var(--risu-radius-lg);background:color-mix(in srgb,var(--risu-theme-darkbg) 72%,transparent)}
    header{display:flex;align-items:end;justify-content:space-between;gap:.6rem}header>div{display:grid;gap:.12rem}strong{font-size:.72rem}small,output{color:var(--risu-theme-textcolor2);font-size:.62rem}button{flex:none;border:1px solid var(--risu-theme-primary);color:var(--risu-theme-primary)}
    .crop-frame{position:relative;display:grid;width:100%;place-items:center;overflow:hidden;margin-inline:auto;border-radius:calc(var(--risu-radius-lg) * 0.9);background:repeating-conic-gradient(color-mix(in srgb,var(--risu-theme-textcolor2) 12%,transparent) 0 25%,transparent 0 50%) 50%/1rem 1rem;touch-action:none;user-select:none}
    .crop-frame.frame-contain{max-height:18rem;padding:.4rem}.crop-frame.frame-square{width:min(100%,22rem);aspect-ratio:1}.crop-frame.frame-landscape{aspect-ratio:16/9}.crop-frame.frame-portrait{width:min(100%,18rem);aspect-ratio:3/4}
    .crop-frame img{display:block;pointer-events:none;-webkit-user-drag:none}.crop-frame.frame-contain img{width:auto;height:auto;max-width:100%;max-height:17rem;object-fit:contain}.crop-frame:not(.frame-contain) img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
    .crop-frame.draggable{cursor:grab}.crop-frame.dragging{cursor:grabbing}
    .crop-guide{position:absolute;z-index:1;inset:0;border:2px solid var(--risu-theme-primary);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--color-media-text) 62%,transparent),inset 0 0 2rem color-mix(in srgb,var(--color-shadow) 16%,transparent);pointer-events:none}
    .crop-guide::before,.crop-guide::after{position:absolute;content:'';inset:0;opacity:.58}.crop-guide::before{background:linear-gradient(90deg,transparent 33.1%,var(--risu-theme-primary) 33.2% 33.5%,transparent 33.6% 66.4%,var(--risu-theme-primary) 66.5% 66.8%,transparent 66.9%)}.crop-guide::after{background:linear-gradient(transparent 33.1%,var(--risu-theme-primary) 33.2% 33.5%,transparent 33.6% 66.4%,var(--risu-theme-primary) 66.5% 66.8%,transparent 66.9%)}
    output{justify-self:center;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
</style>
