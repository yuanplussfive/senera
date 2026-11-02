import { ref } from 'vue'
import { readAgentQqClientPreferencesKey } from '../../../../../../../../Source/AgentSystem/Channels/Client/AgentQqClientPreferences'

const objectUrls = new Map<string, string>()
const backgroundUrlVersion = ref(0)
const dbName = 'ssqq-local-assets'
const dbVersion = 1
const imageStoreName = 'images'
const chatBackgroundKey = 'chat_background'

export interface LocalImageInfo {
    path: string
    url?: string
}

export function getBackgroundImageUrl(value: string | null | undefined, _version = backgroundUrlVersion.value) {
    if (!value) return ''
    if (value.startsWith('ssqq-background://')) {
        return objectUrls.get(value) ?? ''
    }
    if (value.startsWith('data:') || value.startsWith('blob:') || value.startsWith('file:')) {
        return value
    }
    return value
}

export function toBackgroundImageStyle(value: string | null | undefined) {
    const url = getBackgroundImageUrl(value)
    return url ? `url("${url.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}")` : ''
}

export function rememberLocalImageUrl(path: string, url: string) {
    const previous = objectUrls.get(path)
    if (previous?.startsWith('blob:') && previous !== url) URL.revokeObjectURL(previous)
    objectUrls.set(path, url)
    backgroundUrlVersion.value += 1
}

export async function saveBrowserBackgroundImage(file: Blob, purpose = chatBackgroundKey) {
    const key = `${readAgentQqClientPreferencesKey()}:${purpose}`
    const db = await openAssetDb()
    try {
        await putImageBlob(db, key, file)
    } finally {
        db.close()
    }
    const path = `ssqq-background://${encodeURIComponent(key)}`
    rememberLocalImageUrl(path, URL.createObjectURL(file))
    return path
}

export async function migrateInlineBackgroundImage(value: string | null | undefined) {
    if (!value?.startsWith('data:image')) return null
    const response = await fetch(value)
    const blob = await response.blob()
    const backgroundUrl = await saveBrowserBackgroundImage(blob)
    return backgroundUrl
}

export async function hydrateBackgroundImage(value: string | null | undefined) {
    if (!value?.startsWith('ssqq-background://') || objectUrls.has(value)) {
        return
    }
    const db = await openAssetDb()
    let blob: Blob | undefined
    try {
        blob = await getImageBlob(db, decodeURIComponent(value.slice('ssqq-background://'.length)))
    } finally {
        db.close()
    }
    if (!blob) return
    const url = URL.createObjectURL(blob)
    rememberLocalImageUrl(value, url)
}

function openAssetDb() {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, dbVersion)
        request.onupgradeneeded = () => {
            const db = request.result
            if (!db.objectStoreNames.contains(imageStoreName)) {
                db.createObjectStore(imageStoreName)
            }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

function putImageBlob(db: IDBDatabase, key: string, file: Blob) {
    return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(imageStoreName, 'readwrite')
        transaction.objectStore(imageStoreName).put(file, key)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
    })
}

function getImageBlob(db: IDBDatabase, key: string) {
    return new Promise<Blob | undefined>((resolve, reject) => {
        const transaction = db.transaction(imageStoreName, 'readonly')
        const request = transaction.objectStore(imageStoreName).get(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}
