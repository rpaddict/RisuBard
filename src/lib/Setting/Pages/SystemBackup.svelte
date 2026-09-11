<script lang="ts">
    import ShButton from 'src/lib/UI/GUI/ShButton.svelte'
    import { DownloadIcon, UploadIcon, SettingsIcon } from '@lucide/svelte'
    import { alertConfirm } from 'src/ts/alert'
    import { language } from 'src/lang'
    import {
        CleanupMigratedFiles,
        ImportFromSaveZip,
        LoadLocalBackup,
        SaveLocalBackup,
        SaveLocalBackupForUpstream,
        SavePartialLocalBackup,
        SaveSettingsOnlyBackup,
    } from 'src/ts/drive/backuplocal'
    import { exportAsDataset } from 'src/ts/storage/exportAsDataset'
    import ShAccordion from 'src/lib/UI/GUI/ShAccordion.svelte'
    import Button from 'src/lib/UI/GUI/Button.svelte'

    async function downloadLocal() {
        if (!(await alertConfirm(language.backupConfirm))) return
        SaveLocalBackup()
    }

    function downloadSettingsOnly() {
        SaveSettingsOnlyBackup()
    }

    async function restoreFromLocalFile() {
        if (!(await alertConfirm(language.backupLoadConfirm))) return
        if (!(await alertConfirm(language.backupLoadConfirm2))) return
        LoadLocalBackup()
    }

    async function downloadForUpstream() {
        if (!(await alertConfirm(language.saveBackupForUpstreamConfirm))) return
        SaveLocalBackupForUpstream()
    }

    async function downloadPartial() {
        if (!(await alertConfirm(language.backupConfirm))) return
        SavePartialLocalBackup()
    }
</script>

<p class="text-textcolor2 text-sm mb-4">{language.backupTabDesc}</p>

<div class="border border-darkborderc bg-darkbg/40 rounded-md p-4 mb-4">
    <div class="flex items-center gap-2 text-textcolor mb-3">
        <DownloadIcon size={16} />
        <span class="font-medium">{language.backupLocal}</span>
    </div>
    <p class="text-textcolor2 text-sm leading-relaxed mb-3">{language.backupLocalDesc}</p>

    <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-3 p-3 border border-darkborderc/50 rounded-md bg-bgcolor/50">
            <div class="flex flex-col min-w-0 flex-1">
                <span class="text-textcolor text-sm font-medium">{language.backupLocalDownload}</span>
                <span class="text-textcolor2 text-xs leading-relaxed mt-0.5">{language.backupLocalDownloadDesc}</span>
            </div>
            <ShButton variant="outline" size="sm" onclick={downloadLocal}>
                <DownloadIcon size={14} />
                {language.backupLocalDownload}
            </ShButton>
        </div>
        <div class="flex items-center justify-between gap-3 p-3 border border-darkborderc/50 rounded-md bg-bgcolor/50">
            <div class="flex flex-col min-w-0 flex-1">
                <span class="text-textcolor text-sm font-medium">{language.backupSettingsOnly}</span>
                <span class="text-textcolor2 text-xs leading-relaxed mt-0.5">{language.backupSettingsOnlyDesc}</span>
            </div>
            <ShButton variant="outline" size="sm" onclick={downloadSettingsOnly}>
                <SettingsIcon size={14} />
                {language.backupSettingsOnly}
            </ShButton>
        </div>
        <div class="flex items-center justify-between gap-3 p-3 border border-darkborderc/50 rounded-md bg-bgcolor/50">
            <div class="flex flex-col min-w-0 flex-1">
                <span class="text-textcolor text-sm font-medium">{language.loadBackupLocal}</span>
                <span class="text-textcolor2 text-xs leading-relaxed mt-0.5">{language.backupLocalRestoreDesc}</span>
            </div>
            <ShButton variant="outline" size="sm" onclick={restoreFromLocalFile}>
                <UploadIcon size={14} />
                {language.loadBackupLocal}
            </ShButton>
        </div>
    </div>
</div>

<div class="border border-darkborderc bg-darkbg/40 rounded-md p-4 mb-4" data-v1-transfer-tools>
    <div class="flex items-center gap-2 text-textcolor mb-2">
        <UploadIcon size={16} />
        <span class="font-medium">{language.migration}</span>
    </div>
    <p class="text-textcolor2 text-sm leading-relaxed mb-4">{language.migrationDesc}</p>

    <div class="flex flex-col gap-2">
        <Button onclick={downloadForUpstream} className="w-full">
            {language.saveBackupForUpstream}
        </Button>
        <Button onclick={restoreFromLocalFile} className="w-full">
            {language.migrationLoadUpstreamBackup}
        </Button>
    </div>

    <div class="mt-4">
        <ShAccordion name={language.migrationSaveFolderAccordion} variant="card">
            <p class="text-textcolor2 text-sm leading-relaxed mb-3">{language.migrationSaveFolderDesc}</p>
            <p class="text-textcolor2 text-sm leading-relaxed mb-2">{language.importSaveZipDesc}</p>
            <div class="flex flex-col gap-2">
                <Button onclick={ImportFromSaveZip} className="w-full">{language.importSaveZip}</Button>
            </div>
            <p class="text-textcolor2 text-sm leading-relaxed mt-4 mb-2">{language.cleanupMigratedDesc}</p>
            <div class="flex flex-col gap-2">
                <Button onclick={CleanupMigratedFiles} className="w-full">{language.cleanupMigratedFiles}</Button>
            </div>
        </ShAccordion>
    </div>

    <div class="mt-3">
        <ShAccordion name={language.migrationLegacyAccordion} variant="card">
            <p class="text-textcolor2 text-sm leading-relaxed mb-3">{language.migrationLegacyDesc}</p>
            <div class="flex flex-col gap-2">
                <Button onclick={downloadPartial} className="w-full">{language.savePartialLocalBackup}</Button>
                <Button onclick={exportAsDataset} className="w-full">{language.exportAsDataset}</Button>
            </div>
        </ShAccordion>
    </div>
</div>
