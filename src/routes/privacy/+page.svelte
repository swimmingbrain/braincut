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
    <p>
      Large files are left where they are and read a piece at a time. A copy is kept in the browser's own
      storage in two cases: when the file is 64 MB or smaller, so a project you reopen finds it without asking
      for permission again, and when the file arrived without a handle to it on disk, because then the copy is
      the only way back to it. A proxy or a converted copy, when you ask for one, is written to the same
      private area. All of these copies live on your machine and can be cleared with the site's data.
    </p>

    <h2>Data Storage</h2>
    <p>
      brainCUT uses your browser's own storage and nothing else. None of it leaves your browser, and all of
      it can be cleared at any time through your browser settings. This is everything the app writes:
    </p>
    <p>
      <strong>localStorage</strong> holds small interface settings under five keys:
      <code>braincut-preferences</code> (everything in the preferences dialog),
      <code>braincut-layout</code> (panel sizes and which tabs are open),
      <code>braincut-export</code> (the export settings you last used),
      <code>braincut-project-view</code> (list or grid in the project panel) and
      <code>braincut-effects-collapsed</code> (which effect groups you have folded away).
    </p>
    <p>
      <strong>IndexedDB</strong> holds two databases. <code>braincut</code> keeps your saved projects, the
      recents list and which project was open last. <code>braincut-media</code> keeps three stores:
      <code>sources</code>, what points a project back at its footage &mdash; the file's name, size, last
      modified date and the path it was picked from, plus a handle to it on disk, a copy of the file, or
      both, following the rule above; <code>peaks</code>, the computed audio waveforms; and <code>files</code>,
      used only in browsers that cannot write to the origin private file system directly.
    </p>
    <p>
      <strong>The origin private file system</strong> holds the generated copies of your media: proxies
      (the smaller previews) and converted copies (files the browser could not decode as they were), plus
      scratch files written during an export. It is a private area of disk only this site can see.
    </p>
    <p>
      <strong>Cache Storage</strong> holds the app itself, so it works offline: the files of the build you
      loaded, the last good copy of everything else, the ffmpeg core once it has been downloaded, and the one
      setting the service worker needs to know, which mirror the core may come from.
    </p>
    <p>
      All of it stays inside your browser's storage for this site. Nothing here is sent anywhere, and
      clearing the site's data removes the lot, copies included.
    </p>

    <h2>Analytics</h2>
    <p>
      We do not use tracking scripts, analytics services, or advertising networks.
    </p>

    <h2>Third-Party Services</h2>
    <p>
      Exactly two things ever talk to the network, and neither of them receives your media.
    </p>
    <p>
      <strong>Fonts.</strong> The interface loads its fonts from Google Fonts (fonts.googleapis.com and
      fonts.gstatic.com) while the page loads. Google's privacy policy applies to that request.
    </p>
    <p>
      <strong>The converter, only when you convert.</strong> Some files use codecs the browser cannot decode
      on its own, HEVC and ProRes among them. Converting one of those downloads the ffmpeg.wasm core from
      jsDelivr, once, and keeps it in the browser cache for later. Only the core's own file names are
      requested, never your media. If you never convert a file, this request never happens. The mirror can
      be changed or emptied entirely through the ffmpegMirror preference, which turns conversion off.
    </p>
    <p>
      That is the complete list. There is no backend, no API, no error reporting and no update check. Once
      the page has loaded, the editor works with the network switched off.
    </p>

    <h2>Cookies</h2>
    <p>
      brainCUT does not use cookies, and there is no account to sign in to. The interface settings listed
      above are stored in localStorage.
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
  /* the app shell pins html and body to the viewport and hides the overflow.
     the public pages are documents, so they hand the scrolling back. the two
     selectors are deliberately heavier than app.css's plain `html, body`,
     because which of the two stylesheets loads last is not fixed */
  :global(html:root), :global(html body) {
    height: auto;
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

  /* only the headings space the sections, so paragraphs need their own gap */
  p + p {
    margin-top: 12px;
  }

  p a {
    color: var(--accent);
    text-decoration: none;
  }

  p a:hover {
    color: var(--accent-hover);
  }

  /* the storage keys are named exactly, so they are set in the mono face */
  p :global(code) {
    font-family: var(--font-editor);
    font-size: 12px;
    color: var(--text-primary);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 1px 5px;
    white-space: nowrap;
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
