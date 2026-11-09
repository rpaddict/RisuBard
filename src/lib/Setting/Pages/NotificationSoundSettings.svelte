<script lang="ts">
    import { language } from 'src/lang';
    import SettingPage from 'src/lib/UI/GUI/SettingPage.svelte';
    import { DBState } from 'src/ts/stores.svelte';
    import NotificationToggle from './Display/NotificationToggle.svelte';
    import SoundGroup from './Sound/SoundGroup.svelte';
    import SoundSetting from './Sound/SoundSetting.svelte';
    import UiSoundSetting from './Sound/UiSoundSetting.svelte';
</script>

<SettingPage title={language.soundAndNotification}>
    <SoundGroup title={language.groupBrowserNotification}>
        <NotificationToggle />
    </SoundGroup>

    <SoundGroup title={language.groupMessageNotification}>
        <SoundSetting
            description={language.descMessageSound}
            bind:enabled={DBState.db.playMessage}
            bind:sound={DBState.db.messageSound}
            bind:volume={DBState.db.messageSoundVolume}
        />
    </SoundGroup>

    <SoundGroup title={language.groupTranslateNotification}>
        <SoundSetting
            description={language.descTranslateSound}
            bind:enabled={DBState.db.playMessageOnTranslateEnd}
            bind:sound={DBState.db.translateSound}
            bind:volume={DBState.db.translateSoundVolume}
        />
    </SoundGroup>

    <SoundGroup title={language.groupUiSound}>
        <UiSoundSetting />
    </SoundGroup>
</SettingPage>
