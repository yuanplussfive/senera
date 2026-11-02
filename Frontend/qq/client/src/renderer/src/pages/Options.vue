<!-- Senera owns the client settings surface. AGPL-3.0-only. -->
<template>
    <SeneraSettings :show="show" />
</template>
<script setup lang="ts">
import SeneraSettings from '@renderer/components/SeneraSettings.vue'
defineOptions({ name: 'ViewOption' })
defineProps<{ show: boolean }>()
</script>
