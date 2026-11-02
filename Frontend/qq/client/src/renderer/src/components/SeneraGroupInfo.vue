<!-- Host group information reads the same directory and OneBot member state as chat. AGPL-3.0-only. -->
<template>
    <dialog
        ref="dialog"
        class="qq-group-info"
        aria-labelledby="qq-group-title"
        @cancel.prevent="close"
        @click="backdrop"
    >
        <header class="qq-group-heading">
            <button
                type="button"
                class="senera-icon-button qq-group-back"
                aria-label="返回"
                @click="selected ? (selected = undefined) : close()"
            >
                <font-awesome-icon :icon="['fas', 'angle-left']" />
            </button>
            <div>
                <h2 id="qq-group-title">
                    {{ selected ? '成员资料' : '群聊成员' }}<small v-if="!selected">{{ members.length }}</small>
                </h2>
                <span>{{ chat.show.name }}</span>
            </div>
            <SeneraGroupManager :group-id="chat.show.id" />
            <button type="button" class="senera-icon-button qq-group-close" aria-label="关闭" @click="close">
                <font-awesome-icon :icon="['fas', 'xmark']" />
            </button>
        </header>
        <div class="qq-group-layout" :class="{ 'has-selection': selected }">
            <section class="qq-group-members" aria-label="群聊成员">
                <label class="qq-group-search"
                    ><font-awesome-icon :icon="['fas', 'magnifying-glass']" /><input
                        v-model="search"
                        type="search"
                        placeholder="搜索成员"
                        aria-label="搜索成员"
                /></label>
                <div class="qq-group-member-list">
                    <section v-for="section in sections" :key="section.name">
                        <h3>
                            {{ section.name }}<span>{{ section.members.length }}</span>
                        </h3>
                        <QQMemberRow
                            v-for="member in section.members"
                            :key="member.user_id"
                            :name="member.card || member.nickname"
                            :avatar="avatar(member.user_id)"
                            :role="role(member)"
                            :bot="isAgent(member.user_id)"
                            :selected="selected?.user_id === member.user_id"
                            @click="selected = member"
                        />
                    </section>
                    <p v-if="!sections.length" class="qq-group-empty">没有找到匹配的成员</p>
                </div>
            </section>
            <section class="qq-group-profile" :aria-label="selected ? '成员资料' : '群资料'" :style="selected?.user_id === seneraDirectory?.operatorId ? background('profile') : undefined">
                <template v-if="selected">
                    <div class="qq-profile-identity">
                        <img :src="avatar(selected.user_id)" alt="" />
                        <div>
                            <h3>
                                {{ selected.card || selected.nickname
                                }}<font-awesome-icon v-if="isAgent(selected.user_id)" :icon="['fas', 'robot']" />
                            </h3>
                            <span>QQ {{ selected.user_id }}</span>
                        </div>
                    </div>
                    <dl>
                        <dt>昵称</dt>
                        <dd>{{ selected.nickname }}</dd>
                        <dt>身份</dt>
                        <dd>
                            {{ isAgent(selected.user_id) ? 'Agent' : '用户'
                            }}<span v-if="role(selected)"> · {{ role(selected) }}</span>
                        </dd>
                        <template v-if="selected.card"
                            ><dt>群昵称</dt>
                            <dd>{{ selected.card }}</dd></template
                        ><template v-if="selected.title"
                            ><dt>头衔</dt>
                            <dd>{{ selected.title }}</dd></template
                        >
                    </dl>
                    <footer>
                        <button type="button" class="qq-secondary-button" @click="copy(selected.user_id)">
                            复制账号</button
                        ><button
                            v-if="selected.user_id !== Number(auth.loginInfo.uin)"
                            type="button"
                            class="qq-primary-button"
                            @click="message(selected)"
                        >
                            发消息
                        </button>
                    </footer>
                </template>
                <template v-else>
                    <div class="qq-profile-identity">
                        <img :src="conversationAvatar('group', chat.show.id)" alt="" />
                        <div>
                            <h3>{{ chat.show.name }}</h3>
                            <span>群号 {{ chat.show.id }}</span>
                        </div>
                    </div>
                    <dl>
                        <dt>群成员</dt>
                        <dd>{{ members.length }} 人</dd>
                        <dt>Agent</dt>
                        <dd>{{ members.filter((item) => isAgent(item.user_id)).length }} 位</dd>
                    </dl>
                    <p class="qq-group-description">选择成员查看资料，或通过右上角管理群聊与成员。</p>
                    <footer>
                        <button type="button" class="qq-secondary-button" @click="copy(chat.show.id)">复制群号</button>
                    </footer>
                </template>
            </section>
        </div>
    </dialog>
</template>
<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import app from '@renderer/main'
import { useAuthStore } from '@renderer/state/auth'
import { seneraDirectory } from '@renderer/runtime/seneraDirectory'
import { userAvatar as avatar, conversationAvatar } from '@renderer/runtime/seneraIdentity'
import { useClientAppearance } from '@renderer/runtime/appearance'
const { background } = useClientAppearance()
import { jumpToChat } from '@renderer/function/utils/appUtil'
import { PopInfo, PopType } from '@renderer/function/base'
import type { ChatInfoElem, GroupMemberInfoElem } from '@renderer/function/elements/information'
import QQMemberRow from './QQMemberRow.vue'
import SeneraGroupManager from './SeneraGroupManager.vue'

const props = defineProps<{ chat: ChatInfoElem }>()
const emit = defineEmits<{ close: [] }>()
const auth = useAuthStore()
const dialog = ref<HTMLDialogElement>()
const search = ref('')
const selected = ref<GroupMemberInfoElem>()
const members = computed(() => props.chat.info.group_members)
const sections = computed(() => {
    const query = search.value.trim().toLocaleLowerCase()
    const matching = members.value.filter((member) =>
        `${member.card} ${member.nickname} ${member.user_id}`.toLocaleLowerCase().includes(query),
    )
    return [
        { name: '群主 / 管理员', members: matching.filter((member) => ['owner', 'admin'].includes(member.role)) },
        { name: '群成员', members: matching.filter((member) => !['owner', 'admin'].includes(member.role)) },
    ].filter((section) => section.members.length)
})
const isAgent = (id: number) => Boolean(seneraDirectory.value?.agents.some((agent) => agent.qqUserId === id))
const role = (member: GroupMemberInfoElem) =>
    member.role === 'owner' ? '群主' : member.role === 'admin' ? '管理员' : undefined
watch(members, (list) => {
    if (selected.value) selected.value = list.find((member) => member.user_id === selected.value?.user_id)
})
onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => dialog.value?.close())
function close() {
    emit('close')
}
function backdrop(event: MouseEvent) {
    if (event.target === dialog.value) close()
}
async function copy(id: number) {
    try {
        await app.config.globalProperties.$copyText(String(id))
        new PopInfo().add(PopType.INFO, '复制成功', true)
    } catch {
        new PopInfo().add(PopType.ERR, '复制失败', true)
    }
}
async function message(member: GroupMemberInfoElem) {
    const agent = seneraDirectory.value?.agents.find((item) => item.qqUserId === member.user_id)
    if (!agent) return
    close()
    jumpToChat(String(member.user_id), '')
}
</script>
<style scoped>
.qq-group-info {
    box-sizing: border-box;
    width: min(704px, calc(100vw - 48px));
    height: min(620px, calc(100dvh - 72px));
    max-height: none;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--client-divider);
    border-radius: 12px;
    color: var(--qq-text_primary);
    background: var(--color-bg);
    font: inherit;
    box-shadow: 0 16px 64px #0003;
}
.qq-group-info::backdrop {
    background: #0003;
}
.qq-group-info[open] {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
}
.qq-group-info {
    pointer-events: auto;
}
.qq-group-heading {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px 18px 16px 24px;
    border-bottom: 1px solid var(--client-divider);
}
.qq-group-heading > div {
    flex: 1;
    min-width: 0;
}
.qq-group-heading h2 {
    display: flex;
    align-items: baseline;
    gap: 7px;
    margin: 0;
    font-size: 16px;
    font-weight: 600;
}
.qq-group-heading small,
.qq-group-heading > div > span {
    color: var(--qq-text_secondary);
    font-size: 12px;
    font-weight: 400;
}
.qq-group-heading > div > span {
    display: block;
    margin-top: 4px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.qq-group-back {
    display: none;
}
.qq-group-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    min-height: 0;
}
.qq-group-members {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--client-divider);
}
.qq-group-search {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 8px;
    margin: 16px;
    padding: 0 10px;
    height: 34px;
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: 6px;
    background: var(--client-hover);
    color: var(--qq-text_secondary);
}
.qq-group-search:focus-within {
    border-color: var(--client-accent);
}
.qq-group-search > svg {
    width: 14px;
}
.qq-group-search input {
    min-width: 0;
    width: 100%;
    padding: 0;
    border: 0;
    outline: none;
    color: var(--qq-text_primary);
    background: transparent;
    font: inherit;
    font-size: 13px;
}
.qq-group-member-list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 8px 12px;
    scrollbar-width: thin;
    scrollbar-color: var(--client-divider) transparent;
}
.qq-group-member-list h3 {
    display: flex;
    gap: 6px;
    margin: 12px 12px 5px;
    color: var(--qq-text_secondary);
    font-size: 12px;
    font-weight: 400;
}
.qq-group-profile {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: auto;
    padding: 30px 24px 24px;
    background: var(--color-card);
}
.qq-profile-identity {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 30px;
}
.qq-profile-identity > img {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    object-fit: cover;
}
.qq-profile-identity > div {
    min-width: 0;
}
.qq-profile-identity h3 {
    margin: 0 0 6px;
    font-size: 18px;
    font-weight: 500;
    overflow-wrap: anywhere;
}
.qq-profile-identity h3 svg {
    width: 14px;
    margin-left: 6px;
    color: var(--client-accent);
}
.qq-profile-identity span {
    color: var(--qq-text_secondary);
    font-size: 12px;
}
dl {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 20px 12px;
    margin: 0;
    font-size: 14px;
    line-height: 22px;
}
dt {
    color: var(--qq-text_secondary);
}
dd {
    margin: 0;
    overflow-wrap: anywhere;
}
.qq-group-description,
.qq-group-empty {
    font-size: 13px;
    line-height: 22px;
    color: var(--qq-text_secondary);
}
.qq-group-description {
    margin: 28px 0;
}
.qq-group-empty {
    margin: 24px;
    text-align: center;
}
footer {
    display: flex;
    gap: 10px;
    margin-top: auto;
    padding-top: 32px;
}
footer button {
    flex: 1;
    height: 36px;
    border-radius: 6px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
}
.qq-primary-button {
    border: 1px solid var(--client-accent);
    color: #fff;
    background: var(--client-accent);
}
.qq-secondary-button {
    border: 1px solid var(--client-divider);
    color: var(--qq-text_primary);
    background: transparent;
}
@media (max-width: 700px) {
    .qq-group-info {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100dvh;
        max-width: none;
        margin: 0;
        border: 0;
        border-radius: 0;
    }
    .qq-group-heading {
        padding: max(12px, env(safe-area-inset-top)) 14px 12px;
        height: 70px;
        box-sizing: border-box;
    }
    .qq-group-heading h2 {
        justify-content: center;
    }
    .qq-group-heading > div > span {
        text-align: center;
    }
    .qq-group-back {
        display: inline-flex;
    }
    .qq-group-close {
        display: none;
    }
    .qq-group-layout {
        display: block;
    }
    .qq-group-members {
        height: 100%;
        border: 0;
    }
    .qq-group-search {
        margin: 14px 18px 8px;
        height: 38px;
        border-radius: 9px;
    }
    .qq-group-member-list {
        padding: 4px 8px max(16px, env(safe-area-inset-bottom));
    }
    .qq-group-member-list h3 {
        margin-top: 18px;
    }
    .qq-group-profile {
        display: none;
    }
    .has-selection .qq-group-members {
        display: none;
    }
    .has-selection .qq-group-profile {
        display: flex;
        box-sizing: border-box;
        height: 100%;
        padding-bottom: max(24px, env(safe-area-inset-bottom));
    }
}
</style>
