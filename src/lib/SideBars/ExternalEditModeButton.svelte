<script lang="ts">
    import { language } from 'src/lang'
    import { externalEditMode, toggleExternalEditMode } from 'src/ts/globalApi.svelte'
    import SolarBoldIcon from '../UI/Icons/SolarBoldIcon.svelte'
    import BarIcon from './BarIcon.svelte'

    const label = $derived(externalEditMode.active
        ? language.externalEditModeFinish
        : language.externalEditModeStart)
</script>

<div data-external-edit-mode-button>
    <BarIcon
        onClick={() => void toggleExternalEditMode()}
        ariaLabel={label}
        title={label}
        pressed={externalEditMode.active}
        disabled={externalEditMode.busy}
    >
        <SolarBoldIcon name="hourglass" size={24} />
    </BarIcon>
</div>
