<script lang="ts">
    import { language } from 'src/lang';
    import { DBState } from 'src/ts/stores.svelte';
    import { CheckIcon, ClipboardPasteIcon, DownloadIcon, FileUpIcon, Trash2Icon } from '@lucide/svelte';
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte';
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte';
    import type { AppSkin } from 'src/ts/gui/appSkin';
    import {
        exportAppSkin,
        importAppSkinFile,
        installAppSkinFromText,
        isAppSkinSuppressed,
        removeAppSkin,
        selectAppSkin,
    } from 'src/ts/gui/appSkinRuntime';

    let pasteOpen = $state(false);
    let pasteText = $state('');
    const copy = $derived(language.appSkin);
    const skins = $derived((DBState.db.appSkins ?? []) as AppSkin[]);
    const activeId = $derived(DBState.db.appSkinId ?? '');
    const suppressed = isAppSkinSuppressed();
    const activeSkin = $derived(skins.find((skin) => skin.id === activeId));
    // The default card shows the user's own color scheme, not whatever skin is active.
    const defaultSwatch = $derived.by(() => {
        const scheme = DBState.db.colorScheme;
        return {
            ground: scheme.bgcolor,
            surface: scheme.darkbg,
            border: scheme.darkBorderc,
            text: scheme.textcolor,
            accent: scheme.primary,
            accentText: scheme.accentText ?? scheme.textcolor,
            radius: '0.375rem',
            font: 'inherit',
        };
    });

    async function installPasted() {
        if (await installAppSkinFromText(pasteText)) {
            pasteText = '';
            pasteOpen = false;
        }
    }

    // Preview swatch from the skin's own colors; missing roles fall back to the current theme.
    function swatch(skin: AppSkin) {
        const c = skin.colors ?? {};
        const t = skin.tokens ?? {};
        return {
            ground: c.bgcolor ?? 'var(--color-bgcolor)',
            surface: c.darkbg ?? 'var(--color-darkbg)',
            border: c.darkborderc ?? 'var(--color-darkborderc)',
            text: c.textcolor ?? 'var(--color-textcolor)',
            accent: c.primary ?? 'var(--color-primary)',
            accentText: c.accenttext ?? 'var(--color-accenttext)',
            radius: t['radius-md'] ?? 'var(--risu-radius-md)',
            font: t['font-ui'] ?? 'inherit',
        };
    }
</script>

{#snippet preview(s: ReturnType<typeof swatch> | null)}
    <span
        class="block h-16 overflow-hidden rounded-md border"
        style:background-color={s?.ground ?? 'var(--color-bgcolor)'}
        style:border-color={s?.border ?? 'var(--color-darkborderc)'}
        aria-hidden="true"
    >
        <span
            class="m-2 flex h-12 items-center gap-2 border px-2"
            style:background-color={s?.surface ?? 'var(--color-darkbg)'}
            style:border-color={s?.border ?? 'var(--color-darkborderc)'}
            style:border-radius={s?.radius ?? 'var(--risu-radius-md)'}
        >
            <span class="min-w-0 flex-1 text-left text-xs font-semibold" style:color={s?.text ?? 'var(--color-textcolor)'} style:font-family={s?.font ?? 'inherit'}>Aa 가</span>
            <span
                class="inline-flex h-6 shrink-0 items-center px-2 text-[10px] font-bold"
                style:background-color={s?.accent ?? 'var(--color-primary)'}
                style:color={s?.accentText ?? 'var(--color-accenttext)'}
                style:border-radius={s?.radius ?? 'var(--risu-radius-md)'}
            >OK</span>
        </span>
    </span>
{/snippet}

<section class="border-t border-darkborderc py-3" aria-labelledby="app-skin-label" data-app-skin-settings>
    <div class="min-w-0">
        <span id="app-skin-label" class="text-sm text-textcolor">{copy.title}</span>
        <p class="mt-0.5 text-xs text-textcolor2">{copy.help}</p>
        {#if suppressed}
            <p class="mt-2 rounded-md border border-warning-border bg-warning-bg px-2 py-1.5 text-xs text-warning" role="status">{copy.safeModeActive}</p>
        {/if}
    </div>

    <div class="mt-3 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2" role="group" aria-labelledby="app-skin-label">
        <button
            type="button"
            data-app-skin-card=""
            class="relative min-w-0 rounded-lg border p-2 text-left transition-colors hover:bg-darkbutton focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            class:border-primary={activeId === ''}
            class:border-darkborderc={activeId !== ''}
            class:bg-selected={activeId === ''}
            class:ring-2={activeId === ''}
            class:ring-primary={activeId === ''}
            aria-pressed={activeId === ''}
            onclick={() => selectAppSkin('')}
        >
            {#if activeId === ''}
                <span class="absolute right-1.5 top-1.5 z-10 inline-flex size-5 items-center justify-center rounded-full bg-primary text-accenttext" aria-hidden="true"><CheckIcon size={12} strokeWidth={3} /></span>
            {/if}
            {@render preview(defaultSwatch)}
            <span class="mt-2 block truncate text-sm font-medium text-textcolor">{copy.defaultSkin}</span>
            <span class="block truncate text-xs text-textcolor2">{copy.defaultSkinDetail}</span>
        </button>

        {#each skins as skin (skin.id)}
            {@const selected = activeId === skin.id}
            <div
                class="relative flex min-w-0 flex-col rounded-lg border p-2 transition-colors"
                class:border-primary={selected}
                class:border-darkborderc={!selected}
                class:bg-selected={selected}
                class:ring-2={selected}
                class:ring-primary={selected}
            >
                <button
                    type="button"
                    data-app-skin-card={skin.id}
                    class="min-w-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-pressed={selected}
                    onclick={() => selectAppSkin(skin.id)}
                >
                    {#if selected}
                        <span class="absolute right-1.5 top-1.5 z-10 inline-flex size-5 items-center justify-center rounded-full bg-primary text-accenttext" aria-hidden="true"><CheckIcon size={12} strokeWidth={3} /></span>
                    {/if}
                    {@render preview(swatch(skin))}
                    <span class="mt-2 block truncate text-sm font-medium text-textcolor" title={skin.name}>{skin.name}</span>
                    <span class="block truncate text-xs text-textcolor2" title={skin.description ?? skin.source}>
                        {skin.source ? copy.sourceLabel.replace('{}', skin.source) : (skin.description ?? skin.id)}
                    </span>
                </button>
                <div class="mt-1.5 flex justify-end gap-1">
                    <ShButton variant="ghost" size="icon-xs" aria-label={`${copy.export}: ${skin.name}`} title={copy.export} onclick={() => exportAppSkin(skin.id)}><DownloadIcon /></ShButton>
                    <ShButton variant="ghost" size="icon-xs" aria-label={`${copy.remove}: ${skin.name}`} title={copy.remove} onclick={() => removeAppSkin(skin.id)}><Trash2Icon /></ShButton>
                </div>
            </div>
        {/each}
    </div>

    {#if !suppressed && activeSkin?.colors && Object.keys(activeSkin.colors).length > 0}
        <p class="mt-2 text-xs text-textcolor2" role="note">{copy.overridesPalette}</p>
    {/if}
    {#if skins.length === 0}
        <p class="mt-2 text-xs text-textcolor2">{copy.empty}</p>
    {/if}

    <div class="mt-3 flex flex-wrap gap-2">
        <ShButton variant="outline" size="sm" onclick={() => importAppSkinFile()}><FileUpIcon size={15} />{copy.importFile}</ShButton>
        <ShButton variant="outline" size="sm" onclick={() => { pasteOpen = true }}><ClipboardPasteIcon size={15} />{copy.pasteCode}</ShButton>
    </div>
</section>

{#if pasteOpen}
    <ShDialog open onOpenChange={(open) => { if (!open) pasteOpen = false }} size="lg" closeOnEscape ariaLabel={copy.pasteTitle}>
        {#snippet title()}{copy.pasteTitle}{/snippet}
        <textarea
            data-skin-part="input"
            class="h-64 w-full resize-y rounded-md border border-darkborderc bg-transparent p-2 font-mono text-sm text-textcolor focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
            placeholder={copy.pastePlaceholder}
            aria-label={copy.pastePlaceholder}
            spellcheck="false"
            bind:value={pasteText}
        ></textarea>
        {#snippet footer()}
            <ShButton variant="ghost" onclick={() => { pasteOpen = false }}>{language.cancel}</ShButton>
            <ShButton variant="primary" disabled={!pasteText.trim()} onclick={installPasted}>{copy.install}</ShButton>
        {/snippet}
    </ShDialog>
{/if}
