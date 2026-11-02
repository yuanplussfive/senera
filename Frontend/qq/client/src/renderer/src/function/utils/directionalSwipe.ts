/** A gesture owns one direction for its entire lifetime; scrolling cannot turn into navigation. */
export class DirectionalSwipe {
    private origin?: { x: number; y: number }
    private axis: 'pending' | 'horizontal' | 'cancelled' = 'cancelled'

    start(x: number, y: number) {
        this.origin = { x, y }
        this.axis = 'pending'
    }

    move(x: number, y: number): number | undefined {
        if (!this.origin || this.axis === 'cancelled') return undefined
        const dx = x - this.origin.x
        const dy = y - this.origin.y
        if (this.axis === 'pending') {
            // CSS pixels, independent of screen density. Resolve intent before moving any surface.
            if (Math.hypot(dx, dy) < 14) return undefined
            this.axis = Math.abs(dx) >= Math.abs(dy) * 2 ? 'horizontal' : 'cancelled'
        }
        return this.axis === 'horizontal' ? dx : undefined
    }

    cancel() {
        this.origin = undefined
        this.axis = 'cancelled'
    }
}

/** Controls, selection and horizontally scrollable content retain their native gestures. */
export function canStartSwipe(target: EventTarget | null, surface: HTMLElement): boolean {
    if (!(target instanceof Element) || window.getSelection()?.isCollapsed === false) return false
    if (target.closest('button, a, input, textarea, select, [contenteditable="true"], [role="slider"], [data-swipe-ignore]')) return false
    for (let element: Element | null = target; element && element !== surface; element = element.parentElement) {
        const overflow = getComputedStyle(element).overflowX
        if (element.scrollWidth > element.clientWidth && (overflow === 'auto' || overflow === 'scroll')) return false
    }
    return true
}
