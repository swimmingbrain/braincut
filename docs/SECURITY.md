# Security

Everything in brainCUT runs in your browser. No server of mine sees your footage. Nothing is uploaded, and the only request that ever leaves your machine while editing is the one that fetches the ffmpeg core from a CDN, the first time a file needs converting.

Decoding and encoding happen inside the browser's own WebCodecs implementation, and the converter runs in a WebAssembly sandbox. There are no shell commands, no `exec`, nothing that runs outside the tab.

If you find a security problem, please don't open a public issue. Use the private vulnerability reporting under the Security tab of this repository and I'll get back to you as soon as I can.
