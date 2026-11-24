import { alertConfirm, alertError, alertNormal, alertWait } from './alert'
import { forageStorage, requestImmediateSave } from './globalApi.svelte'
import { isNodeServer } from './platform'
import { DBState } from './stores.svelte'

/** Only a page opened on this computer may stop the server; the server checks this again. */
export function canStopServerFromBrowser() {
    if (!isNodeServer || typeof location === 'undefined') return false
    const host = location.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return host === 'localhost' || host === '::1' || host.startsWith('127.')
}

const ko = () => DBState.db.language === 'ko'

export async function stopServerFromBrowser() {
    const confirmed = await alertConfirm(ko()
        ? '리스바드 서버를 종료할까요?\n저장을 마친 뒤 서버가 꺼집니다. 다시 쓰려면 리스바드를 다시 실행해야 합니다.'
        : 'Stop the RisuBard server?\nIt finishes saving first. Start RisuBard again to keep using it.')
    if (!confirmed) return
    alertWait(ko() ? '저장을 마무리하고 서버를 종료하는 중입니다...' : 'Saving and stopping the server...')
    try {
        await requestImmediateSave({ flushServer: true, rejectOnFailure: true })
        const res = await fetch('/api/shutdown-from-browser', {
            method: 'POST',
            headers: { 'risu-auth': await forageStorage.createAuth() },
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.error || `HTTP ${res.status}`)
        }
    } catch (error) {
        alertError(error)
        return
    }
    alertNormal(ko()
        ? '리스바드 서버를 종료했습니다. 이 탭을 닫아도 됩니다.\n다시 쓰려면 리스바드를 실행한 뒤 이 탭을 새로고침하세요.'
        : 'The RisuBard server has stopped. You can close this tab.\nTo use it again, start RisuBard and reload this tab.')
}
