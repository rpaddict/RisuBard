<script lang="ts">
    import { language } from 'src/lang'
    import { risuBardCommonSettingsItems } from 'src/ts/setting/risuBardCommonSettingsData'
    import type { SettingItem } from 'src/ts/setting/types'
    import { getLabel } from 'src/ts/setting/utils'
    import SettingPage from 'src/lib/UI/GUI/SettingPage.svelte'
    import SettingRenderer from '../SettingRenderer.svelte'

    const sections: { header: SettingItem; items: SettingItem[] }[] = []
    for (const item of risuBardCommonSettingsItems) {
        if (item.type === 'header') sections.push({ header: item, items: [item] })
        else sections.at(-1)?.items.push(item)
    }
    let content: HTMLDivElement

    function jumpTo(id: string) {
        const target = content.querySelector<HTMLElement>(`[data-setting-id="${id}"]`)
            ?? content.querySelector<HTMLElement>(`[data-common-section="${id}"]`)
        if (!target) return
        target.tabIndex = -1
        target.focus({ preventScroll: true })
        target.scrollIntoView({ block: 'start', behavior: 'instant' })
    }
</script>

<SettingPage title={language.risuBardSettings.common.title} description={language.risuBardSettings.common.description}>
    <div class="common-settings-layout">
    <nav class="common-jump-toolbar" aria-label={language.risuBardSettings.common.title}>
        {#each sections as section (section.header.id)}
            <button type="button" onclick={() => jumpTo(section.header.id)}>{getLabel(section.header)}</button>
            {#if section.items.some((item) => item.id === 'risubard.common.embedding')}
                <button type="button" onclick={() => jumpTo('risubard.embedding')}>의미 검색 임베딩</button>
            {/if}
        {/each}
    </nav>
    <div class="common-settings-content" bind:this={content}>
        {#each sections as section (section.header.id)}
            <section data-common-section={section.header.id} aria-label={getLabel(section.header)} tabindex="-1">
                <SettingRenderer items={section.items} layout="row" compact />
            </section>
        {/each}
    </div>
    </div>
</SettingPage>

<style>
    .common-settings-layout {
        display: grid;
        grid-template-columns: minmax(7rem, 10rem) minmax(0, 1fr);
        align-items: start;
        gap: 1rem;
    }
    .common-jump-toolbar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        flex-direction: column;
        gap: .35rem;
        max-height: 80vh;
        overflow-y: auto;
        flex-shrink: 0;
        padding: .5rem;
        border: 1px solid var(--settings-border);
        border-radius: var(--settings-radius);
        background: var(--color-darkbg);
    }
    .common-jump-toolbar button {
        flex-shrink: 0;
        min-height: 2.25rem;
        padding: .35rem .65rem;
        border-radius: calc(var(--risu-radius-lg) * 0.8);
        color: var(--color-textcolor);
        font-size: .8rem;
        text-align: left;
        overflow-wrap: anywhere;
    }
    .common-jump-toolbar button:hover { background: var(--settings-surface-hover); }
    .common-jump-toolbar button:focus-visible,
    .common-settings-content section:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
    }
    .common-settings-content { min-width: 0; }
    .common-settings-content section,
    .common-settings-content :global([data-setting-id]) { scroll-margin-top: .5rem; }
    .common-settings-content :global(.settings-standard-row) { min-height: 3rem; padding: .55rem .85rem; }
    .common-settings-content :global(.settings-standard-group) { margin-bottom: 1.3rem; }
    @media (max-width: 480px) {
        .common-settings-layout { grid-template-columns: minmax(5rem, 7rem) minmax(0, 1fr); gap: .5rem; }
        .common-jump-toolbar { padding: .25rem; }
        .common-jump-toolbar button { padding: .35rem; }
        .common-settings-content :global(.settings-standard-row:not(.flex-col)) { flex-wrap: wrap; gap: .6rem; }
    }
</style>
