<script context="module" lang="ts">
  // each copy on a page needs its own mask and clip ids
  let count = 0;
</script>

<script lang="ts">
  export let size: number = 24;
  const uid = `bc${++count}`;
</script>

<svg width={size} height={size} viewBox="0 8 64 48" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <mask id="{uid}-h">
      <rect width="64" height="64" fill="#fff" />
      <rect x="9" y="19" width="5.4" height="5" rx="1" fill="#000" /><rect x="19.2" y="19" width="5.4" height="5" rx="1" fill="#000" /><rect x="29.4" y="19" width="5.4" height="5" rx="1" fill="#000" /><rect x="39.6" y="19" width="5.4" height="5" rx="1" fill="#000" /><rect x="49.8" y="19" width="5.4" height="5" rx="1" fill="#000" />
      <rect x="9" y="40" width="5.4" height="5" rx="1" fill="#000" /><rect x="19.2" y="40" width="5.4" height="5" rx="1" fill="#000" /><rect x="29.4" y="40" width="5.4" height="5" rx="1" fill="#000" /><rect x="39.6" y="40" width="5.4" height="5" rx="1" fill="#000" /><rect x="49.8" y="40" width="5.4" height="5" rx="1" fill="#000" />
    </mask>
    <g id="{uid}-s"><rect x="4" y="15" width="56" height="34" rx="4" fill="currentColor" mask="url(#{uid}-h)" /></g>
    <clipPath id="{uid}-l"><polygon points="-20,-20 42.6,-20 21.4,84 -20,84" /></clipPath>
    <clipPath id="{uid}-r"><polygon points="42.6,-20 84,-20 84,84 21.4,84" /></clipPath>
  </defs>
  <g transform="translate(-2.44 -3.05)"><g clip-path="url(#{uid}-l)"><use href="#{uid}-s" /></g></g>
  <g transform="translate(2.44 3.05)"><g clip-path="url(#{uid}-r)"><use href="#{uid}-s" /></g></g>
</svg>
