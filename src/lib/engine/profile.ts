// render phase timing for the compositor. off unless something switches it
// on: a measure per phase per frame is not free at sequence frame rate, and
// the entry buffer would fill up over a long session
interface Phase {
  ms: number;
  count: number;
}

const totals = new Map<string, Phase>();
let on = false;

export function setProfiling(value: boolean): void {
  on = value;
  resetPhases();
}

export function profiling(): boolean {
  return on;
}

function record(name: string, from: number): void {
  const ms = performance.now() - from;
  const entry = totals.get(name);
  if (entry) {
    entry.ms += ms;
    entry.count++;
  } else {
    totals.set(name, { ms, count: 1 });
  }
  try {
    // shows up in a browser trace next to the gpu work it caused
    performance.measure(`braincut:${name}`, { start: from, duration: ms });
  } catch {}
}

export function phase<T>(name: string, fn: () => T): T {
  if (!on) return fn();
  const from = performance.now();
  try {
    return fn();
  } finally {
    record(name, from);
  }
}

export async function phaseAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!on) return fn();
  const from = performance.now();
  try {
    return await fn();
  } finally {
    record(name, from);
  }
}

export function phaseTotals(): Record<string, Phase> {
  const out: Record<string, Phase> = {};
  for (const [name, e] of totals) out[name] = { ms: Math.round(e.ms * 100) / 100, count: e.count };
  return out;
}

export function resetPhases(): void {
  totals.clear();
  try {
    performance.clearMeasures();
  } catch {}
}
