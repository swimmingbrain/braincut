import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { defaultAudioTransition, defaultTransitionDuration, defaultVideoTransition } from '$lib/engine/transitions/defaults';

export interface Preferences {
  // seconds a still gets when it lands on the timeline
  stillImageDuration: number;
  defaultTransitionDuration: number;
  defaultVideoTransition: string;
  defaultAudioTransition: string;
  // fraction of the sequence size the program monitor renders at
  previewQuality: number;
  autoSave: boolean;
  snapping: boolean;
  // where the ffmpeg core is fetched from the first time a file needs
  // converting, empty string turns conversion off entirely
  ffmpegMirror: string;
  useProxies: boolean;
  showThumbnails: boolean;
  showWaveforms: boolean;
  hardwareAcceleration: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  audioScrubbing: boolean;
  timecodeFormat: 'timecode' | 'frames' | 'seconds';
  thumbnailSize: number;
}

const defaults: Preferences = {
  stillImageDuration: 5,
  defaultTransitionDuration,
  defaultVideoTransition,
  defaultAudioTransition,
  previewQuality: 0.25,
  autoSave: true,
  snapping: true,
  ffmpegMirror: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm',
  useProxies: false,
  showThumbnails: true,
  showWaveforms: true,
  hardwareAcceleration: 'no-preference',
  audioScrubbing: false,
  timecodeFormat: 'timecode',
  thumbnailSize: 96
};

function createPreferencesStore() {
  let initial = defaults;
  if (browser) {
    try {
      const stored = localStorage.getItem('braincut-preferences');
      if (stored) initial = { ...defaults, ...JSON.parse(stored) };
    } catch {}
  }

  const { subscribe, set, update } = writable<Preferences>(initial);

  return {
    subscribe,
    set(value: Preferences) {
      set(value);
      if (browser) {
        localStorage.setItem('braincut-preferences', JSON.stringify(value));
      }
    },
    update(fn: (prefs: Preferences) => Preferences) {
      update((current) => {
        const next = fn(current);
        if (browser) {
          localStorage.setItem('braincut-preferences', JSON.stringify(next));
        }
        return next;
      });
    }
  };
}

export const preferences = createPreferencesStore();
