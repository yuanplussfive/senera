import { setBcuiTheme, type BcuiTheme } from 'vue3-bcui'
import { rgbToHsl, hslToRgb } from './systemUtil'
import { useSettingsStore } from '@renderer/state/settings'

/** Keep the user's custom accent legible in either color scheme. */
export function applyCustomThemeColor(color: string) {
    const rgb = [0, 2, 4].map(offset => parseInt(color.slice(offset, offset + 2), 16))
    const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2])
    const settings = useSettingsStore().sysConfig
    const dark = settings.opt_auto_dark ? window.matchMedia('(prefers-color-scheme: dark)').matches : settings.opt_dark
    const min = dark ? 0.625 : 0.35
    const max = dark ? 0.9 : 0.625
    const final = hslToRgb(hsl[0], hsl[1], min + hsl[2] * (max - min))
    document.documentElement.style.setProperty('--color-main', `rgb(${final.join(',')})`)
}

const LOCAL_BCUI_STYLE_ID = 'ssqq-local-bcui-style'
const LOCAL_BCUI_THEME_ID = 'ssqq-local-bcui-theme'
const LOCAL_APPEND_THEME_ID = 'ssqq-local-append-theme'

function upsertStyleLink(id: string, href: string) {
    const head = document.head
    if (!head) {
        return
    }

    let link = document.getElementById(id) as HTMLLinkElement | null
    if (!link) {
        link = document.createElement('link')
        link.id = id
        link.rel = 'stylesheet'
        link.type = 'text/css'
    }

    const resolvedHref = new URL(href, document.baseURI).href
    if (link.href !== resolvedHref) {
        link.href = resolvedHref
    }

    if (!link.isConnected) {
        head.appendChild(link)
    }
}

export function applyBcuiTheme(theme: BcuiTheme) {
    setBcuiTheme(theme)
    upsertStyleLink(LOCAL_BCUI_STYLE_ID, './bcui/css/style.css')
    upsertStyleLink(LOCAL_BCUI_THEME_ID, `./bcui/css/color-${theme}.css`)
    upsertStyleLink(LOCAL_APPEND_THEME_ID, `./css/append-${theme}.css`)
}
