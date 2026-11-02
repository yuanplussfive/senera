/// <reference types="vite/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue'
    // eslint-disable-next-line
    const component: DefineComponent<{}, {}, any>
    export default component
}

// po 文件，按字符串处理
declare module '*.po' {
    const value: string
    export default value
}

declare module '*.yaml' {
    const content: any
    export default content
}

declare module '*.yml' {
    const content: any
    export default content
}

declare module '@renderer/assets/img/qq-face/public/assets/qq_emoji/_index.json' {
    const content: {
        emojiId: string,
        describe: '' | `/${string}`,
        assets: {
            type: number,
            path: string,
            name: string,
        }[]
    }[]
    export default content
}
