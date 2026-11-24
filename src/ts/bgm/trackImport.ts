// Adding tracks from the three sources. Shared by the floating player and the manager.

import { saveAsset } from '../globalApi.svelte'
import { selectMultipleFile } from '../util'
import { youtubePlaceholderTitle, type BgmLibrary, type BgmSlot } from './library'
import { addTracksToSlot, fetchYouTubeTitle, fileTitle, parseYouTubeLines } from './libraryEdits'

export const BGM_UPLOAD_EXTENSIONS = ['mp3', 'ogg', 'oga', 'opus', 'wav', 'flac', 'm4a', 'aac', 'weba', 'webm']

/** Adds every YouTube address in the text. Titles fill in afterwards when YouTube provides them. */
export function addYouTubeText(library: BgmLibrary, slot: BgmSlot, text: string): { added: number; skipped: number } {
    const { sources, skipped } = parseYouTubeLines(text)
    const added = addTracksToSlot(library, slot, sources.map(source => ({ title: youtubePlaceholderTitle(source.videoId), source })))
    for (const track of added) {
        if (track.source.kind !== 'youtube') continue
        const { videoId } = track.source
        void fetchYouTubeTitle(videoId).then((title) => {
            // A reactive library holds its own copy of each track, so find it again by id.
            const live = library.tracks.find(item => item.id === track.id)
            if (title && live && live.title === youtubePlaceholderTitle(videoId)) live.title = title
        })
    }
    return { added: added.length, skipped }
}

/** Asks for audio files, stores them as assets and adds them. Returns how many were added. */
export async function uploadAudioFiles(library: BgmLibrary, slot: BgmSlot): Promise<number> {
    const files = await selectMultipleFile(BGM_UPLOAD_EXTENSIONS)
    const items = []
    for (const file of files) {
        const key = await saveAsset(file.data, '', file.name)
        items.push({ title: fileTitle(file.name), source: { kind: 'asset' as const, key } })
    }
    return addTracksToSlot(library, slot, items).length
}

export function addFolderFiles(library: BgmLibrary, slot: BgmSlot, items: Array<{ folderId: string; relPath: string }>): number {
    return addTracksToSlot(library, slot, items.map(item => ({ title: fileTitle(item.relPath), source: { kind: 'file' as const, ...item } }))).length
}
