# Contributing

There is no formal process. Fork the repo, make your change, open a pull request. Small and focused beats big and sweeping, so if you plan something larger, open an issue first and we can talk it through before you spend time on it.

## Running locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173` in Chrome or Edge. Firefox and Safari run the editor too, they just decode fewer codecs and can't write an export straight to disk.

`pnpm check` runs the type checker and has to come back with no errors and no warnings, `pnpm test` runs the unit tests, and `pnpm build` produces the static site in `build/`, which is exactly what gets deployed to GitHub Pages. All three run on every pull request.

## Where things live

- `src/lib/project` is the document: `types.ts` holds the model, `ops.ts` every editing operation as a pure function on a sequence, `time.ts` the frame and timecode maths, `keyframes.ts` the interpolation, `history.ts` the undo stack, `serialize.ts` reads and writes the `.braincut` file, `persistence.ts` the autosave into IndexedDB, `store.ts` the writable everything else reads and `ids.ts` the one place new ids come from. Nothing in here touches the DOM, which is why most of the tests are here.
- `src/lib/media` gets files into a project: `probe.ts` reads what a file is, `import.ts` adds it, `sources.ts` remembers where its bytes come from — handle, copy, name, size, date, path — and does the relinking, `opfs.ts` is the origin private file system wrapper, `thumbnails.ts` and `waveform.ts` draw it, `proxy.ts` makes the preview copy and `transcode.ts` the ffmpeg one. The waveform analysis runs in `media/workers/waveform.worker.ts`.
- `src/lib/engine` is playback: `media-reader.ts` and `media-cache.ts` pull frames out of files, `compositor.ts` draws a sequence at a time with PixiJS — including the slate a clip that will not decode gets, and the recovery from a lost WebGL context — `audio-engine.ts` and `audio-graph.ts` schedule the audio and `audio-render.ts` renders it offline for an export, `text.ts` draws the titles, `player.ts` is the clock that drives all of it, `session.ts` ties them together and holds `resetPreview`, and `profile.ts` is the per-phase timing that stays off unless you switch it on. Effects and transitions have their registries under `engine/effects` and `engine/transitions` — `effects/filters.ts` turns a stored param into the pixi filter it means, `effects/audio.ts` does the same for the Web Audio nodes, `effects/shader-check.ts` compiles a filter on a throwaway context so a broken one falls back instead of painting black — with the custom shaders in `engine/effects/shaders`, `tone-map.ts` among them.
- `src/lib/editor` is what the timeline and the menus call. `shortcuts.ts` is the one place keys are bound, `commands.ts` the command palette entries, and the actions are split by what they touch: `project-actions.ts` (new, open, save), `source-actions.ts` (three-point editing from the source monitor), `edit-actions.ts` (marks, ripple trims, generated clips, panel focus), `export-actions.ts` (the single-frame export), `timeline-interactions.ts` (everything that edits clips on the timeline). `tools.ts`, `snapping.ts`, `drag.ts` and `clipboard.ts` are the smaller pieces.
- `src/lib/export` writes the result out: `render.ts` drives the encode and decides between building the file in memory and streaming it through a scratch file, `scene.ts` renders frames off the timeline, `presets.ts` holds the formats and the codec fallbacks, `download.ts` hands the result to the browser, `gif.ts` and `frame.ts` are the two odd ones out.
- `src/lib/stores` is the state that is not the document: `app.ts` for what the interface is doing right now (selection, playhead, tool, panel layout, toasts, preview quality) and `preferences.ts` for what survives a reload in `localStorage`. `src/lib/templates/sequences.ts` holds the sequence presets and `src/lib/version.ts` reads the version out of `package.json`.
- `src/lib/ui` are the Svelte components, one per file. The timeline is split across `ui/timeline` (`Timeline.svelte` and the `Ruler`, `TrackHeader`, `TrackLane`, `ClipView`, `TransitionView`, `MarkerFlag`, `Playhead`, `Scrollbar` pieces, plus `timeline.css`), and every modal lives in `ui/dialogs`.
- `src/routes` is four public pages and the editor: `+page.svelte` is the landing page, `privacy`, `terms` and `imprint` are the legal ones, and `editor/+page.svelte` is the editor itself, which is mostly layout. `+layout.svelte` mounts the toasts, registers the service worker and forces a full load after a deploy; `+layout.ts` turns prerendering on for everything and `editor/+page.ts` turns SSR off for the editor, since WebCodecs, WebGL and the file system only exist in a browser. `+error.svelte` is the error page and `src/hooks.client.ts` puts a client error on screen instead of leaving a blank one. There are no server routes.
- `src/service-worker.ts` keeps every file of the current build in a cache of its own, so a page that was open before a deploy still gets its chunks, and it holds on to the ffmpeg core once it has been downloaded. `src/app.css` holds the design tokens every component reads.

## Tests

`pnpm test` runs them all with vitest — nineteen files, a bit over two hundred tests. They are plain node tests next to the code they cover, no browser and no fixtures:

- `project`: `ops`, `time`, `keyframes`, `history`, `serialize`, `store`, `defaults`
- `engine`: `clip-time`, `transform`, `audio-math`, `player`, `effects/registry`, `transitions/registry`, `transitions/glsl`
- `editor`: `timeline-interactions`, `snapping`, `clipboard`
- `export`: `presets`
- `media`: `probe`

The registry tests are the cheap insurance worth knowing about: they walk every effect and every transition definition and check the params are coherent, so adding one with a bad default fails the build rather than the editor. Anything you add to `ops.ts` wants a test, since that is where a wrong edit silently corrupts a timeline.

## What helps most

- Files that don't import or play. Container, codecs, where the file came from and what the project panel says about it is the most useful thing you can send. There is an issue template for exactly this.
- Performance on big files. Four hours of 4K should scrub as well as four minutes of 1080p, and where it doesn't, a note about the file and the machine helps more than a guess.
- Bugs you hit while cutting something real. Fix them if you like, or just report them.

## Style

There is no linter and no formatter, so keep the style of the file you are in: two spaces, single quotes, semicolons, and lowercase comments that explain why rather than what.

Time is always seconds, never frames, and positions on the timeline go through the helpers in `time.ts` so they land on the frame grid. Every decoded frame gets closed when it has been drawn; a leak there costs hundreds of megabytes in a minute.

Commit messages are short and lowercase with a type prefix, like `fix: keep transitions when the cut under them moves` or `feat: ripple trim with the b tool`. The types in use are `feat`, `fix`, `perf`, `docs`, `test`, `refactor` and `chore`.

## License

By contributing you agree that your work is released under the MIT license, like the rest of the project.
