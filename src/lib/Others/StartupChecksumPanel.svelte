<script lang="ts">
    import Button from '../UI/GUI/Button.svelte'
    import { language } from 'src/lang'
    import { NodeStorage } from 'src/ts/storage/nodeStorage'
    import type { ChecksumMismatch } from 'src/ts/storage/checksumMismatch'

    interface Props {
        mismatch: ChecksumMismatch
    }

    let { mismatch }: Props = $props()
    let busy = $state(false)
    let failure = $state('')

    async function accept() {
        if (busy || !mismatch.path) return
        busy = true
        failure = ''
        try {
            await new NodeStorage().acceptChecksum(mismatch)
            location.reload()
        } catch (error) {
            failure = error instanceof Error ? error.message : String(error)
            busy = false
        }
    }
</script>

<section
    data-startup-checksum
    aria-labelledby="startup-checksum-title"
    class="mt-5 w-[min(92vw,42rem)] rounded-lg border border-darkborderc bg-bgcolor p-4 text-left text-sm text-textcolor shadow-lg"
>
    <h2 id="startup-checksum-title" class="text-base font-semibold">{language.startupLoading.checksumTitle}</h2>
    <p class="mt-1 leading-relaxed text-textcolor2">{language.startupLoading.checksumHelp}</p>

    <dl class="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
        <dt class="text-textcolor2">{language.startupLoading.checksumFile}</dt>
        <dd class="select-all break-all font-mono text-xs leading-5">{mismatch.file}</dd>
        <dt class="text-textcolor2">{language.startupLoading.checksumExpected}</dt>
        <dd class="select-all break-all font-mono text-xs leading-5">{mismatch.expected ?? language.startupLoading.checksumMissing}</dd>
        <dt class="text-textcolor2">{language.startupLoading.checksumActual}</dt>
        <dd class="select-all break-all font-mono text-xs leading-5">{mismatch.actual}</dd>
    </dl>

    {#if !mismatch.path}
        <p class="mt-3 text-textcolor2">{language.startupLoading.checksumOutside}</p>
    {/if}
    {#if failure}
        <p role="alert" class="mt-3 break-words text-danger">{failure}</p>
    {/if}

    <div class="mt-4 flex flex-wrap justify-end gap-2">
        <Button styled="outlined" size="sm" disabled={busy} onclick={() => location.reload()}>
            {language.startupLoading.checksumRetry}
        </Button>
        {#if mismatch.path}
            <Button size="sm" disabled={busy} onclick={accept}>
                {busy ? language.startupLoading.checksumAccepting : language.startupLoading.checksumAccept}
            </Button>
        {/if}
    </div>
</section>
