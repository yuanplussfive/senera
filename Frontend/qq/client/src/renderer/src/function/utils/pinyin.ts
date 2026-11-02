export type PinYinData = { main: string[]; short: string[]; source?: string }
type PinyinLibrary = typeof import('pinyin-pro')
let library: PinyinLibrary | undefined
let loading: Promise<boolean> | undefined

export function isPinyinReady() { return library !== undefined }

/** Search data loads from the installed dependency, with the same version as the application. */
export function ensurePinyinLoaded(): Promise<boolean> {
    if (library) return Promise.resolve(true)
    return loading ??= import('pinyin-pro').then(module => {
        library = module
        return true
    }).catch(error => {
        loading = undefined
        console.error('无法加载拼音检索模块', error)
        return false
    })
}

export function preloadPinyin() {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => { void ensurePinyinLoaded() })
    else setTimeout(() => { void ensurePinyinLoaded() }, 0)
}

export function getPinyin(name: string): PinYinData {
    if (!library) return { source: name, main: [], short: [] }
    return {
        source: name,
        main: [library.pinyin(name, { toneType: 'none', type: 'array' }).join('').toLowerCase()],
        short: [library.pinyin(name, { pattern: 'first', type: 'array' }).join('').toLowerCase()],
    }
}

export function matchPinyin(data: PinYinData, query: string): boolean {
    const normalized = query.toLowerCase()
    if ([...data.main, ...data.short].some(value => value.includes(normalized))) return true
    return !!(library && data.source && library.match(data.source, query, {
        precision: 'any', continuous: true, insensitive: true,
    }))
}
