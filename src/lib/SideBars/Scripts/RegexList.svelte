<script lang="ts">
    import type { customscript } from "src/ts/storage/database.svelte";
    import RegexData from "./RegexData.svelte";
    import Sortable from "sortablejs";
    import { sleep, sortableOptions } from "src/ts/util";
    import { onDestroy, onMount, tick, untrack } from "svelte";
    import { characterEditorJumpRequest } from "src/ts/stores.svelte";
  import { DownloadIcon, HardDriveUploadIcon, PlusIcon } from "@lucide/svelte";
  import { exportRegex, importRegex } from "src/ts/process/scripts";
    interface Props {
        value?: customscript[];
        buttons?: boolean
        /** Set on the selected character's list, which Character Assistant links open. */
        jumpTarget?: boolean
    }

    let { value = $bindable([]), buttons = false, jumpTarget = false }: Props = $props();
    let openRequest = $state<{ index: number; nonce: number } | null>(null)

    $effect(() => {
        const request = $characterEditorJumpRequest
        if (!jumpTarget || request?.kind !== 'regex') return
        untrack(() => void revealScript(request.index, request.nonce))
    })
    async function revealScript(index: number, nonce: number) {
        if (index < 0 || index >= value.length) return
        openRequest = { index, nonce }
        characterEditorJumpRequest.set(null)
        await tick()
        ele?.querySelector<HTMLElement>(`[data-risu-idx="${index}"]`)?.scrollIntoView({ block: 'center' })
    }
    let stb: Sortable = null
    let ele: HTMLDivElement = $state()
    let sorted = $state(0)
    let opened = 0
    const createStb = () => {
        // Children tear down before this component does, so a child's onDestroy can
        // settle the counter to 0 while the list node is already detached. Checking
        // isConnected (not a local flag, which is still false at that point) keeps us
        // from building a Sortable that would immediately be thrown away.
        if(!ele?.isConnected){
            return
        }
        stb = Sortable.create(ele, {
            onEnd: async () => {
                let idx:number[] = []
                ele.querySelectorAll('[data-risu-idx]').forEach((e, i) => {
                    idx.push(parseInt(e.getAttribute('data-risu-idx')))
                })
                let newValue:customscript[] = []
                idx.forEach((i) => {
                    newValue.push(value[i])
                })
                value = newValue
                try {
                    stb.destroy()
                } catch (error) {}
                sorted += 1
                await sleep(1)
                createStb()
            },
            ...sortableOptions
        })
    }

    const onOpen = () => {
        opened += 1
        if(stb){
            try {
                stb.destroy()
            } catch (error) {}
        }
    }
    const onClose = () => {
        opened -= 1
        if(opened === 0){
            createStb()
        }
    }

    onMount(createStb)

    onDestroy(() => {
        if(stb){
            try {
                stb.destroy()
            } catch (error) {}
        }
    })
</script>
{#key sorted}
    <div class="contain w-full max-w-full mt-2 flex flex-col p-3 border-selected border-1 bg-darkbg rounded-md" bind:this={ele}>
        {#if value.length === 0}
                <div class="text-textcolor2">No Scripts</div>
        {/if}
        <!-- Keyed: RegexData's `open` is per-instance state, so with an unkeyed each a
             deletion would destroy the LAST instance's state rather than the removed
             row's, desyncing the `opened` counter and killing drag reordering. -->
        {#each value as customscript, i (customscript)}
            <RegexData idx={i} bind:value={value[i]} openSignal={openRequest?.index === i ? openRequest.nonce : 0} onOpen={onOpen} onClose={onClose} onRemove={() => {
                let customscript = value
                customscript.splice(i, 1)
                value = customscript
            }}/>
        {/each}
    </div>
{/key}
{#if buttons}
    <div class="flex gap-2 mt-2">
        <button class="rounded-md text-textcolor2 hover:text-textcolor focus-within:text-textcolor" onclick={() => {
            value.push({
            comment: "",
            in: "",
            out: "",
            type: "editinput"
            })
        }}>
            <PlusIcon />
        </button>
        <button class="rounded-md text-textcolor2 hover:text-textcolor focus-within:text-textcolor" onclick={() => {
            exportRegex(value)
        }}><DownloadIcon /></button>
        <button class="rounded-md text-textcolor2 hover:text-textcolor focus-within:text-textcolor" onclick={async () => {
            value = await importRegex(value)
        }}><HardDriveUploadIcon /></button>
    </div>
{/if}