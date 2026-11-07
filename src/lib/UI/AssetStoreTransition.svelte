<script lang="ts">
    import { onDestroy, onMount } from 'svelte'
    import { DatabaseIcon, ArrowRightIcon } from '@lucide/svelte'
    import { DBState } from 'src/ts/stores.svelte'
    import { isNodeServer } from 'src/ts/platform'
    import { forageStorage } from 'src/ts/globalApi.svelte'
    import { alertConfirm } from 'src/ts/alert'
    import ShButton from './GUI/ShButton.svelte'
    import { setAssetStoreConvertible } from 'src/ts/storage/assetStorePending.svelte'

    interface Props {
        /** home: a prominent card at the top of the start page; settings: the plain settings panel. */
        placement?: 'home' | 'settings'
    }
    let { placement = 'settings' }: Props = $props()

    type Status = {
        convertible: number
        unconvertible: number
        stored: number
        manifestEntries: number
        manifestBytes: number
        lastManifestSaveMs: number | null
    }
    const TRIAL_LIMIT = 1000

    let status = $state<Status | null>(null)
    let busy = $state<'' | 'check' | 'trial' | 'all' | 'revert'>('')
    let stopRequested = $state(false)
    let progress = $state<{ done: number; total: number } | null>(null)
    let message = $state('')
    let error = $state('')
    // Keeps the home card after a run finishes so the result stays readable.
    let ranThisSession = $state(false)
    onDestroy(() => { stopRequested = true })

    const isKorean = $derived(DBState.db.language === 'ko')
    const count = (value: number) => value.toLocaleString(isKorean ? 'ko-KR' : 'en-US')
    const fileSize = (bytes: number) => bytes < 1048576
        ? `${Math.max(1, Math.round(bytes / 1024))}KB`
        : `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)}MB`
    const seconds = (ms: number) => ms < 1000 ? `${Math.max(1, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}${isKorean ? '초' : 's'}`

    const ui = $derived(isKorean ? {
        homeTitle: '에셋 저장 구조를 전환해 주세요',
        homeDone: '에셋 저장 구조 전환을 마쳤습니다',
        homeIntro: '에셋을 목록 파일 밖의 전용 폴더로 옮기면 저장과 봇 설치가 빨라집니다. 원본은 지우지 않으며 언제든 되돌릴 수 있습니다. 이전 버전 앱으로 돌아가기 전에는 먼저 되돌려 주세요.',
        items: (value: number) => `${count(value)}개`,
        title: '에셋 저장 구조 전환',
        intro: '에셋을 목록 파일(manifest.json) 밖의 전용 폴더로 옮깁니다. 목록이 작아져 저장, 봇 설치, 업데이트가 빨라집니다. 새로 들어오는 에셋은 이미 전용 폴더에 저장됩니다.',
        safety: '옮기는 동안 원본을 지우지 않으며, 언제든 되돌리기로 이전 구조로 돌아갈 수 있습니다. 이전 버전 앱으로 돌아가기 전에는 먼저 되돌려 주세요.',
        convertible: '옮길 에셋',
        stored: '전용 폴더의 에셋',
        manifest: '목록 파일',
        lastSave: '최근 목록 저장 1회',
        check: '점검',
        trial: `시험 전환 (${count(TRIAL_LIMIT)}개)`,
        all: '전체 전환',
        revert: '되돌리기',
        stop: '중지',
        stopping: '중지 대기 중',
        checking: '점검 중…',
        none: '옮길 에셋이 없습니다.',
        progress: (done: number, total: number) => `${count(done)} / ${count(total)}개 옮김`,
        reverting: (done: number, total: number) => `${count(done)} / ${count(total)}개 되돌림`,
        trialDone: (converted: number, verified: number, failed: number) => failed
            ? `${count(converted)}개를 옮겼고 ${count(failed)}개는 다시 읽기 검증에 실패했습니다. 전체 전환 전에 되돌려 주세요.`
            : `${count(converted)}개를 옮기고 모두 다시 읽어 확인했습니다(${count(verified)}개 일치). 문제가 없으면 전체 전환을 진행해 주세요.`,
        allDone: (converted: number) => `${count(converted)}개를 옮겼습니다.`,
        stopped: (converted: number) => `${count(converted)}개를 옮긴 뒤 멈췄습니다. 다시 누르면 이어서 옮깁니다.`,
        revertDone: (reverted: number) => `${count(reverted)}개를 이전 구조로 되돌렸습니다.`,
        skipped: (value: number) => `원본 파일을 찾지 못한 에셋 ${count(value)}개는 그대로 두었습니다.`,
        busyFiles: (value: number) => `다른 프로그램이 쓰고 있는 등의 이유로 지금 옮기지 못한 에셋 ${count(value)}개는 그대로 두었습니다. 서버를 다시 켠 뒤 전환하면 다시 시도합니다.`,
        failed: '요청을 처리하지 못했습니다. 서버 연결을 확인하고 다시 시도해 주세요. 이미 옮긴 에셋은 그대로 읽힙니다.',
        revertConfirm: '전용 폴더의 에셋을 모두 목록 파일로 되돌릴까요? 에셋이 많으면 저장이 다시 느려집니다.',
    } : {
        homeTitle: 'Upgrade your asset storage',
        homeDone: 'Asset storage upgrade finished',
        homeIntro: 'Moving assets out of the list file into their own folder makes saving and bot installs faster. Originals are never deleted, and you can revert at any time. Revert first before going back to an older app version.',
        items: (value: number) => count(value),
        title: 'Asset storage upgrade',
        intro: 'Moves assets out of the list file (manifest.json) into their own folder. A smaller list makes saving, bot installs and updates faster. New assets are already stored in that folder.',
        safety: 'Originals are never deleted during the move, and Revert returns to the previous layout at any time. Revert first before going back to an older app version.',
        convertible: 'Assets to move',
        stored: 'Assets in the folder',
        manifest: 'List file',
        lastSave: 'Last list save',
        check: 'Check',
        trial: `Trial (${count(TRIAL_LIMIT)})`,
        all: 'Move all',
        revert: 'Revert',
        stop: 'Stop',
        stopping: 'Stopping',
        checking: 'Checking…',
        none: 'Nothing left to move.',
        progress: (done: number, total: number) => `${count(done)} / ${count(total)} moved`,
        reverting: (done: number, total: number) => `${count(done)} / ${count(total)} reverted`,
        trialDone: (converted: number, verified: number, failed: number) => failed
            ? `Moved ${count(converted)}; ${count(failed)} failed the read-back check. Revert before moving all.`
            : `Moved ${count(converted)} and read every one back (${count(verified)} matched). If all looks fine, move the rest.`,
        allDone: (converted: number) => `Moved ${count(converted)} assets.`,
        stopped: (converted: number) => `Stopped after moving ${count(converted)}. Press again to resume.`,
        revertDone: (reverted: number) => `Reverted ${count(reverted)} assets.`,
        skipped: (value: number) => `${count(value)} assets whose original file is missing were left as they are.`,
        busyFiles: (value: number) => `${count(value)} assets could not be moved right now (for example, another program has them open) and were left as they are. Restart the server and move again to retry.`,
        failed: 'The request failed. Check the server connection and try again. Assets already moved stay readable.',
        revertConfirm: 'Return every asset in the folder to the list file? With many assets, saving becomes slow again.',
    })

    const storage = () => forageStorage.realStorage as unknown as {
        assetStoreTransition(action: 'status' | 'convert' | 'revert', options?: { limit?: number; verify?: boolean }): Promise<any>
    }

    async function refresh() {
        await forageStorage.Init()
        status = await storage().assetStoreTransition('status')
    }

    onMount(() => { void refresh().catch(() => { status = null }) })
    // The sidebar home button blinks while this count is above zero.
    $effect(() => { if (status) setAssetStoreConvertible(status.convertible) })

    async function check() {
        busy = 'check'
        error = ''
        message = ''
        try { await refresh() }
        catch { error = ui.failed }
        finally { busy = '' }
    }

    async function trial() {
        busy = 'trial'
        error = ''
        message = ''
        ranThisSession = true
        try {
            await forageStorage.Init()
            const result = await storage().assetStoreTransition('convert', { limit: TRIAL_LIMIT, verify: true })
            status = result.status
            message = ui.trialDone(result.converted, result.verified ?? 0, result.failed ?? 0)
            if (result.missing) message += ` ${ui.skipped(result.missing)}`
            if (result.errors) message += ` ${ui.busyFiles(result.errors)}`
        } catch { error = ui.failed }
        finally { busy = '' }
    }

    async function runAll(action: 'convert' | 'revert') {
        if (action === 'revert' && !await alertConfirm(ui.revertConfirm)) return
        busy = action === 'convert' ? 'all' : 'revert'
        stopRequested = false
        error = ''
        message = ''
        ranThisSession = true
        let done = 0
        let missing = 0
        let busyFiles = 0
        try {
            await forageStorage.Init()
            const total = action === 'convert' ? (status?.convertible ?? 0) : (status?.stored ?? 0)
            progress = { done: 0, total }
            while (!stopRequested) {
                const result = await storage().assetStoreTransition(action)
                status = result.status
                const moved = action === 'convert' ? result.converted : result.reverted
                done += moved
                missing += result.missing ?? 0
                busyFiles += result.errors ?? 0
                progress = { done, total: Math.max(total, done + result.remaining) }
                if (!moved || !result.remaining) break
            }
            message = action === 'revert' ? ui.revertDone(done)
                : stopRequested && status?.convertible ? ui.stopped(done) : ui.allDone(done)
            if (missing) message += ` ${ui.skipped(missing)}`
            if (busyFiles) message += ` ${ui.busyFiles(busyFiles)}`
        } catch { error = ui.failed }
        finally {
            busy = ''
            progress = null
            stopRequested = false
        }
    }

    const visible = $derived(isNodeServer && status !== null
        && (placement === 'settings' || status.convertible > 0 || ranThisSession))
</script>

{#if visible && status && placement === 'home'}
    <section class="home-card" aria-labelledby="asset-store-home-title">
        <div class="home-head">
            <span class="home-mark" aria-hidden="true"><DatabaseIcon size={24} /></span>
            <div class="home-copy">
                <h2 id="asset-store-home-title">{status.convertible ? ui.homeTitle : ui.homeDone}</h2>
                <p>{ui.homeIntro}</p>
            </div>
        </div>
        <dl class="home-tiles">
            <div><dt>{ui.convertible}</dt><dd class="lead">{ui.items(status.convertible)}</dd></div>
            <div><dt>{ui.manifest}</dt><dd>{fileSize(status.manifestBytes)}</dd></div>
            {#if status.lastManifestSaveMs !== null}
                <div><dt>{ui.lastSave}</dt><dd>{seconds(status.lastManifestSaveMs)}</dd></div>
            {:else}
                <div><dt>{ui.stored}</dt><dd>{ui.items(status.stored)}</dd></div>
            {/if}
        </dl>
        <div class="home-actions">
            <button type="button" class="home-button primary" onclick={() => runAll('convert')} disabled={!!busy || !status.convertible}>
                <ArrowRightIcon size={18} aria-hidden="true" />{ui.all}
            </button>
            <button type="button" class="home-button" onclick={trial} disabled={!!busy || !status.convertible}>{ui.trial}</button>
            <button type="button" class="home-button quiet" onclick={check} disabled={!!busy}>{busy === 'check' ? ui.checking : ui.check}</button>
            {#if busy === 'all' || busy === 'revert'}
                <button type="button" class="home-button quiet" onclick={() => { stopRequested = true }} disabled={stopRequested}>{stopRequested ? ui.stopping : ui.stop}</button>
            {/if}
            <button type="button" class="home-revert" onclick={() => runAll('revert')} disabled={!!busy || !status.stored}>{ui.revert}</button>
        </div>
        {#if progress || message || error}
            <div class="home-state" role="status" aria-live="polite">
                {#if progress}
                    <div class="home-meter" aria-hidden="true"><span style:width={`${progress.total ? Math.min(100, progress.done / progress.total * 100) : 0}%`}></span></div>
                    <p>{busy === 'revert' ? ui.reverting(progress.done, progress.total) : ui.progress(progress.done, progress.total)}</p>
                {:else if message}
                    <p>{message}</p>
                {/if}
                {#if error}<p class="error">{error}</p>{/if}
            </div>
        {/if}
    </section>
{:else if visible && status}
    <section class="panel" aria-labelledby="asset-store-title">
        <h2 id="asset-store-title">{ui.title}</h2>
        <p>{ui.intro}</p>
        <p>{ui.safety}</p>
        <dl class="facts">
            <div><dt>{ui.convertible}</dt><dd>{count(status.convertible)}</dd></div>
            <div><dt>{ui.stored}</dt><dd>{count(status.stored)}</dd></div>
            <div><dt>{ui.manifest}</dt><dd>{fileSize(status.manifestBytes)}</dd></div>
            {#if status.lastManifestSaveMs !== null}
                <div><dt>{ui.lastSave}</dt><dd>{seconds(status.lastManifestSaveMs)}</dd></div>
            {/if}
        </dl>
        <div class="actions">
            <ShButton variant="outline" size="sm" onclick={check} disabled={!!busy}>{busy === 'check' ? ui.checking : ui.check}</ShButton>
            <ShButton variant="outline" size="sm" onclick={trial} disabled={!!busy || !status.convertible}>{ui.trial}</ShButton>
            <ShButton variant="primary" size="sm" onclick={() => runAll('convert')} disabled={!!busy || !status.convertible}>{ui.all}</ShButton>
            {#if busy === 'all' || busy === 'revert'}
                <ShButton variant="outline" size="sm" onclick={() => { stopRequested = true }} disabled={stopRequested}>{stopRequested ? ui.stopping : ui.stop}</ShButton>
            {/if}
            <ShButton variant="ghost" size="sm" className="revert" onclick={() => runAll('revert')} disabled={!!busy || !status.stored}>{ui.revert}</ShButton>
        </div>
        <div class="state" role="status" aria-live="polite">
            {#if progress}
                <div class="meter" aria-hidden="true"><span style:width={`${progress.total ? Math.min(100, progress.done / progress.total * 100) : 0}%`}></span></div>
                <p>{busy === 'revert' ? ui.reverting(progress.done, progress.total) : ui.progress(progress.done, progress.total)}</p>
            {:else if message}
                <p>{message}</p>
            {:else if !status.convertible}
                <p>{ui.none}</p>
            {/if}
            {#if error}<p class="error">{error}</p>{/if}
        </div>
    </section>
{/if}

<style>
    /* Settings placement: the plain settings panel. */
    .panel {
        display: grid; gap: .65rem; width: 100%; min-width: 0; padding: 1rem;
        background: var(--settings-surface, var(--color-darkbg)); border: 1px solid var(--settings-border, var(--color-darkborderc));
        border-radius: var(--settings-radius, calc(var(--risu-radius-lg) * 1.2));
    }
    .panel h2 { font-size: 1rem; font-weight: 600; color: var(--color-textcolor); }
    .panel p { margin: 0; color: var(--color-textcolor2); line-height: 1.55; max-width: 70ch; }
    .facts { display: flex; flex-wrap: wrap; gap: .4rem 1.5rem; margin: .15rem 0; }
    .facts div { display: grid; gap: .1rem; }
    .facts dt { font-size: .78rem; color: var(--color-textcolor2); }
    .facts dd { margin: 0; font-size: 1rem; font-weight: 600; color: var(--color-textcolor); font-variant-numeric: tabular-nums; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
    .actions :global(.revert) { margin-left: auto; }
    .state { display: grid; gap: .4rem; min-height: 1.5rem; }
    .meter { height: .375rem; border-radius: 999px; background: var(--color-darkbutton); overflow: hidden; }
    .meter span { display: block; height: 100%; background: var(--color-primary); transition: width .3s cubic-bezier(.16, 1, .3, 1); }
    .error { color: var(--color-danger); }

    /* Home placement: a warm card that is hard to overlook, mixed from the theme background. */
    .home-card {
        --orange: color-mix(in srgb, var(--color-warning) 70%, var(--color-draculared));
        --orange-deep: color-mix(in srgb, var(--orange) 65%, var(--color-darkbg));
        --on-orange: var(--color-on-warning);
        display: grid; gap: 1rem; width: 100%; min-width: 0; padding: 1.15rem 1.25rem;
        background: color-mix(in srgb, var(--orange) 16%, var(--color-bgcolor));
        border: 1px solid color-mix(in srgb, var(--orange-deep) 85%, var(--color-bgcolor));
        border-radius: var(--risu-radius-xl);
        color: var(--color-textcolor);
    }
    .home-head { display: flex; gap: .9rem; align-items: flex-start; }
    .home-mark {
        flex: none; display: flex; align-items: center; justify-content: center;
        width: 2.75rem; height: 2.75rem; border-radius: calc(var(--risu-radius-lg) * 1.3);
        background: var(--orange); color: var(--on-orange);
    }
    .home-copy { display: grid; gap: .3rem; min-width: 0; }
    .home-copy h2 { margin: 0; font-size: 1.15rem; font-weight: 600; line-height: 1.35; color: var(--color-textcolor); text-wrap: balance; }
    .home-copy p { margin: 0; font-size: .92rem; line-height: 1.6; max-width: 68ch; color: color-mix(in srgb, var(--color-textcolor) 84%, var(--orange)); }
    .home-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .6rem; margin: 0; }
    .home-tiles div { display: grid; gap: .15rem; padding: .65rem .8rem; border-radius: calc(var(--risu-radius-lg) * 1.1); background: color-mix(in srgb, var(--orange) 26%, var(--color-bgcolor)); }
    .home-tiles dt { font-size: .78rem; color: color-mix(in srgb, var(--color-textcolor) 72%, var(--orange)); }
    .home-tiles dd { margin: 0; font-size: 1.35rem; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--color-textcolor); }
    .home-tiles dd.lead { color: color-mix(in srgb, var(--orange) 80%, var(--color-textcolor)); }
    .home-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
    .home-button {
        display: inline-flex; align-items: center; gap: .4rem; height: 2.5rem; padding: 0 1rem;
        border-radius: var(--risu-radius-lg); font-size: .92rem; font-weight: 600; cursor: pointer;
        color: color-mix(in srgb, var(--color-textcolor) 80%, var(--orange));
        background: transparent; border: 1px solid color-mix(in srgb, var(--orange-deep) 85%, var(--color-bgcolor));
        transition: background-color .15s ease-out, border-color .15s ease-out;
    }
    .home-button:hover:not(:disabled) { background: color-mix(in srgb, var(--orange) 18%, transparent); }
    .home-button.primary { color: var(--on-orange); background: var(--orange); border-color: var(--orange); }
    .home-button.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--orange) 85%, var(--color-textcolor)); }
    .home-button.quiet { border-color: color-mix(in srgb, var(--color-textcolor) 22%, var(--color-bgcolor)); color: var(--color-textcolor); }
    .home-button:disabled, .home-revert:disabled { opacity: .5; cursor: not-allowed; }
    .home-button:focus-visible, .home-revert:focus-visible { outline: 2px solid var(--orange); outline-offset: 2px; }
    .home-revert {
        margin-left: auto; padding: .25rem .1rem; font-size: .85rem; cursor: pointer; background: none; border: none;
        color: color-mix(in srgb, var(--color-textcolor) 65%, var(--orange));
        text-decoration: underline; text-underline-offset: 3px;
    }
    .home-state { display: grid; gap: .4rem; }
    .home-state p { margin: 0; font-size: .9rem; line-height: 1.55; color: var(--color-textcolor); }
    .home-meter { height: .4rem; border-radius: 999px; overflow: hidden; background: color-mix(in srgb, var(--orange) 22%, var(--color-bgcolor)); }
    .home-meter span { display: block; height: 100%; background: var(--orange); transition: width .3s cubic-bezier(.16, 1, .3, 1); }
    @media (max-width: 480px) {
        .home-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .home-tiles div:first-child { grid-column: 1 / -1; }
        .home-revert { margin-left: 0; }
    }
</style>
