import VueClipboard from 'vue-clipboard2'
import packageInfo from '@senera-product'
import { applyBcuiTheme } from './function/utils/bcuiTheme'

import App from './App.vue'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { library } from '@fortawesome/fontawesome-svg-core'
import { fas } from '@fortawesome/free-solid-svg-icons'

import { faSquare, faHeart, faCommentDots, faAddressBook, faFaceSmile, faFolder, faImage, faClock, faUser } from '@fortawesome/free-regular-svg-icons'

import 'vue3-bcui/base.css'
import 'vue3-bcui/style.css'
import 'vue3-bcui/themes.css'
import './styles/appStyles'

import { getPortableFileLang } from './function/utils/systemUtil'
import { preloadPinyin } from './function/utils/pinyin'

/* eslint-disable no-console */
const zh = getPortableFileLang('zh-CN')

// 载入 l10n
const messages = { 'zh-CN': zh }
// 初始化 i18n
export const i18n = createI18n({
    legacy: false,
    locale: 'zh-CN',
    fallbackLocale: 'zh-CN',
    silentFallbackWarn: true,
    messages,
})

// 创建 App
const app = createApp(App)
export default app
export const uptime = new Date().getTime()

preloadPinyin()

console.info(`Senera QQ ${packageInfo.version}`)

function bootstrap() {
    applyBcuiTheme('light')

    app.use(i18n)
    app.use(createPinia())
    app.use(VueClipboard)

    library.add(fas)
    library.add(faSquare, faHeart, faCommentDots, faAddressBook, faFaceSmile, faFolder, faImage, faClock, faUser)
    app.component('FontAwesomeIcon', FontAwesomeIcon)

    app.mount('#app')
}

try {
    bootstrap()
} catch (error: unknown) {
    console.error('Chat bootstrap failed', error)
    const root = document.getElementById('app')
    if (root) {
        root.setAttribute('role', 'alert')
        root.textContent = `无法启动聊天界面：${error instanceof Error ? error.message : String(error)}`
    }
}
