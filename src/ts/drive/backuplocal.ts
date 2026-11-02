import { alertError, alertStore, alertWait, alertMd, alertConfirm, alertConfirmMulti, alertClear, waitAlert, notifySuccess, notifyInfo, notifyError } from "../alert";
import { LocalWriter, forageStorage, requestImmediateSave } from "../globalApi.svelte";
import { encodeRisuSaveLegacy } from "../storage/risuSave";
import { getDatabase, type Chat } from "../storage/database.svelte";
import { fetchChatFromServer } from "../storage/chatStorage";
import { language } from "src/lang";

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

async function persistCurrentStateForBackup() {
    await requestImmediateSave({ flushServer: true, rejectOnFailure: true })
}

export async function SaveLocalBackup(){
    try {
        alertWait("Saving local backup...")
        await persistCurrentStateForBackup()
        await forageStorage.exportBackup()
        notifyInfo(language.backupDownloadRequested)
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            alertClear()
            return
        }
        console.error(error)
        alertError(error instanceof Error ? error.message : 'Failed')
    }
}

/**
 * Saves a settings-only backup — the full backup minus characters, chats and
 * inlay images. Intended for seeding a fresh instance: modules, plugins, prompt
 * presets, personas, lorebooks, theme and API keys all travel.
 *
 * Asks about module assets first. Asset-pack modules routinely hold thousands
 * of images, so for those users the module images — not the character library —
 * are what makes the file big, and it is worth one question rather than a
 * silent multi-GB download. Excluding them ships the module definitions with
 * their images missing, which is why it is never the default.
 *
 * The server does the trimming (see /api/backup/export?mode=settings) so the
 * character library never has to cross the network.
 */
export async function SaveSettingsOnlyBackup(){
    let includeModuleAssets = true
    try {
        alertWait(language.backupSettingsOnlyEstimating)
        await persistCurrentStateForBackup()
        const estimate = await forageStorage.settingsBackupEstimate()
        alertClear()

        const baseBytes = estimate.dbBytes + estimate.baseAssets.bytes
        if (estimate.moduleAssets.count > 0) {
            // The dialog supplies its own Cancel, so only the two real choices
            // go in here. Sizes sit on the buttons because that is the whole
            // decision being made.
            const choice = await alertConfirmMulti(
                language.backupSettingsOnly,
                [
                    language.backupSettingsOnlyWithModuleAssets(
                        formatBytes(baseBytes + estimate.moduleAssets.bytes),
                    ),
                    language.backupSettingsOnlyWithoutModuleAssets(formatBytes(baseBytes)),
                ],
                language.backupSettingsOnlyBreakdown(
                    formatBytes(baseBytes),
                    estimate.moduleAssets.moduleCount,
                    estimate.moduleAssets.count,
                    formatBytes(estimate.moduleAssets.bytes),
                ),
            )
            if (choice !== 0 && choice !== 1) return
            includeModuleAssets = choice === 0
        } else {
            // Nothing worth asking about — a plain confirm with the size.
            if (!(await alertConfirm(language.backupSettingsOnlyConfirm(formatBytes(baseBytes))))) return
        }
    } catch (error) {
        console.error(error)
        alertError(error instanceof Error ? error.message : 'Failed')
        return
    }

    try {
        alertWait("Saving settings backup...")
        await forageStorage.exportBackup({ mode: 'settings', moduleAssets: includeModuleAssets })
        if (!includeModuleAssets) {
            alertMd(language.backupSettingsOnlyModuleAssetsSkipped)
        } else {
            notifyInfo(language.backupDownloadRequested)
        }
    } catch (error) {
        console.error(error)
        alertError('Failed')
    }
}

export async function SaveLocalBackupForUpstream(){
    try {
        alertWait("Saving local backup...")
        await persistCurrentStateForBackup()
        await forageStorage.exportBackup({ target: 'upstream' })
        notifyInfo(language.backupDownloadRequested)
    } catch (error) {
        console.error(error)
        alertError('Failed')
    }
}

/**
 * Saves a partial local backup with only critical assets.
 * 
 * Differences from SaveLocalBackup:
 * - Only includes profile images for characters/groups (excludes emotion images, additional assets, VITS files, CC assets)
 * - Additionally includes: persona icons, folder images, bot preset images
 * - Processes only assets in assetMap (selective) instead of all .png files in assets folder
 * - Faster and more efficient for quick backups
 * - Ideal for backing up core visual identity without bulk data
 */
export async function SavePartialLocalBackup(){
    // First confirmation: Explain the difference from regular backup
    const firstConfirm = await alertConfirm(language.partialBackupFirstConfirm)
    
    if (!firstConfirm) {
        return
    }
    
    // Second confirmation: Final warning about not saving assets
    const secondConfirm = await alertConfirm(language.partialBackupSecondConfirm)
    
    if (!secondConfirm) {
        return
    }
    
    alertWait("Saving partial local backup...")
    const writer = new LocalWriter()
    const r = await writer.init()
    if(!r){
        alertError('Failed')
        return
    }

    const db = getDatabase()
    const assetMap = new Map<string, { charName: string, assetName: string }>()
    
    // Only collect main profile images for both characters and groups
    if (db.characters) {
        for (const char of db.characters) {
            if (!char) continue
            const charName = char.name ?? 'Unknown Character'
            
            // Save the main profile image (supports both character and group types)
            // Note: emotionImages are intentionally excluded from partial backup
            if (char.image) {
                assetMap.set(char.image, { charName: charName, assetName: 'Profile Image' })
            }
        }
    }
    
    // User icon
    if (db.userIcon) {
        assetMap.set(db.userIcon, { charName: 'User Settings', assetName: 'User Icon' })
    }
    
    // Persona icons
    if (db.personas) {
        for (const persona of db.personas) {
            if (persona && persona.icon) {
                assetMap.set(persona.icon, { charName: 'Persona', assetName: `${persona.name} Icon` })
            }
        }
    }
    
    // Custom background
    if (db.customBackground) {
        assetMap.set(db.customBackground, { charName: 'User Settings', assetName: 'Custom Background' })
    }
    
    // Folder images in characterOrder
    if (db.characterOrder) {
        for (const item of db.characterOrder) {
            if (typeof item !== 'string' && item.img) {
                assetMap.set(item.img, { charName: 'Folder', assetName: `${item.name} Folder Image` })
            }
            if (typeof item !== 'string' && item.imgFile) {
                assetMap.set(item.imgFile, { charName: 'Folder', assetName: `${item.name} Folder Image File` })
            }
        }
    }
    
    // Bot preset images
    if (db.botPresets) {
        for (const preset of db.botPresets) {
            if (preset && preset.image) {
                assetMap.set(preset.image, { charName: 'Preset', assetName: `${preset.name} Preset Image` })
            }
        }
    }
    
    const missingAssets: string[] = []

    const assetKeys = Array.from(assetMap.keys())

    for(let i=0;i<assetKeys.length;i++){
        const key = assetKeys[i]
        let message = `Saving partial local backup... (${i + 1} / ${assetKeys.length})`
        if (missingAssets.length > 0) {
            const skippedItems = missingAssets.map(key => {
                const assetInfo = assetMap.get(key);
                return assetInfo ? `'${assetInfo.assetName}' from ${assetInfo.charName}` : `'${key}'`;
            }).join(', ');
            message += `\n(Skipping... ${skippedItems})`;
        }
        alertWait(message)

        if(!key || !key.endsWith('.png')){
            continue
        }

        const data = await forageStorage.getItem(key) as unknown as Uint8Array

        if (data) {
            await writer.writeBackup(key, data)
        } else {
            missingAssets.push(key)
        }
    }

    // Reassemble full chats from server for placeholders (runtime lazy load)
    alertWait(`Saving partial local backup... (Assembling chat data)`)
    const dbCopy = structuredClone({ ...db, account: undefined })
    for (const char of dbCopy.characters) {
        for (let i = 0; i < char.chats.length; i++) {
            const chat = char.chats[i]
            if (chat._placeholder && chat.id) {
                let full: unknown
                try {
                    full = await fetchChatFromServer(char.chaId, i, chat.id)
                } catch (error) {
                    const reason = error instanceof Error ? error.message : String(error)
                    throw new Error(`Could not read chat "${char.name}" / "${chat.name}" (${chat.id}) from the server: ${reason}. Backup aborted to prevent data loss.`)
                }
                if (full) {
                    char.chats[i] = full as Chat
                } else {
                    throw new Error(`Chat data missing for "${char.name}" / "${chat.name}" (${chat.id}). Backup aborted to prevent data loss.`)
                }
            }
        }
    }
    const dbData = encodeRisuSaveLegacy(dbCopy, 'compression')

    alertWait(`Saving partial local backup... (Saving database)`) 

    await writer.writeBackup('database.risudat', dbData)
    await writer.close()

    if (missingAssets.length > 0) {
        let message = 'Partial backup successful, but the following profile images were missing and skipped:\n\n'
        for (const key of missingAssets) {
            const assetInfo = assetMap.get(key)
            if (assetInfo) {
                message += `* **${assetInfo.assetName}** (from *${assetInfo.charName}*)  \n  *File: ${key}*\n`
            } else {
                message += `* **Unknown Asset**  \n  *File: ${key}*\n`
            }
        }
        alertMd(message)
    } else {
        notifySuccess('Success')
    }
}

export function LoadLocalBackup(){
    try {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.bin';
        input.onchange = async () => {
            if (!input.files || input.files.length === 0) {
                input.remove();
                return;
            }
            const file = input.files[0];
            input.remove();
            alertWait(`Loading local Backup... (Uploading ${file.name})`);
            const result = await forageStorage.importBackup(file, (loaded, total, phase) => {
                if (phase === 'processing') {
                    alertWait('Loading local Backup... (Processing backup entries)')
                    return
                }
                if (phase === 'validating') {
                    alertWait('Loading local Backup... (Validating backup)')
                    return
                }
                if (phase === 'publishing') {
                    alertWait('Loading local Backup... (Publishing restored data)')
                    return
                }
                if (phase === 'finalizing') {
                    alertWait('Loading local Backup... (Finalizing restore)')
                    return
                }
                const progress = total > 0 ? ((loaded / total) * 100).toFixed(2) : '0.00'
                alertWait(`Loading local Backup... (${progress}%)`)
            })
            const coldStorageWarnings = [
                result.coldStorageFailed ? `${result.coldStorageFailed} character(s)` : '',
                result.pluginStorageColdFailed ? `${result.pluginStorageColdFailed} plugin storage item(s)` : '',
            ].filter(Boolean)
            if (coldStorageWarnings.length > 0) {
                alertError(`Warning: ${coldStorageWarnings.join(' and ')} could not be restored from cold storage. The imported save may be incomplete. The app will now reload.`)
                await waitAlert()
            } else {
                alertStore.set({
                    type: "wait",
                    msg: "Success, Refreshing your app."
                });
            }
            location.search = ''
            location.reload()
        };

        input.click();
    } catch (error) {
        console.error(error);
        alertError('Failed, Is file corrupted?')
    }
}

export async function ImportFromSaveZip() {
    try {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.zip'
        input.onchange = async () => {
            if (!input.files || input.files.length === 0) {
                input.remove()
                return
            }
            const file = input.files[0]
            input.remove()

            if (!(await alertConfirm(language.importSaveFolderConfirmZip(file.name, formatBytes(file.size))))) return
            if (!(await alertConfirm(language.backupLoadConfirm2))) return

            alertWait(`Uploading ${file.name}...`)
            const result = await forageStorage.uploadSaveFolderZip(file, (loaded, total) => {
                const progress = total > 0 ? ((loaded / total) * 100).toFixed(2) : '0.00'
                alertWait(`Uploading ${file.name}... (${progress}%)`)
            })

            alertStore.set({
                type: "wait",
                msg: `${language.importSaveFolderSuccess} (${result.imported} files). Refreshing...`
            })
            location.search = ''
            location.reload()
        }

        input.click()
    } catch (error) {
        console.error(error)
        alertError(error instanceof Error ? error.message : 'Import failed')
    }
}

export async function CleanupMigratedFiles() {
    try {
        alertWait(language.importSaveFolderScanning)
        let scan: { count: number, totalSize: number }
        try {
            scan = await forageStorage.scanCleanup()
        } catch (error) {
            notifyError(error instanceof Error ? error.message : language.cleanupMigratedNotReady)
            return
        }

        if (scan.count === 0) {
            notifyInfo(language.cleanupMigratedNoFiles)
            return
        }

        const sizeStr = formatBytes(scan.totalSize)
        if (!(await alertConfirm(language.cleanupMigratedConfirm(scan.count, sizeStr)))) return

        alertWait(language.cleanupMigratedCleaning)
        const result = await forageStorage.executeCleanup()

        notifySuccess(language.cleanupMigratedSuccess(result.removed, formatBytes(result.freedBytes)))
    } catch (error) {
        console.error(error)
        notifyError(error instanceof Error ? error.message : 'Cleanup failed')
    }
}

// ── Server-side backup functions ─────────────────────────────────────────────

export async function SaveServerBackup() {
    try {
        alertWait(language.serverBackupSaving)
        await persistCurrentStateForBackup()
        const result = await forageStorage.saveServerBackup((current, total, bytes) => {
            const pct = total > 0 ? ((current / total) * 100).toFixed(1) : '0'
            const bytesStr = formatBytes(bytes)
            alertWait(`${language.serverBackupSaving} (${pct}% - ${bytesStr})`)
        })
        notifySuccess(language.serverBackupSaveSuccess(result.filename, formatBytes(result.size)))
    } catch (error) {
        console.error(error)
        alertError(error instanceof Error ? error.message : 'Server backup failed')
    }
}
