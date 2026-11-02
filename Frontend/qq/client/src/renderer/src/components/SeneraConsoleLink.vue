<!-- Host navigation stays a normal link; native hosts reveal their existing console. AGPL-3.0-only. -->
<template>
    <a class="senera-icon-button senera-console-link" :href="seneraConsoleUrl()" aria-label="返回主控台" title="返回主控台">
        <font-awesome-icon :icon="['fas', 'arrow-up-right-from-square']" />
    </a>
</template>
<script setup lang="ts">
import { seneraConsoleUrl } from '@renderer/runtime/seneraContext'
</script>
