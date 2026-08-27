<script lang="ts">
  import { base } from '$app/paths';
  import Logo from '$lib/ui/Logo.svelte';
</script>

<svelte:head>
  <title>brainCUT | Video Editor in Your Browser</title>
  <meta name="description" content="Cut, trim and export video entirely in your browser. No sign-up, no uploads, no server. Local files, real-time preview, transitions and effects, MP4 and WebM export." />
  <link rel="canonical" href="https://cut.swimmingbrain.dev/" />
  <meta property="og:title" content="brainCUT | Video Editor in Your Browser" />
  <meta property="og:description" content="Cut, trim and export video entirely in your browser. No sign-up, no uploads, no server." />
  <meta property="og:url" content="https://cut.swimmingbrain.dev/" />
  <meta name="twitter:title" content="brainCUT | Video Editor in Your Browser" />
  <meta name="twitter:description" content="Cut, trim and export video entirely in your browser. No sign-up, no uploads, no server." />
  {@html `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'brainCUT',
    url: 'https://cut.swimmingbrain.dev',
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    description: 'Video editor that runs entirely in your browser. Cut, trim, add transitions and effects, export to MP4 or WebM. No accounts, no uploads, no installs.',
    author: { '@type': 'Person', name: 'Braian Plaku', url: 'https://swimmingbrain.dev' },
    license: 'https://opensource.org/licenses/MIT',
    featureList: ['Browser-based video editing', 'Real-time preview', 'Multi-track timeline', 'Transitions and effects', 'Export to MP4, WebM and GIF', 'Works offline', 'Local file system access']
  })}<\/script>`}
</svelte:head>

<div class="landing">
  <nav class="nav">
    <div class="nav-inner">
      <a href="{base}/" class="logo">
        <span class="logo-mark"><Logo size={24} /></span>
        <span class="logo-name">brainCUT</span>
      </a>
      <div class="nav-actions">
        <a href="https://github.com/swimmingbrain/braincut" target="_blank" rel="noopener" class="github-link" title="GitHub">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        </a>
        <a href="{base}/editor" class="nav-cta">Open Editor</a>
      </div>
    </div>
  </nav>

  <div class="content">
    <div class="split">
      <div class="left">
        <h1 class="hero-title">
          Cut video<br />
          <span class="hero-accent">without the upload.</span>
        </h1>
        <p class="hero-desc">
          A video editor that runs entirely in your browser. Your footage never leaves your machine.
          No accounts, no installs, no servers.
        </p>
        <a href="{base}/editor" class="hero-cta">
          Open Editor
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </a>
        <div class="feature-pills">
          <span class="pill">local files</span>
          <span class="pill">real-time preview</span>
          <span class="pill">transitions &amp; effects</span>
          <span class="pill">mp4 &amp; webm export</span>
          <span class="pill">works offline</span>
          <span class="pill">no accounts</span>
        </div>
      </div>

      <div class="right">
        <div class="demo-window">
          <div class="demo-bar">
            <div class="demo-dots">
              <span class="dot"></span>
              <span class="dot"></span>
              <span class="dot"></span>
            </div>
            <span class="demo-filename">summer-cut.braincut</span>
            <div style="flex:1"></div>
            <span class="demo-label">program</span>
          </div>
          <div class="demo-content">
            <div class="demo-monitor">
              <div class="demo-frame">
                <span class="demo-tc">00:00:04:12</span>
              </div>
              <div class="demo-transport">
                <span class="t-btn"></span>
                <span class="t-btn play"></span>
                <span class="t-btn"></span>
                <div class="t-bar"><span class="t-bar-fill"></span></div>
              </div>
            </div>
            <div class="demo-timeline">
              <div class="demo-ruler">
                {#each Array(8) as _, i}
                  <span class="tick">{i * 5}s</span>
                {/each}
              </div>
              <div class="demo-lane">
                <span class="lane-name">V2</span>
                <div class="lane-track">
                  <span class="clip title" style="left: 18%; width: 22%"></span>
                </div>
              </div>
              <div class="demo-lane">
                <span class="lane-name">V1</span>
                <div class="lane-track">
                  <span class="clip video" style="left: 0%; width: 34%"></span>
                  <span class="clip transition" style="left: 32%; width: 5%"></span>
                  <span class="clip video" style="left: 37%; width: 28%"></span>
                  <span class="clip image" style="left: 66%; width: 16%"></span>
                </div>
              </div>
              <div class="demo-lane">
                <span class="lane-name">A1</span>
                <div class="lane-track">
                  <span class="clip audio" style="left: 0%; width: 65%"></span>
                  <span class="clip audio" style="left: 66%; width: 30%"></span>
                </div>
              </div>
              <div class="demo-playhead" style="left: 44%"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <section class="features">
    <div class="features-inner">
      <h2 class="features-heading">What you get</h2>
      <div class="features-grid">
        <div class="feature">
          <h3>Runs in your browser</h3>
          <p>Decoding, compositing and encoding all happen on this machine through WebCodecs and WebGL. There is no backend, so there is nothing to sign up for and nothing to wait in a queue for.</p>
        </div>
        <div class="feature">
          <h3>Real-time preview</h3>
          <p>Scrub, play, step a frame at a time. The program monitor renders the whole stack live: transforms, opacity, blend modes, effects and transitions, at full, half, quarter or eighth scale. HDR footage is tone mapped on the way in.</p>
        </div>
        <div class="feature">
          <h3>Transitions and effects</h3>
          <p>Sixty-seven GPU transitions and fifty-four effects: forty-four for picture &mdash; colour correction, blurs, keying, stylize, distort &mdash; and ten for audio. Nearly every parameter can be keyframed, held or eased.</p>
        </div>
        <div class="feature">
          <h3>Export to MP4, WebM, GIF</h3>
          <p>Encoded with WebCodecs and muxed in the browser. Anything over 400 MB is streamed to disk instead of being built in memory, so a long export never has to fit in the tab. MOV, MKV and WAV as well, plus GIFs and single frames.</p>
        </div>
        <div class="feature">
          <h3>Your files stay local</h3>
          <p>Media is read from your disk, through the File System Access API where the browser has it. Nothing is uploaded, because there is no server. A project remembers where each file was, so reopening it finds the footage again.</p>
        </div>
        <div class="feature">
          <h3>Works offline</h3>
          <p>Once the page has loaded it keeps working without a connection. Open a project on a train, cut, export, close the tab. The only thing that needs the network after that is converting an exotic file.</p>
        </div>
      </div>
    </div>
  </section>

  <footer class="footer">
    <div class="footer-inner">
      <div class="footer-brand">
        <span class="logo-mark"><Logo size={16} /></span>
        <span class="footer-name">brainCUT</span>
      </div>
      <div class="footer-links">
        <a href="{base}/privacy">Privacy</a>
        <a href="{base}/terms">Terms</a>
        <a href="{base}/imprint">Imprint</a>
      </div>
      <p class="footer-credit">
        made with <span class="heart">&hearts;</span> by
        <a href="https://swimmingbrain.dev" target="_blank" rel="noopener">Braian Plaku</a>
      </p>
    </div>
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

  .landing {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-deep);
  }

  .nav {
    flex-shrink: 0;
    background: var(--bg-deep);
    border-bottom: 1px solid var(--border);
  }

  .nav-inner {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 32px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
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

  .nav-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .nav-cta {
    padding: 5px 14px;
    font-size: 12px;
    font-weight: 500;
    color: #111;
    background: var(--accent);
    border-radius: var(--radius-sm);
    text-decoration: none;
    transition: background 0.15s;
  }

  .nav-cta:hover {
    background: var(--accent-hover);
    color: #111;
  }

  .content {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: 0 32px;
  }

  .split {
    max-width: 1200px;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 56px;
  }

  .left {
    flex: 0 0 380px;
  }

  .hero-title {
    font-size: 42px;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.03em;
    color: var(--text-primary);
    margin-bottom: 16px;
  }

  .hero-accent {
    color: var(--accent);
  }

  .hero-desc {
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin-bottom: 24px;
  }

  .hero-cta {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 22px;
    font-size: 14px;
    font-weight: 600;
    color: #111;
    background: var(--accent);
    border-radius: var(--radius-sm);
    text-decoration: none;
    transition: background 0.15s, transform 0.1s;
  }

  .hero-cta:hover {
    background: var(--accent-hover);
    color: #111;
    transform: translateY(-1px);
  }

  .feature-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 24px;
  }

  .pill {
    font-size: 10px;
    font-weight: 500;
    font-family: var(--font-editor);
    color: var(--text-muted);
    padding: 3px 8px;
    border: 1px solid var(--border);
    background: var(--bg-surface);
    letter-spacing: 0.02em;
  }

  .right {
    flex: 1;
    min-width: 0;
  }

  .demo-window {
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }

  .demo-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 32px;
    padding: 0 12px;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
  }

  .demo-dots {
    display: flex;
    gap: 5px;
  }

  .demo-dots .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--border);
  }

  .demo-filename {
    font-size: 11px;
    font-family: var(--font-editor);
    color: var(--text-primary);
  }

  .demo-label {
    font-size: 10px;
    font-family: var(--font-editor);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .demo-content {
    display: flex;
    flex-direction: column;
    min-height: 280px;
    background: var(--bg-surface);
  }

  .demo-monitor {
    flex: 1;
    padding: 14px 14px 8px;
    background: var(--bg-deep);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .demo-frame {
    flex: 1;
    min-height: 128px;
    position: relative;
    background: linear-gradient(135deg, #2c4664 0%, #5b4a2c 45%, #2a5341 100%);
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    padding: 8px;
  }

  .demo-tc {
    font-family: var(--font-editor);
    font-size: 10px;
    color: rgba(255, 255, 255, 0.85);
    background: rgba(0, 0, 0, 0.45);
    padding: 1px 5px;
  }

  .demo-transport {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .t-btn {
    width: 10px;
    height: 10px;
    background: var(--text-muted);
    opacity: 0.5;
  }

  .t-btn.play {
    background: var(--accent);
    opacity: 1;
    clip-path: polygon(0 0, 100% 50%, 0 100%);
  }

  .t-bar {
    flex: 1;
    height: 3px;
    background: var(--border);
    margin-left: 4px;
  }

  .t-bar-fill {
    display: block;
    width: 44%;
    height: 100%;
    background: var(--accent);
  }

  .demo-timeline {
    position: relative;
    padding: 0 0 8px;
    background: var(--bg-surface);
    border-top: 1px solid var(--border);
  }

  .demo-ruler {
    display: flex;
    align-items: center;
    gap: 0;
    height: 18px;
    padding-left: 26px;
    border-bottom: 1px solid var(--border);
  }

  .tick {
    flex: 1;
    font-family: var(--font-editor);
    font-size: 8px;
    color: var(--text-muted);
    border-left: 1px solid var(--border);
    padding-left: 3px;
    line-height: 18px;
  }

  .demo-lane {
    display: flex;
    align-items: stretch;
    height: 18px;
    margin-top: 3px;
  }

  .lane-name {
    width: 26px;
    flex-shrink: 0;
    font-family: var(--font-editor);
    font-size: 8px;
    color: var(--text-muted);
    line-height: 18px;
    padding-left: 4px;
  }

  .lane-track {
    position: relative;
    flex: 1;
    background: var(--bg-deep);
  }

  .clip {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 1px;
  }

  .clip.video {
    background: var(--clip-video);
    border-top: 2px solid var(--clip-video-edge);
  }

  .clip.audio {
    background: var(--clip-audio);
    border-top: 2px solid var(--clip-audio-edge);
  }

  .clip.image {
    background: var(--clip-image);
    border-top: 2px solid var(--clip-image-edge);
  }

  .clip.title {
    background: var(--clip-title);
    border-top: 2px solid var(--clip-title-edge);
  }

  .clip.transition {
    background: repeating-linear-gradient(
      -45deg,
      rgba(255, 255, 255, 0.18) 0 2px,
      rgba(255, 255, 255, 0.04) 2px 5px
    );
    z-index: 1;
  }

  .demo-playhead {
    position: absolute;
    top: 0;
    bottom: 8px;
    width: 1px;
    background: var(--playhead);
  }

  .demo-playhead::before {
    content: '';
    position: absolute;
    top: 0;
    left: -3px;
    width: 7px;
    height: 7px;
    background: var(--playhead);
  }

  .features {
    border-top: 1px solid var(--border);
    padding: 64px 32px;
  }

  .features-inner {
    max-width: 1200px;
    margin: 0 auto;
  }

  .features-heading {
    font-size: 24px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 40px;
    letter-spacing: -0.02em;
  }

  .features-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 32px;
  }

  .feature h3 {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 8px;
  }

  .feature p {
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
  }

  .footer {
    flex-shrink: 0;
    border-top: 1px solid var(--border);
    padding: 12px 32px;
  }

  .footer-inner {
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .footer-brand {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .footer-name {
    font-family: var(--font-brand);
    font-style: italic;
    font-size: 14px;
    color: var(--text-primary);
  }

  .footer-credit {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-editor);
  }

  .footer-credit a {
    color: var(--accent);
    text-decoration: none;
  }

  .footer-credit a:hover {
    color: var(--accent-hover);
  }

  .github-link {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    transition: color 0.15s;
  }

  .github-link:hover {
    color: var(--text-secondary);
  }

  .footer-links {
    display: flex;
    gap: 16px;
    font-size: 11px;
    font-family: var(--font-editor);
  }

  .footer-links a {
    color: var(--text-muted);
    text-decoration: none;
  }

  .footer-links a:hover {
    color: var(--accent);
  }

  .heart {
    color: var(--error);
    font-size: 12px;
  }

  /* mobile: stack and allow scroll */
  @media (max-width: 900px) {
    .landing {
      height: auto;
      min-height: 100vh;
      overflow-y: auto;
    }

    .content {
      padding: 40px 20px;
    }

    .split {
      flex-direction: column;
      gap: 32px;
    }

    .left {
      flex: none;
      text-align: center;
    }

    .hero-title { font-size: 34px; }
    .hero-desc { font-size: 14px; }

    .feature-pills {
      justify-content: center;
    }

    .right {
      width: 100%;
    }

    .features {
      padding: 48px 20px;
    }

    .features-grid {
      grid-template-columns: 1fr;
      gap: 24px;
    }

    .footer {
      padding: 16px 20px;
    }
  }

  /* the three footer columns stop fitting side by side around here */
  @media (max-width: 560px) {
    .footer-inner {
      flex-direction: column;
      gap: 10px;
      text-align: center;
    }
  }

  @media (max-width: 480px) {
    .hero-title { font-size: 28px; }
    .content { padding: 32px 16px; }
    .demo-frame { min-height: 96px; }
  }
</style>
