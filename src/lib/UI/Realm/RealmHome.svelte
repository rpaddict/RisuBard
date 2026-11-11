<script lang="ts">
    import { ChevronDownIcon, ChevronUpIcon, SparklesIcon } from '@lucide/svelte';
    import { language } from 'src/lang';
    import { DBState } from 'src/ts/stores.svelte';
    import RealmMain from './RealmMain.svelte';

    let { showRemovedHint = false }: { showRemovedHint?: boolean } = $props();

    let mode = $derived(DBState.db.realmHomeMode ?? (DBState.db.hideRealm ? 'collapsed' : 'show'));
    let expanded = $state(false);

    $effect(() => {
        if (mode !== 'collapsed') expanded = false;
    });
</script>

{#if mode === 'show'}
    <RealmMain />
{:else if mode === 'collapsed' && expanded}
    <div class="mt-4 flex justify-end">
        <button
            type="button"
            data-realm-collapse
            class="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-textcolor2 transition-colors hover:bg-selected hover:text-textcolor"
            onclick={() => expanded = false}
        >
            <ChevronUpIcon size={16} />
            {language.realmHomeCollapse}
        </button>
    </div>
    <RealmMain />
{:else if mode === 'collapsed'}
    <button
        type="button"
        data-realm-expand
        aria-expanded="false"
        class="mt-4 flex w-full items-center gap-3 rounded-2xl border border-darkborderc bg-darkbg px-4 py-3 text-left shadow-lg transition-colors hover:bg-selected/30 sm:px-5"
        onclick={() => expanded = true}
    >
        <span class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary">
            <SparklesIcon size={19} />
        </span>
        <span class="min-w-0 grow">
            <span class="block text-base font-semibold tracking-tight text-textcolor">RisuRealm</span>
            <span class="block text-sm text-textcolor2">{language.realmHomeCollapsedHint}</span>
        </span>
        <span class="flex shrink-0 items-center gap-1 text-sm text-textcolor2">
            {language.realmHomeExpand}
            <ChevronDownIcon size={16} />
        </span>
    </button>
{:else if showRemovedHint}
    <p data-realm-removed class="mt-4 px-4 text-center text-sm text-textcolor2">{language.realmHomeRemovedHint}</p>
{/if}
