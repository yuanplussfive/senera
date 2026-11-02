// The host supplies its canonical IANA zone; standalone builds use the browser zone.
// AGPL-3.0-only.
const hostTimeZone = document.querySelector<HTMLMetaElement>('meta[name="senera-time-zone"]')?.content
if (document.querySelector('meta[name="senera-client-root"]') && !hostTimeZone) {
    throw new Error('Senera 未提供显示时区')
}

export function dateTimeFormat(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    return new Intl.DateTimeFormat(locales, { ...options, ...(hostTimeZone ? { timeZone: hostTimeZone } : {}) })
}

/** UTC fields represent the displayed calendar date, never an adjusted instant. */
export function calendarDate(date: Date): Date {
    const parts = dateTimeFormat('en-CA', { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date)
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === type)?.value)
    return new Date(Date.UTC(part('year'), part('month') - 1, part('day')))
}
