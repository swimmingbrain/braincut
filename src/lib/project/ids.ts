// short random ids, enough for one project. uuids are long and end up in
// every clip, keyframe and transition of the project file
const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function id(size = 10): string {
  const bytes = new Uint8Array(size);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < size; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < size; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
