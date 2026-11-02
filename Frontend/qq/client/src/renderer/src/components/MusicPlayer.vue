<template>
    <div class="music-controller">
        <div>
            <img :src="currentMusic?.cover">
            <div>
                <a>{{ currentMusic?.title }}
                    <a v-if="currentMusic?.free != null">{{ $t('（试听）') }}</a>
                    <span> / {{ currentMusic?.author?.join('/') }}</span>
                </a>
                <audio :src="currentMusic?.url ?? ''"
                    @loadedmetadata="audioLoaded"
                    @error="audioLoadFail"
                    @timeupdate="audioUpdate()" />
                <div>
                    <label for="music-controller-bar" class="sr-only">{{ $t('音乐播放进度') }}</label>
                    <input id="music-controller-bar" value="0" min="0"
                        :max="sizeMax" step="0.1" type="range"
                        @input="audioChange">
                    <div>
                        <div :style="{
                            width: sizeDur / sizeMax * 100 > 100 ? 'calc(100% + 9px)' : ('calc(' + (sizeDur / sizeMax * 100) + '% + 9px)'),
                        }" />
                        <div :style="{
                            width: sizeReal > 0 ? ('calc(' + ((1 - (sizeReal / sizeMax)) * 100) + '% - 9px)') : '0%',
                            marginLeft: sizeReal > 0 ? ('calc(' + ((sizeReal / sizeMax * 100) + '% + 9px)')) : '0%',
                        }" />
                    </div>
                    <font-awesome-icon v-if="!isLoaded" :icon="['fas', 'spinner']" spin />
                    <template v-else>
                        <font-awesome-icon v-if="audio?.paused" :icon="['fas', 'play']" @click="audioControll()" />
                        <font-awesome-icon v-else :icon="['fas', 'pause']" @click="audioControll()" />
                    </template>
                    <font-awesome-icon v-if="musicList.length > 1" :icon="['fas', 'forward']" @click="switchMusic(currentIndex + 1, true)" />
                    <span>{{ minutesDur < 10 ? '0' + minutesDur : minutesDur }}:{{ secondsDur < 10 ? '0' + secondsDur : secondsDur }} / {{ minutes < 10 ? '0' + minutes : minutes }}:{{ seconds < 10 ? '0' + seconds : seconds }}</span>
                </div>
            </div>
        </div>
    </div>
    <span v-if="nowLyric &&
              nowLyric.text &&
              nowLyric.text.trim() != ''"
        class="music-lyric">{{ nowLyric.text }}</span>
    <div class="music-list">
        <template v-if="false">
            播放列表为空
        </template>
        <template v-else>
            <div
                v-for="(music, index) in musicList"
                :key="`${music.type}-${music.url}-${index}`"
                @click="switchMusic(index)">
                <div :style="{ opacity: index === currentIndex ? 1 : 0 }" />
                <img :src="music.cover">
                <span>{{ music.title }} - {{ music.author.join('/') }}</span>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
    import { computed, ref, watch } from 'vue'
    import { PopInfo, PopType } from '@renderer/function/base'
    import { audioState, musicListState, currentIndexState, readyToPlayState, nowLyricState, addMusic, parseLyric, mergeLyric, findLyricIndex, lyricText } from '@renderer/runtime/musicPlayer'

    import { i18n } from '@renderer/main'
    import { useSettingsStore } from '@renderer/state/settings'

    const settingsStore = useSettingsStore()
    const $t = i18n.global.t

    const audio = audioState

    const musicList = musicListState
    const currentIndex = currentIndexState
    const readyToPlay = readyToPlayState
    const isLoaded = ref(false)

    const sizeMax = ref(0)
    const sizeReal = ref(0)
    const sizeDur = ref(0)

    const minutes = ref(0)
    const seconds = ref(0)
    const minutesDur = ref(0)
    const secondsDur = ref(0)

    const nowLyric = nowLyricState

    const currentMusic = computed(() => {
        if (currentIndex.value < 0 || currentIndex.value >= musicList.value.length) {
            return null
        }
        return musicList.value[currentIndex.value]
    })

    // 定义 emits
    const emit = defineEmits<{
        'open-panel': [value: boolean]
        'update-lyric': [value: string]
        'update-status': [value: boolean]
    }>()

    watch(nowLyricState, lyric => {
        if (!lyric) emit('update-lyric', '')
    })

    const resetController = () => {
        isLoaded.value = false
        sizeMax.value = 0
        sizeReal.value = 0
        sizeDur.value = 0
        minutes.value = 0
        seconds.value = 0
        minutesDur.value = 0
        secondsDur.value = 0
        nowLyric.value = undefined
        emit('update-lyric', '')
    }

    const switchMusic = (index: number, pass: boolean = false) => {
        if(pass) {
            musicList.value.splice(currentIndex.value, 1)
            if(musicList.value.length === 0) {
                resetController()
                emit('open-panel', false)
                return
            }

            if(currentIndex.value >= musicList.value.length) {
                currentIndex.value = musicList.value.length - 1
            }

            resetController()
            addMusic(musicList.value[currentIndex.value], 'current')
            return
        }

        const safeIndex = Math.min(Math.max(index, 0), musicList.value.length - 1)
        const music = musicList.value[safeIndex]
        if (!music) {
            return
        }

        resetController()
        addMusic(music, 'current')
    }

    const audioLoaded = (event: any) => {
        isLoaded.value = true
        audio.value = event.target as HTMLAudioElement
        sizeMax.value = currentMusic.value?.time ?? audio.value.duration
        sizeReal.value = audio.value.duration
        minutes.value = Math.floor(sizeMax.value / 60)
        seconds.value = Math.floor(sizeMax.value % 60)
        if(readyToPlay.value) {
            audio.value.play()
            readyToPlay.value = false
        }
        // 更新媒体信息
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title : currentMusic.value?.title ?? '',
                artist: currentMusic.value?.author?.join('/') ?? '',
                artwork: [
                    { src: currentMusic.value?.cover ?? '', sizes: '130x130', type: 'image/png' },
                ]
            });

            navigator.mediaSession.setActionHandler('nexttrack', () => {
                switchMusic(currentIndex.value + 1, true)
            });
        }
        // 如果是网易云音乐，异步获取歌词
        if (currentMusic.value?.type === 'music163' && currentMusic.value.data && typeof currentMusic.value.data === 'string') {
            const musicRef = currentMusic.value
            fetch(import.meta.env.VITE_APP_163_MUSIC_API + '/lyric?id=' + currentMusic.value.data)
                .then(res => res.json())
                .then(data => {
                    const originalLyric = parseLyric(data.lrc?.lyric || '')
                    const translatedLyric = parseLyric(data.tlyric?.lyric || '')
                    // 默认展示"翻译 + 原文"合并结果：同时间点优先使用翻译歌词
                    // 当用户开启"显示原歌词"时，仅展示原文歌词。
                    const final = settingsStore.sysConfig.original_lyrics ? originalLyric : mergeLyric(originalLyric, translatedLyric)

                    if (currentMusic.value === musicRef) {
                        musicRef.lyric = final
                    }
                })
            }
    }

    const audioLoadFail = () => {
        if(currentMusic.value?.title != undefined) {
            new PopInfo().add(PopType.INFO, '加载资源 ' + currentMusic.value?.title + ' 失败', false)
            switchMusic(currentIndex.value + 1, true)
        }
    }

    const audioUpdate = () => {
        if(audio.value) {
            emit('update-status', audio.value.paused)

            const bar = document.getElementById('music-controller-bar') as HTMLInputElement
            if(bar) {
                bar.value = audio.value.currentTime.toString()
            }
            sizeDur.value = audio.value.currentTime
            minutesDur.value = Math.floor(audio.value.currentTime / 60)
            secondsDur.value = Math.floor(audio.value.currentTime % 60)

            if(audio.value.currentTime >= audio.value.duration) {
                // 从列表移除并播放下一首
                musicList.value.splice(currentIndex.value, 1)
                if(currentIndex.value >= musicList.value.length) {
                    currentIndex.value = musicList.value.length - 1
                }
                if(currentIndex.value >= 0) {
                    resetController()
                    audio.value.src = musicList.value[currentIndex.value].url
                    readyToPlay.value = true
                } else {
                    resetController()
                    emit('open-panel', false)
                }
            }

            if(currentMusic.value?.lyric && currentMusic.value.lyric.length > 0) {
                const lyricIndex = findLyricIndex(currentMusic.value.lyric, audio.value.currentTime)
                if(lyricIndex >= 0) {
                    const text = lyricText(currentMusic.value.lyric[lyricIndex])
                    if(!nowLyric.value || nowLyric.value.index !== lyricIndex || nowLyric.value.text !== text) {
                        nowLyric.value = {
                            index: lyricIndex,
                            text,
                        }
                    }
                } else {
                    nowLyric.value = undefined
                }

                if(settingsStore.sysConfig.glabal_lyric == true) {
                    emit('update-lyric', nowLyric.value?.text ?? currentMusic.value.title)
                } else {
                    emit('update-lyric', '')
                }
            }
        }
    }

    const audioChange = (event: any) => {
        const bar = event.target as HTMLInputElement
        if (audio.value) {
            const value = parseFloat(bar.value)
            if(value <= audio.value.duration) {
                if(audio.value.paused) {
                    audio.value.currentTime = value
                } else {
                    audio.value.pause()
                    audio.value.currentTime = value
                    audio.value.play()
                }
            } else {
                bar.value = audio.value.currentTime.toString()
            }
        }
    }

    const audioControll = () => {
        if (audio.value) {
            if (audio.value.paused) {
                audio.value.play()
            } else {
                audio.value.pause()
            }
        }
    }

</script>

<style scoped>
    .music-controller {
        background: var(--color-card-1);
        border-radius: 7px 7px 0 0;
        flex-direction: column;
        padding: 15px 15px 10px 15px;
        display: flex;
    }
    .music-controller > div:first-child {
        align-items: flex-start;
        display: flex;
    }
    .music-controller > div:first-child > img {
        border-radius: 7px;
        margin-right: 20px;
        max-height: 60px;
        width: 60px;
    }
    .music-controller > div:first-child > div {
        flex-direction: column;
        display: flex;
        width: 100%;
    }
    .music-controller > div:first-child > div > a {
        font-size: 0.9rem;
        font-weight: bold;
        margin-bottom: 5px;
    }
    .music-controller > div:first-child > div > a > a {
        font-size: 0.7rem;
        font-weight: normal;
    }
    .music-controller > div:first-child > div > a > span {
        font-size: 0.8rem;
        opacity: 0.7;
    }
    .music-controller > div:first-child > div > div {
        flex-direction: row;
        margin-top: 5px;
        flex-wrap: wrap;
        display: flex;
    }
    .music-controller > div:first-child > div > div > input {
        appearance: none;
        -webkit-appearance: none;
        width: 100%;
        background: transparent;
        margin-right: 10px;
    }
    .music-controller > div:first-child > div > div > input::-webkit-slider-thumb {
        background: var(--color-main);
        -webkit-appearance: none;
        border-radius: 100%;
        margin-top: -3px;
        height: 12px;
        width: 12px;
    }
    .music-controller > div:first-child > div.me > div > input::-webkit-slider-thumb {
        background: var(--color-font-r);
    }
    .music-controller > div:first-child > div > div > input::-webkit-slider-runnable-track {
        background: var(--color-card-1);
        border-radius: 10px;
        height: 6px;
    }
    .music-controller > div:first-child > div.me > div > input::-webkit-slider-runnable-track {
        background: var(--color-font-2);
    }
    .music-controller > div:first-child > div > div > svg {
        font-size: 0.75rem;
        margin-left: 4px;
        margin-right: 10px;
        cursor: pointer;
    }
    .music-controller > div:first-child > div > div > span {
        font-size: 0.7rem;
        text-align: right;
        margin-right: 10px;
        flex: 1;
    }
    .music-controller > div:first-child > div > div > div {
        width: calc(100% - 20px);
        margin-bottom: -6px;
        margin-right: 20px;
        margin-left: 3px;
    }
    .music-controller > div:first-child > div > div > div > div {
        transform: translateY(calc(-100% - 2px));
        background: var(--color-main);
        pointer-events: none;
        border-radius: 6px;
        height: 6px;
        width: 0%;
    }
    .music-controller > div:first-child > div > div > div > div:nth-child(2) {
        transform: translateY(calc(-100% - 16px));
        background: var(--color-card-2);
        border-radius: 0 6px 6px 0;
    }
    .music-controller > div:first-child > div.me > div > div > div:nth-child(2) {
        background: var(--color-font-1);
    }
    .music-controller > div:first-child > div.me > div > div > div {
        background: var(--color-font-r);
    }

    .music-lyric {
        display: block;
        text-align: center;
        padding: 5px;
        border-radius: 0 0 7px 7px;
        color: var(--color-font-2);
        background: var(--color-card-2);
        font-size: 0.8rem;
    }

    .music-list {
        padding: 10px;
        margin: 10px 0 -15px 0;
        border-radius: 7px;
        max-height: 20vh;
        overflow-y: scroll;
    }
    .music-list > div {
        display: flex;
        align-items: center;
        margin-bottom: 5px;
    }
    .music-list > div > div {
        width: 4px;
        height: 20px;
        background: var(--color-main);
        border-radius: 4px;
        margin-right: 10px;
    }
    .music-list img {
        width: 30px;
        height: 30px;
        margin-right: 10px;
        border-radius: 7px;
    }
    .music-list span {
        text-overflow: ellipsis;
        font-size: 0.8rem;
    }
</style>
