import { Component, DirectiveBinding, markRaw, ObjectDirective, shallowReactive } from 'vue'
import { VueCompData } from './elements/vueComp'
import { v4 as uuid } from 'uuid'
import UserInfoTooltip from '@renderer/components/tooltip/UserInfoTooltip.vue'
import { vTooltip } from './utils/appUtil'

export const tooltipList: TooltipInfo<Component>[] = shallowReactive([])

export type TooltipInfo<T extends Component> = {
    compData: VueCompData<T>
    pos: { x: number, y: number }
    id: string
}

export type TooltipController = {
    id: string
    close: () => void
}

export function addTooltip<T extends Component>(compData: VueCompData<T>, pos: { x: number, y: number }): TooltipController {
    const id = uuid()
    tooltipList.push({ compData, pos, id })
    return {
        id,
        close: () => closeTooltip(id)
    }
}

export function closeTooltip(id: string) {
    const index = tooltipList.findIndex(t => t.id === id)
    if (index !== -1) {
        tooltipList.splice(index, 1)
    }
}

type IUser = any

export type VUserTooltipBinding = IUser | number | (() => IUser | number)

export function bindUserTooltip(el: HTMLElement, user: VUserTooltipBinding) {
    vTooltip.mounted(el, {
        value: { comp: markRaw(UserInfoTooltip), props: { user } }
    })
    return () => vTooltip.unmounted(el)
}

export const vUserTooltip: ObjectDirective<HTMLElement, VUserTooltipBinding> = {
    mounted(el: HTMLElement, binding: DirectiveBinding<VUserTooltipBinding>) {
        bindUserTooltip(el, binding.value)
    },
    unmounted(el: HTMLElement) {
        vTooltip.unmounted(el)
    }
}
