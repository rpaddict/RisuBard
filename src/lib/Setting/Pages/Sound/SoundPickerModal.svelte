<script lang="ts">
    import { language } from 'src/lang';
    import ShDialog from 'src/lib/UI/GUI/ShDialog.svelte';
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte';
    import { bundledSoundIds, playSoundPreview } from 'src/ts/notificationSound';
    import { saveAsset } from 'src/ts/globalApi.svelte';
    import { selectSingleFile } from 'src/ts/util';
    import { DBState } from 'src/ts/stores.svelte';
    import { v4 as uuidv4 } from 'uuid';
    import { PlayIcon, UploadIcon, CheckIcon, Trash2Icon } from '@lucide/svelte';

    interface Preset {
        value: string;
        label: string;
        /** Selected when the stored value is empty. */
        isDefault?: boolean;
    }

    interface Props {
        open?: boolean;
        /** Current sound: a preset value or an uploaded "assets/<hash>" path. */
        value?: string;
        /** Volume (0-100) used for previews. */
        volume?: number;
        /** Dialog title; defaults to the notification sound title. */
        title?: string;
        /** Bundled choices; defaults to the notification jingles. */
        presets?: Preset[];
        /** Which upload list this picker reads and writes, so each sound family keeps its own uploads. */
        uploadList?: 'customSounds' | 'customUiSounds';
        /** Custom preview (e.g. Web Audio for button sounds). Defaults to the notification preview. */
        preview?: (value: string) => void;
    }

    let {
        open = $bindable(false),
        value = $bindable(''),
        volume = 100,
        title,
        presets = bundledSoundIds.map((id) => ({
            value: id,
            label: id === 'default' ? language.soundDefault : id,
            isDefault: id === 'default',
        })),
        uploadList = 'customSounds',
        preview = (v: string) => playSoundPreview(v, volume),
    }: Props = $props();

    let uploads = $derived(DBState.db[uploadList] ?? []);

    function select(v: string) {
        value = v;
        preview(v);
    }

    async function uploadSound() {
        const f = await selectSingleFile(['mp3', 'wav', 'ogg', 'm4a']);
        if (!f) return;
        // saveAsset hashes by content, so re-uploading the same file yields the
        // same path. Skip adding a second entry for identical bytes — just select
        // the existing one — but new content gets its own uuid-keyed entry.
        const path = await saveAsset(f.data, '', f.name);
        if (!uploads.some((s) => s.path === path)) {
            DBState.db[uploadList] = [...uploads, { id: uuidv4(), name: f.name, path }];
        }
        select(path);
    }

    function removeCustom(entry: { id: string, path: string }) {
        DBState.db[uploadList] = uploads.filter((s) => s.id !== entry.id);
        if (value === entry.path) {
            value = '';
        }
    }
</script>

<ShDialog bind:open size="default" tier="alert">
    {#snippet title()}
        {title ?? language.selectNotificationSound}
    {/snippet}

    <!-- data-ui-sound="off": every row previews its sound, so no click sound on top. -->
    <div class="flex flex-col gap-1 max-h-[50vh] overflow-y-auto pr-1" data-ui-sound="off">
        {#each presets as preset (preset.value)}
            {@const selected = value === preset.value || (!value && preset.isDefault)}
            <div class="flex items-center gap-2 rounded-md px-3 py-2 transition-colors {selected ? 'bg-selected' : 'hover:bg-selected/50'}">
                {#if selected}
                    <CheckIcon size={16} class="text-primary shrink-0" />
                {:else}
                    <span class="w-4 shrink-0"></span>
                {/if}
                <button class="flex-1 text-left truncate" onclick={() => select(preset.value)}>
                    {preset.label}
                </button>
                <button class="shrink-0 hover:text-primary" onclick={() => preview(preset.value)} aria-label={language.preview}>
                    <PlayIcon size={18} />
                </button>
            </div>
        {/each}

        {#each uploads as s (s.id)}
            {@const selected = value === s.path}
            <div class="flex items-center gap-2 rounded-md px-3 py-2 transition-colors {selected ? 'bg-selected' : 'hover:bg-selected/50'}">
                {#if selected}
                    <CheckIcon size={16} class="text-primary shrink-0" />
                {:else}
                    <span class="w-4 shrink-0"></span>
                {/if}
                <button class="flex-1 text-left truncate" onclick={() => select(s.path)} title={s.name}>
                    {s.name}
                </button>
                <button class="shrink-0 hover:text-primary" onclick={() => preview(s.path)} aria-label={language.preview}>
                    <PlayIcon size={18} />
                </button>
                <button class="shrink-0 text-textcolor2 hover:text-danger/80" onclick={() => removeCustom(s)} aria-label={language.remove}>
                    <Trash2Icon size={18} />
                </button>
            </div>
        {/each}
    </div>

    {#snippet footer()}
        <ShButton variant="default" size="sm" onclick={uploadSound}>
            <UploadIcon size={16} />
            {language.uploadSound}
        </ShButton>
    {/snippet}
</ShDialog>
