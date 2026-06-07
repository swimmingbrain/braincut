/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// two jobs: keep the app's own files around so a page and its chunks always
// come from the same build (even after a deploy replaced everything on the
// server), and hold on to the ffmpeg core once it has been downloaded, so
// converting a file works the second time without a network

import { build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

// one cache per deploy for the app itself, dropped when the next one arrives
const APP_CACHE = `braincut-app-${version}`;
// these outlive deploys: the last good copies of everything else, the ffmpeg
// core files fetched so far, and the mirror setting
const CACHE_NAME = 'braincut-v1';
const FFMPEG_CACHE = 'braincut-ffmpeg-v1';
const CONFIG_CACHE = 'braincut-config-v1';
const CONFIG_URL = '/__braincut-config';

// where the ffmpeg core comes from unless the preference says otherwise.
// only reached when a file's codecs are beyond what webcodecs decodes
const DEFAULT_MIRROR = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

// the app's chunks, the pages, and the handful of small static files
const PRECACHE = [
  ...build,
  ...prerendered,
  ...files.filter((f) => /^\/(favicon\.svg|manifest\.json|robots\.txt|braincut-logo-readme\.svg)$/.test(f))
];

let mirrorOverride: string | null = null; // null = not set, '' = disabled, string = url

// caches can be unavailable (private windows in some browsers), the app has
// to keep working without them
async function openCache(name: string): Promise<Cache | null> {
  try {
    return await caches.open(name);
  } catch {
    return null;
  }
}

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await openCache(APP_CACHE);
      if (!cache) return;
      // one missing file must not stop the rest from being cached
      await Promise.allSettled(PRECACHE.map((url) => cache.add(url).catch(() => {})));
    })()
  );
  sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
  const keep = [APP_CACHE, CACHE_NAME, FFMPEG_CACHE, CONFIG_CACHE];
  event.waitUntil(
    (async () => {
      try {
        const names = await caches.keys();
        await Promise.all(names.filter((n) => !keep.includes(n)).map((n) => caches.delete(n)));
      } catch { /* no cache storage, nothing to clean */ }
      await sw.clients.claim();
    })()
  );
});

// receive config from the app (persisted so it survives worker restarts)
sw.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;
  // hard reloads bypass service worker control, the app asks to reclaim it
  if (data.type === 'claim') {
    sw.clients.claim();
    return;
  }
  if (data.type !== 'ffmpeg-config') return;
  mirrorOverride = typeof data.mirror === 'string' ? data.mirror : null;
  event.waitUntil(
    (async () => {
      const cache = await openCache(CONFIG_CACHE);
      if (cache) await cache.put(CONFIG_URL, new Response(JSON.stringify({ mirror: mirrorOverride })));
    })()
  );
});

async function getMirror(): Promise<string> {
  if (mirrorOverride !== null) return mirrorOverride;
  try {
    const cache = await openCache(CONFIG_CACHE);
    const stored = cache && (await cache.match(CONFIG_URL));
    if (stored) {
      const cfg = await stored.json();
      if (typeof cfg.mirror === 'string') {
        mirrorOverride = cfg.mirror;
        return mirrorOverride as string;
      }
    }
  } catch { /* fall through */ }
  return DEFAULT_MIRROR;
}

// the core is a wasm blob and a loader of a few megabytes. once fetched it
// never changes under the same url, so the cached copy always wins
async function handleFfmpeg(request: Request): Promise<Response> {
  const cache = await openCache(FFMPEG_CACHE);
  const hit = cache ? await cache.match(request) : undefined;
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok && cache) {
    try {
      await cache.put(request, response.clone());
    } catch { /* storage full or unavailable */ }
  }
  return response;
}

// the app's own files never change under a given name, so the copy from
// the build they belong to wins, whatever the server has by now
async function handleImmutable(request: Request): Promise<Response> {
  const cache = await openCache(APP_CACHE);
  const hit = cache ? await cache.match(request) : undefined;
  if (hit) return hit;
  const resp = await fetch(request);
  if (resp.ok && cache) {
    try {
      await cache.put(request, resp.clone());
    } catch { /* storage unavailable */ }
  }
  return resp;
}

// network first, with what we have as the fallback: the page from this
// build for navigations, the last good copy for everything else
async function handleDefault(request: Request, url: URL): Promise<Response> {
  try {
    const response = await fetch(request);
    if (response.status === 200 && url.origin === sw.location.origin) {
      const cache = await openCache(CACHE_NAME);
      if (cache) {
        try {
          await cache.put(request, response.clone());
        } catch { /* storage full or unavailable */ }
      }
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request).catch(() => undefined);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const page =
        (await caches.match(url.pathname).catch(() => undefined)) || (await caches.match('/').catch(() => undefined));
      if (page) return page;
    }
    throw err;
  }
}

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === sw.location.origin;

  if (!sameOrigin) {
    event.respondWith(
      (async () => {
        const mirror = await getMirror();
        if (mirror && request.url.startsWith(mirror)) {
          return handleFfmpeg(request).catch(() => fetch(request));
        }
        return fetch(request);
      })()
    );
    return;
  }

  if (url.pathname.startsWith('/_app/immutable/')) {
    event.respondWith(handleImmutable(request).catch(() => fetch(request)));
    return;
  }

  // whatever goes wrong inside, the browser gets a real answer, never a
  // broken interception
  event.respondWith(handleDefault(request, url).catch(() => fetch(request)));
});
