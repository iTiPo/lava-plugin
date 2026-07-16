<script lang="ts">
    let { size = 30 }: { size?: number } = $props();
</script>

<div class="lava-mark" style:width="{size}px" style:height="{size}px">
    <span class="lava-mark__letter">L</span>
</div>
