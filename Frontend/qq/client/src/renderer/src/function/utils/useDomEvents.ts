import { onMounted, onUnmounted } from 'vue'

/** Attach a document listener for the lifetime of the consuming component. */
export function useEventListener<T extends keyof DocumentEventMap>(
    target: Document,
    event: T,
    callback: (event: DocumentEventMap[T]) => void,
) {
    onMounted(() => target.addEventListener(event, callback))
    onUnmounted(() => target.removeEventListener(event, callback))
}

type KeyboardCallback = () => boolean | undefined
const modifierKeys = new Map<string, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>([
    ['ctrl', 'ctrlKey'], ['shift', 'shiftKey'], ['alt', 'altKey'], ['meta', 'metaKey'],
])

/** All shortcut alternatives share one listener and one normalized event key. */
export function useKeyboard(...args: [string, ...string[], KeyboardCallback]) {
    const callback = args.at(-1) as KeyboardCallback
    const shortcuts = (args.slice(0, -1) as string[]).map((shortcut) =>
        shortcut.toLowerCase().split('+').map((key) => key.trim()),
    )
    useEventListener(document, 'keydown', (event) => {
        // Script-dispatched events can use the keydown name without carrying
        // KeyboardEvent data. Composing/consumed input does not invoke shortcuts.
        if (typeof event.key !== 'string' || !event.key || event.isComposing || event.defaultPrevented) return
        const eventKey = event.key.toLowerCase()
        const matches = shortcuts.some((keys) => keys.every((key) => {
            const modifier = modifierKeys.get(key)
            return modifier ? event[modifier] : eventKey === key
        }))
        if (matches && callback()) {
            event.preventDefault()
            event.stopPropagation()
        }
    })
}
