// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import {
    buildArcaClipboardHtml,
    exportArcaHtml,
    findDetachedArcaPanels,
    planArcaComplexSnapshots,
    shouldIncludeArcaRasterNode,
    shouldIncludeArcaSnapshotNode,
} from './arcaExport';

describe('shouldIncludeArcaSnapshotNode', () => {
    it('accepts text nodes while excluding controls and detached panel subtrees', () => {
        const root = document.createElement('div');
        root.innerHTML = '<p>prose</p><button>open</button><aside>panel</aside>';
        const proseText = root.querySelector('p')?.firstChild as Text;
        const button = root.querySelector('button') as HTMLButtonElement;
        const panel = root.querySelector('aside') as HTMLElement;

        expect(shouldIncludeArcaSnapshotNode(proseText, [panel])).toBe(true);
        expect(shouldIncludeArcaSnapshotNode(button, [panel])).toBe(false);
        expect(shouldIncludeArcaSnapshotNode(panel, [panel])).toBe(false);
    });
});

describe('shouldIncludeArcaRasterNode', () => {
    it('keeps in-flow buttons and folded sprites in a rasterized block but drops floating controls', () => {
        const root = document.createElement('div');
        root.innerHTML = '<button class="chip">501</button><div class="sprite" role="button"><img src="a.png"></div><button class="fab">menu</button><aside>panel</aside>';
        const [chip, sprite, fab, panel] = Array.from(root.children) as HTMLElement[];
        const readStyle = (element: Element) => ({
            getPropertyValue: (property: string) => property === 'position' && element === fab ? 'fixed' : '',
        }) as unknown as CSSStyleDeclaration;

        expect(shouldIncludeArcaRasterNode(chip, [panel], readStyle)).toBe(true);
        expect(shouldIncludeArcaRasterNode(sprite, [panel], readStyle)).toBe(true);
        expect(shouldIncludeArcaRasterNode(fab, [panel], readStyle)).toBe(false);
        expect(shouldIncludeArcaRasterNode(panel, [panel], readStyle)).toBe(false);
    });

    it('drops small fixed labels but keeps a fixed wrapper that holds a panel', () => {
        const root = document.createElement('div');
        root.innerHTML = '<label class="fab">지도</label><div class="wrap"><section class="tablet"></section></div>';
        const [fab, wrap] = Array.from(root.children) as HTMLElement[];
        const tablet = wrap.firstElementChild as HTMLElement;
        const readStyle = (element: Element) => ({
            getPropertyValue: (property: string) => property === 'position' && element !== tablet ? 'fixed' : '',
        }) as unknown as CSSStyleDeclaration;
        const readRect = (element: Element) => (element === tablet ? domRect(360, 640) : domRect(element === fab ? 56 : 0, element === fab ? 56 : 0));

        expect(shouldIncludeArcaRasterNode(fab, [], readStyle, readRect)).toBe(false);
        expect(shouldIncludeArcaRasterNode(wrap, [], readStyle, readRect)).toBe(true);
    });
});

describe('findDetachedArcaPanels', () => {
    it('separates a large FAB panel without treating its button or internal ornaments as panels', () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <main class="alpha"><span class="beta"></span></main>
            <button class="gamma">Open</button>
            <div class="delta"><aside class="epsilon"><span class="zeta"></span></aside></div>
        `;
        const [status, fab, overlay] = Array.from(root.children) as HTMLElement[];
        const panel = overlay.firstElementChild as HTMLElement;
        const panelOrnament = panel.firstElementChild as HTMLElement;
        const styles = new Map<Element, CSSStyleDeclaration>([
            [status, cssStyle('position: relative;')],
            [fab, cssStyle('position: fixed;')],
            [overlay, cssStyle('position: fixed; background-color: rgba(0, 0, 0, .5);')],
            [panel, cssStyle('position: absolute; z-index: 900; overflow: hidden; background: linear-gradient(#112244, #050811); box-shadow: 0 20px 50px #000;')],
            [panelOrnament, cssStyle('position: absolute;')],
        ]);
        const rects = new Map<Element, DOMRect>([
            [root, domRect(760, 600)],
            [status, domRect(760, 400)],
            [fab, domRect(48, 48)],
            [overlay, domRect(760, 600)],
            [panel, domRect(420, 520)],
            [panelOrnament, domRect(300, 180)],
        ]);

        expect(findDetachedArcaPanels(
            root,
            element => styles.get(element) ?? cssStyle(''),
            element => rects.get(element) ?? domRect(0, 0),
        )).toEqual([panel]);
    });

    it('skips a zero-size FAB wrapper and schedules its fixed card as a separate snapshot', () => {
        const root = document.createElement('div');
        root.className = 'zero-shell';
        root.innerHTML = '<label class="tiny-launcher">OPEN</label><div class="detached-surface">Panel content</div>';
        const [fab, panel] = Array.from(root.children) as HTMLElement[];
        const styles = new Map<Element, CSSStyleDeclaration>([
            [fab, cssStyle('position: fixed; display: flex;')],
            [panel, cssStyle('position: fixed; display: block; opacity: 0; transform: translateY(8px);')],
        ]);
        const rects = new Map<Element, DOMRect>([
            [root, domRect(0, 0)],
            [fab, domRect(54, 46)],
            [panel, domRect(460, 520)],
        ]);

        const plan = planArcaComplexSnapshots(
            root,
            element => styles.get(element) ?? cssStyle(''),
            element => rects.get(element) ?? domRect(0, 0),
        );

        expect(plan).toHaveLength(1);
        expect(plan[0].kind).toBe('panel');
        expect(plan[0].element).toBe(panel);
    });

    it('keeps an image background layer that only inherits pointer-events none', () => {
        const root = document.createElement('div');
        root.innerHTML = '<div class="pic"><span class="stage"><span class="bg"></span><img class="sprite"></span></div>';
        const stage = root.querySelector('.stage') as HTMLElement;
        const background = root.querySelector('.bg') as HTMLElement;
        const sprite = root.querySelector('.sprite') as HTMLElement;
        const styles = new Map<Element, CSSStyleDeclaration>([
            [stage, cssStyle('position: relative; pointer-events: none;')],
            [background, cssStyle('position: absolute; z-index: 0; pointer-events: none; background-image: linear-gradient(#123, #456); box-shadow: 4px 4px 0 #111;')],
            // Chrome reports overflow on <img>; the loaded sprite must still not become a panel.
            [sprite, cssStyle('position: absolute; z-index: 1; pointer-events: none; overflow: hidden; transform: translateX(-50%);')],
        ]);
        const rects = new Map<Element, DOMRect>([
            [root, domRect(760, 600)],
            [stage, domRect(600, 340)],
            [background, domRect(600, 340)],
            [sprite, domRect(230, 340)],
        ]);

        expect(findDetachedArcaPanels(
            root,
            element => styles.get(element) ?? cssStyle(''),
            element => rects.get(element) ?? domRect(0, 0),
        )).toEqual([]);
    });

    it('keeps a framed and tilted picture cut-in as part of its scene', () => {
        const root = document.createElement('div');
        root.innerHTML = '<span class="bg"><span class="cuts"><span class="cut"><img src="rain.webp"></span></span></span>';
        const background = root.querySelector('.bg') as HTMLElement;
        const cuts = root.querySelector('.cuts') as HTMLElement;
        const cut = root.querySelector('.cut') as HTMLElement;
        const styles = new Map<Element, CSSStyleDeclaration>([
            [background, cssStyle('position: absolute; background-image: url(room.webp);')],
            [cuts, cssStyle('position: absolute; pointer-events: none; z-index: 1;')],
            [cut, cssStyle('position: absolute; overflow: hidden; box-shadow: 4px 4px 0 #111; background-color: rgb(28, 35, 48); transform: rotate(1.5deg); pointer-events: none;')],
        ]);
        const rects = new Map<Element, DOMRect>([
            [root, domRect(760, 400)],
            [background, domRect(600, 340)],
            [cuts, domRect(600, 340)],
            [cut, domRect(240, 180)],
        ]);

        expect(findDetachedArcaPanels(
            root,
            element => styles.get(element) ?? cssStyle(''),
            element => rects.get(element) ?? domRect(0, 0),
        )).toEqual([]);
    });

    it('detects an unnamed absolute off-canvas layer from geometry and computed state', () => {
        const root = document.createElement('div');
        root.innerHTML = '<section class="ordinary"><i></i></section><aside class="unknown-layer">Details</aside>';
        const [ordinary, layer] = Array.from(root.children) as HTMLElement[];
        const ornament = ordinary.firstElementChild as HTMLElement;
        const styles = new Map<Element, CSSStyleDeclaration>([
            [ordinary, cssStyle('position: relative; display: grid; background-color: rgb(10, 20, 30);')],
            [ornament, cssStyle('position: absolute; width: 300px; height: 180px;')],
            [layer, cssStyle('position: absolute; z-index: 700; opacity: 0; pointer-events: none; transform: translateX(100%); overflow: auto; background-color: rgb(20, 30, 60); box-shadow: 0 20px 50px #000;')],
        ]);
        const rects = new Map<Element, DOMRect>([
            [root, domRect(760, 600)],
            [ordinary, domRect(760, 400)],
            [ornament, domRect(300, 180)],
            [layer, domRect(360, 480)],
        ]);

        expect(findDetachedArcaPanels(
            root,
            element => styles.get(element) ?? cssStyle(''),
            element => rects.get(element) ?? domRect(0, 0),
        )).toEqual([layer]);
    });

    it('does not treat a transparent control overlay as a panel because of the computed background shorthand', () => {
        const root = document.createElement('div');
        root.innerHTML = '<div class="frame"><img class="art"><span class="controls"><span class="count">2/3</span></span></div>';
        const controls = root.querySelector('.controls') as HTMLElement;
        const styles = new Map<Element, CSSStyleDeclaration>([
            // Chrome always reports the shorthand with its default layers.
            [controls, computedStyle({
                position: 'absolute',
                'z-index': '16',
                opacity: '0',
                'pointer-events': 'none',
                background: 'rgba(0, 0, 0, 0) none repeat scroll 0% 0% / auto padding-box border-box',
                'background-color': 'rgba(0, 0, 0, 0)',
                'background-image': 'none',
                'box-shadow': 'none',
                overflow: 'visible',
            })],
        ]);
        const rects = new Map<Element, DOMRect>([
            [root, domRect(760, 600)],
            [controls, domRect(560, 608)],
        ]);

        expect(findDetachedArcaPanels(
            root,
            element => styles.get(element) ?? cssStyle(''),
            element => rects.get(element) ?? domRect(0, 0),
        )).toEqual([]);
    });
});

describe('exportArcaHtml', () => {
    it('drops floating label FABs instead of copying them as text', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<p>prose</p><div class="fabs"><label class="fab" for="tab-map">지도</label><label class="fab" for="tab-set">설정</label></div>';
        const labels = Array.from(root.querySelectorAll('label'));
        const styles = new Map<Element, CSSStyleDeclaration>(
            labels.map(label => [label, cssStyle('position: fixed; display: flex; width: 56px; height: 56px;')]),
        );

        const html = await exportArcaHtml(root, {
            readStyle: element => styles.get(element) ?? cssStyle(''),
            loadImage: async url => url,
        });

        expect(html).toContain('prose');
        expect(html).not.toContain('지도');
        expect(html).not.toContain('설정');
    });

    it('carries the chat line height over as a ratio, keeping a block that sets its own', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<p>첫 줄<br>둘째 줄</p><div class="card"><p>카드</p></div>';
        const card = root.children[1] as HTMLElement;
        const styles = new Map<Element, CSSStyleDeclaration>([
            [root, cssStyle('font-size: 20px; line-height: 40px;')],
            [card, cssStyle('line-height: 1.45;')],
        ]);

        const html = await exportArcaHtml(root, {
            readStyle: element => styles.get(element) ?? cssStyle(''),
            loadImage: async url => url,
        });
        const output = document.createElement('div');
        output.innerHTML = html;
        const wrapper = output.firstElementChild as HTMLElement;

        expect(wrapper.style.lineHeight).toBe('2');
        expect((wrapper.children[0] as HTMLElement).style.lineHeight).toBe('2');
        expect((wrapper.children[1] as HTMLElement).style.lineHeight).toBe('1.45');
        expect(wrapper.children[1].querySelector('p')?.style.lineHeight).toBe('');
    });

    it('surfaces complex snapshot failures instead of silently flattening hidden panels', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<div class="unknown-wrapper"><div class="unknown-panel">Hidden panel</div></div>';
        const wrapper = root.firstElementChild as HTMLElement;
        const panel = wrapper.firstElementChild as HTMLElement;
        const styles = new Map<Element, CSSStyleDeclaration>([
            [root, cssStyle('font-size: 16px;')],
            [wrapper, cssStyle('display: block;')],
            [panel, cssStyle('position: fixed; display: block; opacity: 0;')],
        ]);

        await expect(exportArcaHtml(root, {
            readStyle: element => styles.get(element) ?? cssStyle(''),
            renderComplexBlock: async () => { throw new Error('snapshot failed'); },
        })).rejects.toThrow('snapshot failed');
    });

    it('preserves a complex visual block as a full-width snapshot while keeping ordinary prose as HTML', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<p>ordinary prose</p><section class="status"><div class="dial">D-18</div></section>';
        const prose = root.children[0] as HTMLElement;
        const status = root.children[1] as HTMLElement;
        const dial = status.firstElementChild as HTMLElement;
        const styles = new Map<Element, CSSStyleDeclaration>([
            [root, cssStyle('display: block; font-size: 16px;')],
            [prose, cssStyle('display: block; font-size: 16px;')],
            [status, cssStyle('display: grid; width: 100%; min-height: 260px; background-image: linear-gradient(#071122, #02050c);')],
            [dial, cssStyle('position: absolute; right: 12px; top: 12px;')],
        ]);
        const renderComplexBlock = vi.fn(async () => [
            'data:image/png;base64,status-card',
            'data:image/png;base64,detached-panel',
        ]);

        const html = await exportArcaHtml(root, {
            readStyle: (element) => styles.get(element) ?? cssStyle(''),
            loadImage: async (url) => url,
            renderComplexBlock,
        });
        const output = document.createElement('div');
        output.innerHTML = html;
        const snapshots = Array.from(output.querySelectorAll('img[data-arca-complex-snapshot]')) as HTMLImageElement[];

        expect(output.firstElementChild?.tagName).toBe('P');
        expect(output.firstElementChild?.textContent).toBe('ordinary prose');
        expect(snapshots.map(snapshot => snapshot.getAttribute('src'))).toEqual([
            'data:image/png;base64,status-card',
            'data:image/png;base64,detached-panel',
        ]);
        expect(snapshots[0].style.width).toBe('100%');
        expect(snapshots[0].style.maxWidth).toBe('100%');
        expect(renderComplexBlock).toHaveBeenCalledOnce();
        expect(renderComplexBlock).toHaveBeenCalledWith(status);
        expect(html).not.toContain('class="status"');
    });

    it('snapshots a flex-row status board even without a background image', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<p>prose</p><div class="board"><div class="floor"><b>5F</b><b>A-501</b></div></div>';
        const board = root.children[1] as HTMLElement;
        const floor = board.firstElementChild as HTMLElement;
        const styles = new Map<Element, CSSStyleDeclaration>([
            [board, cssStyle('display: block; background-color: rgb(16, 18, 24);')],
            [floor, cssStyle('display: flex;')],
        ]);
        const renderComplexBlock = vi.fn(async () => 'data:image/png;base64,board');

        const html = await exportArcaHtml(root, {
            readStyle: element => styles.get(element) ?? cssStyle(''),
            renderComplexBlock,
        });

        expect(renderComplexBlock).toHaveBeenCalledWith(board);
        expect(html).toContain('data:image/png;base64,board');
        expect(html).toContain('<p');
        expect(html).not.toContain('5F');
    });

    it('drops fixed FAB buttons instead of snapshotting them into blank images', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<p>prose</p><div class="mha-clear"></div><button class="fab">지도</button><button class="fab">설정</button>';
        const [, , map, settings] = Array.from(root.children) as HTMLElement[];
        const styles = new Map<Element, CSSStyleDeclaration>([
            [map, cssStyle('position: fixed; right: 18px; bottom: 220px; width: 56px; height: 56px;')],
            [settings, cssStyle('position: fixed; right: 18px; bottom: 288px; width: 56px; height: 56px;')],
        ]);
        const renderComplexBlock = vi.fn(async () => 'data:image/png;base64,blank');

        const html = await exportArcaHtml(root, {
            readStyle: element => styles.get(element) ?? cssStyle(''),
            renderComplexBlock,
        });

        expect(renderComplexBlock).not.toHaveBeenCalled();
        expect(html).not.toContain('<img');
        expect(html).not.toContain('지도');
    });

    it('keeps column flex layouts and closed details as HTML', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<div class="stack"><b>one</b><b>two</b></div>'
            + '<details><summary>open</summary><div class="row"><b>a</b><b>b</b></div></details>';
        const stack = root.children[0] as HTMLElement;
        const row = root.querySelector('.row') as HTMLElement;
        const styles = new Map<Element, CSSStyleDeclaration>([
            [stack, cssStyle('display: flex; flex-direction: column;')],
            [row, cssStyle('display: flex;')],
        ]);
        const renderComplexBlock = vi.fn(async () => 'data:image/png;base64,unused');

        const html = await exportArcaHtml(root, {
            readStyle: element => styles.get(element) ?? cssStyle(''),
            renderComplexBlock,
        });

        expect(renderComplexBlock).not.toHaveBeenCalled();
        expect(html).toContain('one');
        expect(html).toContain('<details');
    });

    it('descends into a prose wrapper and snapshots only the layout block inside it', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<div class="message"><p>first line</p><div class="overlay"><img src="/bg.png"><img src="/sprite.png"></div><p>last line</p></div>';
        const wrapper = root.firstElementChild as HTMLElement;
        const overlay = wrapper.querySelector('.overlay') as HTMLElement;
        const sprite = overlay.lastElementChild as HTMLElement;
        const styles = new Map<Element, CSSStyleDeclaration>([
            [wrapper, cssStyle('display: block; border: 1px solid rgb(255, 0, 0);')],
            [overlay, cssStyle('position: relative;')],
            [sprite, cssStyle('position: absolute;')],
        ]);
        const renderComplexBlock = vi.fn(async () => 'data:image/png;base64,overlay');
        root.getBoundingClientRect = () => domRect(750, 400);
        overlay.getBoundingClientRect = () => domRect(300, 160);

        const html = await exportArcaHtml(root, {
            readStyle: element => styles.get(element) ?? cssStyle(''),
            renderComplexBlock,
        });
        const output = document.createElement('div');
        output.innerHTML = html;
        const exportedWrapper = output.firstElementChild as HTMLElement;

        expect(renderComplexBlock).toHaveBeenCalledOnce();
        expect(renderComplexBlock).toHaveBeenCalledWith(overlay);
        expect(exportedWrapper.tagName).toBe('DIV');
        expect(exportedWrapper.style.border).toContain('1px solid');
        expect(Array.from(exportedWrapper.children).map(child => child.textContent)).toEqual(['first line', '', 'last line']);
        const snapshot = exportedWrapper.querySelector('img[data-arca-complex-snapshot]') as HTMLImageElement;
        expect(snapshot.getAttribute('src')).toBe('data:image/png;base64,overlay');
        expect(snapshot.style.width).toBe('40%');
    });

    it('exports an image plugin picture with hidden overlays as the original image instead of a snapshot', async () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <p>before</p>
            <div class="am-generated-image"><span class="am-generated-image-frame"><img class="am-generated-image__img" src="/api/asset/module-art" loading="lazy"><span class="history"><img src="/api/asset/old-art"></span><span class="edge-controls"><button>prev</button><span class="count">2/3</span></span><span class="regen-ui"><span class="spinner"></span></span></span></div>
            <p>after</p>
        `;
        const picture = root.querySelector('.am-generated-image') as HTMLElement;
        const styles = new Map<Element, CSSStyleDeclaration>([
            [picture, cssStyle('display: flex; justify-content: center;')],
            [root.querySelector('.am-generated-image-frame') as HTMLElement, cssStyle('display: grid; position: relative;')],
            [root.querySelector('.history') as HTMLElement, cssStyle('display: none;')],
            [root.querySelector('.edge-controls') as HTMLElement, cssStyle('position: absolute; inset: 0 -72px; z-index: 16; opacity: 0;')],
            [root.querySelector('.regen-ui') as HTMLElement, cssStyle('position: absolute; display: none;')],
        ]);
        const renderComplexBlock = vi.fn(async () => 'data:image/webp;base64,snapshot');
        const loadImage = vi.fn(async (url: string) => `data:image/png;base64,${url.split('/').pop()}`);

        const html = await exportArcaHtml(root, {
            baseUrl: 'https://risu.example/chat',
            readStyle: element => styles.get(element) ?? cssStyle(''),
            loadImage,
            renderComplexBlock,
        });
        const output = document.createElement('div');
        output.innerHTML = html;

        expect(renderComplexBlock).not.toHaveBeenCalled();
        expect(Array.from(output.children).map(element => element.tagName)).toEqual(['P', 'P', 'P']);
        expect(Array.from(output.querySelectorAll('img')).map(image => image.getAttribute('src')))
            .toEqual(['data:image/png;base64,module-art']);
        expect(loadImage).toHaveBeenCalledWith('https://risu.example/api/asset/module-art');
        expect(output.textContent).not.toContain('2/3');
    });

    it('still snapshots a sprite over a background picture', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<div class="scene"><img class="sprite" src="/sprite.png"></div>';
        const scene = root.firstElementChild as HTMLElement;
        const styles = new Map<Element, CSSStyleDeclaration>([
            [scene, cssStyle('position: relative; background-image: url("/room.png");')],
            [scene.firstElementChild as HTMLElement, cssStyle('position: absolute; left: 10px;')],
        ]);
        const renderComplexBlock = vi.fn(async () => 'data:image/webp;base64,scene');

        await exportArcaHtml(root, {
            readStyle: element => styles.get(element) ?? cssStyle(''),
            loadImage: async url => url,
            renderComplexBlock,
        });

        expect(renderComplexBlock).toHaveBeenCalledWith(scene);
    });

    it('replaces a CSS background asset with a real image without changing message order', async () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <p>before</p>
            <div class="image-container" style="background-image: url('/api/asset/abc')"><br></div>
            <p>after</p>
        `;
        const loadImage = vi.fn(async () => 'data:image/png;base64,converted');

        const html = await exportArcaHtml(root, {
            baseUrl: 'https://risu.example/chat',
            loadImage,
        });

        const output = document.createElement('div');
        output.innerHTML = html;
        const children = Array.from(output.children);

        expect(children.map((element) => element.tagName)).toEqual(['P', 'P', 'P']);
        const imageFrame = children[1] as HTMLElement;
        const image = imageFrame.querySelector('img') as HTMLImageElement;
        expect(image.getAttribute('src')).toBe('data:image/png;base64,converted');
        expect(imageFrame.style.width).toBe('');
        expect(image.style.width).toBe('100%');
        expect(image.style.maxWidth).toBe('60%');
        expect(html).not.toContain('background-image');
        expect(html).not.toContain('image-container');
        expect(loadImage).toHaveBeenCalledWith('https://risu.example/api/asset/abc');
    });

    it('adds configurable spacing between top-level blocks and centers exported images', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<p>첫 문단</p><img src="/portrait.png" alt="portrait"><p>둘째 문단</p>';

        const html = await exportArcaHtml(root, {
            baseUrl: 'https://risu.example/chat',
            loadImage: async () => 'data:image/png;base64,portrait',
            imageWidthPercent: 40,
            paragraphSpacingPercent: 100,
        });
        const output = document.createElement('div');
        output.innerHTML = html;
        const [first, imageFrame, last] = Array.from(output.children) as HTMLElement[];
        const image = imageFrame.querySelector('img') as HTMLImageElement;

        expect(first.style.marginBottom).toBe('1em');
        expect(imageFrame.tagName).toBe('P');
        expect(imageFrame.style.display).toBe('block');
        expect(imageFrame.style.textAlign).toBe('center');
        expect(imageFrame.style.width).toBe('');
        expect(imageFrame.style.marginLeft).toBe('auto');
        expect(imageFrame.style.marginRight).toBe('auto');
        expect(imageFrame.style.marginBottom).toBe('1em');
        expect(image.style.display).toBe('inline-block');
        expect(image.style.width).toBe('100%');
        expect(image.style.maxWidth).toBe('40%');
        expect(image.style.float).toBe('none');
        expect(image.style.marginLeft).toBe('auto');
        expect(image.style.marginRight).toBe('auto');
        expect(last.style.marginBottom).toBe('');
    });

    it('inlines safe computed styles and rewrites unsupported flex rows as table cells', async () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <div class="status-row" style="position: relative; overflow: hidden; opacity: 0.7; background-image: url('/paper.png')">
                <span class="location">란타르나 외곽 평원</span>
                <span class="reputation">10</span>
            </div>
        `;
        const [row] = Array.from(root.children) as HTMLElement[];
        const [location, reputation] = Array.from(row.children) as HTMLElement[];
        const styles = new Map<Element, CSSStyleDeclaration>([
            [row, cssStyle('display: flex; flex-direction: row; width: 100%; padding: 12px; background-color: rgb(247, 244, 232); border: 1px solid rgb(210, 200, 180); border-radius: 8px; position: relative; overflow: hidden; opacity: 0.7; background-image: url("/paper.png");')],
            [location, cssStyle('color: rgb(32, 67, 75); font-weight: 600;')],
            [reputation, cssStyle('color: rgb(32, 67, 75); text-align: right;')],
        ]);
        const html = await exportArcaHtml(root, {
            readStyle: (element) => styles.get(element) ?? cssStyle(''),
            loadImage: async (url) => url,
        });

        const output = document.createElement('div');
        output.innerHTML = html;
        const exportedRow = output.firstElementChild as HTMLElement;
        const exportedCells = Array.from(exportedRow.children) as HTMLElement[];

        expect(exportedRow.className).toBe('');
        expect(exportedRow.style.display).toBe('table');
        expect(exportedRow.style.width).toBe('100%');
        expect(exportedRow.style.padding).toBe('12px');
        expect(exportedRow.style.backgroundColor).toBe('rgb(247, 244, 232)');
        expect(exportedRow.style.borderRadius).toBe('8px');
        expect(exportedRow.style.borderWidth).toBe('0px');
        expect(html).toContain('table-cell');
        expect(exportedCells.map((cell) => cell.getAttribute('style'))).toEqual([
            expect.stringContaining('display: table-cell'),
            expect.stringContaining('display: table-cell'),
        ]);
        expect(exportedCells.every(cell => cell.style.borderWidth === '0px')).toBe(true);
        expect(exportedCells[1].style.textAlign).toBe('right');
        expect(html).not.toMatch(/display:\s*flex/i);
        expect(html).not.toMatch(/position:|overflow:|opacity:|url\(/i);
    });

    it('lets the exported frame control normal body text size while preserving larger headings', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<p class="body-copy">본문</p><h2 class="heading">제목</h2>';
        const [body, heading] = Array.from(root.children) as HTMLElement[];
        const styles = new Map<Element, CSSStyleDeclaration>([
            [root, cssStyle('font-size: 16px;')],
            [body, cssStyle('color: rgb(247, 248, 252); font-size: 16px;')],
            [heading, cssStyle('font-size: 24px; font-weight: 600;')],
        ]);

        const bodyHtml = await exportArcaHtml(root, {
            readStyle: (element) => styles.get(element) ?? cssStyle(''),
            loadImage: async (url) => url,
        });
        const html = buildArcaClipboardHtml({ bodyHtml, displayName: 'Test', fontSizePx: 18 });

        expect(bodyHtml).not.toContain('font-size: 16px');
        expect(bodyHtml).toContain('font-size: 24px');
        expect(html).toContain('font-size: 18px');
    });

    it('embeds existing images and removes interactive editor controls', async () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <p>본문</p>
            <img src="/api/asset/portrait" alt="파트리샤" style="border-radius: 12px; object-fit: cover;">
            <button type="button">편집</button>
            <textarea>임시 편집문</textarea>
            <div class="partial-edit-overlay"><span>편집 모달</span></div>
        `;
        const loadImage = vi.fn(async () => 'data:image/png;base64,portrait');

        const html = await exportArcaHtml(root, {
            baseUrl: 'https://risu.example/chat',
            loadImage,
            readStyle: (element) => (element as HTMLElement).style,
        });

        const output = document.createElement('div');
        output.innerHTML = html;
        const image = output.querySelector('img') as HTMLImageElement;

        expect(image.src).toBe('data:image/png;base64,portrait');
        expect(image.alt).toBe('파트리샤');
        expect(image.getAttribute('style')).toContain('border-radius: 12px');
        expect(image.style.maxWidth).toBe('60%');
        expect(loadImage).toHaveBeenCalledWith('https://risu.example/api/asset/portrait');
        expect(output.querySelector('button, textarea, .partial-edit-overlay')).toBeNull();
        expect(output.textContent).not.toContain('편집 모달');
    });

    it('flattens a single-image frame instead of exporting its viewport-sized wrapper', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<div class="portrait-frame"><img src="/api/asset/miho" alt="Miho"></div>';
        const frame = root.firstElementChild as HTMLElement;
        const portrait = frame.firstElementChild as HTMLElement;
        const styles = new Map<Element, CSSStyleDeclaration>([
            [frame, cssStyle('display: block; width: 400px; max-width: 1877.33px; height: 400px; margin: 10px 344px; border-radius: 10px;')],
            [portrait, cssStyle('display: block; width: 400px; height: 400px; max-width: 100%;')],
        ]);

        const html = await exportArcaHtml(root, {
            baseUrl: 'https://risu.example/chat',
            loadImage: async () => 'data:image/png;base64,miho',
            readStyle: (element) => styles.get(element) ?? cssStyle(''),
            imageWidthPercent: 40,
        });

        const output = document.createElement('div');
        output.innerHTML = html;
        const exportedFrame = output.firstElementChild as HTMLElement;
        const exported = exportedFrame.querySelector('img') as HTMLImageElement;

        expect(exportedFrame.tagName).toBe('P');
        expect(exportedFrame.style.width).toBe('');
        expect(exported.getAttribute('src')).toBe('data:image/png;base64,miho');
        expect(exported.style.width).toBe('100%');
        expect(exported.style.maxWidth).toBe('40%');
        expect(exported.getAttribute('style')).toContain('border-radius: 10px');
        expect(html).not.toMatch(/344px|1877\.33px|width:\s*400px|height:\s*400px/i);
    });

    it('does not export viewport-resolved pixel geometry from responsive cards', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<details class="status-card"><summary>1일차 · 오후</summary></details>';
        const card = root.firstElementChild as HTMLElement;

        const html = await exportArcaHtml(root, {
            readStyle: (element) => element === card
                ? cssStyle('display: block; width: 620px; max-width: 1877.33px; height: 42.7167px; margin: 10px 234px; padding: 7px 10px; border-radius: 10px;')
                : cssStyle(''),
            loadImage: async (url) => url,
        });

        const output = document.createElement('div');
        output.innerHTML = html;
        const exported = output.firstElementChild as HTMLElement;

        expect(exported.style.maxWidth).toBe('100%');
        expect(exported.style.marginTop).toBe('10px');
        expect(exported.style.marginBottom).toBe('10px');
        expect(html).not.toMatch(/234px|620px|1877\.33px|42\.7167px/i);
    });

    it('materializes textual pseudo-elements used for card icons and ornaments', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<div class="inventory-label">보유 아이템</div>';
        const label = root.firstElementChild as HTMLElement;

        const html = await exportArcaHtml(root, {
            readStyle: (element, pseudoElement) => {
                if (element === label && pseudoElement === '::before') {
                    return cssStyle('content: "⚗"; color: rgb(120, 100, 80); margin-right: 6px;');
                }
                if (element === label && pseudoElement === '::after') {
                    return cssStyle('content: "✦"; color: rgb(180, 160, 130); margin-left: 4px;');
                }
                return cssStyle('color: rgb(60, 70, 75);');
            },
            loadImage: async (url) => url,
        });

        expect(html).toContain('>⚗</span>보유 아이템<span');
        expect(html).toContain('>✦</span>');
        expect(html).toContain('margin-right: 6px');
        expect(html).not.toContain('::before');
    });

    it('formats whole-block sound, dialogue, and thought markers without touching mixed prose', async () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <p>§PUNG—whistle…§</p>
            <p>"Grit your teeth and push through!"</p>
            <p>‘They are exposing their flank…’</p>
            <p>He said "this stays ordinary" while walking.</p>
        `;

        const html = await exportArcaHtml(root, {
            semanticPalette: 'dark',
            readStyle: (element) => element === root ? cssStyle('font-size: 16px;') : cssStyle('font-size: 16px;'),
            loadImage: async (url) => url,
        });
        const output = document.createElement('div');
        output.innerHTML = html;
        const [sound, quote, thought, ordinary] = Array.from(output.children) as HTMLElement[];

        expect(sound.textContent).toBe('PUNG—whistle…');
        expect(sound.style.display).toBe('inline-block');
        expect(sound.style.color).toBe('rgb(208, 123, 231)');
        expect(sound.style.fontStyle).toBe('italic');
        expect(quote.style.borderLeftWidth).toBe('4px');
        expect(quote.style.color).toBe('rgb(241, 187, 87)');
        expect(thought.style.borderLeftWidth).toBe('4px');
        expect(thought.style.color).toBe('rgb(127, 171, 241)');
        expect(ordinary.style.borderLeftWidth).toBe('');
    });

    it('exports parser quote marks as colored spans without destination highlight styles', async () => {
        const root = document.createElement('div');
        root.innerHTML = `<p>Prose <mark risu-mark="quote2">“Dialogue”</mark> <mark risu-mark="quote1">‘Thought’</mark></p>
            <p><mark risu-mark="blockquote2">“Block dialogue”</mark></p>
            <p><mark risu-mark="blockquote1">‘Block thought’</mark></p><mark>Highlight</mark>`;
        const html = await exportArcaHtml(root, {
            readStyle: (element, pseudo) => {
                if (pseudo) return cssStyle('');
                const kind = element.getAttribute('risu-mark');
                return cssStyle(kind
                    ? `color: ${kind.endsWith('1') ? 'rgb(127, 171, 241)' : 'rgb(241, 187, 87)'}; background-color: transparent;`
                    : '');
            },
        });
        const output = document.createElement('div');
        output.innerHTML = html;
        const spans = Array.from(output.querySelectorAll('span'));
        expect(spans).toHaveLength(4);
        expect(spans.map(span => span.style.color)).toEqual([
            'rgb(241, 187, 87)', 'rgb(127, 171, 241)', 'rgb(241, 187, 87)', 'rgb(127, 171, 241)',
        ]);
        expect(output.querySelector('p')?.textContent).toBe('Prose “Dialogue” ‘Thought’');
        expect(output.querySelectorAll('mark')).toHaveLength(1);
        expect(output.querySelector('mark')?.textContent).toBe('Highlight');
    });

    it.each(['p', 'div', 'figure'])('exports a %s image wrapper without its white frame', async (tag) => {
        const root = document.createElement('div');
        root.innerHTML = `<${tag} class="portrait" style="border: 3px solid white; padding: 12px; border-radius: 12px;"><img src="data:image/png;base64,portrait"></${tag}>`;
        const html = await exportArcaHtml(root, { readStyle: element => (element as HTMLElement).style });
        const output = document.createElement('div');
        output.innerHTML = html;
        const frame = output.firstElementChild as HTMLElement;
        const image = frame.querySelector('img')!;
        expect(frame.tagName).toBe('P');
        expect(frame.style.borderWidth).toBe('0px');
        expect(frame.style.textAlign).toBe('center');
        expect(image.style.borderWidth).toBe('0px');
        expect(image.style.padding).toBe('0px');
        expect(image.style.borderRadius).toBe('12px');
    });

    it('flattens nested image-only wrappers including rendering comments', async () => {
        const root = document.createElement('div');
        root.innerHTML = `<div style="border: 2px solid white; width: 100%;"><!--render--><div style="border: 1px solid white; border-radius: 20px;"><span><!--image--><img src="data:image/png;base64,portrait"></span></div><!--end--></div>`;
        const output = document.createElement('div');
        output.innerHTML = await exportArcaHtml(root, {
            readStyle: element => (element as HTMLElement).style,
            imageWidthPercent: 40,
        });
        expect(output.querySelectorAll('*')).toHaveLength(2);
        const frame = output.firstElementChild as HTMLElement;
        expect(frame.tagName).toBe('P');
        expect(frame.style.borderWidth).toBe('0px');
        expect(frame.style.textAlign).toBe('center');
        const image = output.querySelector('img')!;
        expect(image.style.borderWidth).toBe('0px');
        expect(image.style.borderRadius).toBe('20px');
        expect(image.style.maxWidth).toBe('40%');
    });

    it('removes the bordered image-only table from the reported Arca HTML', async () => {
        const root = document.createElement('div');
        root.innerHTML = `<table style="border: 2.75px solid rgb(235, 224, 224); border-radius: 20px; max-width: 100%; display: table;">
            <tbody style="display: table-cell;"><tr style="display: table-row;"><td style="border: 0px solid rgb(69, 75, 97); text-align: center; display: table-cell;">
            <p style="border: 0px; text-align: center;"><img alt="Yuri_uniform_shocked" src="data:image/png;base64,portrait" style="border: 0px; max-width: 40%;"></p>
            </td></tr></tbody></table>`;
        const output = document.createElement('div');
        output.innerHTML = await exportArcaHtml(root, {
            readStyle: element => (element as HTMLElement).style,
            imageWidthPercent: 40,
        });
        expect(output.querySelector('table, tbody, tr, td')).toBeNull();
        expect(output.querySelectorAll('*')).toHaveLength(2);
        expect((output.firstElementChild as HTMLElement).style.textAlign).toBe('center');
        const image = output.querySelector('img')!;
        expect(image.alt).toBe('Yuri_uniform_shocked');
        expect(image.style.borderWidth).toBe('0px');
        expect(image.style.borderRadius).toBe('20px');
        expect(image.style.maxWidth).toBe('40%');
    });

    it('keeps captions and unrelated bordered panels when flattening image wrappers', async () => {
        const root = document.createElement('div');
        root.innerHTML = `<figure style="border: 1px solid blue;"><img src="data:image/png;base64,portrait"><figcaption>Caption</figcaption></figure><div style="border: 1px solid red;">Status</div>`;
        const output = document.createElement('div');
        output.innerHTML = await exportArcaHtml(root, { readStyle: element => (element as HTMLElement).style });
        expect(output.querySelector('figcaption')?.textContent).toBe('Caption');
        expect(output.querySelector('figure')?.style.borderWidth).toBe('1px');
        expect((output.lastElementChild as HTMLElement).style.borderWidth).toBe('1px');
    });

    it('preserves external regex colors and supplies a safe explicit choice style', async () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <span class="regex-sound-block">CLANG</span>
            <div class="regex-choice-block">▶ Advance</div>
        `;
        const [sound, choice] = Array.from(root.children) as HTMLElement[];
        const styles = new Map<Element, CSSStyleDeclaration>([
            [root, cssStyle('font-size: 16px;')],
            [sound, cssStyle('display: inline-block; color: rgb(255, 174, 25); font-style: italic;')],
            [choice, cssStyle('display: block;')],
        ]);

        const html = await exportArcaHtml(root, {
            semanticPalette: 'dark',
            readStyle: (element) => styles.get(element) ?? cssStyle(''),
            loadImage: async (url) => url,
        });
        const output = document.createElement('div');
        output.innerHTML = html;
        const [exportedSound, exportedChoice] = Array.from(output.children) as HTMLElement[];

        expect(exportedSound.style.color).toBe('rgb(255, 174, 25)');
        expect(exportedChoice.style.borderLeftWidth).toBe('4px');
        expect(exportedChoice.style.fontWeight).toBe('600');
    });
});

describe('buildArcaClipboardHtml', () => {
    it('builds an Arca-safe wrapper without unsupported layout CSS', () => {
        const html = buildArcaClipboardHtml({
            bodyHtml: '<p style="color: #f8f8f2;">본문</p>',
            displayName: '<레슬레리아나>',
            badge: 'AI',
            iconDataUrl: 'data:image/png;base64,profile',
            fontSizePx: 18,
            colors: {
                background: '#292d3e',
                panel: '#202331',
                text: '#f7f8fc',
                mutedText: '#aeb6cc',
                border: '#454b61',
            },
        });

        expect(html).toContain('&lt;레슬레리아나&gt;');
        expect(html).toContain('<p style="color: #f8f8f2;">본문</p>');
        expect(html).toContain('src="data:image/png;base64,profile"');
        expect(html).toContain('From RisuBard');
        expect(html).toContain('font-size: 18px');
        expect(html).toContain('margin: 1rem 0');
        expect(html).not.toContain('max-width: 600px');
        expect(html).not.toContain('margin: 1rem auto');
        expect(html).not.toMatch(/class=|<style|display:\s*(?:flex|grid)|position:|overflow:|opacity:|url\(/i);
    });

    it('adds an empty paragraph before and after the chat frame for typing around it', () => {
        const html = buildArcaClipboardHtml({
            bodyHtml: '<p>본문</p>',
            displayName: 'Test',
        });
        const output = document.createElement('div');
        output.innerHTML = html;

        expect(output.children).toHaveLength(3);
        expect(output.firstElementChild?.tagName).toBe('P');
        expect(output.firstElementChild?.innerHTML).toBe('<br>');
        expect(output.children[1].tagName).toBe('DIV');
        expect(output.lastElementChild?.tagName).toBe('P');
        expect(output.lastElementChild?.innerHTML).toBe('<br>');
    });

    it('applies a custom base font size to the full-width frame', () => {
        const html = buildArcaClipboardHtml({
            bodyHtml: '<p>본문</p>',
            displayName: 'Test',
            fontSizePx: 24,
        });

        expect(html).toContain('font-size: 24px');
        expect(html).not.toContain('max-width: 600px');
    });

    it('can hide the title image without hiding the title', () => {
        const html = buildArcaClipboardHtml({
            bodyHtml: '<p>본문</p>',
            displayName: 'Title',
            iconDataUrl: 'data:image/png;base64,profile',
            showTitleImage: false,
        });

        expect(html).toContain('>Title</h3>');
        expect(html).not.toContain('data:image/png;base64,profile');
    });

    it('renders the title image as a large oval by default', () => {
        const html = buildArcaClipboardHtml({
            bodyHtml: '<p>본문</p>',
            displayName: 'Title',
            iconDataUrl: 'data:image/png;base64,profile',
        });
        const output = document.createElement('div');
        output.innerHTML = html;
        const image = output.querySelector('img[alt="profile"]') as HTMLImageElement;

        expect(image.style.width).toBe('70%');
        expect(image.style.maxWidth).toBe('420px');
        expect(image.style.borderRadius).toBe('50%');
    });

    it('renders a cropped square title image', () => {
        const html = buildArcaClipboardHtml({
            bodyHtml: '<p>본문</p>',
            displayName: 'Title',
            iconDataUrl: 'data:image/png;base64,profile',
            titleImageStyle: 'square',
        });
        const output = document.createElement('div');
        output.innerHTML = html;
        const image = output.querySelector('img[alt="profile"]') as HTMLImageElement;

        expect(image.style.width).toBe('320px');
        expect(image.style.height).toBe('320px');
        expect(image.style.objectFit).toBe('cover');
        expect(image.style.borderRadius).toBe('12px');
    });

    it('renders a compact thumbnail beside the title', () => {
        const html = buildArcaClipboardHtml({
            bodyHtml: '<p>본문</p>',
            displayName: 'Title',
            badge: 'AI',
            iconDataUrl: 'data:image/png;base64,profile',
            titleImageStyle: 'thumbnail-title',
        });
        const output = document.createElement('div');
        output.innerHTML = html;
        const image = output.querySelector('table img[alt="profile"]') as HTMLImageElement;

        expect(image.style.width).toBe('64px');
        expect(image.style.height).toBe('64px');
        expect(image.style.objectFit).toBe('cover');
        expect(output.querySelector('table')?.textContent).toContain('Title');
        expect(output.querySelector('table')?.textContent).toContain('AI');
    });
});

function cssStyle(cssText: string): CSSStyleDeclaration {
    const element = document.createElement('div');
    element.style.cssText = cssText;
    return element.style;
}

function computedStyle(values: Record<string, string>): CSSStyleDeclaration {
    return { getPropertyValue: (property: string) => values[property] ?? '' } as CSSStyleDeclaration;
}

function domRect(width: number, height: number): DOMRect {
    return { width, height, x: 0, y: 0, top: 0, right: width, bottom: height, left: 0, toJSON() {} };
}
