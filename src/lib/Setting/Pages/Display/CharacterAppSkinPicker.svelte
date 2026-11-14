<script lang="ts">
    // Links an installed app skin to the open bot. The link lives in app settings, not in the bot file.
    import { language } from 'src/lang';
    import { DBState, selectedCharID } from 'src/ts/stores.svelte';
    import { CheckIcon, GlobeIcon } from '@lucide/svelte';
    import { requestImmediateSave } from 'src/ts/globalApi.svelte';
    import { appSkinSwatch, defaultAppSkinSwatch, type AppSkinSwatch } from 'src/ts/gui/appSkinSwatch';
    import { characterAppSkinId, isAppSkinSuppressed, listAppSkins, toggleCharacterAppSkin } from 'src/ts/gui/appSkinRuntime';
    import AppSkinPreview from './AppSkinPreview.svelte';

    const copy = $derived(language.appSkin);
    const entries = $derived(listAppSkins(DBState.db));
    const character = $derived($selectedCharID >= 0 ? DBState.db.characters?.[$selectedCharID] : undefined);
    const linkedId = $derived(characterAppSkinId(DBState.db, $selectedCharID));
    const globalId = $derived(DBState.db.appSkinId ?? '');
    const globalName = $derived(globalId === '' ? copy.defaultSkin : (entries.find((entry) => entry.skin.id === globalId)?.skin.name ?? globalId));
    const suppressed = isAppSkinSuppressed();
    const defaultSwatch = $derived(defaultAppSkinSwatch(DBState.db.colorScheme));

    function pick(id: string) {
        if (!character) return;
        toggleCharacterAppSkin(id);
        void requestImmediateSave();
    }
</script>

{#snippet card(id: string, name: string, detail: string, s: AppSkinSwatch | null)}
    {@const linked = linkedId === id}
    <button
        type="button"
        data-character-app-skin={id}
        class="relative flex min-w-0 flex-col rounded-lg border p-2 text-left transition-colors hover:bg-darkbutton focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
        class:border-primary={linked}
        class:border-darkborderc={!linked}
        class:bg-selected={linked}
        class:ring-2={linked}
        class:ring-primary={linked}
        aria-pressed={linked}
        aria-label={`${name}: ${linked ? copy.botActive : copy.botActivate}`}
        title={linked ? copy.botActive : copy.botActivate}
        disabled={!character}
        onclick={() => pick(id)}
    >
        {#if linked}
            <span class="absolute right-1.5 top-1.5 z-10 inline-flex size-5 items-center justify-center rounded-full bg-primary text-accenttext" aria-hidden="true"><CheckIcon size={12} strokeWidth={3} /></span>
        {/if}
        <AppSkinPreview swatch={s} />
        <span class="mt-2 block truncate text-sm font-medium text-textcolor" title={name}>{name}</span>
        <span class="block truncate text-xs text-textcolor2" title={detail}>{detail}</span>
        <span class="mt-1.5 flex min-h-5 flex-wrap items-center gap-1 text-[11px] font-semibold">
            {#if linked}
                <span class="rounded-sm bg-primary px-1.5 py-0.5 text-accenttext">{copy.botActive}</span>
            {/if}
            {#if globalId === id}
                <span class="inline-flex items-center gap-0.5 rounded-sm border border-darkborderc px-1.5 py-0.5 text-textcolor2"><GlobeIcon size={11} aria-hidden="true" />{copy.botGlobal}</span>
            {/if}
        </span>
    </button>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1" data-character-app-skins>
    {#if suppressed}
        <p class="rounded-md border border-warning-border bg-warning-bg px-2 py-1.5 text-xs text-warning" role="status">{copy.safeModeActive}</p>
    {/if}
    {#if !character}
        <p class="text-sm text-textcolor2" role="status">{copy.botNoCharacter}</p>
    {:else if linkedId === null}
        <p class="text-xs text-textcolor2" role="status" data-character-app-skin-status>{copy.botFollowsGlobal.replace('{}', globalName)}</p>
    {/if}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2" role="group" aria-label={copy.title}>
        {@render card('', copy.defaultSkin, copy.defaultSkinDetail, defaultSwatch)}
        {#each entries as { skin, builtin } (skin.id)}
            {@render card(skin.id, skin.name, builtin ? copy.builtinLabel : skin.source ? copy.sourceLabel.replace('{}', skin.source) : (skin.description ?? skin.id), appSkinSwatch(skin))}
        {/each}
    </div>
</div>
