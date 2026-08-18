import type { Filter } from 'pixi.js';

// pixi compiles a filter's program the first time it draws and only logs when
// the shader is broken, so a bad effect quietly paints black. compiling the
// same source on a throwaway context first turns that into something we can
// fall back from
let scratch: WebGL2RenderingContext | null | undefined;
const results = new Map<string, string | null>();
const told = new Set<string>();

function context(): WebGL2RenderingContext | null {
  if (scratch && !scratch.isContextLost()) return scratch;
  if (scratch === null) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    scratch = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  } catch {
    scratch = null;
  }
  return scratch ?? null;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): string | null {
  const shader = gl.createShader(type);
  if (!shader) return 'no shader object';
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS) as boolean;
  const log = ok ? null : (gl.getShaderInfoLog(shader) || 'compile failed').trim();
  gl.deleteShader(shader);
  return log;
}

// null when the program builds, the driver's message when it does not
export function programError(vertex: string, fragment: string): string | null {
  const key = `${vertex.length}:${fragment}`;
  const cached = results.get(key);
  if (cached !== undefined) return cached;
  const gl = context();
  if (!gl) {
    results.set(key, null);
    return null;
  }
  const error = compile(gl, gl.FRAGMENT_SHADER, fragment) ?? compile(gl, gl.VERTEX_SHADER, vertex);
  results.set(key, error);
  return error;
}

// a filter whose shader does not build is dropped by the caller, which falls
// back to something plain instead of drawing a black frame
export function filterCompiles(filter: Filter, label: string): boolean {
  const program = filter.glProgram;
  if (!program?.fragment || !program.vertex) return true;
  const error = programError(program.vertex, program.fragment);
  if (!error) return true;
  if (!told.has(label)) {
    told.add(label);
    console.warn(`[braincut] ${label} does not compile here, falling back:\n${error}`);
  }
  return false;
}
