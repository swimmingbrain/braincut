// the whole document. everything the editor shows and everything a project
// file stores comes from here, so keep it plain data: no classes, no
// functions, nothing that can't go through structured clone or JSON

export type Id = string;
export type MediaKind = 'video' | 'audio' | 'image';
export type ClipKind = 'video' | 'audio' | 'image' | 'title' | 'color' | 'adjustment';
export type TrackKind = 'video' | 'audio';
export type Rotation = 0 | 90 | 180 | 270;
export type MediaStatus = 'ready' | 'missing' | 'unsupported' | 'converting';

// the label colors of a desktop nle, so people keep their habits
export type Label =
  | 'none' | 'violet' | 'iris' | 'caribbean' | 'lavender' | 'cerulean' | 'forest' | 'rose'
  | 'mango' | 'purple' | 'blue' | 'teal' | 'magenta' | 'tan' | 'green' | 'brown' | 'yellow';

export interface Project {
  id: Id;
  name: string;
  version: 1;
  createdAt: number;
  modifiedAt: number;
  media: MediaItem[];
  bins: Bin[];
  sequences: Sequence[];
  activeSequenceId: Id | null;
}

export interface Bin {
  id: Id;
  name: string;
  parentId: Id | null;
}

export interface MediaItem {
  id: Id;
  name: string;
  kind: MediaKind;
  binId: Id | null;
  // seconds, images have 0
  duration: number;
  // display size after rotation, audio has 0
  width: number;
  height: number;
  fps: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  channels: number;
  sampleRate: number;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
  mimeType: string;
  fileSize: number;
  // what the file was called on disk and when it was last written there, so a
  // project opened later can recognise the same file again. old project files
  // have neither, matching falls back to the item name and the size
  fileName?: string;
  lastModified?: number;
  // path inside the folder it was imported from, when the browser gave one
  relativePath?: string;
  rotation: Rotation;
  alpha: boolean;
  status: MediaStatus;
  statusReason?: string;
  // a smaller copy in the origin private file system, used for preview when proxies are on
  proxy: { key: string; width: number; height: number } | null;
  // a converted copy that stands in for a file the browser can't decode
  converted: { key: string } | null;
  // small data url for the project panel
  thumbnail: string | null;
  label: Label;
  addedAt: number;
}

export interface Sequence {
  id: Id;
  name: string;
  width: number;
  height: number;
  // 23.976, 24, 25, 29.97, 30, 50, 59.94, 60
  fps: number;
  sampleRate: number;
  // video tracks first (index 0 is V1, the bottom layer), then audio tracks (A1 first)
  tracks: Track[];
  markers: Marker[];
  inPoint: number | null;
  outPoint: number | null;
}

export interface Track {
  id: Id;
  kind: TrackKind;
  name: string;
  // sorted by start, never overlapping
  clips: Clip[];
  // sorted by start
  transitions: Transition[];
  muted: boolean;
  solo: boolean;
  locked: boolean;
  // video: the eye toggle
  hidden: boolean;
  // audio track gain in db, 0 is unity
  volume: number;
  // px in the timeline
  height: number;
}

export interface Clip {
  id: Id;
  kind: ClipKind;
  name: string;
  mediaId: Id | null;
  // sequence seconds, frame aligned
  start: number;
  duration: number;
  // source seconds where the clip begins in the media
  in: number;
  // speed > 0, 1 is normal
  speed: number;
  reverse: boolean;
  // clips with the same linkId move, select and delete together (a/v link)
  linkId: Id | null;
  enabled: boolean;
  label: Label;
  // fixed ones first: transform + opacity for anything visual, volume + pan for audio
  effects: EffectInstance[];
  title?: TitleData;
  // kind 'color': #rrggbb
  color?: string;
}

export interface TitleData {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700;
  italic: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
  stroke: { color: string; width: number } | null;
  shadow: { color: string; blur: number; x: number; y: number } | null;
  background: { color: string; padding: number } | null;
  // fractions of the frame, the text is centered in the box
  box: { x: number; y: number; width: number };
}

export type ParamValue = number | boolean | string | [number, number];
export type Easing = 'linear' | 'hold' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface Keyframe {
  // seconds relative to clip.start
  time: number;
  value: ParamValue;
  easing: Easing;
}

export interface EffectInstance {
  id: Id;
  type: string;
  enabled: boolean;
  fixed?: boolean;
  params: Record<string, ParamValue>;
  // sorted by time, a key present here means the param is animated
  keyframes: Record<string, Keyframe[]>;
}

export interface Transition {
  id: Id;
  // an audio transition id or a video transition id from the registry
  type: string;
  // null on one side means from or to black at a clip edge
  leftClipId: Id | null;
  rightClipId: Id | null;
  // sequence seconds
  start: number;
  duration: number;
  params: Record<string, ParamValue>;
}

export interface Marker {
  id: Id;
  time: number;
  duration: number;
  name: string;
  color: Label;
  note: string;
}
