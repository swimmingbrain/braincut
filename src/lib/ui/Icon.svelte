<script lang="ts" module>
  // one place for every glyph in the editor. 16px grid, 1.5 stroke, round
  // caps, so a button never has to care which icon it holds. shapes that
  // read better solid (transport, keyframes, dots) override the stroke
  const paths: Record<string, string> = {
    play: '<path fill="currentColor" stroke="none" d="M4.8 3.2 12.4 8l-7.6 4.8z"/>',
    pause: '<path fill="currentColor" stroke="none" d="M4.8 3.4h2.1v9.2H4.8zM9.1 3.4h2.1v9.2H9.1z"/>',
    stepBack: '<path d="M4.6 3.6v8.8"/><path fill="currentColor" stroke="none" d="M12 3.9v8.2L6.2 8z"/>',
    stepForward: '<path d="M11.4 3.6v8.8"/><path fill="currentColor" stroke="none" d="M4 3.9v8.2L9.8 8z"/>',
    toStart: '<path d="M3.4 3.6v8.8"/><path fill="currentColor" stroke="none" d="M8.6 4.4v7.2L5.1 8zM12.9 4.4v7.2L9.4 8z"/>',
    toEnd: '<path d="M12.6 3.6v8.8"/><path fill="currentColor" stroke="none" d="M7.4 4.4v7.2L10.9 8zM3.1 4.4v7.2L6.6 8z"/>',
    markIn: '<path d="M5.5 3v10M5.5 3h4.6M5.5 13h4.6"/>',
    markOut: '<path d="M10.5 3v10M10.5 3H5.9M10.5 13H5.9"/>',
    marker: '<path fill="currentColor" stroke="none" d="M3.6 2.4h9l-2.2 3.2 2.2 3.2h-9z"/><path d="M3.6 2.4v11.2"/>',
    razor: '<path d="M6 2.5h4v6l-2 2-2-2z"/><path d="M8 10.5v3"/>',
    select: '<path d="M4 2.5v9.2l2.4-2.3 1.6 3.6 1.9-.9-1.6-3.5h3.3z"/>',
    trackSelect: '<path d="M2.5 2.5v7.4l1.9-1.9 1.3 2.9 1.6-.7-1.3-2.9h2.7z"/><path d="M11 5.5 13.5 8 11 10.5M13.5 8h-4"/>',
    ripple: '<path d="M3.5 3v10M12.5 3v10"/><path d="M6 8h4M8.5 6 10.5 8l-2 2"/>',
    rolling: '<path d="M8 3v10"/><path d="M4 8h2.5M6 6.5 4.5 8 6 9.5"/><path d="M12 8H9.5M10 6.5 11.5 8 10 9.5"/>',
    slip: '<path d="M3 3.5v9M13 3.5v9"/><path d="M5.5 8h5M6.8 6.2 5 8l1.8 1.8M9.2 6.2 11 8l-1.8 1.8"/>',
    slide: '<path d="M6 3.5v9M10 3.5v9"/><path d="M2 8h2.5M4 6.5 2.5 8 4 9.5M14 8h-2.5M12 6.5 13.5 8 12 9.5"/>',
    pen: '<path d="M11.5 2.5 13.5 4.5 5.5 12.5 2.5 13.5 3.5 10.5z"/>',
    hand: '<path d="M5.6 8V4.3a1.1 1.1 0 0 1 2.2 0v3.1V3.3a1.1 1.1 0 0 1 2.2 0v4.1V4.7a1.1 1.1 0 0 1 2.2 0v4.8c0 2.2-1.7 4-3.9 4-2 0-3-1-4.1-2.8L3.1 9.3a1.1 1.1 0 0 1 1.7-1.4z"/>',
    zoom: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 13.8 13.8M5.2 7h3.6M7 5.2v3.6"/>',
    text: '<path d="M3 4.4V3h10v1.4M8 3v10M6 13h4"/>',
    link: '<path d="M6.5 9.5 9.5 6.5"/><path d="M7.5 4.8 9 3.3a2.6 2.6 0 0 1 3.7 3.7l-1.5 1.5M8.5 11.2 7 12.7A2.6 2.6 0 0 1 3.3 9l1.5-1.5"/>',
    unlink: '<path d="M7.5 4.8 9 3.3a2.6 2.6 0 0 1 3.7 3.7l-1.5 1.5M8.5 11.2 7 12.7A2.6 2.6 0 0 1 3.3 9l1.5-1.5"/><path d="M2.6 2.6 13.4 13.4"/>',
    eye: '<path d="M1.5 8S3.8 3.8 8 3.8 14.5 8 14.5 8 12.2 12.2 8 12.2 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>',
    eyeOff: '<path d="M6.3 3.9A6.6 6.6 0 0 1 8 3.8c4.2 0 6.5 4.2 6.5 4.2a12 12 0 0 1-2 2.6M4.3 5.1A11.7 11.7 0 0 0 1.5 8s2.3 4.2 6.5 4.2c1 0 1.9-.2 2.6-.5"/><path d="M6.7 6.7a1.8 1.8 0 0 0 2.5 2.5"/><path d="M2.6 2.6 13.4 13.4"/>',
    lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
    unlock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1"/>',
    mute: '<path d="M2.5 6h2.2L8 3.3v9.4L4.7 10H2.5z"/><path d="M10.6 6.2 13.9 9.5M13.9 6.2 10.6 9.5"/>',
    solo: '<path d="M3 9.5V8a5 5 0 0 1 10 0v1.5"/><rect x="2" y="9" width="2.8" height="4.2" rx="1"/><rect x="11.2" y="9" width="2.8" height="4.2" rx="1"/>',
    snap: '<path d="M4 12.8V6.5a4 4 0 0 1 8 0v6.3"/><path d="M4 9.4h3.2M8.8 9.4H12"/><path d="M4 12.8h3.2M8.8 12.8H12"/>',
    plus: '<path d="M8 3.5v9M3.5 8h9"/>',
    minus: '<path d="M3.5 8h9"/>',
    close: '<path d="M4 4 12 12M12 4 4 12"/>',
    chevronDown: '<path d="M4 6 8 10l4-4"/>',
    chevronRight: '<path d="M6 4l4 4-4 4"/>',
    search: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 13.8 13.8"/>',
    folder: '<path d="M1.8 12.8v-9.6h4.2l1.5 2h6.7v7.6z"/>',
    film: '<rect x="1.5" y="3" width="13" height="10" rx="1"/><path d="M4.5 3v10M11.5 3v10M1.5 8h13"/>',
    audio: '<path d="M3 6h2.4L8.5 3.2v9.6L5.4 10H3z"/><path d="M10.6 6.2a2.6 2.6 0 0 1 0 3.6M12.6 4.6a5 5 0 0 1 0 6.8"/>',
    image: '<rect x="1.8" y="3" width="12.4" height="10" rx="1"/><circle cx="5.6" cy="6.4" r="1.2"/><path d="M2 11.2 5.8 7.6l3 2.6 2.4-2 2.9 2.7"/>',
    title: '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1"/><path d="M5 6.4V5.6h6v.8M8 5.6v5M6.6 10.6h2.8"/>',
    settings: '<circle cx="8" cy="8" r="2.2"/><path d="M12.7 9.8a1 1 0 0 0 .2 1.1l.1.1a1.2 1.2 0 1 1-1.7 1.7l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9v.1a1.2 1.2 0 1 1-2.4 0v-.1a1 1 0 0 0-.7-.9 1 1 0 0 0-1.1.2l-.1.1a1.2 1.2 0 1 1-1.7-1.7l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6h-.1a1.2 1.2 0 1 1 0-2.4h.1a1 1 0 0 0 .9-.7 1 1 0 0 0-.2-1.1l-.1-.1a1.2 1.2 0 1 1 1.7-1.7l.1.1a1 1 0 0 0 1.1.2h.1a1 1 0 0 0 .6-.9v-.1a1.2 1.2 0 1 1 2.4 0v.1a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1.2 1.2 0 1 1 1.7 1.7l-.1.1a1 1 0 0 0-.2 1.1v.1a1 1 0 0 0 .9.6h.1a1.2 1.2 0 1 1 0 2.4h-.1a1 1 0 0 0-.9.6z"/>',
    export: '<path d="M8 10.5V2.5M5.2 5.3 8 2.5l2.8 2.8"/><path d="M2.8 10v3.5h10.4V10"/>',
    importIcon: '<path d="M8 2.5v8M5.2 7.7 8 10.5l2.8-2.8"/><path d="M2.8 10v3.5h10.4V10"/>',
    save: '<path d="M2.5 3.5a1 1 0 0 1 1-1h7l3 3v7a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/><path d="M5 2.5v4h5.5v-4M4.5 13.5v-4h7v4"/>',
    undo: '<path d="M3 5.5h6.5a3.5 3.5 0 0 1 0 7H6"/><path d="M5.5 3 3 5.5 5.5 8"/>',
    redo: '<path d="M13 5.5H6.5a3.5 3.5 0 0 0 0 7H10"/><path d="M10.5 3 13 5.5 10.5 8"/>',
    fx: '<path d="M3 13.5V4.8a2 2 0 0 1 2-2h1.2M3 8h3.4"/><path d="M9 8.5l4.5 5M13.5 8.5 9 13.5"/>',
    keyframe: '<path d="M8 3l4 5-4 5-4-5z"/>',
    keyframeOn: '<path fill="currentColor" stroke="none" d="M8 2.8 12.2 8 8 13.2 3.8 8z"/>',
    loop: '<path d="M3 7V6a2.5 2.5 0 0 1 2.5-2.5h7"/><path d="M10.2 1.6 12.9 3.5l-2.7 1.9"/><path d="M13 9v1a2.5 2.5 0 0 1-2.5 2.5h-7"/><path d="M5.8 14.4 3.1 12.5l2.7-1.9"/>',
    fit: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
    camera: '<path d="M2 5.5h2.5l1-1.6h5l1 1.6H14v7.5H2z"/><circle cx="8" cy="9" r="2.4"/>',
    trash: '<path d="M2.5 4h11M6 4V2.8h4V4M4 4v9.2h8V4M6.5 6.5v4.5M9.5 6.5v4.5"/>',
    copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
    more: '<circle cx="3.4" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.6" cy="8" r="1.1" fill="currentColor" stroke="none"/>',
    check: '<path d="M3 8.4 6.3 11.6 13 4.8"/>',
    warning: '<path d="M8 2.5 14.5 13.5h-13z"/><path d="M8 6.4v3.2M8 11.6v.4"/>',
    info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.4v4M8 4.8v.4"/>',
    github: '<path fill="currentColor" stroke="none" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>',
    palette: '<path d="M8 1.8a6.2 6.2 0 0 0 0 12.4c.9 0 1.4-.6 1.4-1.3 0-.4-.2-.7-.4-1-.2-.3-.4-.5-.4-.9 0-.6.5-1.1 1.1-1.1h1.3a3.2 3.2 0 0 0 3.2-3.2c0-2.8-2.8-4.9-6.2-4.9z"/><circle cx="5.2" cy="6.2" r=".9" fill="currentColor" stroke="none"/><circle cx="8" cy="4.6" r=".9" fill="currentColor" stroke="none"/><circle cx="10.9" cy="6" r=".9" fill="currentColor" stroke="none"/>',
    wave: '<path d="M2.2 6.6v2.8M4.4 3.8v8.4M6.6 5.6v4.8M8.8 2.8v10.4M11 6v4M13.2 4.4v7.2"/>',
    mixer: '<path d="M4 2.5v3.2M4 8.9v4.6M12 2.5v6.4M12 12.1v1.4"/><path d="M2.4 7.3h3.2M10.4 10.5h3.2"/>'
  };

  export type IconName = keyof typeof paths;
</script>

<script lang="ts">
  let { name, size = 16 }: { name: string; size?: number } = $props();

  const markup = $derived(paths[name] ?? '');
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false">{@html markup}</svg>

<style>
  svg {
    display: block;
    flex-shrink: 0;
  }
</style>
