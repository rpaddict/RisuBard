<script lang="ts">
    import { CopyIcon, DownloadIcon, RefreshCwIcon, ShieldCheckIcon, TriangleAlertIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { notifyError, notifySuccess } from 'src/ts/alert'
    import { downloadFile, forageStorage } from 'src/ts/globalApi.svelte'
    import SettingPage from 'src/lib/UI/GUI/SettingPage.svelte'
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import CharacterAssetTransition from './CharacterAssetTransition.svelte'
    import ModuleAssetTransition from './ModuleAssetTransition.svelte'

    interface DurationSummary {
        p50: number | null
        p90: number | null
    }

    interface StorageDiagnosticReport {
        reportType: 'risubard-storage-diagnostics'
        schemaVersion: 1
        appVersion: string
        status: 'no-observations' | 'no-issues-observed' | 'issues-detected'
        saves: { attempts: number; successes: number; failures: number; durationMs: DurationSummary }
        canonicalProjection: { attempts: number; successes: number; failures: number; durationMs: DurationSummary }
        directWrites: { attempts: number; successes: number; fallbacks: number; failures: number }
        materialization?: { attempts: number; successes: number; failures: number; durationMs: DurationSummary }
        shadow: { checks: number; matches: number; mismatches: number; failures: number; skipped: number }
        issues: Array<{ area: string; stage: string; code: string; count: number }>
        privacy: { includesPersonalContent: false; includesRawLogs: false; omitted: string[] }
    }

    let report = $state<StorageDiagnosticReport | null>(null)
    let loading = $state(false)

    function reportText() {
        return report ? JSON.stringify(report, null, 2) : ''
    }

    function formatDuration(value: number | null) {
        return value === null ? '—' : `${Math.round(value).toLocaleString()} ms`
    }

    function statusLabel() {
        if (!report || report.status === 'no-observations') return language.storageDiagnosticsNoObservations
        return report.status === 'issues-detected'
            ? language.storageDiagnosticsIssuesDetected
            : language.storageDiagnosticsNoIssues
    }

    async function generateReport() {
        loading = true
        try {
            const response = await fetch('/api/storage-diagnostics/report', {
                headers: { 'risu-auth': await forageStorage.createAuth() },
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            report = await response.json()
            notifySuccess(language.storageDiagnosticsGenerated)
        } catch {
            notifyError(language.storageDiagnosticsFailed, { source: 'storage-diagnostics' })
        } finally {
            loading = false
        }
    }

    async function downloadReport() {
        const text = reportText()
        if (!text) return
        await downloadFile('risubard-storage-diagnostics.json', new TextEncoder().encode(text))
    }

    async function copyReport() {
        const text = reportText()
        if (!text) return
        try {
            await navigator.clipboard.writeText(text)
            notifySuccess(language.storageDiagnosticsCopied)
        } catch {
            notifyError(language.storageDiagnosticsFailed, { source: 'storage-diagnostics' })
        }
    }
</script>

<SettingPage title={language.storageDiagnosticsTitle} description={language.storageDiagnosticsDesc}>
    <div class="diagnostics-stack">
        <CharacterAssetTransition />
        <ModuleAssetTransition />
        <section class="privacy-note" aria-label={language.storageDiagnosticsPrivacy}>
            <ShieldCheckIcon size={20} />
            <p>{language.storageDiagnosticsPrivacy}</p>
        </section>

        <div class="action-row">
            <ShButton variant="primary" onclick={generateReport} disabled={loading}>
                <RefreshCwIcon size={16} class={loading ? 'animate-spin' : ''} />
                {loading ? language.storageDiagnosticsGenerating : language.storageDiagnosticsGenerate}
            </ShButton>
            <ShButton variant="outline" onclick={downloadReport} disabled={!report || loading}>
                <DownloadIcon size={16} />
                {language.storageDiagnosticsDownload}
            </ShButton>
            <ShButton variant="outline" onclick={copyReport} disabled={!report || loading}>
                <CopyIcon size={16} />
                {language.storageDiagnosticsCopy}
            </ShButton>
        </div>

        {#if report}
            <section class="status-panel" class:has-issues={report.status === 'issues-detected'}>
                <div class="status-heading">
                    {#if report.status === 'issues-detected'}
                        <TriangleAlertIcon size={20} />
                    {:else}
                        <ShieldCheckIcon size={20} />
                    {/if}
                    <div>
                        <strong>{statusLabel()}</strong>
                        <span>RisuBard {report.appVersion}</span>
                    </div>
                </div>
                <div class="metric-grid">
                    <div class="metric">
                        <span>{language.storageDiagnosticsSaveSuccess}</span>
                        <strong>{report.saves.successes.toLocaleString()} / {report.saves.attempts.toLocaleString()}</strong>
                    </div>
                    <div class="metric">
                        <span>{language.storageDiagnosticsSaveP50}</span>
                        <strong>{formatDuration(report.saves.durationMs.p50)}</strong>
                    </div>
                    <div class="metric">
                        <span>{language.storageDiagnosticsSaveP90}</span>
                        <strong>{formatDuration(report.saves.durationMs.p90)}</strong>
                    </div>
                    <div class="metric">
                        <span>{language.storageDiagnosticsShadowMatch}</span>
                        <strong>{report.shadow.matches.toLocaleString()} / {report.shadow.checks.toLocaleString()}</strong>
                    </div>
                    <div class="metric">
                        <span>{language.storageDiagnosticsDirectWriteSuccess}</span>
                        <strong>{report.directWrites.successes.toLocaleString()} / {report.directWrites.attempts.toLocaleString()}</strong>
                    </div>
                    <div class="metric">
                        <span>{language.storageDiagnosticsDirectWriteFallback}</span>
                        <strong>{report.directWrites.fallbacks.toLocaleString()}</strong>
                    </div>
                    {#if report.materialization}
                        <div class="metric">
                            <span>{language.storageDiagnosticsMaterialization}</span>
                            <strong>{report.materialization.successes.toLocaleString()} / {report.materialization.attempts.toLocaleString()}</strong>
                        </div>
                        <div class="metric">
                            <span>{language.storageDiagnosticsMaterializationP90}</span>
                            <strong>{formatDuration(report.materialization.durationMs.p90)}</strong>
                        </div>
                    {/if}
                </div>
            </section>

            {#if report.issues.length > 0}
                <section class="issue-panel">
                    <h2>{language.storageDiagnosticsIssues}</h2>
                    <div class="issue-list">
                        {#each report.issues as issue (`${issue.area}:${issue.stage}:${issue.code}`)}
                            <div class="issue-row">
                                <code>{issue.area} / {issue.stage} / {issue.code}</code>
                                <strong>×{issue.count.toLocaleString()}</strong>
                            </div>
                        {/each}
                    </div>
                </section>
            {:else}
                <p class="empty-copy">
                    {report.status === 'no-observations'
                        ? language.storageDiagnosticsNoDataDesc
                        : language.storageDiagnosticsNoIssueDesc}
                </p>
            {/if}
        {/if}
    </div>
</SettingPage>

<style>
    .diagnostics-stack { display: grid; gap: 1rem; }
    .privacy-note { display: flex; align-items: flex-start; gap: .75rem; padding: .9rem 1rem; color: var(--color-textcolor); background: color-mix(in srgb, var(--color-primary) 9%, var(--color-darkbg)); border: 1px solid color-mix(in srgb, var(--color-primary) 30%, var(--color-darkborderc)); border-radius: .75rem; }
    .privacy-note p { margin: 0; color: var(--color-textcolor2); line-height: 1.55; }
    .privacy-note :global(svg) { flex: 0 0 auto; color: var(--color-primary); margin-top: .1rem; }
    .action-row { display: flex; flex-wrap: wrap; gap: .55rem; }
    .status-panel, .issue-panel { overflow: hidden; background: var(--settings-surface); border: 1px solid var(--settings-border); border-radius: var(--settings-radius); }
    .status-panel.has-issues { border-color: color-mix(in srgb, var(--color-danger) 45%, var(--settings-border)); }
    .status-heading { display: flex; align-items: center; gap: .7rem; padding: 1rem; border-bottom: 1px solid var(--settings-border); }
    .status-heading > div { display: grid; gap: .15rem; }
    .status-heading strong { font-size: 1rem; color: var(--color-textcolor); }
    .status-heading span { font-size: .8rem; color: var(--color-textcolor2); }
    .status-heading :global(svg) { color: var(--color-success); }
    .has-issues .status-heading :global(svg) { color: var(--color-danger); }
    .metric-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .metric { display: grid; gap: .3rem; min-width: 0; padding: 1rem; border-right: 1px solid var(--settings-border); }
    .metric:nth-child(3n) { border-right: 0; }
    .metric:nth-child(-n + 3) { border-bottom: 1px solid var(--settings-border); }
    .metric span { color: var(--color-textcolor2); font-size: .78rem; }
    .metric strong { color: var(--color-textcolor); font-size: 1.05rem; font-variant-numeric: tabular-nums; }
    .issue-panel h2 { margin: 0; padding: .85rem 1rem; color: var(--color-textcolor); font-size: .9rem; border-bottom: 1px solid var(--settings-border); }
    .issue-list { display: grid; }
    .issue-row { display: flex; justify-content: space-between; gap: 1rem; padding: .75rem 1rem; color: var(--color-textcolor); border-bottom: 1px solid var(--settings-border); }
    .issue-row:last-child { border-bottom: 0; }
    .issue-row code { overflow-wrap: anywhere; color: var(--color-textcolor2); font-size: .78rem; }
    .empty-copy { margin: 0; padding: .9rem 1rem; color: var(--color-textcolor2); background: var(--settings-surface); border: 1px solid var(--settings-border); border-radius: var(--settings-radius); }
    @media (max-width: 720px) {
        .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .metric { border-right: 1px solid var(--settings-border); border-bottom: 0; }
        .metric:nth-child(2n) { border-right: 0; }
        .metric:nth-child(-n + 4) { border-bottom: 1px solid var(--settings-border); }
    }
    @media (max-width: 460px) {
        .action-row :global(button) { width: 100%; }
        .metric-grid { grid-template-columns: 1fr; }
        .metric { border-right: 0; border-bottom: 1px solid var(--settings-border); }
        .metric:last-child { border-bottom: 0; }
    }
</style>
