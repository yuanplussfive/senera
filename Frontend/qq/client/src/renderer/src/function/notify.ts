import app from '@renderer/main'
import { NotifyInfo, NotificationElem } from './elements/system'
import { jumpToChat } from './utils/appUtil'
import { readNotificationPermission } from '@renderer/runtime/notifications'

export class Notify {
    // 针对 MSG 类型的通知，记录用户的通知数量
    private static userNotifyList: { [key: string]: number } = {}
    // Web 端端通知列表，key tag
    private static notifyList: { [key: string]: Notification } = {}

    /**
     * 发送一条通知
     * @param info 通知信息
     */
    public notify(info: NotifyInfo) {
        const { $t } = app.config.globalProperties
        // 判断当前 userId 是否已存在通知
        const userId = info.tag.split('/')[0]
        if (Notify.userNotifyList[userId] === undefined) {
            Notify.userNotifyList[userId] = 1
        } else {
            Notify.userNotifyList[userId]++
            // 修改通知内容为：“<内容>” 以及<数量>条消息
            info.body = $t('“{body}” 以及 {num} 条消息', {
                body: info.body,
                num: Notify.userNotifyList[userId] - 1,
            })
            // 关闭之前的通知
            for (const key of Object.keys(Notify.notifyList)) {
                if (key.split('/')[0] === userId) this.close(key)
            }
        }
        this.notifySingle(info)
    }

    /**
     * 发送独立通知
     * @param info 通知信息
     */
    public notifySingle(info: NotifyInfo) {
        if (readNotificationPermission() === 'granted') this.sendNotice(info)
    }

    /**
     * 关闭用户的所有通知
     * @param userId 用户 ID
     */
    public async closeAll(userId: string) {
        for (const key of Object.keys(Notify.notifyList)) {
            if (key.split('/')[0] === userId) this.close(key)
        }
        delete Notify.userNotifyList[userId]
    }

    /**
     * 关闭所有通知
     */
    public clear() {
        for (const key of Object.keys(Notify.notifyList)) this.close(key)
        Notify.userNotifyList = {}
    }

    /**
     * 关闭一条通知
     * @param tag 通知标签
     */
    private close(tag: string) {
        Notify.notifyList[tag]?.close()
        delete Notify.notifyList[tag]
    }

    /**
     * 关闭一条通知（如果是消息通知，则跳转到对应的聊天页面）
     * @param tag 通知标签
     * @returns 通知对象
     */
    private closeJump(tag: string | undefined) {
        if (tag !== undefined) {
            if (tag.indexOf('/') > 0) {
                // MSG 类型的通知
                const userId = tag.split('/')[0]
                const msgId = tag.substring(userId.length + 1, tag.length)
                delete Notify.userNotifyList[userId]
                // 跳转到这条消息的发送者页面
                window.focus()
                jumpToChat(userId, msgId)
            }
            this.close(tag)
        }
    }

    /**
     * 发送一条通知（Web 端）
     * @param info 通知信息
     * @returns 通知对象
     */
    private sendNotice(info: NotifyInfo) {
        // 构建通知
        let notificationTile = ''
        const notificationBody = {} as NotificationElem
        notificationBody.requireInteraction = true
        notificationTile = info.title
        notificationBody.body = info.body
        notificationBody.tag = info.tag
        notificationBody.icon = info.icon
        // 发起通知
        const notification = new Notification(
            notificationTile,
            notificationBody,
        )
        notification.onclick = (event: Event) => {
            const info = event.target as NotificationOptions
            this.closeJump(info.tag)
        }
        // 保存通知对象
        Notify.notifyList[info.tag] = notification
    }
}
