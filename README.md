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
- **Real-time preview.** The program monitor renders the whole stack live: transforms, opacity, blend modes, effect filters, adjustment layers, titles and transitions. Preview resolution is yours to pick when a 4K sequence gets heavy: Full, 1/2, 1/4 or 1/8, and 1/4 is where it starts. HDR footage, PQ or HLG, is tone mapped to SDR on the way to the canvas. A clip whose file the browser cannot decode draws a slate with its name instead of taking the picture down with it, there is a Reset preview button for when something does get stuck, and a lost WebGL context is asked back and picks up where it left off.
- **Transitions.** Sixty-seven GPU transitions from the gl-transitions collection, curated into six groups that make sense while cutting: dissolves, wipes, slides and pushes, 3D and motion, zooms and stylize. Audio gets constant power, constant gain and exponential fades.
- **Effects.** Forty-four video effects and ten audio ones. Colour correction with exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, saturation and vibrance. Blurs and sharpen, chroma and luma keying, levels, vignette, glitch, glow, bloom, old film, CRT, pixelate, mosaic, crop and flip, twist, bulge, shockwave and lens distortion. The audio effects are built on Web Audio: gain, EQ, low, high and band-pass filters, a compressor, reverb, delay, stereo width.
- **Keyframes.** Nearly every parameter can be animated, with linear, hold and eased interpolation: ease in, ease out, ease in and out. A stopwatch per parameter turns a static value into a first keyframe and bakes it back when you switch it off.
- **Titles.** Text with font, weight, colour, stroke, shadow and a background box, placed on the frame and rendered with the rest of the picture.
- **Export.** MP4, WebM, MOV, MKV, WAV and GIF, encoded with WebCodecs and muxed in the browser, with eleven presets to start from. Saving to a file writes straight into it; a download over 400 MB goes through a scratch file instead of being built in memory. An export whose clips point at files that are gone stops before it starts and names them. Single frames export as PNG or JPEG.
- **Undo that means it.** Two hundred steps, with the history panel showing exactly what each one was, drags collapsed into one entry.
- **Your files stay local.** Media is read in place, through the File System Access API where the browser has it. A project remembers each file's name, size, last modified date and the path it was picked from, so reopening it finds the footage again; anything still missing is relinked from one folder in a single pass. Projects, the recents list and the handles back to your files live in the browser's own storage.
- **Works offline.** Once the page has loaded, everything runs locally. The only request that ever needs the network is the converter's first download.

## How it works under the hood

There's no magic and no backend.

**Reading files.** Demuxing goes through [mediabunny](https://github.com/Vanilagy/mediabunny), which reads containers with random access over a `Blob`, so a four-hour file is never loaded into memory. Frames come out of the browser's own [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) decoders: random access while scrubbing, a sequential cursor with read-ahead while playing.

**Compositing.** Every frame is drawn with [PixiJS](https://pixijs.com/) on WebGL. Decoded frames upload straight to textures, effects are shader filters, and a transition renders both sides into render textures and runs a [gl-transitions](https://gl-transitions.com/) shader between them. A frame that arrives PQ or HLG coded gets a tone map shader in front of it, so HDR footage lands in sRGB rather than looking washed out. Textures are destroyed the moment the frame is on screen; nothing is retained. When the driver takes the WebGL context away, the compositor asks for it back and redraws.

**Audio.** Playback is a Web Audio graph, one node chain per clip with the track's effects and keyframed gain and pan, scheduled ahead of the clock. The clock itself is the audio context, which is what keeps picture and sound together. Export renders the same graph offline.

**The document.** One plain data structure, edited through pure functions and [immer](https://immerjs.github.io/immer/). Undo is the patch list immer hands back, which is why it is exact and cheap.

**Storage.** Projects, recents, file handles and the identity of every media file go into IndexedDB through [idb-keyval](https://github.com/jakearchibald/idb-keyval); files up to 64 MB are kept there whole. Proxies, converted copies and export scratch files go into the origin private file system.

**When a file is too exotic.** HEVC and ProRes are not decodable everywhere. Those files are converted once to H.264 with [ffmpeg.wasm](https://ffmpegwasm.netlify.app/), whose core is fetched from a CDN the first time it is needed and cached afterwards. Everything else never touches it.

**Frontend.** [SvelteKit](https://kit.svelte.dev/) with the static adapter. The whole app is pre-built to static HTML/CSS/JS and deployed to GitHub Pages. No SSR, no API routes, no server.

## Keyboard shortcuts

`Ctrl` is `Cmd` on a Mac. Text fields keep their own keys, and while a dialog or the command palette is open it owns the keyboard.

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
| `Ctrl+K` | Split at the playhead, or open the palette when there is nothing to cut |
| `Ctrl+Shift+K` | Split across every track |
| `Delete` `Backspace` | Delete |
| `Shift+Delete` `Shift+Backspace` | Ripple delete |
| `Q` `W` | Ripple trim the previous / next edit to the playhead |
| `Alt+Left` `Alt+Right` | Nudge the selected clips one frame (with `Shift`, five) |
| `;` `'` | Lift / extract |
| `,` `.` | Insert / overwrite |
| `Ctrl+D` `Ctrl+Shift+D` | Default video / audio transition |
| `Ctrl+L` | Link / unlink |
| `Shift+E` | Enable / disable clip |
| `Ctrl+Alt+M` | Mute / unmute the selected audio clips |
| `Ctrl+R` | Speed and duration |
| `Ctrl+Z` `Ctrl+Shift+Z` `Ctrl+Y` | Undo / redo |
| `Ctrl+C` `Ctrl+X` `Ctrl+V` | Copy, cut, paste |
| `Ctrl+A` `Ctrl+Shift+A` | Select all / deselect |
| `S` | Toggle snapping |
| `=` `-` `\` | Zoom in, zoom out, fit the sequence |
| `Ctrl+S` `Ctrl+Shift+S` | Save / save as |
| `Ctrl+O` `Ctrl+I` | Open a project, import media |
| `Ctrl+M` `Ctrl+Shift+E` | Export, export the current frame |
| `Ctrl+N` | New sequence |
| `Ctrl+Shift+P` | Command palette |
| `?` | Shortcuts |
| `Ctrl+,` | Preferences |
| `Esc` | Close what is open, then clear the selection |
| `Shift+1` to `Shift+5` | Focus project, source, program, timeline, effects |
| `Alt+drag` | Duplicate a clip |
| `Ctrl+drag` | Insert instead of overwrite |

The lift and extract keys are the semicolon and the apostrophe, as on a desktop NLE. The numpad `+` and `-` zoom as well.

## Project files and relinking

A project is a single `.braincut` file, and it is JSON. Open it in a text editor and you will find the sequences, tracks, clips, effects and keyframes as plain objects, which means it diffs and it survives being poked at.

What it does not contain is your footage. Media is referenced, not embedded, so the file stays small no matter how much material you cut. What each media item does carry is enough to recognise the file again: its name, its size in bytes, its last modified date, the path it was picked from, and everything the probe found — container, codecs, duration, resolution, frame rate, rotation. The bytes stay where they always were, on your disk.

Where those bytes come from is remembered next to the project rather than inside it, and how depends on the file:

- **A file the browser handed over as a handle** keeps that handle, and up to 64 MB a copy of the file is kept beside it, so reopening the project is silent — no picker, no permission prompt, nothing to click. Above 64 MB only the handle is kept, because a copy would double the disk cost for no gain, and reading a handle after a browser restart needs permission again: the project panel gathers every file in that state behind one **Grant access** button and asks for all of them at once.
- **A file that arrived without a handle** — from a plain file input, or in a browser with no File System Access API — is kept as the file object itself whatever its size, because that is the only way back to it.
- **Neither** — the file moved, or the project came from another machine — and the item is marked missing: its tile gets a red badge that says so, and the reason why on hovering it. The timeline is untouched: clips, effects and keyframes all stay exactly where they were.

Missing items come back two ways. **Relink** picks one file for one item. **Relink all…** points at the folder the footage moved to, walks it, and matches every missing item at once: same name and size first, then the same name, then a file of exactly the same size whose duration is within half a second. It says how many of them it found.

Autosave is a separate thing from the file. It writes into IndexedDB, coalescing a burst of edits into one write about a second and a half after you stop, and it is what the recents list on the welcome screen opens. Saving to a `.braincut` file is still what makes a project yours to keep, back up and move.

## Proxies and conversion

Two different problems, two different answers, and it is worth knowing which one you have hit.

**Conversion** is for files the browser cannot decode at all. HEVC and ProRes are the usual ones, and a file like that arrives in the project marked unsupported with the codec named. Converting runs it through ffmpeg.wasm once and writes an H.264 copy, which then stands in for the original everywhere, exports included. The core is a few megabytes fetched from jsDelivr the first time and cached after that. It is capped at 2 GB of input, because ffmpeg.wasm keeps its whole filesystem in a 32-bit heap and a larger file has nowhere to go. Turn the mirror off in the preferences and conversion is off entirely.

**Proxies** are for files the browser decodes perfectly well but not fast enough. A proxy is a 540p H.264 copy made with the browser's own encoder, no ffmpeg involved, and it usually lands under a tenth of a camera file's size. It stands in for preview only. Export always goes back to the original, so a proxy can never quietly cost you quality. Switch them on with the "Use proxies" preference.

Both copies live in the origin private file system, not in your project folder, and both are per media item. Clearing the site's data throws them away and they are made again on demand.

## Preview quality and big files

Nothing is ever loaded whole. A file on the timeline is opened as a `Blob` and read with random access, so the editor pulls the few seconds it needs and nothing more, whether the file is four minutes or four hours. Scrubbing seeks and decodes single frames; playing keeps a sequential cursor with read-ahead, and cursors nobody has asked for in three seconds get closed so their decoders go away. Decoded frames are destroyed as soon as they have been drawn.

What does accumulate is the cheap stuff: thumbnails, the audio peaks a waveform is drawn from, and the still images in a sequence. Peaks are computed once in a worker and cached in IndexedDB, so a clip is only analysed the first time you see it. Everything else is bounded and evicted.

So the thing that actually decides whether a heavy sequence feels good is the preview quality switch, in the program monitor's header and in the preferences. It renders the monitor at **Full**, **1/2**, **1/4** or **1/8** of the sequence size, and **1/4** is where it starts, because a 4K timeline composited at 4K just to fill a monitor a quarter that size is work nobody asked for. Drop it to 1/8 on a laptop, turn proxies on if the decode itself is the bottleneck, and export at full quality regardless, because export never uses either — it always renders at the sequence size and reads the original file.

The preview is built to survive bad footage rather than stop at it. A clip whose file the browser cannot decode draws a dark slate with the clip's name where its picture would be, and the rest of the sequence keeps playing. HDR footage arrives PQ or HLG coded in BT.2020 and is tone mapped to SDR before it is composited, so it looks like the picture and not like a washed-out copy of it. If the preview does get stuck, the header says so and **Reset preview** throws the whole thing away and builds it again, failures included, so a file that broke once gets another try. A WebGL context the driver took away is asked back automatically and the picture is redrawn.

Exports have their own limit to work around. A download is built in memory when it should come out under 400 MB, which puts the metadata at the front and costs a fraction of a second; over that it is written to a scratch file in the origin private file system and handed to the browser from there, so the tab never holds the whole thing. Saving straight to a file with the file picker always streams, and for anything over about 1.5 GB that is what the export dialog suggests.

## Known limitations

- **Codec support is the browser's.** brainCUT decodes with WebCodecs, so what it can open is what your browser can open. H.264, VP8, VP9 and AV1 are broadly fine; AAC, Opus, MP3 and PCM likewise.
- **HEVC and ProRes need converting.** Files the browser refuses are converted once with ffmpeg.wasm, which takes time and disk, and the converter stops at 2 GB of input.
- **HDR is tone mapped, not preserved.** PQ and HLG footage is mapped to SDR for both the preview and the export. There is no HDR output.
- **Files over 64 MB may ask for permission again.** A big file the browser gave a handle for is remembered by that handle alone, and after a browser restart reading it needs one click on Grant access, or a relink if it has moved.
- **Chromium is the recommended browser.** Chrome, Edge, Arc and Brave get direct file access, streamed exports, the folder picker Relink all uses, and the widest codec list. Firefox and Safari run the editor with a fallback path and fewer codecs, and relink from a multi-file picker rather than a folder.
- **No multicam and no motion tracking.** Both are on the list, neither is here.
- **No collaborative editing.** There is no server to collaborate through, on purpose.
- **Very long sequences are limited by memory, not by design.** Nothing is loaded whole, but caches, waveforms and thumbnails still add up.

## Security and privacy

Everything runs in your browser. Your footage never leaves your machine.

- **No telemetry, no analytics, no tracking.**
- **No accounts, no cookies, no data collection.**
- Media is read in place through the File System Access API. Nothing is copied to a server, because there is no server. What does get copied, into the browser's own storage on your machine, is a file up to 64 MB the browser gave a handle for, so a project reopens without asking for it again, a file that arrived without a handle at all, and any proxy or converted copy you ask for. Clearing the site's data removes all of it.
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
| Storage | IndexedDB, origin private file system, Cache Storage |
| Fallback conversion | ffmpeg.wasm |
| Styling | Plain CSS on design tokens, with Tailwind CSS 4 for the reset |
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

MIT.

The libraries it is built on keep their own, and [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES) lists every one of them. The single thing in there that is not MIT or close to it: the transition called Page Curl is a BSD 3-Clause shader, copyright Hewlett-Packard, and its notice travels inside the shader source.

Built by [Braian Plaku](https://swimmingbrain.dev)
