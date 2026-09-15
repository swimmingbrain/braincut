import { writable } from 'svelte/store';
import { DEFAULT_PORT } from './protocol';

export type ClaudeState = 'off' | 'connecting' | 'connected';

export interface ClaudeInfo {
  state: ClaudeState;
  port: number;
  // what claude did last, shown in the status bar so the user can follow along
  lastAction: string | null;
  calls: number;
}

export const claude = writable<ClaudeInfo>({ state: 'off', port: DEFAULT_PORT, lastAction: null, calls: 0 });
