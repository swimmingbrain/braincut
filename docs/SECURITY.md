# Security

Everything in brainCUT runs in your browser. No server of mine sees your footage. Nothing is uploaded. Two requests leave your machine and that is the whole list: the fonts, from Google Fonts as the page loads, and the ffmpeg core, from a CDN the first time a file needs converting. Neither one carries your media, and if you never convert anything the second never happens. There is no backend, no API, no telemetry, no error reporting and no update check.

Decoding and encoding happen inside the browser's own WebCodecs implementation, and the converter runs in a WebAssembly sandbox. There are no shell commands, no `exec`, nothing that runs outside the tab.

## What stays on your machine

Everything the editor keeps is in your browser's storage for this origin, and clearing the site's data removes all of it:

- **localStorage** — five keys of interface settings: `braincut-preferences`, `braincut-layout`, `braincut-export`, `braincut-project-view`, `braincut-effects-collapsed`.
- **IndexedDB** — the `braincut` database holds saved projects, the recents list and which project was open last. The `braincut-media` database holds what points a project back at its footage — a handle to the file on disk, a copy of the file, or both — along with its name, size, last modified date and the path it was picked from. It also holds the computed audio peaks, and, in a browser that cannot write to the origin private file system from the main thread, the proxies and converted copies that would otherwise live there.
- **The origin private file system** — proxies, converted copies, and the scratch file a large export is written through.
- **Cache Storage** — the app's own files so it works offline, the ffmpeg core once it has been downloaded, and which mirror the service worker may fetch that core from.

A file the browser gave a handle for is copied only when it is 64 MB or smaller; a larger one is read in place, a few seconds at a time, through that handle, and reading it after a restart needs your permission again. A file that arrived without a handle — a plain file input, or a browser with no File System Access API — is kept whatever its size, because the copy is then the only way back to it.

## The converter

The ffmpeg core is not part of this repository and is not a dependency. It is downloaded at runtime, once, only when a file uses codecs WebCodecs cannot decode, and only the core's own file names are requested — never your media. The mirror is the `ffmpegMirror` preference: point it somewhere you trust, or empty it, which turns conversion off entirely.

## Reporting

If you find a security problem, please don't open a public issue. Use the private vulnerability reporting under the Security tab of this repository and I'll get back to you as soon as I can.
