<script lang="ts">
    import { CopyIcon, HardDriveUploadIcon, ImageOffIcon, Share2Icon, Trash2Icon, TrashIcon, UploadIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import { DBState } from "src/ts/stores.svelte";
    import { alertConfirm, notifyError, notifySuccess } from "src/ts/alert";
    import {
        selectChatPromptPreset,
        copyPreset,
        downloadPreset,
        importPreset,
        deleteBotPreset,
    } from "src/ts/storage/database.svelte";
    import { selectSingleFile } from "src/ts/util";
    import { findHttpUrlAtOffset } from "src/ts/setting/promptPresetSettingsData.svelte";
    import { openURL } from "src/ts/globalApi.svelte";
    import TextInput from "src/lib/UI/GUI/TextInput.svelte";
    import ShButton from "src/lib/UI/GUI/ShButton.svelte";
    import type { botPreset } from "src/ts/storage/database.svelte";

    let {
        getPreset,
    }: {
        getPreset?: () => botPreset | null | undefined;
    } = $props();

    const activePreset = $derived(getPreset?.() ?? DBState.db.botPresets[DBState.db.botPresetsId]);
    const activeIndex = $derived(DBState.db.botPresets.findIndex((preset) => preset === activePreset || preset.id === activePreset?.id));

    function selectImportedOrDuplicated(index: number) {
        selectChatPromptPreset(index);
    }

    async function uploadIcon() {
        const sel = await selectSingleFile(['png', 'jpg', 'jpeg', 'webp']);
        if (!sel) return;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const img = new Image();
        //@ts-expect-error Uint8Array buffer type (ArrayBufferLike) is incompatible with BlobPart's ArrayBuffer
        const blob = new Blob([sel.data], { type: "image/png" });
        img.src = URL.createObjectURL(blob);
        await img.decode();
        canvas.width = 48;
        canvas.height = 48;
        ctx.drawImage(img, 0, 0, 48, 48);
        const data = canvas.toDataURL('image/jpeg', 0.7);
        if (activePreset) activePreset.image = data;
    }

    function removeIcon() {
        if (activePreset) activePreset.image = undefined;
    }

    function handleDescriptionClick(event: MouseEvent & { currentTarget: HTMLTextAreaElement }) {
        if (!event.shiftKey) return;
        const url = findHttpUrlAtOffset(event.currentTarget.value, event.currentTarget.selectionStart);
        if (!url) return;
        event.preventDefault();
        openURL(url);
    }

    function handleExport() {
        downloadPreset(activeIndex, 'risupreset');
        notifySuccess(language.presetExported);
    }

    function handleDuplicate() {
        const before = DBState.db.botPresets.length;
        copyPreset(activeIndex);
        const after = DBState.db.botPresets.length;
        if (after > before) {
            selectImportedOrDuplicated(after - 1);
            notifySuccess(language.presetDuplicated);
        }
    }

    async function handleImport() {
        const before = DBState.db.botPresets.length;
        await importPreset();
        const after = DBState.db.botPresets.length;
        if (after > before) {
            selectImportedOrDuplicated(after - 1);
            notifySuccess(language.presetImported);
        }
    }

    async function handleDelete() {
        if (DBState.db.botPresets.length <= 1) {
            notifyError(language.errors.onlyOnePreset);
            return;
        }
        const presetId = activePreset?.id;
        if (!presetId) return;
        const presetName = activePreset?.name ?? '';
        const ok = await alertConfirm(`${language.presetDeleteConfirm}\n${presetName}`);
        if (!ok) return;

        if (deleteBotPreset(presetId)) notifySuccess(language.presetDeleted);
    }
</script>

<div class="flex flex-col gap-3">
    {#if activePreset}
        <div data-prompt-preset-identity class="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-3">
            <div class="flex flex-col gap-1">
                <span class="text-sm text-textcolor">{language.icon}</span>
                <div class="flex items-center gap-1.5">
                    {#if activePreset.image}
                        <img src={activePreset.image} alt="icon"
                             class="size-10 rounded-md shrink-0" decoding="async" />
                    {:else}
                        <div class="size-10 rounded-md bg-darkbutton border border-darkborderc flex items-center justify-center text-textcolor2 shrink-0">
                            <ImageOffIcon size={18} />
                        </div>
                    {/if}
                    <ShButton variant="default" size="icon-sm" onclick={uploadIcon}
                              title={language.presetImport} aria-label={language.presetImport}>
                        <UploadIcon size={16} />
                    </ShButton>
                    {#if activePreset.image}
                        <ShButton variant="destructive" size="icon-sm" onclick={removeIcon}
                                  title={language.iconRemove} aria-label={language.iconRemove}>
                            <TrashIcon size={16} />
                        </ShButton>
                    {/if}
                </div>
            </div>
            <label class="flex min-w-0 flex-col gap-1">
                <span class="text-sm text-textcolor">{language.name}</span>
                <TextInput bind:value={activePreset.name} fullwidth />
            </label>
        </div>

        <label data-prompt-preset-description class="flex flex-col gap-1">
            <span class="text-sm text-textcolor">{language.promptPresetDescription}</span>
            <textarea
                class="min-h-20 w-full resize-y rounded-md border border-darkborderc bg-transparent px-4 py-2 text-textcolor shadow-xs transition-colors focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
                value={activePreset.description ?? ''}
                placeholder={language.promptPresetDescriptionPlaceholder}
                oninput={(event) => activePreset.description = event.currentTarget.value}
                onclick={handleDescriptionClick}
            ></textarea>
            <span class="text-xs text-textcolor2">{language.promptPresetDescriptionLinkHint}</span>
        </label>
    {/if}

    <div class="grid grid-cols-4 gap-2">
        <ShButton variant="default" size="default" className="w-full min-w-0" onclick={handleDuplicate} title={language.presetDuplicate}>
            <CopyIcon size={16} />
            <span class="hidden sm:inline">{language.presetDuplicate}</span>
        </ShButton>
        <ShButton variant="default" size="default" className="w-full min-w-0" onclick={handleExport} title={language.presetExport}>
            <Share2Icon size={16} />
            <span class="hidden sm:inline">{language.presetExport}</span>
        </ShButton>
        <ShButton variant="default" size="default" className="w-full min-w-0" onclick={handleImport} title={language.presetImport}>
            <HardDriveUploadIcon size={16} />
            <span class="hidden sm:inline">{language.presetImport}</span>
        </ShButton>
        <ShButton variant="destructive" size="default" className="w-full min-w-0" onclick={handleDelete} title={language.presetDelete}>
            <Trash2Icon size={16} />
            <span class="hidden sm:inline">{language.presetDelete}</span>
        </ShButton>
    </div>
</div>
