<script lang="ts">
  import { base } from '$app/paths';
  import Logo from '$lib/ui/Logo.svelte';
</script>

<svelte:head>
  <title>Privacy Policy | brainCUT</title>
  <meta name="description" content="brainCUT privacy policy. Your footage stays on your machine, nothing is uploaded to any server." />
  <link rel="canonical" href="https://cut.swimmingbrain.dev/privacy" />
  <meta property="og:title" content="Privacy Policy | brainCUT" />
  <meta property="og:url" content="https://cut.swimmingbrain.dev/privacy" />
</svelte:head>

<div class="legal">
  <nav class="nav">
    <div class="nav-inner">
      <a href="{base}/" class="logo">
        <span class="logo-mark"><Logo size={24} /></span>
        <span class="logo-name">brainCUT</span>
      </a>
    </div>
  </nav>

  <div class="content">
    <h1>Privacy Policy</h1>
    <p class="updated">Last updated: August 2026</p>

    <h2>Overview</h2>
    <p>
      brainCUT is a browser-based video editor. Your footage is decoded, composited and encoded entirely
      on your device. We do not collect, store, or transmit your media or personal data to any server.
    </p>

    <h2>Files</h2>
    <p>
      Media reaches the editor either through the browser's File System Access API, when you open a file
      or a folder, or through a file input and drag and drop in browsers without it. From there everything
      happens locally: frames are decoded with WebCodecs, composited with WebGL, and encoded back with
      WebCodecs when you export. No file data is uploaded to external servers.
    </p>

    <h2>Data Storage</h2>
    <p>
      brainCUT uses your browser's storage. Projects, the recents list and the handles that point back at
      your files live in IndexedDB. Proxies, converted copies and files written during an export live in
      the origin private file system, a private area of disk only this site can see. Preferences and the
      panel layout live in localStorage. The app itself is kept in Cache Storage so it works offline. None
      of this leaves your browser and all of it can be cleared at any time through your browser settings.
    </p>

    <h2>Analytics</h2>
    <p>
      We do not use tracking scripts, analytics services, or advertising networks.
    </p>

    <h2>Third-Party Services</h2>
    <p>
      Two things involve other servers. Neither of them receives your media.
    </p>
    <p>
      <strong>Fonts.</strong> The interface loads fonts from Google Fonts during page load. Google's privacy
      policy applies to that request.
    </p>
    <p>
      <strong>The converter.</strong> Some files use codecs the browser cannot decode on its own, HEVC and
      ProRes among them. Converting one of those downloads the ffmpeg.wasm core from jsDelivr, once, and
      keeps it in the browser cache for later. Only the core's own file names are requested, never your
      media. The mirror can be changed or emptied entirely through the ffmpegMirror preference, which turns
      conversion off.
    </p>

    <h2>Cookies</h2>
    <p>
      brainCUT does not use cookies. Preferences and layout are stored in localStorage.
    </p>

    <h2>Changes</h2>
    <p>
      We may update this policy from time to time. Changes will be reflected on this page with an updated date.
    </p>

    <h2>Contact</h2>
    <p>
      For questions about this policy, contact us via
      <a href="https://github.com/swimmingbrain/braincut" target="_blank" rel="noopener">GitHub</a>.
    </p>
  </div>

  <footer class="footer">
    <a href="{base}/">&larr; Back to brainCUT</a>
  </footer>
</div>

<style>
  :global(html), :global(body) {
    overflow: auto;
  }

  .legal {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-deep);
  }

  .nav {
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
  }

  .nav-inner {
    max-width: 720px;
    margin: 0 auto;
    padding: 0 32px;
    height: 48px;
    display: flex;
    align-items: center;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
  }

  .logo-mark {
    display: flex;
    align-items: center;
    color: var(--accent);
  }

  .logo-name {
    font-family: var(--font-brand);
    font-style: italic;
    font-size: 18px;
    color: var(--text-primary);
  }

  .content {
    flex: 1;
    max-width: 720px;
    margin: 0 auto;
    padding: 48px 32px;
    width: 100%;
  }

  h1 {
    font-size: 28px;
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 4px;
  }

  .updated {
    font-size: 12px;
    color: var(--text-muted);
    font-family: var(--font-editor);
    margin-bottom: 32px;
  }

  h2 {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 24px 0 8px;
  }

  p {
    font-size: 14px;
    line-height: 1.7;
    color: var(--text-secondary);
  }

  p a {
    color: var(--accent);
    text-decoration: none;
  }

  p a:hover {
    color: var(--accent-hover);
  }

  .footer {
    border-top: 1px solid var(--border);
    padding: 16px 32px;
    max-width: 720px;
    margin: 0 auto;
    width: 100%;
  }

  .footer a {
    font-size: 12px;
    font-family: var(--font-editor);
    color: var(--text-muted);
    text-decoration: none;
  }

  .footer a:hover {
    color: var(--accent);
  }
</style>
