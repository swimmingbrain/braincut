# Contributing

There is no formal process. Fork the repo, make your change, open a pull request. Small and focused beats big and sweeping, so if you plan something larger, open an issue first and we can talk it through before you spend time on it.

## Running locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173` in Chrome or Edge. Firefox and Safari run the editor too, they just decode fewer codecs and can't write an export straight to disk.

`pnpm check` runs the type checker, `pnpm test` the unit tests, `pnpm build` produces the static site in `build/`, which is exactly what gets deployed to GitHub Pages. All three run on every pull request.

## Where things live

- `src/lib/project` is the document: `types.ts` holds the model, `ops.ts` every editing operation as a pure function on a sequence, `time.ts` the frame and timecode maths, `history.ts` the undo stack, `store.ts` the writable everything else reads. Nothing in here touches the DOM, which is why it is also where the tests are.
- `src/lib/media` gets files into a project: `probe.ts` reads what a file is, `import.ts` adds it, `sources.ts` remembers where it came from, `thumbnails.ts` and `waveform.ts` draw it, `proxy.ts` and `transcode.ts` make a copy the browser can handle.
- `src/lib/engine` is playback: `media-reader.ts` and `media-cache.ts` pull frames out of files, `compositor.ts` draws a sequence at a time with PixiJS, `audio-engine.ts` schedules the audio, `player.ts` is the clock that drives both. Effects and transitions have their registries under `engine/effects` and `engine/transitions`.
- `src/lib/export` writes the result out, `src/lib/editor` holds tools, shortcuts, snapping and the command palette entries.
- `src/lib/ui` are the Svelte components, one per file, `src/routes/editor` is the editor page itself, which is mostly layout.
- `src/service-worker.ts` keeps every file of the current build in a cache of its own, so a page that was open before a deploy still gets its chunks, and it holds on to the ffmpeg core once it has been downloaded.

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
