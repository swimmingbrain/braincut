<p align="center">
  <img src="static/braincut-logo-readme.svg" alt="braincut logo" width="80" />
</p>

<h1 align="center">brainCUT</h1>

<p align="center">
  A free, open-source video editor that runs entirely in your browser.<br/>
  No accounts. No uploads. No installs. Just open a tab and cut.
</p>

<p align="center">
  <a href="https://cut.swimmingbrain.dev"><strong>Try it now &rarr; cut.swimmingbrain.dev</strong></a>
</p>

I edit video for university projects and for a small channel, and every editor I tried wanted something from me first. A subscription, an account, an upload, twenty gigabytes of disk. The web ones wanted my footage on their servers, which for a 40 GB folder of camera files is not a plan, it is a weekend. So I built the editor I actually wanted: it opens in a tab, reads the files where they already are, and never sends them anywhere.

If you have used a desktop editor before, the layout and the keys will feel familiar: source and program monitors, a project bin, effect controls, a multi-track timeline, and the tool shortcuts in the places your hands expect them.

## What it does

brainCUT is a non-linear video editor that decodes, composites and encodes in the browser. There is no backend. You open your media, cut it on a timeline, add transitions and effects, and export an MP4 or a WebM straight back to disk.

Projects are a plain file you keep next to your footage. Nothing is stored on a server, because there is no server.

## Features

- **Multi-track timeline.** Video and audio tracks, ripple and rolling edits, slip and slide, razor, three-point editing, insert and overwrite, linked audio and video, markers, in and out points. Snapping to clip edges, the playhead and markers.
- **Real-time preview.** The program monitor renders the whole stack live: transforms, opacity, blend modes, effect filters, adjustment layers, titles and transitions. Preview resolution is yours to pick when a 4K sequence gets heavy.
- **Transitions.** Over a hundred GPU transitions from the gl-transitions collection, curated into groups that make sense while cutting: dissolves, wipes, slides and pushes, zooms, flips, glitches. Audio gets constant power, constant gain and exponential fades.
- **Effects.** Colour correction with exposure, contrast, highlights, shadows, temperature and vibrance. Blurs, sharpen, keying, levels, vignette, glitch, glow, old film, pixelate, crop, and a set of audio effects built on Web Audio: EQ, compressor, reverb, delay, stereo width.
- **Keyframes.** Every parameter that can move can be animated, with linear, hold, ease and bezier interpolation.
- **Titles.** Text with font, weight, colour, stroke, shadow and a background box, placed on the frame and rendered with the rest of the picture.
- **Export.** MP4, WebM, MOV, MKV, WAV and GIF, encoded with WebCodecs and muxed in the browser. Long exports stream straight to a file on disk instead of filling memory. Single frames export as PNG or JPEG.
- **Undo that means it.** Two hundred steps, with the history panel showing exactly what each one was, drags collapsed into one entry.
- **Your files stay local.** Media is read through the File System Access API, in place. Projects, the recents list and the handles back to your files live in the browser's own storage.
- **Works offline.** Once the page has loaded, everything runs locally. The only request that ever needs the network is the converter's first download.

## How it works under the hood

There's no magic and no backend.

**Reading files.** Demuxing goes through [mediabunny](https://github.com/Vanilagy/mediabunny), which reads containers with random access over a `Blob`, so a four-hour file is never loaded into memory. Frames come out of the browser's own [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) decoders: random access while scrubbing, a sequential cursor with read-ahead while playing.

**Compositing.** Every frame is drawn with [PixiJS](https://pixijs.com/) on WebGL. Decoded frames upload straight to textures, effects are shader filters, and a transition renders both sides into render textures and runs a [gl-transitions](https://gl-transitions.com/) shader between them. Textures are destroyed the moment the frame is on screen; nothing is retained.

**Audio.** Playback is a Web Audio graph, one node chain per clip with the track's effects and keyframed gain and pan, scheduled ahead of the clock. The clock itself is the audio context, which is what keeps picture and sound together. Export renders the same graph offline.

**The document.** One plain data structure, edited through pure functions and [immer](https://immerjs.github.io/immer/). Undo is the patch list immer hands back, which is why it is exact and cheap.

**Storage.** Projects, recents and file handles go into IndexedDB through [idb-keyval](https://github.com/jakearchibald/idb-keyval). Proxies, converted copies and export scratch files go into the origin private file system.

**When a file is too exotic.** HEVC and ProRes are not decodable everywhere. Those files are converted once to H.264 with [ffmpeg.wasm](https://ffmpegwasm.netlify.app/), whose core is fetched from a CDN the first time it is needed and cached afterwards. Everything else never touches it.

**Frontend.** [SvelteKit](https://kit.svelte.dev/) with the static adapter. The whole app is pre-built to static HTML/CSS/JS and deployed to GitHub Pages. No SSR, no API routes, no server.

## Keyboard shortcuts

| Key | What it does |
|-----|--------------|
| `Space` | Play / pause |
| `J` `K` `L` | Shuttle backwards, stop, forwards |
| `Left` `Right` | One frame back / forward |
| `Shift+Left` `Shift+Right` | Five frames |
| `Home` `End` | Start / end of the sequence |
| `Up` `Down` | Previous / next edit point |
| `I` `O` | Mark in / mark out |
| `Shift+I` `Shift+O` | Go to in / out |
| `Ctrl+Shift+X` | Clear in and out |
| `M` | Add a marker |
| `V` `A` `B` `N` `C` | Selection, track select, ripple, rolling, razor |
| `Y` `U` `P` `H` `Z` `T` | Slip, slide, pen, hand, zoom, type |
| `Ctrl+K` | Split at the playhead |
| `Delete` | Delete |
| `Shift+Delete` | Ripple delete |
| `Q` `W` | Ripple trim the previous / next edit to the playhead |
| `;` `"` | Lift / extract |
| `,` `.` | Insert / overwrite |
| `Ctrl+D` `Ctrl+Shift+D` | Default video / audio transition |
| `Ctrl+L` | Link / unlink |
| `Shift+E` | Enable / disable clip |
| `Ctrl+R` | Speed and duration |
| `Ctrl+Z` `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+C` `Ctrl+X` `Ctrl+V` | Copy, cut, paste |
| `Ctrl+A` `Ctrl+Shift+A` | Select all / deselect |
| `S` | Toggle snapping |
| `=` `-` `\` | Zoom in, zoom out, fit the sequence |
| `Ctrl+S` `Ctrl+O` `Ctrl+I` | Save, open, import |
| `Ctrl+M` `Ctrl+Shift+E` | Export, export the current frame |
| `Ctrl+N` | New sequence |
| `Ctrl+Shift+P` | Command palette |
| `?` | Shortcuts |
| `Ctrl+,` | Preferences |
| `Shift+1` to `Shift+5` | Focus project, source, program, timeline, effects |
| `Alt+drag` | Duplicate a clip |
| `Ctrl+drag` | Insert instead of overwrite |

The lift and extract keys are the semicolon and the apostrophe, as on a desktop NLE.

## Known limitations

- **Codec support is the browser's.** brainCUT decodes with WebCodecs, so what it can open is what your browser can open. H.264, VP8, VP9 and AV1 are broadly fine; AAC, Opus, MP3 and PCM likewise.
- **HEVC and ProRes need converting.** Files the browser refuses are converted once with ffmpeg.wasm, which takes time and disk. Large ones take a lot of both.
- **Chromium is the recommended browser.** Chrome, Edge, Arc and Brave get direct file access, streamed exports and the widest codec list. Firefox and Safari run the editor with a fallback path and fewer codecs.
- **No multicam and no motion tracking.** Both are on the list, neither is here.
- **No collaborative editing.** There is no server to collaborate through, on purpose.
- **Very long sequences are limited by memory, not by design.** Nothing is loaded whole, but caches, waveforms and thumbnails still add up.

## Security and privacy

Everything runs in your browser. Your footage never leaves your machine.

- **No telemetry, no analytics, no tracking.**
- **No accounts, no cookies, no data collection.**
- Media is read in place through the File System Access API. Nothing is copied to a server, because there is no server.
- Decoding and encoding happen in the browser's own WebCodecs implementation. There are no shell commands being executed. No `ffmpeg` binary, no `exec()`, no `spawn()`.
- The ffmpeg.wasm converter runs in a WebAssembly sandbox, and only when you convert a file. Its core is fetched from jsDelivr, once, and cached. Only the core's own file names are requested, never your media. The mirror can be changed or emptied through the `ffmpegMirror` preference, which turns conversion off.
- Fonts are loaded from Google Fonts on page load. That is the only other request the app makes.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Svelte 5 + SvelteKit (static adapter) |
| Demux / mux | mediabunny |
| Decode / encode | WebCodecs |
| Compositing | PixiJS 8 (WebGL) |
| Transitions | gl-transitions |
| Audio | Web Audio API |
| Undo | immer patches |
| Storage | IndexedDB, origin private file system |
| Fallback conversion | ffmpeg.wasm |
| Styling | Tailwind CSS 4 |
| Language | TypeScript |
| Deployment | GitHub Pages |

## Running locally

```bash
git clone https://github.com/swimmingbrain/braincut.git
cd braincut
pnpm install
pnpm dev
```

Open `http://localhost:5173` in Chrome or Edge.

## Browser support

Full functionality needs WebCodecs and the File System Access API, both available in Chromium-based browsers (Chrome, Edge, Arc, Brave, Opera). Firefox and Safari can edit and export too, with a smaller set of decodable codecs and without writing exports straight to disk.

## Contributing

There is no formal process. Fork, change, open a pull request. [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) has the layout of the code and what kind of help matters most right now.

## License

MIT

Built by [Braian Plaku](https://swimmingbrain.dev)
