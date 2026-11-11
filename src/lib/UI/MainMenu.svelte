<script lang="ts">
    import { nodeOnlyVer } from '../../ts/storage/database.svelte';
    import Hub from './Realm/RealmHome.svelte';
    import AssetStoreTransition from './AssetStoreTransition.svelte';
</script>

<div class="flex h-full w-full flex-col items-center overflow-y-auto">
    <header
        data-home-brand
        class="flex w-full max-w-4xl items-baseline gap-2 px-4 pt-4 text-textcolor"
        aria-label={`RisuBard v${nodeOnlyVer}`}
    >
        <span class="text-lg font-semibold tracking-tight">RisuBard</span>
        <span class="text-xs font-medium opacity-60">v{nodeOnlyVer}</span>
    </header>
    <main class="flex w-full max-w-4xl flex-col gap-4 p-4 text-textcolor">
        <AssetStoreTransition placement="home" />
        <Hub />
    </main>
</div>
