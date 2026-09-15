// the tab's end of the claude code bridge: one websocket to the braincut-mcp
// server on this machine, calls in, results out. nothing here leaves the
// machine; the socket only ever points at the loopback address

import { preferences } from '$lib/stores/preferences';
import { addToast } from '$lib/stores/app';
import { version } from '$lib/version';
import { PROTOCOL_VERSION, type CallMessage, type ServerMessage, type TabMessage } from './protocol';
import { claude } from './state';
import { runTool } from './tools';

let socket: WebSocket | null = null;
let wanted = false;
let port = 0;
let attempts = 0;
let retry: ReturnType<typeof setTimeout> | null = null;
// set when another tab took the connection, so this one stops trying
let replaced = false;
let announced = false;

function send(message: TabMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function emit(name: string, data: unknown): void {
  send({ type: 'event', name, data });
}

function summarize(tool: string, result: unknown): string {
  const summary = result && typeof result === 'object' && 'summary' in result ? (result as { summary?: unknown }).summary : null;
  return typeof summary === 'string' && summary ? `${tool.replace(/_/g, ' ')}: ${summary}` : tool.replace(/_/g, ' ');
}

async function handleCall(call: CallMessage): Promise<void> {
  claude.update((c) => ({ ...c, calls: c.calls + 1, lastAction: `${call.tool.replace(/_/g, ' ')}…` }));
  try {
    const result = await runTool(call.tool, call.args ?? {}, { emit });
    send({ type: 'result', id: call.id, ok: true, result });
    claude.update((c) => ({ ...c, lastAction: summarize(call.tool, result) }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send({ type: 'result', id: call.id, ok: false, error: message });
    claude.update((c) => ({ ...c, lastAction: `${call.tool.replace(/_/g, ' ')} failed: ${message}` }));
  }
}

function onMessage(event: MessageEvent): void {
  let message: ServerMessage;
  try {
    message = JSON.parse(String(event.data)) as ServerMessage;
  } catch {
    return;
  }
  switch (message.type) {
    case 'welcome':
      attempts = 0;
      claude.update((c) => ({ ...c, state: 'connected', port }));
      if (!announced) addToast('Claude Code connected', 'success');
      announced = true;
      break;
    case 'call':
      void handleCall(message);
      break;
    case 'replaced':
      replaced = true;
      addToast('Another tab took over the Claude Code connection', 'info', 5000);
      break;
  }
}

function scheduleRetry(): void {
  if (retry) clearTimeout(retry);
  const delay = Math.min(5000, 500 * 2 ** attempts);
  attempts += 1;
  retry = setTimeout(() => {
    retry = null;
    if (wanted && !replaced) connect();
  }, delay);
}

function connect(): void {
  if (retry) {
    clearTimeout(retry);
    retry = null;
  }
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  replaced = false;
  claude.update((c) => ({ ...c, state: 'connecting', port }));
  let ws: WebSocket;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  } catch {
    scheduleRetry();
    return;
  }
  socket = ws;
  ws.onopen = () => {
    send({ type: 'hello', protocol: PROTOCOL_VERSION, app: 'braincut', version, url: location.origin + location.pathname });
  };
  ws.onmessage = onMessage;
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    if (wanted && !replaced) {
      claude.update((c) => ({ ...c, state: 'connecting' }));
      scheduleRetry();
    } else {
      claude.update((c) => ({ ...c, state: 'off' }));
    }
  };
}

function disconnect(): void {
  if (retry) {
    clearTimeout(retry);
    retry = null;
  }
  const open = socket?.readyState === WebSocket.OPEN;
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  attempts = 0;
  announced = false;
  claude.update((c) => ({ ...c, state: 'off', lastAction: null }));
  if (open) addToast('Claude Code disconnected', 'info');
}

// wires the bridge to the preference: on means keep a connection up, off
// means drop it. opening the editor with ?claude (or ?claude=PORT) switches
// the preference on, which is how the readme tells people to start
export function installClaudeBridge(): () => void {
  const flag = new URL(location.href).searchParams.get('claude');
  if (flag !== null) {
    const asked = Number(flag);
    preferences.update((p) => ({
      ...p,
      claudeBridge: true,
      claudePort: Number.isInteger(asked) && asked > 0 && asked < 65536 ? asked : p.claudePort
    }));
  }
  const unsubscribe = preferences.subscribe((p) => {
    if (p.claudeBridge) {
      if (!wanted || p.claudePort !== port) {
        wanted = true;
        port = p.claudePort;
        connect();
      }
    } else if (wanted) {
      wanted = false;
      disconnect();
    }
  });
  return () => {
    unsubscribe();
    wanted = false;
    disconnect();
  };
}

export function connectClaude(): void {
  preferences.update((p) => ({ ...p, claudeBridge: true }));
}

export function disconnectClaude(): void {
  preferences.update((p) => ({ ...p, claudeBridge: false }));
}
