import { ref } from 'vue'

type LyricLine = { [key: number]: string }

export interface MusicInfo {
    title: string,                                  // 标题
    author: string[],                               // 作者
    url: string,                                    // 音乐链接
    type: 'default' | 'music163',                   // 音乐类型（用于特殊功能）
    cover: string,                                  // 封面链接
    free?: boolean                                  // 试听标识
    time?: number                                   // 音频时长
    data?: unknown                                      // 额外数据（如歌曲ID等）
    lyric?: LyricLine[]                              // 歌词（可选）
}

export const musicPanelVisible = ref(false)

export const musicListState = ref<MusicInfo[]>([])
export const currentIndexState = ref(0)
export const readyToPlayState = ref(false)
export const audioState = ref(null as HTMLAudioElement | null)
export const nowLyricState = ref(undefined as { index: number, text: string } | undefined)

const lyricTime = (line: LyricLine) => parseFloat(Object.keys(line)[0])
export const lyricText = (line: LyricLine) => Object.values(line)[0]

export const parseLyric = (lyricText: string) => {
    return lyricText
        .split('\n')
        .flatMap((line: string) => {
            const timeMatches = [...line.matchAll(/\[(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/g)]
            if (timeMatches.length === 0) {
                return []
            }

            const text = line.replace(/\[[^\]]+\]/g, '').trim()
            if (!text) {
                return []
            }

            return timeMatches.map(match => {
                const time = parseFloat(match[1]) * 60 + parseFloat(match[2])
                return {
                    [time]: text,
                }
            })
        })
        .sort((a, b) => lyricTime(a) - lyricTime(b))
}

export const mergeLyric = (originalLyric: LyricLine[], translatedLyric: LyricLine[]) => {
    const merged = new Map<number, string>()

    originalLyric.forEach(line => {
        merged.set(lyricTime(line), lyricText(line))
    })
    translatedLyric.forEach(line => {
        merged.set(lyricTime(line), lyricText(line))
    })

    return [...merged.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([time, text]) => ({ [time]: text }))
}

export const findLyricIndex = (lyrics: LyricLine[], currentTime: number) => {
    let left = 0
    let right = lyrics.length - 1
    let ans = -1

    while (left <= right) {
        const mid = Math.floor((left + right) / 2)
        const midTime = lyricTime(lyrics[mid])
        if (midTime <= currentTime) {
            ans = mid
            left = mid + 1
        } else {
            right = mid - 1
        }
    }

    return ans
}

export const getCurrentMusic = () => {
    if (currentIndexState.value < 0 || currentIndexState.value >= musicListState.value.length) {
        return null
    }

    return musicListState.value[currentIndexState.value]
}

export const addMusic = (info: MusicInfo | null | undefined, type: 'top' | 'bottom' | 'current' = 'bottom', open: boolean = false) => {
    if (!info) {
        return
    }
    // 筛选掉同 title 的
    musicListState.value = musicListState.value.filter(item => {
        return item.title !== info.title
    })
    if (type === 'top') {
        musicListState.value.unshift(info)
        currentIndexState.value++
    } else if (type === 'current') {
        audioState.value?.pause()
        musicListState.value.unshift(info)
        currentIndexState.value = 0
        nowLyricState.value = undefined
        readyToPlayState.value = true
    } else {
        musicListState.value.push(info)
    }

    if (open) {
        musicPanelVisible.value = true
    }
}
