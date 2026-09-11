<script lang="ts">
  import { SaveIcon } from "@lucide/svelte";
  import { saving } from "src/ts/globalApi.svelte";
  import { DBState } from "src/ts/stores.svelte";

  let visible = $state(false);

  $effect(() => {
    if (!DBState?.db?.showSavingIcon || !saving.state) {
      visible = false;
      return;
    }

    const timer = setTimeout(() => {
      visible = true;
    }, 750);
    return () => clearTimeout(timer);
  });
</script>

{#if visible && DBState?.db?.showSavingIcon && saving.state}
  <div
    data-save-indicator
    aria-hidden="true"
    class="absolute top-2 right-2 z-10 text-on-info p-1 rounded-sm bg-info pointer-events-none opacity-25"
  >
    <SaveIcon size={14} />
  </div>
{/if}
