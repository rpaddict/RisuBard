<script lang="ts">
    import { language } from 'src/lang'
    import SettingPage from 'src/lib/UI/GUI/SettingPage.svelte'
    import RisuBardGrimoirePromptWorkspace from './RisuBardGrimoirePromptWorkspace.svelte'
</script>

<SettingPage
    title={language.risuBardGrimoirePrompt.title}
    description={language.risuBardGrimoirePrompt.description}
    fullWidth={true}
>
    <RisuBardGrimoirePromptWorkspace />
</SettingPage>
