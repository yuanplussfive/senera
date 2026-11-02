<!--
 * @FileDescription: 聊天面板页面
 * @Author: Stapxs
 * @Date:
 *      2022/08/14
 *      2022/12/12
 * @Version:
 *      1.0 - 初始版本
 *      1.5 - 重构为 ts 版本，代码格式优化
-->

<template>
    <div id="chat-pan"
        v-move="chatMoveOptions"
        :class="'chat-pan' +
            (uiStore.openSideBar ? ' open' : '')"
        :style="seneraConversation.hosted ? background('chat') : {
            'background-image': toBackgroundImageStyle(!settingsStore.sysConfig.chat_more_blur ? settingsStore.sysConfig.chat_background : ''),
            'background-position': settingsStore.sysConfig.chat_background_align ?? 'center',
            'background-size': settingsStore.sysConfig.chat_background_fit ?? 'cover'
        }"
        @v-move-right.prevent="exitWin()">
        <slot name="chat-extra" />
        <!-- 聊天基本信息 -->
        <div class="info">
            <button type="button" class="senera-icon-button senera-chat-back" :aria-label="$t('返回')" @click="exitWin">
                <font-awesome-icon :icon="['fas', 'angle-left']" />
            </button>
            <img :src="conversationAvatar(chat.show.type, chat.show.id)">
            <div class="info">
                <p>
                    {{ chat.show.name }}
                    <template
                        v-if="chat.show.type == 'group'">
                        ({{
                            chat.info.group_members.length
                        }})
                    </template>
                </p>
                <span v-if="seneraConversation.hosted && connectionStore.phase !== 'connected'" role="status" :title="connectionStore.reason">
                    正在重新连接，聊天内容已保留
                </span>
                <span v-else-if="seneraConversation.activity.value" role="status" aria-live="polite">
                    {{ seneraConversation.activity.value }}
                </span>
                <span v-else-if="chat.show.temp">
                    {{ $t('来自群聊：{group}', { group: chat.show.temp }) }}
                </span>
                <span v-else>
                    <template v-if="chat.show.appendInfo">
                        {{ chat.show.appendInfo }}
                    </template>
                    <template v-else>
                        {{
                            list[list.length - 1] ? $t('上次消息 - {time}', {
                                time: dateTimeFormat(trueLang, {
                                    hour: 'numeric',
                                    minute: 'numeric',
                                    second: 'numeric',
                                }).format(new Date(list[list.length - 1].time * 1000)),
                            }) : $t('暂无消息')
                        }}
                    </template>
                </span>
            </div>
            <div class="space" />
            <SeneraConsoleLink v-if="seneraConversation.hosted" />
            <SeneraGroupManager v-if="chat.show.type === 'group'" :group-id="Number(chat.show.id)" />
            <button v-if="seneraConversation.hosted" class="senera-conversation-clear"
                type="button" aria-label="清空当前对话"
                :title="seneraConversation.error.value || '清空当前对话（同步主控台）'"
                :disabled="!seneraConversation.available.value"
                @click="confirmClearConversation">
                <font-awesome-icon :icon="['fas', seneraConversation.busy.value ? 'spinner' : 'trash-can']" />
            </button>
            <button type="button" class="senera-icon-button senera-chat-menu" :aria-label="$t('更多菜单')" @click="openChatInfoPan">
                <font-awesome-icon :icon="['fas', 'bars']" />
            </button>
        </div>
        <!-- 加载中指示器 -->
        <div :class=" 'loading' + ((uiStore.nowGetHistory || replyLoading) && uiStore.canLoadHistory ? ' show' : '')">
            <font-awesome-icon :icon="['fas', 'spinner']" />
            <span>{{ $t('加载中') }}</span>
        </div>
        <!-- 消息显示区 -->
        <div id="msgPan" ref="msgPan" class="chat"
            style="scroll-behavior: smooth"
            @scroll="chatScroll($event, details[3].open)">
            <template v-if="!details[3].open">
                <div v-if="!uiStore.canLoadHistory" class="note note-nomsg">
                    <hr>
                    <a>{{ $t('没有更多消息了') }}</a>
                </div>
                <div v-if="uiStore.loadHistoryFail" class="note note-nomsg">
                    <hr>
                    <a>{{ $t('获取历史记录失败') }}</a>
                </div>
                <!-- 时间戳，在下滑加载的时候会显示，方便在大段的相连消息上让用户知道消息时间 -->
                <NoticeBody v-if="uiStore.nowGetHistory && list.length > 0"
                    :data="{ sub_type: 'time', time: list[0].time }" />
                <TransitionGroup :name="settingsStore.sysConfig.opt_fast_animation ? '' : 'msglist'" tag="div">
                    <template v-for="(msgIndex, index) in list">
                        <!-- 时间戳 -->
                        <NoticeBody
                            v-if="isShowTime(list[Number(index) - 1] ? list[Number(index) - 1].time : undefined, msgIndex.time)"
                            :key="'notice-time-' + (msgIndex.time / ( 4 * 60 )).toFixed(0)"
                            :data="{ sub_type: 'time', time: msgIndex.time }" />
                        <!-- [已删除]消息 -->
                        <NoticeBody
                            v-if="isDeleteMsg(msgIndex)"
                            :key="'delete-' + msgIndex.message_id"
                            :data="{ sub_type: 'delete' }" />
                        <!-- 消息体 -->
                        <MsgBody v-else-if="(msgIndex.post_type === 'message' ||
                                     msgIndex.post_type === 'message_sent') &&
                                     msgIndex.message.length > 0"
                            :key="msgIndex.fake_message_id ?? msgIndex.message_id"
                            :selected="multipleSelectList.includes(msgIndex.message_id) || tags.menuDisplay.menuSelectedMsgId == msgIndex.message_id"
                            :data="msgIndex"
                            :image-list-header="chatImg"
                            @click="msgClick($event, msgIndex)"
                            @show-menu="showMsgMeun"
                            @scroll-to-msg="jumpToQuotedMessage"
                            @image-loaded="imgLoadedScroll"
                            @left-move="replyMsg"
                            @send-poke="sendPoke" />
                        <!-- 其他通知消息 -->
                        <NoticeBody v-else-if="msgIndex.post_type === 'notice'"
                            :id="uuid()"
                            :key="'notice-' + index"
                            :data="msgIndex"
                            @reedit="reedit" />
                    </template>
                </TransitionGroup>
            </template>
            <template v-else>
                <!-- 搜索消息结果显示 -->
                <TransitionGroup
                    :name="settingsStore.sysConfig.opt_fast_animation ? '' : 'msglist'"
                    tag="div">
                    <template v-for="(msgIndex, index) in tags.search.list">
                        <!-- 时间戳 -->
                        <NoticeBody
                            v-if="isShowTime(list[Number(index) - 1] ? list[Number(index) - 1].time : undefined, msgIndex.time)"
                            :key="'notice-time-' + index"
                            :data="{ sub_type: 'time', time: msgIndex.time }" />
                        <!-- 消息体 -->
                        <MsgBody v-if=" (msgIndex.post_type === 'message' ||
                                     msgIndex.post_type === 'message_sent') &&
                                     msgIndex.message.length > 0"
                            :key="msgIndex.fake_message_id ?? msgIndex.message_id"
                            :selected="multipleSelectList.includes(msgIndex.message_id) || tags.menuDisplay.menuSelectedMsgId == msgIndex.message_id"
                            :data="msgIndex"
                            @scroll-to-msg="scrollToMsg"
                            @show-menu="showMsgMeun"
                            @image-loaded="imgLoadedScroll"
                            @left-move="replyMsg" />
                    </template>
                </TransitionGroup>
            </template>
            <span ref="chatPadding" class="chat-padding">&nbsp;</span>
        </div>
        <!-- 滚动到底部悬浮标志 -->
        <div class="new-msg"
            :style="{ 'opacity': tags.showBottomButton ? 1 : 0 }"
            @click="scrollBottom(true)">
            <div class="ss-card">
                <font-awesome-icon :icon="['fas', 'comment']" />
                <span v-if="NewMsgNum > 0">{{ NewMsgNum }}</span>
            </div>
        </div>
        <!-- 底部区域 -->
        <div id="send-more" ref="sendMore" class="more" :inert="sending" :aria-busy="sending">
            <!-- 功能附加 -->
            <div class="senera-composer-extras">
                <div>
                    <!-- 表情面板 -->
                    <Transition name="pan">
                        <FacePan v-show="details[1].open"
                            @add-special-msg="addSpecialMsg" @send-msg="sendMsg" />
                    </Transition>
                    <!-- 精华消息 -->
                    <Transition name="pan">
                        <div v-show="details[2].open"
                            class="ss-card jin-pan">
                            <div>
                                <font-awesome-icon :icon="['fas', 'message']" />
                                <span>{{ $t('精华消息') }}</span>
                                <font-awesome-icon :icon="['fas', 'xmark']" @click="details[2].open = !details[2].open" />
                            </div>
                            <div
                                class="jin-pan-body"
                                @scroll="jinScroll">
                                <div v-for="(item, index) in chat.info.jin_info.list"
                                    :key="'jin-' + index">
                                    <div>
                                        <img :src="userAvatar(item.sender_uin)">
                                        <div>
                                            <a>{{ item.sender_nick }}</a>
                                            <span>{{ item.sender_time ? dateTimeFormat(
                                                      trueLang,
                                                      {
                                                          hour: 'numeric',
                                                          minute: 'numeric',
                                                      },
                                                  ).format(new Date(item.sender_time * 1000))
                                                      : '' }}
                                                {{ $t('发送') }}</span>
                                        </div>
                                        <span>{{
                                            $t('{time}，由 {name} 设置', {
                                                time: item.add_digest_time ? dateTimeFormat(
                                                    trueLang,
                                                    {
                                                        hour: 'numeric',
                                                        minute: 'numeric',
                                                    },
                                                ).format(new Date(item.add_digest_time * 1000)) : '',
                                                name: item.add_digest_nick,
                                            })
                                        }}</span>
                                    </div>
                                    <div class="context">
                                        <MsgBody :data="item.normalizedMessage" type="body" id-prefix="essence-" />
                                    </div>
                                </div>
                                <div v-if="!tags.isJinLoading && chat.info.jin_info.list.length === 0" class="senera-essence-empty">暂无精华消息，可在消息菜单中设为精华。</div>
                                <div v-show="tags.isJinLoading" class="jin-pan-load">
                                    <font-awesome-icon :icon="['fas', 'spinner']" />
                                </div>
                            </div>
                        </div>
                    </Transition>
                </div>
                <!-- 多选指示器 -->
                <div :class=" multipleSelectList.length > 0 ? 'select-tag show' : 'select-tag'">
                    <div>
                        <font-awesome-icon :icon="['fas', 'share-from-square']" @click="showForWard('individual-messages')" />
                        <span>{{ $t('逐条转发') }}</span>
                    </div>
                    <div>
                        <font-awesome-icon :icon="['fas', 'share']" @click="showForWard('merged-messages')" />
                        <span>{{ $t('合并转发') }}</span>
                    </div>
                    <div>
                        <font-awesome-icon :icon="['fas', 'scissors']" />
                        <span>{{ $t('截图') }}</span>
                    </div>
                    <div>
                        <font-awesome-icon :icon="['fas', 'trash-can']" @click="delMsgs" />
                        <span>{{ $t('删除') }}</span>
                    </div>
                    <div>
                        <font-awesome-icon :icon="['fas', 'copy']" @click="copyMsgs" />
                        <span>{{ $t('复制') }}</span>
                    </div>
                    <div>
                        <font-awesome-icon :icon="['fas', 'xmark']" @click="recallMsgs" />
                        <span>{{ $t('撤回') }}</span>
                    </div>
                    <div>
                        <span @click="multipleSelectList = []">{{ multipleSelectList.length }}</span>
                        <span>{{ $t('取消') }}</span>
                    </div>
                </div>
                <ComposerAttachments :entries="pendingAttachments" @remove="removeAttachment" @retry="retryAttachment"
                    @edit="editImg" @preview="previewAttachment" @preview-unavailable="attachments.current().markPreviewUnavailable($event)" />
                <div v-if="draftSegments.some(segment => segment.value.type !== 'reply')" class="senera-draft-segments">
                    <div v-for="segment in draftSegments.filter(item => item.value.type !== 'reply')" :key="segment.id" class="senera-draft-segment">
                        <EmojiFace v-if="segment.value.type === 'face'" :emoji="Emoji.get(Number(segment.value.id))" />
                        <img v-else-if="segment.value.type === 'image'" :src="segment.value.url ?? segment.value.file" :alt="$t('图片')">
                        <span v-else>{{ segmentLabel(segment.value) }}</span>
                        <button type="button" :aria-label="'移除：' + segmentLabel(segment.value)" @click="removeSegment(segment.id)">
                            <font-awesome-icon :icon="['fas', 'xmark']" />
                        </button>
                    </div>
                </div>
                <!-- 搜索指示器 -->
                <div :class="details[3].open ? 'search-tag show' : 'search-tag'">
                    <font-awesome-icon :icon="['fas', 'search']" />
                    <span>{{ settingsStore.sysConfig.enable_local_history ? $t('搜索已保存的消息') : $t('搜索已加载的消息') }}</span>
                    <div @click="closeSearch">
                        <font-awesome-icon :icon="['fas', 'xmark']" />
                    </div>
                </div>
                <!-- 回复指示器 -->
                <div :class="tags.isReply ? 'replay-tag show' : 'replay-tag'">
                    <font-awesome-icon :icon="['fas', 'reply']" />
                    <span>{{
                        selectedMsg === null ?
                            '' : selectedMsg.sender.nickname + ': ' + getMsgRawTxt(selectedMsg)
                    }}</span>
                    <div @click="cancelReply">
                        <font-awesome-icon :icon="['fas', 'xmark']" />
                    </div>
                </div>
                <!-- At 指示器 -->
                <div
                    :class="atFindList != null ? 'at-tag show' : 'at-tag'"
                    contenteditable="true"
                    @blur="choiceAt(undefined)">
                    <div v-for="(item, index) in atFindList != null ? atFindList : []"
                        :key="'atFind-' + item.user_id"
                        :class="{ selected: index === atSelectedIndex }"
                        @click="choiceAt(item.user_id)">
                        <img :src="userAvatar(item.user_id)">
                        <span>{{
                            item.card != '' && item.card != null ? item.card : item.nickname
                        }}</span>
                        <a>{{ item.user_id }}</a>
                    </div>
                    <div v-if="atFindList?.length == 0" class="emp">
                        <span>{{ $t('没有找到匹配的群成员') }}</span>
                    </div>
                </div>
                <!-- 更多功能 -->
                <div :class="tags.showMoreDetail ? 'more-detail show' : 'more-detail'">
                    <button type="button" class="senera-icon-button action-image"
                        :title="$t('图片')"
                        @click="runSelectImg">
                        <font-awesome-icon :icon="['far', 'image']" />
                        <span class="sr-only">{{ $t('选择图片') }}</span>
                    </button>
                    <input id="choice-pic" type="file" accept="image/*" multiple style="display: none" :disabled="restoringDraft" :aria-label="$t('选择图片')" @change="selectImg">
                    <button type="button" class="senera-icon-button action-file"
                        :title="$t('文件')"
                        @click="runSelectFile">
                        <font-awesome-icon :icon="['far', 'folder']" />
                        <span class="sr-only">{{ $t('选择文件') }}</span>
                    </button>
                    <input id="choice-file" type="file" multiple style="display: none" :disabled="restoringDraft" :aria-label="$t('选择文件')" @change="selectFile">
                    <button type="button" class="senera-icon-button action-emoji"
                        :title="$t('表情')"
                        :aria-label="$t('表情')" :aria-expanded="details[1].open"
                        @click="(details[1].open = !details[1].open),
                                (tags.showMoreDetail = false)">
                        <font-awesome-icon :icon="['far', 'face-smile']" />
                    </button>
                    <button v-if="chat.show.type === 'user'" type="button" class="senera-icon-button action-poke"
                        :title="$t('戳一戳')" :aria-label="$t('戳一戳')"
                        @click="sendPoke(chat.show.id)">
                        <font-awesome-icon :icon="['fas', 'fa-hand-point-up']" />
                    </button>
                    <button v-if="chat.show.type === 'group' && authStore.jsonMap.group_essence?.name" type="button" class="senera-icon-button action-essence"
                        :title="$t('精华消息')" :aria-label="$t('精华消息')" @click="showJin">
                        <font-awesome-icon :icon="['fas', 'star']" />
                    </button>
                    <div class="space" />
                    <button type="button" class="senera-icon-button action-history" :title="$t('搜索消息')" :aria-label="$t('搜索消息')" @click="openSearch">
                        <font-awesome-icon :icon="['far', 'clock']" />
                    </button>
                </div>
            </div>
            <!-- 消息发送框 -->
            <div class="senera-compose-row">
                <div v-menu.prevent="_=>moreFunClick()" class="senera-quick-action"
                    @click="moreFunClick(settingsStore.sysConfig.quick_send)">
                    <font-awesome-icon v-if="tags.showMoreDetail || details.find(item => item.open)" :icon="['fas', 'minus']" />
                    <font-awesome-icon v-else-if="settingsStore.sysConfig.quick_send == 'default'" :icon="['fas', 'plus']" />
                    <font-awesome-icon v-else-if="settingsStore.sysConfig.quick_send == 'img'" :icon="['fas', 'image']" />
                    <font-awesome-icon v-else-if="settingsStore.sysConfig.quick_send == 'file'" :icon="['fas', 'folder']" />
                    <font-awesome-icon v-else-if="settingsStore.sysConfig.quick_send == 'face'" :icon="['fas', 'face-laugh']" />
                </div>
                <div class="senera-compose-body">
                    <form @submit="mainSubmit">
                        <template v-if="!seneraConversation.hosted && !Option.get('use_breakline')">
                            <label for="main-input" class="sr-only">{{ $t('消息输入框') }}</label>
                            <input
                                id="main-input"
                                ref="mainInput"
                                v-model="msg"
                                type="text"
                                autocomplete="off"
                                :disabled="restoringDraft || uiStore.openSideBar || chat.info.me_info.shut_up_timestamp > 0"
                                :placeholder="
                                    chat.info.me_info.shut_up_timestamp > 0
                                        ? $t('已被禁言至：{time}', {
                                            time: dateTimeFormat(
                                                trueLang, getTimeConfig(
                                                    new Date(chat.info.me_info.shut_up_timestamp * 1000),
                                                ),
                                            ).format(new Date(chat.info.me_info.shut_up_timestamp * 1000)),
                                        }) : ''"
                                @paste="addImg"
                                @keydown="mainAtKey"
                                @keyup="mainKeyUp"
                                @input="handleInput">
                        </template>
                        <template v-else>
                            <label for="main-input-ex" class="sr-only">{{ $t('消息输入框') }}</label>
                            <textarea id="main-input-ex"
                                ref="mainInput"
                                v-model="msg"
                                type="text"
                                :disabled="restoringDraft || uiStore.openSideBar || chat.info.me_info.shut_up_timestamp > 0"
                                @paste="addImg"
                                @keydown="mainKey"
                                @keyup="mainKeyUp"
                                @input="handleInput"
                                @compositionstart="handleCompositionStart"
                                @compositionend="handleCompositionEnd" />
                        </template>
                    </form>
                    <slot name="main-input-button" />
                    <button type="button" class="senera-send-button" :aria-label="details[3].open ? $t('搜索消息') : $t('发送')"
                        :disabled="!canSend" @click="sendMsg('sendMsgBack')">
                        <font-awesome-icon v-if="details[3].open" :icon="['fas', 'search']" />
                        <font-awesome-icon v-else :icon="['fas', 'angle-right']" />
                        <span>{{ details[3].open ? $t('搜索消息') : $t('发送') }}</span>
                    </button>
                </div>
            </div>
            <div class="senera-compose-safe-area" />
        </div>
        <!-- 合并转发消息预览器 -->
        <MergePan ref="mergePan" />
        <!-- 消息右击菜单 -->
        <Teleport to="body">
            <div class="msg-menu">
                <div v-show="tags.showMsgMenu" class="msg-menu-bg" @click="closeMsgMenu" />
                <div id="msgMenu" :class="tags.showMsgMenu ?
                    'ss-card msg-menu-body show' : 'ss-card msg-menu-body'">
                    <div v-if="chatStore.chatInfo.show.type == 'group' && authStore.jsonMap.send_respond?.name"
                        v-show="tags.menuDisplay.showRespond"
                        :class="'ss-card respond' + (tags.menuDisplay.respond ? ' open' : '')">
                        <template v-for="(num, index) in Emoji.responseId" :key="'respond-' + num">
                            <EmojiFace :emoji="Emoji.get(num)!"
                                @click="sendRespond(num)" />
                            <font-awesome-icon v-if="index == 4" :icon="['fas', 'angle-up']"
                                @click="tags.menuDisplay.respond = true" />
                        </template>
                    </div>
                    <div v-show="tags.menuDisplay.add" @click="forwardSelf()">
                        <div><font-awesome-icon :icon="['fas', 'plus']" /></div>
                        <a>{{ $t('+ 1') }}</a>
                    </div>
                    <div v-show="tags.menuDisplay.relpy" @click="menuReplyMsg(true)">
                        <div><font-awesome-icon :icon="['fas', 'message']" /></div>
                        <a>{{ $t('回复') }}</a>
                    </div>
                    <div v-show="tags.menuDisplay.forward" @click="showForWard()">
                        <div><font-awesome-icon :icon="['fas', 'share']" /></div>
                        <a>{{ $t('转发') }}</a>
                    </div>
                    <div v-show="tags.menuDisplay.select" @click="intoMultipleSelect()">
                        <div><font-awesome-icon :icon="['fas', 'circle-check']" /></div>
                        <a>{{ $t('多选') }}</a>
                    </div>
                    <div v-show="tags.menuDisplay.copy" @click="copyMsg">
                        <div><font-awesome-icon :icon="['fas', 'clipboard']" /></div>
                        <a>{{ $t('复制') }}</a>
                    </div>
                    <div v-show="tags.menuDisplay.copySelect" @click="copySelectMsg">
                        <div><font-awesome-icon :icon="['fas', 'code']" /></div>
                        <a>{{ $t('复制选中文本') }}</a>
                    </div>
                    <div v-show="tags.menuDisplay.copyImg" @click="copyImg">
                        <div><font-awesome-icon :icon="['fas', 'object-ungroup']" /></div>
                        <a>{{ $t('复制图片') }}</a>
                    </div>
                    <div v-show="tags.menuDisplay.downloadImg != false" @click="downloadImg">
                        <div><font-awesome-icon :icon="['fas', 'floppy-disk']" /></div>
                        <a>{{ $t('下载图片') }}</a>
                    </div>
                    <div v-show="tags.menuDisplay.revoke" @click="revokeMsg">
                        <div><font-awesome-icon :icon="['fas', 'xmark']" /></div>
                        <a>{{ $t('撤回') }}</a>
                    </div>
                    <div v-show="tags.menuDisplay.reedit" @click="reeditMsg">
                        <div><font-awesome-icon :icon="['fas', 'pencil']" /></div>
                        <a>{{ $t('重新编辑') }}</a>
                    </div>
                    <div v-if="chat.show.type === 'group' && selectedMsg && authStore.jsonMap.set_essence?.name" @click="toggleEssence">
                        <div><font-awesome-icon :icon="['fas', 'star']" /></div>
                        <a>{{ selectedMsg.is_essence ? '移出精华' : '设为精华' }}</a>
                    </div>
                    <div v-if="selectedMsg?.seneraTask && seneraConversation.hosted" @click="deleteTask">
                        <div><font-awesome-icon :icon="['fas', 'trash-can']" /></div>
                        <a>删除该任务及之后的消息</a>
                    </div>
                    <div v-show="tags.menuDisplay.at"
                        @click="selectedMsg ? addSpecialMsg({ type: 'at', qq: Number(selectedMsg.sender.user_id) }): '';
                                toMainInput();
                                closeMsgMenu()">
                        <div><font-awesome-icon :icon="['fas', 'at']" /></div>
                        <a>{{ $t('提及') }}</a>
                    </div>
                    <div v-show="tags.menuDisplay.poke" @click="sendPoke(selectedMsg ? selectedMsg.sender.user_id : undefined)">
                        <div><font-awesome-icon :icon="['fas', 'fa-hand-point-up']" /></div>
                        <a>{{ $t('戳一戳') }}</a>
                    </div>
                    <div v-show="tags.menuDisplay.remove" @click="removeUser">
                        <div><font-awesome-icon :icon="['fas', 'trash-can']" /></div>
                        <a>{{ $t('移出群聊') }}</a>
                    </div>
                    <div v-show="tags.menuDisplay.config"
                        @click="openChatInfoPan();
                                ($refs.infoRef as any).openMoreConfig(selectedMsg?.sender.user_id);
                                closeMsgMenu();">
                        <div><font-awesome-icon :icon="['fas', 'cog']" /></div>
                        <a>{{ $t('成员设置') }}</a>
                    </div>
                    <div v-show="tags.menuDisplay.jumpToMsg" @click="jumpSearchMsg">
                        <div><font-awesome-icon :icon="['fas', 'arrow-up-right-from-square']" /></div>
                        <a>{{ $t('跳转到消息') }}</a>
                    </div>
                    <div v-show="isDev" @click="consoleLogMsg">
                        <div><font-awesome-icon :icon="['fas', 'screwdriver-wrench']" /></div>
                        <a>{{ $t('调试信息') }}</a>
                    </div>
                </div>
            </div>
        </Teleport>
        <!-- 群 / 好友信息弹窗 -->
        <Transition name="chat-info-float" :duration="{ enter: 300, leave: 200 }">
            <Info ref="infoRef" :chat="chat" :tags="tags"
                @close="openChatInfoPan" />
        </Transition>
        <!-- 转发面板 -->
        <Transition>
            <div v-if="tags.showForwardPan" class="forward-pan">
                <div class="ss-card card">
                    <header>
                        <span>{{ $t('转发消息') }}</span>
                        <font-awesome-icon :icon="['fas', 'xmark']" @click="cancelForward" />
                    </header>
                    <label for="chat-forward-search" class="sr-only">{{ $t('搜索转发对象') }}</label>
                    <input id="chat-forward-search" :placeholder="$t('搜索 ……')" @input="searchForward">
                    <div>
                        <div v-for="data in forwardList"
                            :key=" 'forwardList-' + data.user_id ? data.user_id : data.group_id"
                            @click="forwardMsg(data)">
                            <img loading="lazy"
                                :title="getShowName(data.group_name || data.nickname, data.remark)"
                                :src="conversationAvatar(data.user_id ? 'user' : 'group', data.user_id ?? data.group_id)">
                            <div>
                                <p>
                                    {{ data.group_name ?
                                        data.group_name : data.remark === data.nickname ?
                                            data.nickname : data.remark + '（' + data.nickname + '）'
                                    }}
                                </p>
                                <span>{{ data.group_id ? $t('群组') : $t('好友') }}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="bg" @click="cancelForward" />
            </div>
        </Transition>
        <div class="bg" :style="{
            'backdrop-filter': `blur(${!settingsStore.sysConfig.chat_more_blur ? settingsStore.sysConfig .chat_background_blur : 0}px)`
        }" />
    </div>
</template>

<script setup lang="ts">
import ComposerAttachments from '@renderer/components/ComposerAttachments.vue'
import { userAvatar, conversationAvatar } from '@renderer/runtime/seneraIdentity'
import { useClientAppearance } from '@renderer/runtime/appearance'
const { background } = useClientAppearance()
import { dateTimeFormat } from '@renderer/runtime/time'
import app from '@renderer/main'
import { i18n } from '@renderer/main'
import Option, { get } from '@renderer/function/option'
import Info from '@renderer/pages/Info.vue'
import MsgBody from '@renderer/components/MsgBody.vue'
import NoticeBody from '@renderer/components/NoticeBody.vue'
import FacePan from '@renderer/components/FacePan.vue'
import MergePan from '@renderer/components/MergePan.vue'
import { useSeneraAttachments } from '@renderer/runtime/useSeneraAttachments'
import { enqueueComposerFileSelection } from '../../../../../../src/api/composerFileSelection'
import { seneraMessageOutbox } from '@renderer/runtime/seneraMessageOutbox'
import { buildSeneraMessage } from '@renderer/runtime/seneraMessageDraft'
import { readSeneraComposer, type StoredSeneraComposer } from '@renderer/runtime/seneraComposerStorage'
import { seneraResourceBaseUrl } from '@renderer/runtime/seneraContext'
import { messageDraftRepository } from '../../../../../../src/api/messageDraftRepository'

import {
    ref,
    computed,
    watch,
    onMounted,
    onBeforeUnmount,
    markRaw,
    nextTick,
    reactive,
    inject,
    toRaw,
    useTemplateRef,
} from 'vue'
import { v4 as uuid } from 'uuid'
import {
	scrollToMsg,
    downloadFile,
    loadHistory as loadHistoryFirst,
    loadMoreHistoryMessages,
    shouldAutoFocus,
	vMenu,
	vMove,
	VMoveOptions,
} from '@renderer/function/utils/appUtil'
import {
    copyToClipboard,
    getTimeConfig,
    getTrueLang,
    getViewTime,
} from '@renderer/function/utils/systemUtil'
import {
    getMsgRawTxt,
    getMsgData,
    sendMsgRaw,
    getShowName,
    isShowTime,
    isDeleteMsg,
    getImageUrlData,
} from '@renderer/function/utils/msgUtil'
import { Logger, LogType, PopInfo, PopType } from '@renderer/function/base'
import { Connector, login } from '@renderer/function/connect'
import { callMessageAction, applyMessageAnnotations, toggleMessageReaction } from '@renderer/function/messageAnnotations'
import { useSeneraConversation } from '@renderer/runtime/useSeneraConversation'
import SeneraGroupManager from '@renderer/components/SeneraGroupManager.vue'
import SeneraConsoleLink from '@renderer/components/SeneraConsoleLink.vue'
import { deleteSeneraTask, seneraClientRoot, refreshSeneraTimeline } from '@renderer/runtime/seneraClient'
import { historyRequestTracker, isSameHistorySession } from '@renderer/function/utils/historyRequest'
import { appendHistoryForQuotedMessage, normalizeMessagesForPreview } from '@renderer/function/msg'
import { loadHistoryToQuotedMessage } from '@renderer/function/utils/quotedMessage'
import { keepQuotedMessageInView } from '@renderer/function/utils/quotedScroll'
import { useQuotedMessagesStore } from '@renderer/state/quotedMessages'
import {
    BaseChatInfoElem,
    MsgItemElem,
    GroupMemberInfoElem,
    UserFriendElem,
    UserGroupElem,
    MenuEventData,
} from '@renderer/function/elements/information'
import { toBackgroundImageStyle } from '@renderer/function/utils/backgroundUtil'
import Emoji from '@renderer/function/model/emoji'
import EmojiFace from '@renderer/components/EmojiFace.vue'
import { Img } from '@renderer/function/model/img'
import { useSessionHistoryStore } from '@renderer/state/sessionHistory'
import { useConnectionStore } from '@renderer/state/connection'
import { useUIStore } from '@renderer/state/ui'
import { useSettingsStore } from '@renderer/state/settings'
import { useAuthStore } from '@renderer/state/auth'
import { useChatStore } from '@renderer/state/chat'
import { useContactStore } from '@renderer/state/contact'
import {
    getOneBotResponseError,
} from '@renderer/function/utils/fileTransferUtil'

defineOptions({ name: 'ViewChat' })

const $t = i18n.global.t
const { viewer: viewerRef } = inject<{ viewer: any }>('viewer', { viewer: null })

const { chat, list } = defineProps<{
    chat: any
    list: any[]
    imgView?: any
}>()

const connectionStore = useConnectionStore()
const uiStore = useUIStore()
const settingsStore = useSettingsStore()
const authStore = useAuthStore()
const chatStore = useChatStore()
const contactStore = useContactStore()
const quotedMessages = useQuotedMessagesStore()
const replyLoading = ref(false)
let replyJump = 0
let replyAnchor: ReturnType<typeof keepQuotedMessageInView> | undefined

function cancelReplyJump() {
    replyJump++
    replyAnchor?.stop()
    if (!replyLoading.value) return
    replyLoading.value = false
    uiStore.nowGetHistory = false
    uiStore.historyBeforeTime = undefined
}

watch(() => quotedMessages.scopeVersion, cancelReplyJump, { flush: 'sync' })
const mergePan = useTemplateRef<InstanceType<typeof MergePan>>('mergePan')
const msgPan = useTemplateRef<HTMLDivElement>('msgPan')
const chatPadding = useTemplateRef<HTMLSpanElement>('chatPadding')
const sendMore = useTemplateRef<HTMLDivElement>('sendMore')
const mainInput = useTemplateRef<HTMLInputElement | HTMLTextAreaElement>('mainInput')

type ForwardAction = 'single-message' | 'individual-messages' | 'merged-messages'

const multipleSelectList = ref<string[]>([])
const selectedForwardAction = ref<ForwardAction>('single-message')
const tags = ref({
    sendTag: 'REFUSE' as 'READY' | 'PASS' | 'REFUSE',
    showBottomButton: true,
    showMoreDetail: false,
    showMsgMenu: false,
    showForwardPan: false,
    openChatInfo: false,
    isReply: false,
    isJinLoading: false,
    onAtFind: false,
    menuDisplay: {
        menuSelectedMsgId: null as string | null,
        jumpToMsg: false,
        add: true,
        relpy: true,
        forward: true,
        select: true,
        copy: true,
        copySelect: false,
        copyImg: false,
        downloadImg: false as string | false,
        revoke: false,
        reedit: false,
        at: true,
        poke: false,
        remove: false,
        respond: false,
        showRespond: true,
        config: false,
    },
    search: {
        userId: -1,
        list: reactive(list),
    },
    msgTouch: {
        x: -1,
        y: -1,
        msgOnTouchDown: false,
        onMove: 'no',
    },
    checkNewLineFlag: false,
})
const details = ref([
    { open: false },
    { open: false },
    { open: false },
    { open: false },
])
const msgMenus = ref<any[]>([])
const NewMsgNum = ref(0)
const msg = ref('')
const draftSegments = ref<{ id: string; value: MsgItemElem }[]>([])
const attachments = useSeneraAttachments(() => JSON.stringify(['onebot11', seneraClientRoot(), authStore.loginInfo.uin, chat.show.type, chat.show.id]))
const pendingAttachments = attachments.pending
const removeAttachment = (id: string) => attachments.current().remove(id)
const retryAttachment = (id: string) => attachments.current().retry(id)
const sending = ref(false)
let composerUpload: AbortController | undefined
const selectedMsg = ref<{ [key: string]: any } | null>(null)
const selectCache = ref('')
const atFindList = ref<GroupMemberInfoElem[] | null>(null)
const atSelectedIndex = ref(0)
const atScrollTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const atScrollInterval = ref<ReturnType<typeof setInterval> | null>(null)
const forwardList = ref(contactStore.userList)
const chatImg = ref<any>(undefined)
const trueLang = getTrueLang()
const isDev = import.meta.env.DEV

let draftKey: string | undefined
const restoringComposer = ref(true)
const restoringDraft = computed(() => restoringComposer.value || attachments.restoring.value)
let draftOperation = 0
let draftRestore: AbortController | undefined
const reportDraftError = (error: unknown) => new PopInfo().add(PopType.ERR, `无法保存或恢复消息草稿：${error instanceof Error ? error.message : String(error)}`)
function persistComposer() {
    if (!draftKey || restoringComposer.value) return
    const draft: StoredSeneraComposer = { version: 2, message: msg.value, parts: JSON.parse(JSON.stringify(draftSegments.value)) }
    void messageDraftRepository.write(draftKey, draft.message || draft.parts.length ? draft : undefined).catch(reportDraftError)
}
function restoreComposer() { return loadComposer() }
async function loadComposer() {
    draftRestore?.abort()
    const controller = new AbortController()
    draftRestore = controller
    const operation = ++draftOperation
    restoringComposer.value = true
    draftKey = JSON.stringify(['onebot11', seneraClientRoot(), authStore.loginInfo.uin, chat.show.type, chat.show.id])
    try {
        const draft = await readSeneraComposer(draftKey, attachments.current(), controller.signal)
        if (operation !== draftOperation) return
        msg.value = draft?.message ?? ''
        draftSegments.value = draft?.parts ?? []
    } catch (error) { if (!controller.signal.aborted) reportDraftError(error) }
    finally {
        if (operation === draftOperation) {
            restoringComposer.value = false
            if (!controller.signal.aborted) void resumeOutgoingMessages()
        }
    }
}
watch([msg, draftSegments], persistComposer, { deep: true, flush: 'post' })
watch(() => connectionStore.phase, phase => { if (phase === 'connected') void resumeOutgoingMessages() })
watch(restoringDraft, restoring => { if (!restoring) void resumeOutgoingMessages() })
const canSend = computed(() => !sending.value && !restoringDraft.value && !uiStore.openSideBar &&
    !(chat.info.me_info.shut_up_timestamp > 0) && pendingAttachments.value.every(entry => entry.status === 'uploaded') &&
    Boolean(msg.value.trim() || pendingAttachments.value.length || draftSegments.value.some(part => part.value.type !== 'reply')))

function reloadChannelHistory(reset = false) {
    if (!login.status || !chatStore.chatInfo.show.id) return
    const request = historyRequestTracker.current()
    if (!reset && request && isSameHistorySession(request, chatStore.chatInfo.show)) refreshSeneraTimeline()
    else void loadHistoryFirst(chatStore.chatInfo.show)
}

const seneraConversation = useSeneraConversation(
    () => chatStore.chatInfo.show,
    () => {
        composerUpload?.abort()
        composerUpload = undefined
        sending.value = false
        if (draftKey) void seneraMessageOutbox.clear(draftKey).catch(reportDraftError)
        cancelReplyJump()
        quotedMessages.reset()
        multipleSelectList.value = []
        selectedMsg.value = null
        tags.value.isReply = false
        tags.value.showMsgMenu = false
        tags.value.showForwardPan = false
        tags.value.search.list = []
        details.value[3].open = false
        NewMsgNum.value = 0
        chatStore.messageList = []
        chatStore.mergeMsgStack = []
        chatStore.mergeMessageList = undefined
        chatStore.mergeMessageImgList = undefined
        chatStore.chatInfo.info.image_list = []
        const contact = contactStore.baseOnMsgList.get(chatStore.chatInfo.show.id)
        if (contact) {
            contact.raw_msg = ''
            contact.message_id = ''
            contact.new_msg = false
        }
        reloadChannelHistory(true)
    },
    reloadChannelHistory,
)

function confirmClearConversation() {
    const current = seneraConversation.conversation.value
    if (!current || !seneraConversation.available.value) return
    const target = { ...current }
    uiStore.popBoxList.push({
        title: '清空当前对话',
        html: '<span>将停止当前任务，删除此对话的消息、模型上下文及关联产物，并同步主控台。此操作无法撤销。</span>',
        button: [
            {
                text: '清空',
                fun: async () => {
                    uiStore.popBoxList.shift()
                    try {
                        await seneraConversation.clear(target)
                        new PopInfo().add(PopType.INFO, '已清空当前对话')
                    } catch (reason) {
                        new PopInfo().add(PopType.ERR, reason instanceof Error ? reason.message : String(reason))
                    }
                },
            },
            { text: $t('取消'), master: true, fun: () => { uiStore.popBoxList.shift() } },
        ],
    })
}

//#region == 窗口移动相关 ==================================================
const chatMoveOptions: VMoveOptions<HTMLDivElement> = {
    enabled: () => window.matchMedia('(max-width: 700px)').matches,
    startEdge: 'left',
    beforeHook: (_) => {
        const target = getTargetWin()
        if (!target) return
        target.style.transition = 'all 0s'
        const pan = document.getElementById('chat-pan')
        if (!pan) return
        const chatEl = pan.getElementsByClassName('chat')[0] as HTMLDivElement
        if(chatEl)
            chatEl.style.overflowY = 'hidden'
    },
    moveHook: (_, move: number) => {
        const target = getTargetWin()
        if (!target) return
        target.style.transform = 'translateX(' + move + 'px)'
    },
    endHook: (_) => {
        const pan = document.getElementById('chat-pan')
        const chatEl = pan?.getElementsByClassName('chat')[0] as HTMLDivElement
        if(chatEl) {
            chatEl.style.overflowY = 'scroll'
        }
        const target = getTargetWin()
        if (!target) return
        target.style.transition = 'transform 0.3s'
        target.style.transform = ''
    },
    rightLimit: {
        value: 100,
        type: '%',
    },
    moveCondition: {
        minMove: {
            value: 33,
            type: '%',
        }
    },
}
//#endregion

function resetState() {
    tags.value = {
        sendTag: 'REFUSE',
        showBottomButton: true,
        showMoreDetail: false,
        showMsgMenu: false,
        showForwardPan: false,
        openChatInfo: false,
        isReply: false,
        isJinLoading: false,
        onAtFind: false,
        menuDisplay: {
            menuSelectedMsgId: null,
            jumpToMsg: false,
            add: true,
            relpy: true,
            forward: true,
            select: true,
            copy: true,
            copySelect: false,
            copyImg: false,
            downloadImg: false,
            revoke: false,
            reedit: false,
            at: true,
            poke: false,
            remove: false,
            respond: false,
            showRespond: true,
            config: false,
        },
        search: {
            userId: -1,
            list: reactive(list),
        },
        msgTouch: {
            x: -1,
            y: -1,
            msgOnTouchDown: false,
            onMove: 'no',
        },
        checkNewLineFlag: false,
    }
    msgMenus.value = []
}

watch(() => JSON.stringify([chat.show.type, chat.show.id]), () => {
    persistComposer()
    restoringComposer.value = true
    composerUpload?.abort()
    composerUpload = undefined
    sending.value = false
    resetState()
    draftSegments.value = []
    multipleSelectList.value = []
    initMenuDisplay()
    nextTick(() => {
        scheduleResizeMainInput()
    })
    const history = useSessionHistoryStore()
    const sessionId = chat.show.id
    const session = [...contactStore.userList].find(i => (i.user_id ?? i.group_id) === sessionId)
    if (session) history.add(session)
    void restoreComposer()
})

watch(msg, () => scheduleResizeMainInput())

onMounted(() => {
    void restoreComposer()
    const history = useSessionHistoryStore()
    const sessionId = chat.show.id
    const session = [...contactStore.userList].find(i => (i.user_id ?? i.group_id) === sessionId)
    if (session) history.add(session)

    updateList(list.length, 0)
    watch(() => list.map((item) => (item.timelineKey ?? item.message_id) + '_' + item.fake_msg),
        (newIds, oldIds = []) => {
            if (newIds.length === oldIds.length && newIds.every((id, index) => id === oldIds[index])) return
            updateList(newIds.length, oldIds.length)
        },
    )
    watch(() => chat.info.jin_info.list.length, () => {
            tags.value.isJinLoading = false
        },
    )
    watch(() => connectionStore.backTimes, () => {
        exitWin()
    })
    nextTick(() => {
        setupChatPaddingObserver()
        scheduleResizeMainInput()
    })
})

onBeforeUnmount(() => {
    persistComposer()
    draftOperation++
    draftRestore?.abort()
    composerUpload?.abort()
    cancelReplyJump()
    if (resizeMainInputFrame !== null) {
        cancelAnimationFrame(resizeMainInputFrame)
        resizeMainInputFrame = null
    }
    if (chatPaddingFrame !== null) {
        cancelAnimationFrame(chatPaddingFrame)
        chatPaddingFrame = null
    }
    if (sendMoreResizeObserver !== null) {
        sendMoreResizeObserver.disconnect()
        sendMoreResizeObserver = null
    }
})

let resizeMainInputFrame: number | null = null
let chatPaddingFrame: number | null = null
let sendMoreResizeObserver: ResizeObserver | null = null
let chatPaddingAfterUpdate: Array<() => void> = []
// scrollHeight includes a small browser-dependent inner gap for this textarea style.
// Keep the existing compact visual height, but make the adjustment explicit.
const TEXTAREA_SCROLL_HEIGHT_COMPACT_OFFSET = 4

function scheduleResizeMainInput(target?: HTMLTextAreaElement | HTMLInputElement | null, keepBottom = false) {
    // The template switches between input and textarea, so measure only after Vue
    // has applied the branch and coalesce rapid input changes into one frame.
    nextTick(() => {
        if (resizeMainInputFrame !== null) {
            cancelAnimationFrame(resizeMainInputFrame)
        }
        resizeMainInputFrame = requestAnimationFrame(() => {
            resizeMainInputFrame = null
            resizeMainInput(target ?? mainInput.value)
            scheduleChatPaddingUpdate(keepBottom ? () => scrollBottom() : undefined)
        })
    })
}

function updateChatPadding() {
    const morePan = sendMore.value
    const padding = chatPadding.value
    const chatPan = msgPan.value
    if (!morePan || !padding || !chatPan) return

    const contentBlocks = Array.from(morePan.children)
        .flatMap(child => Array.from(child.children))
        .filter((child): child is HTMLElement =>
            child instanceof HTMLElement && child.offsetHeight > 0,
        )
    const contentTop = contentBlocks.length > 0? contentBlocks.reduce(
            (top, child) => Math.min(top, child.getBoundingClientRect().top),
            Number.POSITIVE_INFINITY,
        ): morePan.getBoundingClientRect().top
    const chatBottom = chatPan.getBoundingClientRect().bottom
    padding.style.height = Math.max(0, chatBottom - contentTop) + 'px'
}

function scheduleChatPaddingUpdate(afterUpdate?: () => void) {
    if (afterUpdate) {
        chatPaddingAfterUpdate.push(afterUpdate)
    }
    if (chatPaddingFrame !== null) {
        return
    }
    chatPaddingFrame = requestAnimationFrame(() => {
        chatPaddingFrame = null
        updateChatPadding()
        const callbacks = chatPaddingAfterUpdate
        chatPaddingAfterUpdate = []
        callbacks.forEach(callback => callback())
    })
}

function setupChatPaddingObserver() {
    if (sendMoreResizeObserver !== null) return
    const morePan = sendMore.value
    if (!morePan || typeof ResizeObserver === 'undefined') {
        scheduleChatPaddingUpdate()
        return
    }
    sendMoreResizeObserver = new ResizeObserver(() => {
        scheduleChatPaddingUpdate()
    })
    sendMoreResizeObserver.observe(morePan)
    scheduleChatPaddingUpdate()
}

function resizeMainInput(target?: HTMLTextAreaElement | HTMLInputElement | null) {
    const input = target ?? mainInput.value
    if (!input) return
    if (!seneraConversation.hosted && !Option.get('use_breakline')) {
        input.style.height = ''
        return
    }
    if (!(input instanceof HTMLTextAreaElement)) {
        input.style.height = ''
        return
    }
    const computed = getComputedStyle(input)
    const lineHeight = Number.parseFloat(computed.lineHeight)
    const fontSize = Number.parseFloat(computed.fontSize)
    const baseLineHeight = Number.isFinite(lineHeight) ? lineHeight : fontSize
    const paddingTop = Number.parseFloat(computed.paddingTop) || 0
    const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0
    const borderTop = Number.parseFloat(computed.borderTopWidth) || 0
    const borderBottom = Number.parseFloat(computed.borderBottomWidth) || 0
    let minHeight = (Number.isFinite(baseLineHeight) ? baseLineHeight : 0) + paddingTop + paddingBottom + borderTop + borderBottom
    if (minHeight <= 0) {
        const fallback = input.offsetHeight || Number.parseFloat(computed.height) || fontSize
        if (fallback && Number.isFinite(fallback)) {
            minHeight = fallback
        }
    }
    if (!input.dataset.baseHeight) {
        input.dataset.baseHeight = String(minHeight)
    }

    const oldTransition = input.style.transition
    input.style.transition = 'none'
    const oldOverflow = input.style.overflow

    const baseHeight = Number.parseFloat(input.dataset.baseHeight) || minHeight
    // Fast-path: if content is empty, reset directly to baseHeight without measuring
    if (input.value === '') {
        input.style.height = baseHeight + 'px'
    } else {
        // Set overflow:hidden so scrollHeight correctly reflects content height
        input.style.overflow = 'hidden'
        input.style.height = '0px'
        const targetHeight = Math.max(input.scrollHeight - TEXTAREA_SCROLL_HEIGHT_COMPACT_OFFSET, baseHeight)
        input.style.height = targetHeight + 'px'
        input.style.overflow = oldOverflow
    }

    input.getBoundingClientRect()
    input.style.transition = oldTransition
}
function jumpSearchMsg() {
    closeSearch()
    setTimeout(() => {
        if (!selectedMsg.value) return
        scrollToMsg('chat-' + selectedMsg.value?.message_id, true)
        closeMsgMenu()
    }, 100)
}

function chatScroll(event: Event, pass: boolean) {
    if(pass) return

    const body = event.target as HTMLDivElement
    if (body.scrollTop === 0 && list.length > 0 && !replyLoading.value) {
        loadMoreHistory()
    }
    if ((body.scrollTop + body.clientHeight + 10) >= body.scrollHeight) {
        NewMsgNum.value = 0
        tags.value.showBottomButton = false
    }
    if (
        body.scrollTop <
            body.scrollHeight - body.clientHeight * 2 &&
        tags.value.showBottomButton !== true
    ) {
        tags.value.showBottomButton = true
    }
}

async function loadMoreHistory(reply?: { isActive: () => boolean }) {
    if (uiStore.nowGetHistory || uiStore.canLoadHistory === false || list.length === 0) return false
    const firstMsgId = list[0].message_id
    const fullPageSize = 20
    uiStore.nowGetHistory = true
    uiStore.historyBeforeTime = undefined
    uiStore.loadHistoryFail = false
    const type = chatStore.chatInfo.show.type
    const id = chatStore.chatInfo.show.id
    let name
    if (authStore.jsonMap.message_list && type != 'group') {
        name = authStore.jsonMap.message_list.private_name
    } else {
        name = authStore.jsonMap.message_list.name
    }
    const params = {
        group_id: type == 'group' ? id : undefined,
        user_id: type != 'group' ? id : undefined,
        message_id: firstMsgId,
        count: fullPageSize,
    }
    if (!reply) return loadMoreHistoryMessages()
    return requestQuotedHistoryPage(name ?? 'get_chat_history', params, reply.isActive)
}

async function requestQuotedHistoryPage(action: string, params: Record<string, unknown>, isActive: () => boolean) {
    try {
        const response = await Connector.callRawApi(action, params, 10000)
        if (!isActive()) return false
        if (response?.status !== 'ok' || Number(response.retcode ?? 0) !== 0 || response.data == null) {
            throw new Error('History request failed')
        }
        await appendHistoryForQuotedMessage(response, isActive)
        return isActive()
    } catch (error) {
        if (isActive()) {
            new Logger().error(error as Error, 'Loading quoted message history failed')
            uiStore.loadHistoryFail = true
        }
        return false
    } finally {
        if (isActive()) {
            uiStore.nowGetHistory = false
            uiStore.historyBeforeTime = undefined
        }
    }
}

async function waitForHistoryIdle(isActive: () => boolean): Promise<boolean> {
    if (!uiStore.nowGetHistory) return isActive()
    return new Promise(resolve => {
        const finish = (ready: boolean) => {
            stop()
            clearTimeout(timer)
            resolve(ready)
        }
        const stop = watch(() => [uiStore.nowGetHistory, quotedMessages.scopeVersion, replyJump], () => {
            if (!isActive()) finish(false)
            else if (!uiStore.nowGetHistory) finish(true)
        })
        const timer = setTimeout(() => finish(false), 10000)
    })
}

async function jumpToQuotedMessage(messageId: string) {
    cancelReplyJump()
    const pan = document.getElementById('msgPan')
    if (!pan) return
    const jump = replyJump
    const scope = quotedMessages.scopeVersion
    const isActive = () => jump === replyJump && scope === quotedMessages.scopeVersion && pan.isConnected
    if (focusQuotedMessage(messageId, pan, isActive)) return
    if (!quotedMessages.canRequest) return
    replyLoading.value = true
    tags.value.showBottomButton = true
    try {
        if (!await waitForHistoryIdle(isActive) || !isActive()) return
        pan.scrollTop = 0
        const result = await loadHistoryToQuotedMessage({
            isActive,
            hasTarget: () => {
                const target = document.getElementById(messageId)
                return target !== null && pan.contains(target)
            },
            boundary: () => list[0]?.message_id == null ? undefined : String(list[0].message_id),
            loadOlder: () => loadMoreHistory({ isActive }),
            rendered: async () => { await nextTick() },
        })
        if (!isActive()) return
        if (result === 'found') focusQuotedMessage(messageId, pan, isActive)
        else if (result === 'unavailable') new PopInfo().add(PopType.INFO, $t('无法定位上下文'))
    } finally {
        if (isActive()) replyLoading.value = false
    }
}

function focusQuotedMessage(messageId: string, pan: HTMLElement, isActive: () => boolean): boolean {
    const target = document.getElementById(messageId)
    if (!target || !pan.contains(target) || !isActive()) return false
    tags.value.showBottomButton = true
    // Finish a long jump immediately; media layout changes must not interrupt it.
    scrollToMsg(messageId, false, true, true)
    replyAnchor = keepQuotedMessageInView({
        pan, target, isActive,
        onRelease: () => { replyAnchor = undefined },
    })
    return true
}

function scrollTo(where: number | undefined, showAnimation = true) {
    const pan = document.getElementById('msgPan')
    if (pan !== null && where) {
        if (showAnimation === false) {
            pan.style.scrollBehavior = 'unset'
        } else {
            pan.style.scrollBehavior = 'smooth'
        }
        pan.scrollTop = where
        pan.style.scrollBehavior = 'smooth'
    }
}

function scrollBottom(showAnimation = false) {
    const pan = document.getElementById('msgPan')
    if (pan !== null) {
        scrollTo(pan.scrollHeight, showAnimation)
    }
}

function scrollToMsgLocal(message_id: string) {
    if (!scrollToMsg(message_id, true)) {
        new PopInfo().add(PopType.INFO, $t('无法定位上下文'))
    }
}

function imgLoadedScroll(height: number) {
    if (replyLoading.value || replyAnchor?.correct()) return
    const pan = document.getElementById('msgPan')
    if(pan) {
        if(list.length <= 20 && !tags.value.showBottomButton && !replyLoading.value) {
            scrollBottom()
        } else {
            scrollTo(pan.scrollTop + height, false)
        }
    }
}

function mainKey(event: KeyboardEvent) {
    if (event.isComposing) return
    if (mainAtKey(event)) return

    if(tags.value.onAtFind) return
    if (event.key !== 'Enter') return
    let canSend = false
    switch (settingsStore.sysConfig.send_key) {
        case 'none':
            if (event.shiftKey) break
            if (event.ctrlKey) break
            if (event.altKey) break
            if (event.metaKey) break
            canSend = true
            break
        case 'shift':
            if (!event.shiftKey) break
            canSend = true
            break
        case 'ctrl':
            if (!event.ctrlKey) break
            canSend = true
            break
        case 'alt':
            if (!event.altKey) break
            canSend = true
            break
        case 'meta':
            if (!event.metaKey) break
            canSend = true
            break
    }

    if(canSend && tags.value.sendTag != 'PASS') {
        tags.value.sendTag = 'READY'
    }

    if (tags.value.sendTag == 'READY') {
        event.preventDefault()
        void sendMsg()
    } else {
        if(event.key === 'Enter' &&
            (event.ctrlKey || event.metaKey || event.altKey)) {
            msg.value += '\n'
        }
    }

    tags.value.sendTag = 'REFUSE'
}

function mainAtKey(event: KeyboardEvent) {
    if (!tags.value.onAtFind) return false

    if (event.keyCode === 38 || event.keyCode === 40) {
        event.preventDefault()
        const direction = event.keyCode === 38 ? -1 : 1
        moveAtSelection(direction)
        if (atScrollTimer.value !== null) return true
        atScrollTimer.value = setTimeout(() => {
            atScrollInterval.value = setInterval(() => {
                moveAtSelection(direction)
            }, 50)
        }, 300)
        return true
    }

    if (event.keyCode === 13) {
        event.preventDefault()
        const selectedMember = atFindList.value?.[atSelectedIndex.value]
        if (selectedMember) {
            choiceAt(selectedMember.user_id)
        }
        return true
    }

    if (event.keyCode === 27) {
        event.preventDefault()
        tags.value.onAtFind = false
        atFindList.value = null
        atSelectedIndex.value = 0
        return true
    }

    return false
}

function handleCompositionStart() {
    tags.value.sendTag = 'REFUSE'
}

function handleCompositionEnd() {
    tags.value.sendTag = 'PASS'
    setTimeout(() => { tags.value.sendTag = 'REFUSE' }, 50)
}

function mainKeyUp(event: KeyboardEvent) {
    const logger = new Logger()

    if (event.keyCode === 27) {
        return
    }

    if (event.keyCode === 38 || event.keyCode === 40) {
        if (atScrollTimer.value !== null) {
            clearTimeout(atScrollTimer.value)
            atScrollTimer.value = null
        }
        if (atScrollInterval.value !== null) {
            clearInterval(atScrollInterval.value)
            atScrollInterval.value = null
        }
    }

    if (tags.value.checkNewLineFlag){
        tags.value.checkNewLineFlag = false
        if (msg.value == '\n'){
            msg.value = ''
            scheduleResizeMainInput()
        }
    }

    if (tags.value.onAtFind && atFindList.value && atFindList.value.length > 0) {
        if (event.keyCode === 38 || event.keyCode === 40 || event.keyCode === 13 || event.keyCode === 27) {
            return
        }
    }

    if (event.keyCode != 13) {
        const lastInput = msg.value.substring(msg.value.length - 1)
        if (
            !tags.value.onAtFind &&
            lastInput == '@' &&
            chatStore.chatInfo.info.group_members.length > 0 &&
            chatStore.chatInfo.show.type == 'group'
        ) {
            logger.add(LogType.UI, '开始匹配群成员列表 ……')
            tags.value.onAtFind = true
            atSelectedIndex.value = 0
        }
        if (tags.value.onAtFind) {
            if (msg.value.lastIndexOf('@') < 0) {
                logger.add(LogType.UI, '匹配群成员列表被打断 ……')
                tags.value.onAtFind = false
                atFindList.value = null
                atSelectedIndex.value = 0
            } else {
                const atInfo = msg.value
                    .substring(msg.value.lastIndexOf('@') + 1)
                    .toLowerCase()
                atFindList.value = chatStore.chatInfo.info.group_members
                        .filter((item) => { return (
                                (item.card != '' && item.card != null && item.card.toLowerCase().indexOf(atInfo) >=0) ||
                                item.nickname.toLowerCase().indexOf(atInfo) >= 0 ||
                                atInfo ==item.user_id.toString()
                            )
                        },
                    )
                if (atFindList.value.length == 0) {
                    atFindList.value = chatStore.chatInfo.info.group_members
                }
                atSelectedIndex.value = 0
            }
        }
    }
}

function mainSubmit(event: Event) {
    event.preventDefault()
    void sendMsg()
}

function choiceAt(id: number | undefined) {
    if (id != undefined) {
        msg.value = msg.value.substring(0, msg.value.lastIndexOf('@'))
        addSpecialMsg({ type: 'at', qq: Number(id) })
    }
    toMainInput()
    tags.value.onAtFind = false
    atFindList.value = null
    atSelectedIndex.value = 0
}

function scrollAtListToSelected() {
    nextTick(() => {
        const container = document.querySelector('.at-tag.show')
        const selectedItem = document.querySelector('.at-tag.show > div.selected')
        if (container && selectedItem) {
            const containerRect = container.getBoundingClientRect()
            const itemRect = selectedItem.getBoundingClientRect()
            if (itemRect.top < containerRect.top) {
                selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
            } else if (itemRect.bottom > containerRect.bottom) {
                selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
            }
        }
    })
}

function moveAtSelection(direction: number) {
    if (!atFindList.value || atFindList.value.length === 0) return
    if (direction === -1) {
        atSelectedIndex.value = atSelectedIndex.value > 0? atSelectedIndex.value - 1: atFindList.value.length - 1
    } else {
        atSelectedIndex.value = atSelectedIndex.value < atFindList.value.length - 1? atSelectedIndex.value + 1: 0
    }
    scrollAtListToSelected()
}

function showMsgMeun(event: MenuEventData, data: any) {
    selectedMsg.value = data
    tags.value.menuDisplay.menuSelectedMsgId = data.message_id

    if (Option.get('log_level') === 'debug') {
        new Logger().debug('右击消息：' + data)
    }
    if (multipleSelectList.value.length > 0) {
        return
    }

    const menu = document.getElementById('msgMenu')
    const select = event.target as HTMLElement
    let selectUserType = 'member'
    if (
        chatStore.chatInfo.show.type == 'group' &&
        chatStore.chatInfo.info.group_members
    ) {
        chatStore.chatInfo.info.group_members.forEach(
            (item: any) => {
                if (item.user_id == data.sender.user_id) {
                    selectUserType = item.role
                }
            },
        )
    }

    if (menu !== null && data !== null) {
        if (get('close_respond') == true) {
            tags.value.menuDisplay.showRespond = false
        }
        if (
            select.nodeName == 'IMG' &&
            (select as HTMLImageElement).name == 'avatar'
        ) {
            Object.keys(tags.value.menuDisplay).forEach(
                (name: string) => {
                    (tags.value.menuDisplay as any)[name] = false
                },
            )
            tags.value.menuDisplay.showRespond = false
            tags.value.menuDisplay.at = true
            tags.value.menuDisplay.poke = true
            tags.value.menuDisplay.remove = true
            if (
                chatStore.chatInfo.show.type != 'group' ||
                data.sender.user_id === authStore.loginInfo.uin ||
                chatStore.chatInfo.info.me_info.role === 'member' ||
                selectUserType == 'owner' ||
                (selectUserType == 'admin' && chatStore.chatInfo.info.me_info.role != 'owner')
            ) {
                tags.value.menuDisplay.remove = false
            }
            if (data.sender.user_id === authStore.loginInfo.uin) {
                tags.value.menuDisplay.at = false
            }
            if(chatStore.chatInfo.show.type == 'group' &&
            chatStore.chatInfo.info.me_info.role != 'member') {
                tags.value.menuDisplay.config = true
            }
        } else {
            if (
                data.sender.user_id === authStore.loginInfo.uin ||
                chatStore.chatInfo.info.me_info.role ===
                    'admin' ||
                chatStore.chatInfo.info.me_info.role === 'owner'
            ) {
                tags.value.menuDisplay.revoke = true
            }
            tags.value.menuDisplay.reedit = tags.value.menuDisplay.revoke && data.sender.user_id === authStore.loginInfo.uin
            if (data.revoke === true) {
                tags.value.menuDisplay.relpy = false
                tags.value.menuDisplay.forward = false
                tags.value.menuDisplay.revoke = false
                tags.value.menuDisplay.select = false
            }
            if (details.value[3].open) {
                Object.keys(tags.value.menuDisplay).forEach(
                    (name: string) => {
                        (tags.value.menuDisplay as any)[name] = false
                    },
                )
                tags.value.menuDisplay.jumpToMsg = true
            }
            const selection = document.getSelection()
            const textBody = selection?.anchorNode?.parentElement
            let textMsg = null as HTMLElement | null
            let msgParent = textBody
            if (msgParent) {
                while (msgParent.className != 'chat') {
                    if (
                        msgParent.className.startsWith('message') &&
                        msgParent.className.indexOf('-') < 0
                    ) {
                        textMsg = msgParent
                        break
                    }
                    msgParent =
                        msgParent.parentElement as HTMLDivElement
                    if (!msgParent) {
                        break
                    }
                }
            }
            if (
                textBody &&
                textBody.className.indexOf('msg-text') > -1 &&
                selection.focusNode == selection.anchorNode &&
                textMsg &&
                textMsg.id == data.message_id
            ) {
                selectCache.value = selection.toString()
                if (selectCache.value.length > 0) {
                    tags.value.menuDisplay.copySelect = true
                }
            }
            const nList = ['xml', 'json']
            data.message.forEach((item: any) => {
                if (nList.indexOf(item.type as string) > 0) {
                    tags.value.menuDisplay.forward = false
                    tags.value.menuDisplay.add = false
                }
            })
            if (select.nodeName == 'IMG' && (select as HTMLImageElement).src.length > 0) {
                tags.value.menuDisplay.downloadImg = (
                    select as HTMLImageElement
                ).src
                tags.value.menuDisplay.copyImg = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write
            }
        }
        const pointX = event.x
        const pointY = event.y
        menu.style.marginLeft = pointX + 'px'
        menu.style.marginTop = pointY + 'px'
        let menuWidth = menu.clientWidth
        if (tags.value.menuDisplay.showRespond) {
            const item = menu.children[0] as HTMLDivElement
            menuWidth = item.clientWidth
        }
        const maxWidth = window.innerWidth
        if (pointX + menuWidth > maxWidth + 27) {
            menu.style.marginLeft = maxWidth + 7 - menuWidth + 'px'
        }
        tags.value.showMsgMenu = true
        setTimeout(() => {
            const menuHeight = menu.clientHeight
            const bodyHeight = document.body.clientHeight
            if (pointY + menuHeight > bodyHeight - 20) {
                menu.classList.add('topOut')
                menu.style.marginTop =
                    bodyHeight - menuHeight - 10 + 'px'
            }
        }, 100)
    }
}

function initMenuDisplay() {
    tags.value.menuDisplay = {
        menuSelectedMsgId : null,
        jumpToMsg: false,
        add: true,
        relpy: true,
        forward: true,
        select: true,
        copy: true,
        copySelect: false,
        downloadImg: false,
        copyImg: false,
        revoke: false,
        reedit: false,
        at: false,
        poke: false,
        remove: false,
        respond: false,
        showRespond: true,
        config: false,
    }
}

function menuReplyMsg(closeMenu = true) {
    const msgData = selectedMsg.value
    if (!msgData) return
    replyMsg(msgData)
    if (closeMenu) {
        closeMsgMenu()
    }
}

function replyMsg(msgData: any) {
    const msgId = msgData.message_id
    selectedMsg.value = msgData
    cancelReply()
    draftSegments.value.unshift({ id: uuid(), value: { type: 'reply', id: String(msgId) } })
    tags.value.isReply = true
    toMainInput()
}

function cancelReply() {
    draftSegments.value = draftSegments.value.filter(item => item.value.type !== 'reply')
    tags.value.isReply = false
}

function consoleLogMsg() {
    if (!selectedMsg.value) return
    // eslint-disable-next-line no-console
    console.log(selectedMsg.value)
    closeMsgMenu()
}

function cancelForward() {
    forwardList.value = contactStore.userList
    tags.value.showForwardPan = false
    selectedForwardAction.value = 'single-message'
    closeMsgMenu()
}

function searchForward(event: Event) {
    const value = (event.target as HTMLInputElement).value
    forwardList.value = contactStore.userList.filter(
        (item: UserFriendElem & UserGroupElem) => {
            const name = (
                item.user_id? item.nickname + item.remark: item.group_name
            ).toLowerCase()
            const id = item.user_id ? item.user_id : item.group_id
            return (
                name.indexOf(value.toLowerCase()) !== -1 ||
                id.toString() === value
            )
        },
    )
}

function showForWard(action: ForwardAction = 'single-message') {
    selectedForwardAction.value = action
    tags.value.showForwardPan = true
    const showList = [...contactStore.onMsgList].reverse()
    showList.forEach((item: any) => {
        const index = forwardList.value.indexOf(item)
        if (index > -1) {
            forwardList.value.splice(index, 1)
            forwardList.value.unshift(item)
        }
    })
    closeMsgMenu()
}

function forwardSelf() {
    if (selectedMsg.value) {
        const msgData = JSON.parse(JSON.stringify(selectedMsg.value))
        sendMsgRaw(
            chat.show.id,
            chat.show.type,
            msgData.message,
            true,
        )
    }
    closeMsgMenu()
}

function intoMultipleSelect() {
    if (selectedMsg.value) {
        multipleSelectList.value.push(selectedMsg.value.message_id)
    }
    closeMsgMenu()
}

function cloneMessagePayload<T>(payload: T): T {
    const rawPayload = toRaw(payload)
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(rawPayload)
        } catch {
            return JSON.parse(JSON.stringify(rawPayload))
        }
    }
    return JSON.parse(JSON.stringify(rawPayload))
}

function forwardMsg(data: UserFriendElem & UserGroupElem) {
    const forwardAction = selectedForwardAction.value
    const msgData = selectedMsg.value ? cloneMessagePayload(selectedMsg.value) : null
    const id = data.group_id ? data.group_id : data.user_id
    const targetId = String(id)
    const targetType = data.group_id ? 'group' : 'user'
    const msgList = chatStore.messageList.filter((item) => {
        return multipleSelectList.value.includes(item.message_id)
    })
    const shouldPreShow = () =>
        String(chat.show.id) === targetId && chat.show.type === targetType

    if (forwardAction !== 'single-message' && msgList.length === 0) {
        cancelForward()
        return
    }

    if (forwardAction === 'individual-messages') {
        const popInfo = {
            title: $t('逐条转发'),
            html: $t('将按顺序逐条转发 {count} 条消息，是否继续？', {
                count: msgList.length,
            }),
            button: [
                {
                    text: $t('取消'),
                    fun: () => {
                        uiStore.popBoxList.shift()
                    },
                },
                {
                    text: $t('确定'),
                    master: true,
                    fun: () => {
                        msgList.forEach((item) => {
                            sendMsgRaw(
                                targetId,
                                targetType,
                                cloneMessagePayload(item.message),
                                shouldPreShow(),
                            )
                        })
                        multipleSelectList.value = []
                        uiStore.popBoxList.shift()
                    },
                },
            ],
        }
        uiStore.popBoxList.push(popInfo)
    } else if (forwardAction === 'merged-messages') {
        const jsonMsg = {
            app: 'com.tencent.multimsg',
            meta: {
                detail: {
                    source: $t('合并转发消息'),
                    news: [
                        ...msgList.slice(0, 3).map((item) => {
                            const name =
                                item.sender.card &&
                                item.sender.card != ''? item.sender.card: item.sender.nickname
                            return {
                                text:
                                    name +
                                    ': ' +
                                    getMsgRawTxt(item),
                            }
                        }),
                    ],
                    summary: $t('查看 {count} 条转发消息', { count: msgList.length }),
                    resid: '',
                },
            },
        }
        const previewMsg = {
            message: [
                { type: 'json', data: JSON.stringify(jsonMsg), id: '' },
            ],
            sender: {
                user_id: authStore.loginInfo.uin,
                nickname: authStore.loginInfo.nickname,
            }
        }
        const popInfo = {
            title: $t('合并转发消息'),
            template: markRaw(MsgBody),
            templateValue: markRaw({ data: previewMsg, type: 'forward' }),
            button: [
                {
                    text: $t('取消'),
                    fun: () => {
                        uiStore.popBoxList.shift()
                    },
                },
                {
                    text: $t('确定'),
                    master: true,
                    fun: () => {
                        const msgBody = msgList.map((item) => {
                            return {
                                type: 'node',
                                id: item.message_id,
                                user_id: item.sender.user_id,
                                nickname: item.sender.nickname,
                                content: cloneMessagePayload(item.message),
                            }
                        })
                        sendMsgRaw(
                            targetId,
                            targetType,
                            msgBody,
                            shouldPreShow(),
                        )
                        multipleSelectList.value = []
                        uiStore.popBoxList.shift()
                    },
                },
            ],
        }
        uiStore.popBoxList.push(popInfo)
    } else if (selectedMsg.value && msgData) {
        const popInfo = {
            title: $t('转发消息'),
            template: markRaw(MsgBody),
            templateValue: markRaw({ data: msgData, type: 'forward' }),
            button: [
                {
                    text: $t('取消'),
                    fun: () => {
                        uiStore.popBoxList.shift()
                    },
                },
                {
                    text: $t('确定'),
                    master: true,
                    fun: () => {
                        sendMsgRaw(
                            targetId,
                            targetType,
                            cloneMessagePayload(msgData.message),
                            shouldPreShow(),
                        )
                        uiStore.popBoxList.shift()
                    },
                },
            ],
        }
        uiStore.popBoxList.push(popInfo)
    }
    cancelForward()
    if(contactStore.baseOnMsgList.get(id) == undefined) {
        contactStore.baseOnMsgList.set(id, data)
    }
    nextTick(() => {
        const user = document.getElementById('user-' + id)
        if (user) {
            user.click()
        }
    })
}

async function sendRespond(num: number) {
    const msgData = selectedMsg.value
    closeMsgMenu()
    if (!msgData) return
    try { await toggleMessageReaction(msgData, num) }
    catch (reason) { new PopInfo().add(PopType.ERR, reason instanceof Error ? reason.message : String(reason)) }
}

async function toggleEssence() {
    const target = selectedMsg.value
    if (!target) return
    const action = target.is_essence ? authStore.jsonMap.delete_essence?.name : authStore.jsonMap.set_essence?.name
    if (!action) return
    closeMsgMenu()
    try {
        const response = await callMessageAction(action, { group_id: chat.show.id, message_id: target.message_id })
        applyMessageAnnotations(response.data)
        if (details.value[2].open) await loadEssence(0)
    } catch (reason) { new PopInfo().add(PopType.ERR, reason instanceof Error ? reason.message : String(reason)) }
}

function copyMsg() {
    const msgData = selectedMsg.value
    if (msgData !== null) {
        if (!msgData.raw_message) {
            msgData.raw_message = getMsgRawTxt(msgData)
        }
        const popInfo = new PopInfo()
        app.config.globalProperties.$copyText(msgData.raw_message).then(
            () => {
                popInfo.add(PopType.INFO, $t('复制成功'), true)
            },
            () => {
                popInfo.add(PopType.ERR, $t('复制失败'), true)
            },
        )
    }
    closeMsgMenu()
}

function copySelectMsg() {
    if (selectCache.value != '') {
        const popInfo = new PopInfo()
        app.config.globalProperties
            .$copyText(selectCache.value)
            .then(
                () => {
                    popInfo.add(PopType.INFO, $t('复制成功'), true)
                },
                () => {
                    popInfo.add(PopType.ERR, $t('复制失败'), true)
                },
            )
    }
    closeMsgMenu()
}

async function copyImg() {
    const url = tags.value.menuDisplay.downloadImg
    if (!url) return
    closeMsgMenu()
    const { blob } = await getImageUrlData(url)
    const popInfo = new PopInfo()
    const item = new ClipboardItem({ [blob.type]: blob })
    try {
        await copyToClipboard([item])
        popInfo.add(PopType.INFO, $t('复制成功'))
    } catch (e) {
        popInfo.add(PopType.ERR, $t('复制失败'))
        new Logger().error(e as Error, '复制图片失败')
    }
}

function downloadImg() {
    const url = tags.value.menuDisplay.downloadImg
    if (url != false) {
        downloadFile(url as string, `img_${new Date().getTime()}.png`, () => undefined, () => undefined)
    }
    closeMsgMenu()
}

async function revokeMsg() {
    const msgData = selectedMsg.value
    closeMsgMenu()
    if (!msgData) {
        new PopInfo().add(PopType.ERR, $t('获取选中消息失败'))
        return
    }
    confirmRecall(msgData, false)
}

async function reeditMsg() {
    const msgData = selectedMsg.value
    closeMsgMenu()
    if (!msgData) {
        new PopInfo().add(PopType.ERR, $t('获取选中消息失败'))
        return
    }
    confirmRecall(msgData, true)
}

function confirmRecall(msgData: any, edit: boolean) {
    const target = chatStore.chatInfo.show
    const operation = async () => {
        try {
            const response = await Connector.callRawApi('delete_msg', { message_id: msgData.message_id })
            const error = getOneBotResponseError(response)
            if (error) throw new Error(error)
            if (edit && chatStore.chatInfo.show === target) await reedit(msgData)
        } catch (reason) {
            new PopInfo().add(PopType.ERR, reason instanceof Error ? reason.message : String(reason))
        }
    }
    if (!seneraClientRoot()) { void operation(); return }
    uiStore.popBoxList.push({
        title: edit ? '撤回并重新编辑' : '撤回任务',
        html: '<span>将停止当前任务，并同步删除主控台中本任务及之后的消息和上下文。同一任务发送的文本、图片、文件会一起处理。撤回记录将保留，方便重新编辑。</span>',
        button: [
            { text: '确定', fun: async () => { uiStore.popBoxList.shift(); await operation() } },
            { text: $t('取消'), master: true, fun: () => { uiStore.popBoxList.shift() } },
        ],
    })
}

function deleteTask() {
    const data = selectedMsg.value
    closeMsgMenu()
    if (!data?.seneraTask) return
    confirmDeleteTask(data)
}

function deleteSelectedTasks() {
    const selected = list.filter(item => multipleSelectList.value.includes(item.message_id))
    if (!selected.length) return
    if (selected.some(item => !item.seneraTask || !Number.isSafeInteger(item.timelineSequence))) {
        new PopInfo().add(PopType.ERR, '所选消息缺少任务关联，无法安全删除；可以清空整个对话')
        return
    }
    const first = selected.reduce((earliest, item) => item.timelineSequence < earliest.timelineSequence ? item : earliest)
    confirmDeleteTask(first)
}

function confirmDeleteTask(data: any) {
    const target = { ...chatStore.chatInfo.show }
    uiStore.popBoxList.push({
        title: '删除任务及后续消息',
        html: '<span>将停止当前任务，并删除所选任务及之后的全部消息、模型上下文和关联产物。主控台与此对话会同步更新，此操作无法撤销。</span>',
        button: [
            { text: '删除', fun: async () => {
                uiStore.popBoxList.shift()
                try { await deleteSeneraTask(target, data.message_id); multipleSelectList.value = []; refreshSeneraTimeline() }
                catch (reason) { new PopInfo().add(PopType.ERR, reason instanceof Error ? reason.message : String(reason)) }
            } },
            { text: $t('取消'), master: true, fun: () => { uiStore.popBoxList.shift() } },
        ],
    })
}

function removeUser() {
    const msgData = selectedMsg.value
    if (msgData !== null) {
        const popInfo = {
            title: $t('提醒'),
            html: `<span>${$t('真的要将 {user} 移出群聊吗', { user: msgData.sender.nickname })}</span>`,
            button: [
                {
                    text: $t('确定'),
                    fun: () => {
                        if (msgData) {
                            Connector.send(
                                'set_group_kick',
                                {
                                    group_id:
                                                    chatStore.chatInfo.show
                                                        .id,
                                    user_id: msgData.sender.user_id,
                                },
                                'setGroupKick',
                            )
                            closeMsgMenu()
                            uiStore.popBoxList.shift()
                        }
                    },
                },
                {
                    text: $t('取消'),
                    master: true,
                    fun: () => {
                        uiStore.popBoxList.shift()
                    },
                },
            ],
        }
        uiStore.popBoxList.push(popInfo)
    }
}

function closeMsgMenu() {
    tags.value.showMsgMenu = false
    tags.value.menuDisplay.menuSelectedMsgId = null
    setTimeout(() => {
        initMenuDisplay()
    }, 300)
}

function openChatInfoPan() {
    tags.value.openChatInfo = !tags.value.openChatInfo
    if (tags.value.openChatInfo) {
        if (
            chat.show.type === 'group' &&
            chat.info.group_info.group_id !== chat.show.id
        ) {
            Connector.send(
                'get_group_info',
                { group_id: chat.show.id },
                'getGroupInfo',
            )
        } else if (
            chat.show.type === 'user' &&
            chat.info.user_info.uin !== chat.show.id
        ) {
            const userInfo = authStore.jsonMap.friend_info.name
            if(userInfo != undefined) {
                Connector.send(
                    userInfo,
                    { user_id: chat.show.id },
                    'getMoreUserInfo',
                )
            }
        }
        const noticeName = authStore.jsonMap.group_notices?.name
        if (
            chat.show.type === 'group' &&
            (chat.info.group_notices === undefined ||
                Object.keys(chat.info.group_notices).length ===
                    0)
        ) {
            if (noticeName) {
                Connector.send(
                    noticeName,
                    { group_id: chat.show.id },
                    'getGroupNotices',
                )
            }
        }
        if (chat.show.type === 'group' && Object.keys(chat.info.group_files).length === 0) {
            const name = authStore.jsonMap.group_files?.name
            if(name) {
                Connector.send(name, {
                    group_id: chat.show.id
                }, 'getGroupFiles')
            }
        }
    }
}

async function editImg(id: string) {
    const owner = attachments.current()
    const image = owner.store.getState().pending.find(entry => entry.id === id)
    if (!image?.previewUrl || !viewerRef?.value) return
    try {
        const dataurl = await viewerRef.value.edit(image.previewUrl)
        const blob = await (await fetch(dataurl)).blob()
        if (attachments.current() !== owner || !owner.store.getState().pending.some(entry => entry.id === id)) return
        owner.remove(id)
        await owner.enqueue([new File([blob], image.fileName, { type: blob.type })], 'image')
    } catch (error) { new PopInfo().add(PopType.ERR, error instanceof Error ? error.message : String(error)) }
}

function previewAttachment(id: string) {
    const entry = pendingAttachments.value.find(value => value.id === id)
    if (entry?.previewUrl) viewerRef?.value?.open(new Img(entry.previewUrl))
}

function addSpecialMsg(segment: MsgItemElem) {
    if (segment.type === 'text') {
        const input = mainInput.value
        const start = input?.selectionStart ?? msg.value.length
        const end = input?.selectionEnd ?? start
        msg.value = msg.value.slice(0, start) + segment.text + msg.value.slice(end)
        nextTick(() => input?.setSelectionRange(start + segment.text.length, start + segment.text.length))
    } else {
        draftSegments.value.push({ id: uuid(), value: { ...segment } })
    }
}

function removeSegment(id: string) {
    draftSegments.value = draftSegments.value.filter(segment => segment.id !== id)
}

function segmentLabel(segment: MsgItemElem): string {
    if (segment.type === 'at') {
        const member = chat.info.group_members?.find((entry: GroupMemberInfoElem) => String(entry.user_id) === String(segment.qq))
        return '@' + (member?.card || member?.nickname || segment.qq)
    }
    if (segment.type === 'face') return $t('表情')
    if (segment.type === 'image') return $t('图片')
    return segment.name ?? segment.file_name ?? segment.type
}

async function addImg(event: ClipboardEvent) {
    if (!(event.clipboardData && event.clipboardData.items)) {
        return
    }
    const files = Array.from(event.clipboardData.items)
        .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null)
    if (files.length === 0) return
    event.preventDefault()
    await attachments.current().enqueue(files, 'image')
}

function runSelectImg() {
    const input = document.getElementById('choice-pic')
    if (input) {
        input.click()
    }
}

async function selectImg(event: Event) {
    tags.value.showMoreDetail = false
    if (!(event.target instanceof HTMLInputElement)) return
    await enqueueComposerFileSelection(event.target, attachments.current(), 'image')
}

function runSelectFile() {
    const input = document.getElementById('choice-file')
    if (input) {
        input.click()
    }
}

async function selectFile(event: Event) {
    tags.value.showMoreDetail = false
    if (!(event.target instanceof HTMLInputElement)) return
    await enqueueComposerFileSelection(event.target, attachments.current(), 'file')
}

function toMainInput() {
    const input = (document.getElementById( 'main-input') as HTMLTextAreaElement | HTMLInputElement) ??
        (document.getElementById( 'main-input-ex') as HTMLTextAreaElement | HTMLInputElement)
    if (input !== null) {
        input.focus()
    }
}

async function sendMsg(echo = 'sendMsgBack') {
    if (details.value[3].open || !canSend.value) {
        return
    }
    details.value.forEach((item) => {
        item.open = false
    })

    const target = chatStore.chatInfo.show
    const draft = msg.value
    const segments = draftSegments.value.slice()
    const owner = attachments.current()
    const media = owner.store.getState().pending.slice()
    const scope = draftKey
    if (!scope) return
    const controller = new AbortController()
    composerUpload = controller
    sending.value = true
    try {
        const base = seneraResourceBaseUrl()
        if (!base) throw new Error('当前页面没有 Senera 工作区资源上下文')
        const parsedMsg = buildSeneraMessage(draft, segments.map(part => part.value), media, base,
            String(settingsStore.sysConfig.msg_taill ?? '').replaceAll('\\n', '\n'))
        await seneraMessageOutbox.prepare(scope, {
            target: { id: chat.show.temp ? `${chat.show.id}/${chat.show.temp}` : String(chat.show.id), type: chat.show.type },
            message: parsedMsg, text: draft, partIds: segments.map(part => part.id), attachmentIds: media.map(entry => entry.id),
        })
        await flushOutgoingMessages(scope, owner, controller.signal, echo)
    } catch (reason) {
        if (!controller.signal.aborted) new PopInfo().add(PopType.ERR, reason instanceof Error ? reason.message : String(reason))
        return
    } finally {
        if (composerUpload === controller) {
            composerUpload = undefined
            sending.value = false
        }
    }
    if (chatStore.chatInfo.show !== target) return
    tags.value.checkNewLineFlag = true
    scrollBottom()
    scheduleResizeMainInput(undefined, true)
}

async function flushOutgoingMessages(scope: string, owner: ReturnType<typeof attachments.current>, signal: AbortSignal, echo = 'sendMsgBack') {
    await owner.ready
    await seneraMessageOutbox.drain(scope, async entry => {
        await Connector.waitUntilReady(signal)
        const { target, message } = entry.payload
        const response = await sendMsgRaw(target.id, target.type, message, scope === draftKey, echo, true, entry.id)
        if (!response) throw new Error('消息尚未获得发送确认，草稿已保留')
        return response
    }, async entry => {
        const sentParts = new Set(entry.payload.partIds)
        const sentAttachments = new Set(entry.payload.attachmentIds)
        owner.commit(owner.store.getState().pending.filter(value => sentAttachments.has(value.id)))
        await owner.flush()
        if (scope === draftKey) {
            draftSegments.value = draftSegments.value.filter(part => !sentParts.has(part.id))
            tags.value.isReply = draftSegments.value.some(part => part.value.type === 'reply')
            if (msg.value === entry.payload.text) msg.value = ''
        }
        await messageDraftRepository.update<StoredSeneraComposer>(scope, stored => {
            if (!stored) return undefined
            const message = stored.message === entry.payload.text ? '' : stored.message
            const parts = stored.parts.filter(part => !sentParts.has(part.id))
            return message || parts.length ? { ...stored, message, parts } : undefined
        })
    })
}

async function resumeOutgoingMessages() {
    const scope = draftKey
    if (!scope || restoringDraft.value || sending.value) return
    let controller: AbortController | undefined
    try {
        if (!(await seneraMessageOutbox.read(scope))?.length || scope !== draftKey || sending.value) return
        const owner = attachments.current()
        controller = new AbortController()
        composerUpload = controller
        sending.value = true
        try { await flushOutgoingMessages(scope, owner, controller.signal) }
        finally {
            if (composerUpload === controller) { composerUpload = undefined; sending.value = false }
        }
    } catch (error) { if (!controller?.signal.aborted) new PopInfo().add(PopType.ERR, error instanceof Error ? error.message : String(error)) }
}

function updateList(newLength: number, oldLength: number) {
    if (oldLength == 0 && newLength > 0) {
        const name =
            authStore.jsonMap.set_message_read?.name ?? undefined
        let private_name =
            authStore.jsonMap.set_message_read?.private_name ??
            name
        if (!private_name) private_name = name
        if (chatStore.chatInfo.show.type == 'group') {
            if (name) Connector.send(
                name,
                {
                    group_id: chat.show.id,
                    message_id:
                        list[list.length - 1].message_id,
                },
                'setMessageRead',
            )
        } else {
            if (private_name) Connector.send(
                private_name,
                {
                    user_id: chat.show.id,
                    message_id:
                        list[list.length - 1].message_id,
                },
                'setMessageRead',
            )
        }
        if(shouldAutoFocus()) {
            toMainInput()
        }
    }

    if (
        tags.value.showBottomButton &&
        !uiStore.nowGetHistory &&
        !replyLoading.value &&
        oldLength > 0
    ) {
        if (NewMsgNum.value !== 0) {
            NewMsgNum.value =
                NewMsgNum.value + Math.abs(newLength - oldLength)
        } else {
            NewMsgNum.value = Math.abs(newLength - oldLength)
        }
    }
    if (
        !seneraClientRoot() && list.length > 200 &&
        !uiStore.nowGetHistory &&
        !tags.value.showBottomButton
    ) {
        chatStore.messageList = []
        const info = {
            type: chat.show.type,
            id: chat.show.id,
            name: chat.show.name,
            avatar: chat.show.avatar,
            jump: chat.show.jump,
        } as BaseChatInfoElem
        loadHistoryFirst(info)
        uiStore.nowGetHistory = true
    }

    const pan = document.getElementById('msgPan')
    if (pan !== null) {
        const height = pan.scrollHeight
        nextTick(() => {
            const newPan = document.getElementById('msgPan')
            if (newPan !== null) {
                if (uiStore.nowGetHistory) {
                    scrollTo(
                        newPan.scrollHeight - height,
                        false,
                    )
                }
                if (!uiStore.nowGetHistory) {
                    if (!tags.value.showBottomButton) {
                        scrollTo(newPan.scrollHeight)
                    }
                    if (oldLength <= 0) {
                        scrollTo(newPan.scrollHeight, false)
                    }
                }
                uiStore.nowGetHistory = false
            }

            const getImgList = () => {
                const getImgList = [] as string[]
                for(const item of list) {
                    if (item.message !== undefined) {
                        for(const msgItem of item.message) {
                            if (
                                msgItem.type === 'image' &&
                                msgItem.file != 'marketface'
                            ) {
                                getImgList.push(msgItem.url)
                            }
                        }
                    }
                }
                return getImgList
            }
            chatImg.value = Img.fromList(getImgList())
            if (
                chatStore.chatInfo.show &&
                chatStore.chatInfo.show.jump
            ) {
                new Logger().debug(
                    '进入跳转至消息：' +
                        chatStore.chatInfo.show.jump,
                )
                scrollToMsgLocal(
                    'chat-' + chatStore.chatInfo.show.jump,
                )
                chatStore.chatInfo.show.jump = undefined
            }
        })
    }
}

function msgClick(_: Event, data: any) {
    const message_id = data.message_id
    if (multipleSelectList.value.length > 0) {
        if (multipleSelectList.value.indexOf(message_id) > -1) {
            multipleSelectList.value =
                multipleSelectList.value.filter((item) => {
                    return item != message_id
                })
        } else {
            multipleSelectList.value.push(message_id)
        }
    }
}

function delMsgs() {
    if (seneraClientRoot()) {
        deleteSelectedTasks()
        return
    }
    new PopInfo().add(
        PopType.INFO,
        $t('欸嘿，这个按钮只是用来占位置的'),
    )
}

function copyMsgs() {
    const msgList = list.filter((item: any) => {
        return multipleSelectList.value.indexOf(item.message_id) > -1
    })
    let msgText = ''
    let lastDate = ''
    msgList.forEach((item: any) => {
        const time = new Date(getViewTime(item.time))
        const date = dateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(time)
        if (date != lastDate) {
            msgText += '\n—— ' + date + ' ——\n'
            lastDate = date
        }
        msgText +=
            item.sender.nickname +
            ' ' +
            dateTimeFormat(trueLang, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(time) +
            '\n' +
            getMsgRawTxt(item) +
            '\n\n'
    })
    const popInfo = new PopInfo()
    app.config.globalProperties.$copyText(msgText).then(
        () => {
            popInfo.add(PopType.INFO, $t('复制成功'), true)
            multipleSelectList.value = []
        },
        () => {
            popInfo.add(PopType.ERR, $t('复制失败'), true)
        },
    )
}

async function recallMsgs() {
    if (seneraClientRoot()) {
        deleteSelectedTasks()
        return
    }
    const msgList = list.filter((item: any) => multipleSelectList.value.includes(item.message_id))
    const tasks: Promise<true | undefined>[] = []
    for (const msgItem of msgList) {
        const msgId = msgItem.message_id
        tasks.push(Connector.callApi('delete_msg', { message_id: msgId }))
    }
    multipleSelectList.value = []
    await Promise.all(tasks)
}

async function showJin() {
    details.value[2].open = !details.value[2].open
    tags.value.showMoreDetail = !tags.value.showMoreDetail
    if (details.value[2].open) await loadEssence(0)
}

async function loadEssence(page: number) {
    const map = authStore.jsonMap.group_essence
    if (!map?.name || tags.value.isJinLoading) return
    const target = chatStore.chatInfo.show
    tags.value.isJinLoading = true
    try {
        const response = await callMessageAction(map.name, { group_id: target.id, pages: page })
        if (chatStore.chatInfo.show !== target) return
        const entries = await Promise.all((getMsgData('group_essence', response, map) ?? []).map(async (item: Record<string, any>) => {
            const [normalizedMessage] = await normalizeMessagesForPreview({
                post_type: 'message', message_type: 'group', group_id: target.id,
                message_id: item.message_id, time: item.sender_time,
                sender: { user_id: item.sender_uin, nickname: item.sender_nick }, message: item.msg_content,
            })
            return { ...item, normalizedMessage }
        }))
        if (chatStore.chatInfo.show !== target) return
        const state = chatStore.chatInfo.info.jin_info
        state.list = page === 0 ? entries : [...state.list, ...entries]
        state.pages = page
        state.is_end = map.is_end ? Boolean(getMsgData('is_end', response, map.is_end)?.[0]) : true
    } catch (reason) { new PopInfo().add(PopType.ERR, reason instanceof Error ? reason.message : String(reason)) }
    finally { tags.value.isJinLoading = false }
}

async function handleInput(event: Event) {
    const input = event.target as HTMLInputElement
    scheduleResizeMainInput(input)

    if (details.value[3].open) {
        const value = input.value
        if (value.length == 0) {
            tags.value.search.list = reactive(list)
        } else {
            tags.value.search.list = list.filter(
                (item: any) => {
                    const rawMessage = getMsgRawTxt(item)
                    return rawMessage.indexOf(value) !== -1
                },
            )
        }
    }
}

function openSearch() {
    details.value[3].open = !details.value[3].open
    tags.value.showMoreDetail = !tags.value.showMoreDetail
}

function closeSearch() {
    details.value[3].open = !details.value[3].open
    msg.value = ''
    tags.value.search.list = reactive(list)
    scheduleResizeMainInput()
}

async function sendPoke(userId: number) {
    if (authStore.jsonMap.poke) {
        let name = authStore.jsonMap.poke.name
        if (
            chat.show.type == 'user' &&
            authStore.jsonMap.poke.private_name
        ) {
            name = authStore.jsonMap.poke.private_name
        }
        try { await callMessageAction(
            name,
            {
                user_id: userId,
                group_id: chat.show.type === 'group' ? chat.show.id : undefined,
            },
        ) } catch (reason) { new PopInfo().add(PopType.ERR, reason instanceof Error ? reason.message : String(reason)) }
    }
    tags.value.showMoreDetail = false
    tags.value.menuDisplay.poke = false
}

async function reedit(msgData: any) {
    // Explicit replacement owns the composer even if an older storage read is still pending.
    draftOperation++
    draftRestore?.abort()
    restoringComposer.value = false
    composerUpload?.abort()
    composerUpload = undefined
    sending.value = false
    msg.value = ''
    draftSegments.value = []
    const owner = attachments.current()
    const target = chatStore.chatInfo.show
    await owner.ready
    if (attachments.current() !== owner || chatStore.chatInfo.show !== target) return
    owner.clear()
    cancelReply()
    for (const seg of msgData.message) {
        if (seg.type === 'text') {
            msg.value += seg.text
        } else if (seg.type === 'reply') {
            const foundMsg = list.find((item: any) => item.message_id == seg.id)
            if (!foundMsg) continue
            replyMsg(foundMsg)
        } else {
            addSpecialMsg(seg)
        }
    }
    await nextTick()
    scheduleResizeMainInput()
    toMainInput()
    mainInput.value?.setSelectionRange(msg.value.length, msg.value.length)
}

function jinScroll(event: Event) {
    const body = event.target as HTMLDivElement
    if (
        body.scrollTop + body.clientHeight === body.scrollHeight &&
        !tags.value.isJinLoading
    ) {
        if (chat.info.jin_info.is_end == false) {
            void loadEssence(chat.info.jin_info.pages + 1)
        }
    }
}

function moreFunClick(type = 'default') {
    let hasOpen = false
    details.value.forEach((item) => {
        if (item.open) hasOpen = true
        item.open = false
    })
    if (hasOpen) return
    if (tags.value.showMoreDetail) {
        tags.value.showMoreDetail = false
        return
    }
    switch(type) {
        case 'default': tags.value.showMoreDetail = true; break
        case 'img': runSelectImg(); break
        case 'file': runSelectFile(); break
        case 'face': details.value[1].open = !details.value[1].open; break
    }
}

function getTargetWin(): HTMLDivElement | undefined {
    const chatPan = document.getElementById('chat-pan')
    if (!chatPan) return
    if(tags.value.openChatInfo) {
        return chatPan.getElementsByClassName('chat-info-pan')[0] as HTMLDivElement
    } else if(mergePan.value?.isMergeOpen()) {
        return chatPan.getElementsByClassName('merge-pan')[0] as HTMLDivElement
    } else {
        return chatPan as HTMLDivElement
    }
}

function exitWin() {
    if(tags.value.openChatInfo) {
        openChatInfoPan()
    } else if(mergePan.value?.isMergeOpen()) {
        mergePan.value?.closeMergeMsg()
        setTimeout(() => {
            const chatPan = document.getElementById('chat-pan')
            const mergePanEl = chatPan!.getElementsByClassName('merge-pan')[0] as HTMLDivElement
            if(mergePanEl) {
                mergePanEl.style.transform = ''
            }
        }, 500)
    } else {
        chatStore.chatInfo.show.id = 0
        uiStore.openSideBar = true
        new Logger().add(LogType.UI, '右滑打开侧边栏触发完成')
    }
}
</script>

<style scoped>
    /* 消息动画 */
    .msglist-move {
        transition: all 0.3s;
    }

    .msglist-enter-active {
        transition: all 0.4s;
    }

    .msglist-leave-active {
        transition: all 0.2s;
    }

    .msglist-enter-from {
        transform: translateX(-20px);
        opacity: 0;
    }

    .msglist-leave-to {
        opacity: 0;
    }

    /* 更多功能面板动画 */
    .pan-enter-active,
    .pan-leave-active {
        transition: opacity 0.3s;
    }

    .pan-enter-from {
        transform: translateX(20px);
        opacity: 0;
    }

    .pan-leave-to {
        opacity: 0;
    }
</style>

<style scoped>
.senera-draft-segments { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 14px; }
.senera-draft-segment { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 4px 8px; border-radius: 6px; background: var(--color-card-2); color: var(--color-font); }
.senera-draft-segment > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.senera-draft-segment > img { width: 36px; height: 36px; object-fit: contain; }
.senera-draft-segment > button { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; min-width: 28px; min-height: 28px; padding: 4px; border: 0; color: inherit; background: transparent; cursor: pointer; }
.senera-conversation-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    margin-inline: 8px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    color: var(--color-font);
    background: transparent;
    cursor: pointer;
    transition: background-color 0.15s, opacity 0.15s;
}
.senera-conversation-clear:hover:not(:disabled) { background: var(--color-card-2); }
.senera-conversation-clear:disabled { opacity: 0.35; cursor: default; }
.senera-conversation-clear:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
</style>
