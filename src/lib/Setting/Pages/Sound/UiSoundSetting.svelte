<script lang="ts">
    import { language } from 'src/lang';
    import ShSwitch from 'src/lib/UI/GUI/ShSwitch.svelte';
    import ShSlider from 'src/lib/UI/GUI/ShSlider.svelte';
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte';
    import { PlayIcon, Music2Icon } from '@lucide/svelte';
    import { DBState } from 'src/ts/stores.svelte';
    import { previewUiSound, type UiSoundKind } from 'src/ts/uiSound';
    import SoundRow from './SoundRow.svelte';
    import SoundPickerModal from './SoundPickerModal.svelte';

    let enabled = $derived(DBState.db.uiSoundEnabled !== false);
    let pickerKind = $state<UiSoundKind | null>(null);
    let pickerOpen = $state(false);

    const builtinLabel = (kind: UiSoundKind) => kind === 'click' ? language.uiSoundBuiltin : language.uiSoundBuiltinHover;

    function soundValue(kind: UiSoundKind): string {
        return (kind === 'click' ? DBState.db.uiSoundClickSound : DBState.db.uiSoundHoverSound) ?? '';
    }

    function setSoundValue(kind: UiSoundKind, value: string) {
        if (kind === 'click') DBState.db.uiSoundClickSound = value;
        else DBState.db.uiSoundHoverSound = value;
    }

    function soundName(kind: UiSoundKind): string {
        const value = soundValue(kind);
        if (value.startsWith('assets/')) {
            return (DBState.db.customUiSounds ?? []).find((s) => s.path === value)?.name ?? language.uploadedSound;
        }
        // Anything else (including a stale notification preset id) plays the default.
        return builtinLabel(kind);
    }

    function openPicker(kind: UiSoundKind) {
        pickerKind = kind;
        pickerOpen = true;
    }
</script>

{#snippet soundRow(kind: UiSoundKind, label: string, description: string | undefined, on: boolean, setOn: (v: boolean) => void)}
    <SoundRow {label} {description} dimmed={!enabled}>
        <!-- data-ui-sound="off": previews must not stack with their own click sound. -->
        <div class="flex items-center gap-1 min-w-0" data-ui-sound="off">
            <ShButton
                variant="outline"
                size="sm"
                disabled={!enabled || !on}
                onclick={() => openPicker(kind)}
                className="max-w-44"
                title={soundName(kind)}
            >
                <Music2Icon size={14} class="shrink-0" />
                <span class="truncate">{soundName(kind)}</span>
            </ShButton>
            <ShButton
                variant="ghost"
                size="icon-sm"
                disabled={!enabled || !on}
                onclick={() => previewUiSound(kind, soundValue(kind), DBState.db.uiSoundVolume)}
                aria-label={`${language.preview}: ${label}`}
            >
                <PlayIcon size={16} />
            </ShButton>
            <ShSwitch checked={on} disabled={!enabled} onCheckedChange={setOn} ariaLabel={label} />
        </div>
    </SoundRow>
{/snippet}

<div class="divide-y divide-darkborderc" data-ui-sound-settings>
    <SoundRow label={language.uiSoundEnable} description={language.descUiSound}>
        <ShSwitch checked={enabled} onCheckedChange={(v) => (DBState.db.uiSoundEnabled = v)} ariaLabel={language.uiSoundEnable} />
    </SoundRow>

    {@render soundRow('click', language.uiSoundClick, undefined, DBState.db.uiSoundClick !== false, (v) => (DBState.db.uiSoundClick = v))}
    {@render soundRow('hover', language.uiSoundHover, language.descUiSoundHover, DBState.db.uiSoundHover !== false, (v) => (DBState.db.uiSoundHover = v))}

    <SoundRow label={language.soundEffectVolume} dimmed={!enabled}>
        <div class="w-48">
            <ShSlider bind:value={DBState.db.uiSoundVolume} min={0} max={100} step={1} inputWidth="w-14" disabled={!enabled} />
        </div>
    </SoundRow>
</div>

{#if pickerKind}
    {@const kind = pickerKind}
    <SoundPickerModal
        bind:open={pickerOpen}
        bind:value={() => soundValue(kind), (v) => setSoundValue(kind, v)}
        volume={DBState.db.uiSoundVolume}
        title={language.selectUiSound}
        presets={[{ value: '', label: builtinLabel(kind), isDefault: true }]}
        uploadList="customUiSounds"
        preview={(v) => previewUiSound(kind, v, DBState.db.uiSoundVolume)}
    />
{/if}
