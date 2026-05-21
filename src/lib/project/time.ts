// every time in the model is seconds. these helpers are the only place that
// knows about frames, so the frame grid of a sequence stays a display concern

const EPS = 1e-6;

export function frameDuration(fps: number): number {
  return 1 / fps;
}

export function frameToTime(frame: number, fps: number): number {
  return frame / fps;
}

// tolerant of float noise: 0.1 + 0.2 must still land on the frame it means
export function timeToFrame(time: number, fps: number): number {
  return Math.round(time * fps + EPS);
}

export function snapToFrame(time: number, fps: number): number {
  return timeToFrame(time, fps) / fps;
}

export function nearlyEqual(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}

export function isDropFrameRate(fps: number): boolean {
  return nearlyEqual(fps, 29.97, 0.01) || nearlyEqual(fps, 59.94, 0.01);
}

// frame labels skipped per minute by drop frame counting: 2 at 29.97, 4 at 59.94
function dropFramesPerMinute(fps: number): number {
  return Math.round(fps * 0.066666);
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

export interface TimecodeOptions {
  dropFrame?: boolean;
  showHours?: boolean;
}

export function formatTimecode(time: number, fps: number, opts: TimecodeOptions = {}): string {
  const dropFrame = opts.dropFrame ?? isDropFrameRate(fps);
  const showHours = opts.showHours ?? true;
  const negative = time < -EPS;
  let frameNumber = Math.abs(timeToFrame(time, fps));
  const nominal = Math.round(fps);

  if (dropFrame) {
    // the classic drop frame conversion: skip the first two (four) frame
    // labels of every minute that is not a multiple of ten
    const drop = dropFramesPerMinute(fps);
    const framesPerTenMinutes = Math.round(fps * 600);
    const framesPerMinute = nominal * 60 - drop;
    const tens = Math.floor(frameNumber / framesPerTenMinutes);
    const rest = frameNumber % framesPerTenMinutes;
    frameNumber += drop * 9 * tens;
    if (rest > drop) frameNumber += drop * Math.floor((rest - drop) / framesPerMinute);
  }

  const frames = frameNumber % nominal;
  const seconds = Math.floor(frameNumber / nominal) % 60;
  const minutes = Math.floor(frameNumber / (nominal * 60)) % 60;
  const hours = Math.floor(frameNumber / (nominal * 3600));
  const sep = dropFrame ? ';' : ':';
  const body = `${pad(minutes)}:${pad(seconds)}${sep}${pad(frames)}`;
  const text = showHours || hours > 0 ? `${pad(hours)}:${body}` : body;
  return negative ? `-${text}` : text;
}

function dropFrameToFrameNumber(h: number, m: number, s: number, f: number, fps: number): number {
  const nominal = Math.round(fps);
  const drop = dropFramesPerMinute(fps);
  const totalMinutes = h * 60 + m;
  return nominal * 3600 * h + nominal * 60 * m + nominal * s + f - drop * (totalMinutes - Math.floor(totalMinutes / 10));
}

// accepts what people type into a timecode field: '1:23', '00:01:23:10',
// '00:01:23;10', bare digits read in pairs from the right ('123' is one
// second and 23 frames), and '+10' / '-10' as frames relative to base
export function parseTimecode(text: string, fps: number, base = 0): number | null {
  const raw = text.trim();
  if (!raw) return null;

  const relative = /^([+-])\s*(\d+)$/.exec(raw);
  if (relative) {
    const frames = parseInt(relative[2], 10) * (relative[1] === '-' ? -1 : 1);
    return Math.max(0, snapToFrame(base + frames / fps, fps));
  }

  let fields: number[];
  let dropFrame = isDropFrameRate(fps);
  if (/^\d+$/.test(raw)) {
    // packed digits: frames first, then seconds, minutes, hours
    const padded = raw.length % 2 === 1 ? '0' + raw : raw;
    fields = [];
    for (let i = 0; i < padded.length; i += 2) fields.push(parseInt(padded.slice(i, i + 2), 10));
  } else if (/^\d+([:;.]\d+)*$/.test(raw)) {
    if (raw.includes(';')) dropFrame = true;
    fields = raw.split(/[:;.]/).map((s) => parseInt(s, 10));
  } else {
    return null;
  }
  if (fields.length > 4) return null;

  const [f = 0, s = 0, m = 0, h = 0] = [...fields].reverse();
  const nominal = Math.round(fps);
  const frameNumber = dropFrame
    ? dropFrameToFrameNumber(h, m, s, f, fps)
    : ((h * 60 + m) * 60 + s) * nominal + f;
  return frameToTime(Math.max(0, frameNumber), fps);
}

// short and readable, for durations rather than positions: 1:23.4, 1:02:03.4
export function formatDuration(seconds: number): string {
  const total = Math.max(0, seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const secText = secs.toFixed(1);
  const secPadded = secs < 10 ? '0' + secText : secText;
  if (hours > 0) return `${hours}:${pad(minutes)}:${secPadded}`;
  return `${minutes}:${secPadded}`;
}

export type TimeFormat = 'timecode' | 'frames' | 'seconds';

export function formatTime(seconds: number, fps: number, format: TimeFormat = 'timecode'): string {
  switch (format) {
    case 'frames':
      return String(timeToFrame(seconds, fps));
    case 'seconds':
      return `${seconds.toFixed(2)}s`;
    default:
      return formatTimecode(seconds, fps);
  }
}
