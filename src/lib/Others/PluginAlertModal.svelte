<script lang="ts">
    import { language } from "src/lang";
    import { pluginAlertModalStore } from "src/ts/stores.svelte";

    

    const reasons:[string,string][] = $derived.by(() => {
        let v = pluginAlertModalStore.errors.map(error => [
            language.pluginRisksInuserFriendly[error.userAlertKey],
            language.pluginRisksInuserFriendlyDesc[error.userAlertKey]
        ] as [string,string])


        //find duplicates and remove them
        v = v.filter(item => {
            const key = item[0]
            const index = v.findIndex(i => i[0] === key)
            return index === v.indexOf(item)
        })
        return v
    })
</script>

{#if pluginAlertModalStore.open}
    <dialog open class="risu-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-overlay/50">
        <div data-skin-part="modal" class="risu-modal-surface bg-warning-bg rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 class="text-xl font-bold mb-4 text-textcolor">
                {language.pluginRiskDetectedAlert}
            </h2>
            
            <ul class="list-disc list-inside mb-4 space-y-2 text-textcolor">
                {#each reasons as reason}
                    <li>{reason[0]}</li>
                    <ul>
                        <li class="ml-4 text-sm italic">{reason[1]}</li>
                    </ul>
                {/each}
            </ul>
            
            <details class="mb-4 text-textcolor">
                
                <details class="mb-4 text-textcolor">
                    <summary class="cursor-pointer text-textcolor mb-2">
                        Dev Info
                    </summary>

                    {#each pluginAlertModalStore.errors as error}
                        <p class="text-textcolor">{error.message}</p>
                    {/each}
                    
                </details>

                <button 
                    class="text-textcolor"
                    onclick={() => {
                        pluginAlertModalStore.open = false
                        pluginAlertModalStore.errors = []
                    }}
                >
                    {language.continueAnyway}
                </button>
            </details>
            
            <button 
                class="w-full bg-darkbutton hover:bg-darkbutton text-textcolor font-semibold py-2 px-4 rounded-sm transition-colors"
                onclick={() => pluginAlertModalStore.open = false}
            >
                {language.doNotInstall}
            </button>
        </div>
    </dialog>
{/if}
