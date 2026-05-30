export interface SequencePreset {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  description: string;
}

export const presets: SequencePreset[] = [
  { id: '1080p25', name: '1080p 25', width: 1920, height: 1080, fps: 25, description: 'Full HD, the european broadcast rate' },
  { id: '1080p30', name: '1080p 30', width: 1920, height: 1080, fps: 30, description: 'Full HD, what most phones and cameras record' },
  { id: '1080p60', name: '1080p 60', width: 1920, height: 1080, fps: 60, description: 'Full HD at double rate, for motion and gameplay' },
  { id: '4k30', name: '4K UHD 30', width: 3840, height: 2160, fps: 30, description: 'Ultra HD, four times the pixels of 1080p' },
  { id: '4k25', name: '4K UHD 25', width: 3840, height: 2160, fps: 25, description: 'Ultra HD at the european broadcast rate' },
  { id: '720p30', name: '720p 30', width: 1280, height: 720, fps: 30, description: 'HD, light on the machine and fine for the web' },
  { id: 'vertical1080', name: 'Vertical 1080x1920', width: 1080, height: 1920, fps: 30, description: 'Portrait, for phones and short form video' },
  { id: 'square1080', name: 'Square 1080x1080', width: 1080, height: 1080, fps: 30, description: 'Square, for feeds that crop everything else' },
  { id: 'dci4k24', name: 'Cinema 4K DCI 24', width: 4096, height: 2160, fps: 24, description: 'Digital cinema, slightly wider than UHD' },
  { id: '1440p30', name: '2K 1440p 30', width: 2560, height: 1440, fps: 30, description: 'Between HD and UHD, common on desktop captures' }
];

// the rates a sequence can run at. the fractional ones are the ntsc pull-down
// rates and stay fractional, timecode handles them as drop frame
export const fpsOptions = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];

export function presetById(id: string): SequencePreset | undefined {
  return presets.find((p) => p.id === id);
}
