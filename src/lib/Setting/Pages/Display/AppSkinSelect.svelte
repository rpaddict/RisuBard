<script lang="ts">
    import { language } from 'src/lang';
    import { DBState } from 'src/ts/stores.svelte';
    import { CheckIcon, ClipboardPasteIcon, DownloadIcon, ExternalLinkIcon, FileUpIcon, Trash2Icon, TriangleAlertIcon } from '@lucide/svelte';
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte';
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte';
    import { type AppSkin, type AppSkinFont } from 'src/ts/gui/appSkin';
    import { appSkinSwatch, defaultAppSkinSwatch, type AppSkinSwatch } from 'src/ts/gui/appSkinSwatch';
    import { detectInstalledFont } from 'src/ts/gui/appSkinFonts';
    import {
        exportAppSkin,
        importAppSkinFile,
        installAppSkinFromText,
        isAppSkinSuppressed,
        listAppSkins,
        missingSkinFonts,
        removeAppSkin,
        selectAppSkin,
    } from 'src/ts/gui/appSkinRuntime';

    let pasteOpen = $state(false);
    let pasteText = $state('');
    const copy = $derived(language.appSkin);
    const entries = $derived(listAppSkins(DBState.db));
    const skins = $derived(entries.map((entry) => entry.skin));
    const activeId = $derived(DBState.db.appSkinId ?? '');
    const suppressed = isAppSkinSuppressed();
    const activeSkin = $derived(skins.find((skin) => skin.id === activeId));
    // The default card shows the user's own color scheme, not whatever skin is active.
    const defaultSwatch = $derived(defaultAppSkinSwatch(DBState.db.colorScheme));

    async function installPasted() {
        // Close first: the replace confirmation opens as an app alert, which sits under an open dialog.
        pasteOpen = false;
        if (await installAppSkinFromText(pasteText)) pasteText = '';
        else pasteOpen = true;
    }

    const swatch = appSkinSwatch;

    type FontStatus = 'embedded' | 'installed' | 'missing' | 'unknown';
    // Embedded fonts ship inside the skin; the rest must be installed on this device.
    const fontRows = $derived.by(() => (activeSkin?.fonts ?? []).map((font: AppSkinFont) => ({
        font,
        status: (font.asset ? 'embedded' : detectInstalledFont(font.family)) as FontStatus,
    })));
    const statusText = (status: FontStatus) => ({
        embedded: copy.fontEmbedded,
        installed: copy.fontInstalled,
        missing: copy.fontMissing,
        unknown: copy.fontUnknown,
    })[status];
    const roleText = (role: AppSkinFont['role']) => role ? (copy as Record<string, string>)[`fontRole${role}`] : copy.fontRoleNone;
</script>

{#snippet preview(s: AppSkinSwatch | null)}
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

        {#each entries as { skin, builtin } (skin.id)}
            {@const selected = activeId === skin.id}
            {@const missingCount = suppressed ? 0 : missingSkinFonts(skin).length}
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
                    {#if missingCount > 0}
                        <span
                            class="absolute left-1.5 top-1.5 z-10 inline-flex h-5 items-center gap-0.5 rounded-full border border-warning-border bg-warning-bg px-1.5 text-[10px] font-semibold text-warning"
                            title={copy.cardMissingFonts.replace('{}', String(missingCount))}
                            data-skin-missing-fonts={missingCount}
                        ><TriangleAlertIcon size={11} aria-hidden="true" />{missingCount}<span class="sr-only">{copy.cardMissingFonts.replace('{}', String(missingCount))}</span></span>
                    {/if}
                    {@render preview(swatch(skin))}
                    <span class="mt-2 block truncate text-sm font-medium text-textcolor" title={skin.name}>{skin.name}</span>
                    <span class="block truncate text-xs text-textcolor2" title={skin.description ?? skin.source}>
                        {builtin ? copy.builtinLabel : skin.source ? copy.sourceLabel.replace('{}', skin.source) : (skin.description ?? skin.id)}
                    </span>
                </button>
                <div class="mt-1.5 flex justify-end gap-1">
                    <ShButton variant="ghost" size="icon-xs" aria-label={`${copy.export}: ${skin.name}`} title={copy.export} onclick={() => exportAppSkin(skin.id)}><DownloadIcon /></ShButton>
                    {#if !builtin}
                        <ShButton variant="ghost" size="icon-xs" aria-label={`${copy.remove}: ${skin.name}`} title={copy.remove} onclick={() => removeAppSkin(skin.id)}><Trash2Icon /></ShButton>
                    {/if}
                </div>
            </div>
        {/each}
    </div>

    {#if !suppressed && activeSkin?.colors && Object.keys(activeSkin.colors).length > 0}
        <p class="mt-2 text-xs text-textcolor2" role="note">{copy.overridesPalette}</p>
    {/if}
    {#if !suppressed && fontRows.length > 0}
        <div class="mt-3 rounded-lg border border-darkborderc p-2" data-app-skin-fonts>
            <span class="text-xs font-semibold text-textcolor">{copy.fontsTitle}</span>
            <ul class="mt-1.5 flex flex-col gap-1.5">
                {#each fontRows as row (row.font.family + row.font.role)}
                    <li class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        <span class="min-w-0 truncate text-sm text-textcolor" style:font-family={`"${row.font.family}", var(--risu-font-ui)`}>{row.font.family}</span>
                        <span class="text-textcolor2">{roleText(row.font.role)}</span>
                        <span
                            class="rounded-sm border px-1.5 py-0.5"
                            class:border-success-border={row.status === 'embedded' || row.status === 'installed'}
                            class:text-success={row.status === 'embedded' || row.status === 'installed'}
                            class:border-warning-border={row.status === 'missing'}
                            class:text-warning={row.status === 'missing'}
                            class:border-darkborderc={row.status === 'unknown'}
                            class:text-textcolor2={row.status === 'unknown'}
                            data-font-status={row.status}
                        >{statusText(row.status)}</span>
                        {#if row.font.url && row.status !== 'embedded' && row.status !== 'installed'}
                            <a class="inline-flex items-center gap-0.5 text-info hover:underline" href={row.font.url} target="_blank" rel="noopener noreferrer">{copy.fontGet}<ExternalLinkIcon size={12} /></a>
                        {/if}
                        {#if row.font.note}<span class="w-full text-textcolor2">{row.font.note}</span>{/if}
                    </li>
                {/each}
            </ul>
            {#if fontRows.some((row) => row.status !== 'embedded' && row.status !== 'installed')}
                <p class="mt-1.5 text-xs text-textcolor2">{copy.fontFallbackHint}</p>
            {/if}
        </div>
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
