<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher<{ resize: { delta: number }; resizestart: void; resizeend: void }>();

  export let direction: 'vertical' | 'horizontal' = 'vertical';

  let dragging = false;
  let start = 0;

  $: cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';

  function onMouseDown(e: MouseEvent) {
    dragging = true;
    start = direction === 'vertical' ? e.clientX : e.clientY;
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';
    dispatch('resizestart');

    function onMouseMove(e: MouseEvent) {
      const pos = direction === 'vertical' ? e.clientX : e.clientY;
      const delta = pos - start;
      start = pos;
      dispatch('resize', { delta });
    }

    function onMouseUp() {
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      dispatch('resizeend');
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="resizer {direction}"
  class:active={dragging}
  on:mousedown={onMouseDown}
  role="separator"
  aria-orientation={direction}
  tabindex="-1"
></div>

<style>
  .resizer {
    background: var(--border);
    flex-shrink: 0;
    position: relative;
  }

  .resizer.vertical {
    width: 3px;
    cursor: col-resize;
  }

  .resizer.horizontal {
    height: 3px;
    cursor: row-resize;
  }

  .resizer:hover,
  .resizer.active {
    background: var(--accent);
  }

  .resizer::after {
    content: '';
    position: absolute;
  }

  /* a 3px strip is hard to hit, the hit area reaches a few pixels further */
  .resizer.vertical::after {
    top: 0;
    bottom: 0;
    left: -4px;
    right: -4px;
  }

  .resizer.horizontal::after {
    left: 0;
    right: 0;
    top: -4px;
    bottom: -4px;
  }
</style>
