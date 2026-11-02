<template>
    <div v-if="parsedData.success" class="msg-json location-card">
        <p>{{ parsedData.data.title }}</p>
        <p class="location-coordinates">{{ parsedData.data.lat }}, {{ parsedData.data.lng }}</p>
        <div class="bottom-bar">
            <font-awesome-icon :icon="['fas', 'map-marker-alt']" />
            <span>{{ parsedData.data.name }}</span>
        </div>
    </div>
    <span v-else class="msg-unknown">{{
        '( ' + $t('加载失败') + ': ' + id + ' )'
    }}</span>
</template>

<script setup lang="ts">
import { Logger } from '@renderer/function/base'
import * as z from 'zod'

const { data: jsonData, id } = defineProps<{
    data: string,
    id: string,
}>()
const map = z
    .object({
        app: z.literal('com.tencent.map'),
        meta: z.object({
            'Location.Search': z.object({
                name: z.string(),
                address: z.string(),
                lat: z.coerce.number(),
                lng: z.coerce.number(),
            }),
        }),
    })
    .transform((o) => ({
        name: o.meta['Location.Search'].name,
        title: o.meta['Location.Search'].address,
        lat: o.meta['Location.Search'].lat,
        lng: o.meta['Location.Search'].lng,
    }))

// Keep the native location information without loading an external map service.
const parsedData = z.string().transform((value, ctx) => {
    try {
        return JSON.parse(value) as unknown
    } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid location card JSON.' })
        return z.NEVER
    }
}).pipe(map).safeParse(jsonData)
if (!parsedData.success) {
    new Logger().error(parsedData.error, 'Card Parse Error')
}
</script>

<style scoped>
.location-card .location-coordinates {
    color: var(--color-font);
    opacity: 0.6;
    font-variant-numeric: tabular-nums;
}
</style>
