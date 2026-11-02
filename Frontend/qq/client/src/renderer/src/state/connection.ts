import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ClientConnectionPhase } from '../runtime/connectionPolicy'

export const useConnectionStore = defineStore('connection', () => {
    const phase = ref<ClientConnectionPhase>('disconnected')
    const reason = ref('')
    const heartbeatTime = ref<number>(-1)
    const oldHeartbeatTime = ref<number>(-1)
    const lastHeartbeatTime = ref<number>(-1)
    const backTimes = ref(0)

    return {
        phase,
        reason,
        heartbeatTime,
        oldHeartbeatTime,
        lastHeartbeatTime,
        backTimes,
    }
})
