<!-- Contact selection shares the real Agent directory and member rows. AGPL-3.0-only. -->
<template>
    <button v-if="hosted" type="button" class="senera-icon-button" :aria-label="title" :title="title" @click="open">
        <font-awesome-icon :icon="['fas', groupId ? 'user-group' : 'plus']" />
    </button>
    <Teleport to="body">
        <dialog ref="dialog" class="senera-group-dialog" :aria-label="title" @cancel="onCancel">
            <form @submit.prevent="save">
                <header class="qq-group-create-heading">
                    <button type="button" class="qq-group-mobile-cancel" :disabled="busy" @click="close">取消</button>
                    <h2>{{ groupId ? '管理群聊' : '选择联系人' }}</h2>
                    <button type="submit" class="qq-group-mobile-confirm" :disabled="!canSave">
                        {{ busy ? '保存中…' : '完成' }}<span v-if="members.length">({{ members.length }})</span>
                    </button>
                </header>
                <section class="qq-group-picker">
                    <label class="qq-group-picker-search"
                        ><font-awesome-icon :icon="['fas', 'magnifying-glass']" /><input
                            v-model="search"
                            type="search"
                            placeholder="搜索"
                            aria-label="搜索成员"
                            :disabled="busy"
                    /></label>
                    <h3>
                        选择 Agent<span>{{ availableAgents.length }}</span>
                    </h3>
                    <div class="senera-group-members" :aria-busy="!loaded">
                        <p v-if="!loaded && !error" class="qq-group-picker-empty">正在加载联系人…</p>
                        <QQMemberRow
                            v-for="person in filteredAgents"
                            :key="person.id"
                            :name="person.name"
                            :avatar="userAvatar(person.qqUserId)"
                            :bot="true"
                            :description="person.enabled ? undefined : '已停用'"
                            :selected="members.includes(person.id)"
                            :disabled="busy"
                            checkable
                            @click="toggleMember(person.id)"
                        />
                        <p v-if="loaded && !filteredAgents.length" class="qq-group-picker-empty">
                            没有找到匹配的联系人
                        </p>
                    </div>
                </section>
                <section class="qq-group-selection">
                    <h3>
                        {{ title }}<span>已选择 {{ members.length }} 位联系人</span>
                    </h3>
                    <label class="senera-group-field"
                        >群名称<input
                            v-model="name"
                            required
                            maxlength="48"
                            placeholder="为群聊取个名字"
                            :disabled="busy"
                    /></label>
                    <div class="qq-group-selected-list">
                        <QQMemberRow
                            :name="seneraProfile?.name ?? auth.loginInfo.nickname"
                            :avatar="userAvatar(directory?.operatorId)"
                            description="你 · 群主"
                            disabled
                        />
                        <div v-for="person in selectedAgents" :key="person.id" class="qq-group-selected-person">
                            <QQMemberRow
                                :name="person.name"
                                :avatar="userAvatar(person.qqUserId)"
                                :bot="true"
                                :disabled="busy"
                                @click="toggleMember(person.id)"
                            /><button
                                type="button"
                                class="senera-icon-button"
                                :aria-label="`移除 ${person.name}`"
                                :disabled="busy"
                                @click="toggleMember(person.id)"
                            >
                                <font-awesome-icon :icon="['fas', 'xmark']" />
                            </button>
                        </div>
                    </div>
                    <p v-if="error" role="alert" class="senera-group-error">{{ error }}</p>
                    <footer>
                        <button type="submit" class="qq-primary-action" :disabled="!canSave">
                            {{ busy ? '保存中…' : groupId ? '保存修改' : '创建群聊' }}</button
                        ><button type="button" class="qq-secondary-action" :disabled="busy" @click="close">取消</button>
                    </footer>
                </section>
            </form>
        </dialog>
    </Teleport>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import QQMemberRow from './QQMemberRow.vue'
import { seneraClientRoot } from '@renderer/runtime/seneraClient'
import {
    refreshSeneraDirectory,
    updateSeneraDirectory,
    seneraDirectory as directory,
} from '@renderer/runtime/seneraDirectory'
import { seneraProfile, userAvatar } from '@renderer/runtime/seneraIdentity'
import { useAuthStore } from '@renderer/state/auth'
import { reloadUsers } from '@renderer/function/utils/appUtil'
const props = defineProps<{ groupId?: number }>()
const hosted = Boolean(seneraClientRoot())
const auth = useAuthStore()
const title = computed(() => (props.groupId ? '管理群聊' : '创建群聊'))
const dialog = ref<HTMLDialogElement>()
const loaded = ref(false)
const name = ref('')
const members = ref<string[]>([])
const error = ref('')
const busy = ref(false)
const search = ref('')
const availableAgents = computed(() =>
    (directory.value?.agents ?? []).filter(
        (agent) => agent.enabled && !directory.value?.deletingAgentIds.includes(agent.id),
    ),
)
const filteredAgents = computed(() =>
    availableAgents.value.filter((agent) =>
        `${agent.name} ${agent.qqUserId}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()),
    ),
)
const selectedAgents = computed(() =>
    (directory.value?.agents ?? []).filter((agent) => members.value.includes(agent.id)),
)
const canSave = computed(() => !busy.value && loaded.value && Boolean(name.value.trim()) && members.value.length > 0)
function toggleMember(id: string) {
    members.value = members.value.includes(id)
        ? members.value.filter((member) => member !== id)
        : [...members.value, id]
}
function close() {
    if (!busy.value) dialog.value?.close()
}
function onCancel(event: Event) {
    if (busy.value) event.preventDefault()
}
let revision = 0
async function open() {
    error.value = ''
    busy.value = true
    loaded.value = false
    name.value = ''
    members.value = []
    search.value = ''
    dialog.value?.showModal()
    try {
        const snapshot = await refreshSeneraDirectory()
        const group = props.groupId ? snapshot.groups.find((item) => item.id === props.groupId) : undefined
        if (props.groupId && !group) throw new Error('该群聊已不存在')
        name.value = group?.name ?? ''
        members.value = [...(group?.memberAgentIds ?? [])]
        revision = snapshot.revision
        loaded.value = true
    } catch (reason) {
        error.value = reason instanceof Error ? reason.message : String(reason)
    } finally {
        busy.value = false
    }
}
async function save() {
    if (!canSave.value) return
    busy.value = true
    error.value = ''
    try {
        const group = { name: name.value, memberAgentIds: members.value }
        await updateSeneraDirectory(
            props.groupId
                ? { type: 'group.update', revision, id: props.groupId, group }
                : { type: 'group.create', revision, group },
        )
        reloadUsers()
        dialog.value?.close()
    } catch (reason) {
        error.value = reason instanceof Error ? reason.message : String(reason)
    } finally {
        busy.value = false
    }
}
</script>
<style scoped>
.senera-group-dialog {
    box-sizing: border-box;
    width: min(704px, calc(100vw - 48px));
    height: min(620px, calc(100dvh - 72px));
    max-width: none;
    max-height: none;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--client-divider);
    border-radius: 12px;
    background: var(--color-card);
    color: var(--qq-text_primary);
    font: inherit;
    box-shadow: 0 16px 64px #0003;
    pointer-events: auto;
}
.senera-group-dialog::backdrop {
    background: #0005;
}
form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    height: 100%;
    min-height: 0;
}
.qq-group-create-heading {
    display: none;
}
.qq-group-picker,
.qq-group-selection {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    padding: 24px;
}
.qq-group-picker {
    border-right: 1px solid var(--client-divider);
}
.qq-group-picker-search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    flex-shrink: 0;
    padding: 0 10px;
    border: 1px solid var(--client-divider);
    border-radius: 8px;
    background: var(--client-hover);
    color: var(--qq-text_secondary);
}
.qq-group-picker-search:focus-within {
    border-color: var(--client-accent);
}
.qq-group-picker-search input {
    width: 100%;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--qq-text_primary);
    outline: none;
    font: inherit;
    font-size: 14px;
}
h2,
h3 {
    margin: 0;
    font-weight: 500;
}
h3 {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 14px;
}
h3 > span {
    font-size: 12px;
    font-weight: 400;
    color: var(--qq-text_secondary);
}
.qq-group-picker > h3 {
    padding: 24px 0 14px;
}
.senera-group-members,
.qq-group-selected-list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--client-divider) transparent;
}
.senera-group-members {
    margin: 0 -14px;
}
.senera-group-members :deep(.qq-member-check) {
    order: -1;
    width: 20px;
}
.qq-group-selection > h3 {
    margin: 2px 0 28px;
}
.senera-group-field {
    display: grid;
    gap: 9px;
    margin-bottom: 18px;
    font-size: 13px;
    color: var(--qq-text_secondary);
}
.senera-group-field input {
    box-sizing: border-box;
    width: 100%;
    height: 36px;
    padding: 0 10px;
    border: 1px solid var(--client-divider);
    border-radius: 6px;
    color: var(--qq-text_primary);
    background: var(--color-card);
    font: inherit;
    font-size: 14px;
}
.senera-group-field input:focus-visible {
    outline: 1px solid var(--client-accent);
}
.qq-group-selected-person {
    display: flex;
    align-items: center;
}
.qq-group-selected-person :deep(.qq-member-row) {
    min-width: 0;
}
.qq-group-selected-person > .senera-icon-button {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
}
.qq-group-selected-list > :deep(.qq-member-row:disabled) {
    opacity: 1;
}
footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding-top: 20px;
}
.qq-primary-action,
.qq-secondary-action {
    height: 36px;
    padding: 0 22px;
    border: 1px solid var(--client-divider);
    border-radius: 7px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 14px;
    cursor: pointer;
}
.qq-primary-action {
    background: var(--client-accent);
    color: #fff;
    border-color: transparent;
}
button:disabled {
    opacity: 0.45;
    cursor: default;
}
.qq-group-picker-empty {
    margin: 18px 14px;
    color: var(--qq-text_secondary);
    font-size: 13px;
}
.senera-group-error {
    color: var(--color-red);
    font-size: 13px;
}
@media (max-width: 700px) {
    .senera-group-dialog {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100dvh;
        margin: 0;
        border: 0;
        border-radius: 0;
    }
    form {
        display: flex;
        flex-direction: column;
    }
    .qq-group-create-heading {
        display: flex;
        flex-shrink: 0;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: calc(14px + env(safe-area-inset-top)) 18px 14px;
    }
    .qq-group-create-heading h2 {
        font-size: 17px;
    }
    .qq-group-mobile-cancel,
    .qq-group-mobile-confirm {
        padding: 7px 12px;
        border: 0;
        border-radius: 18px;
        background: transparent;
        color: var(--client-accent);
        font: inherit;
        font-size: 15px;
    }
    .qq-group-mobile-confirm {
        background: var(--client-accent);
        color: #fff;
    }
    .qq-group-picker {
        flex: 1;
        padding: 8px 18px 0;
        border: 0;
    }
    .qq-group-picker-search {
        border: 0;
        border-radius: 8px;
        height: 38px;
    }
    .qq-group-picker-search input {
        font-size: 16px;
    }
    .qq-group-picker > h3 {
        padding: 22px 0 10px;
        color: var(--qq-text_secondary);
        font-size: 13px;
    }
    .qq-group-selection {
        flex: 0 0 auto;
        padding: 14px 18px calc(18px + env(safe-area-inset-bottom));
        border-top: 1px solid var(--client-divider);
    }
    .qq-group-selection > h3,
    .qq-group-selected-list,
    footer {
        display: none;
    }
    .senera-group-field {
        margin: 0;
    }
    .senera-group-error {
        margin-bottom: 0;
    }
}
</style>
