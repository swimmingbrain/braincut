// the wire protocol between this server and the braincut tab.
// the original lives in braincut-mcp at src/protocol.ts; keep them identical.

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 7331;

// tab -> server, first message after the socket opens
export interface HelloMessage {
  type: 'hello';
  protocol: number;
  app: string;
  version: string;
  url: string;
}

// tab -> server, the answer to a call
export interface ResultMessage {
  type: 'result';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

// tab -> server, something happened that nobody asked about (export progress, project changed)
export interface EventMessage {
  type: 'event';
  name: string;
  data?: unknown;
}

// server -> tab, run a tool and answer with a result carrying the same id
export interface CallMessage {
  type: 'call';
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

// server -> tab, the answer to hello
export interface WelcomeMessage {
  type: 'welcome';
  protocol: number;
  version: string;
}

// server -> tab, another tab connected and took over
export interface ReplacedMessage {
  type: 'replaced';
}

export type TabMessage = HelloMessage | ResultMessage | EventMessage;
export type ServerMessage = CallMessage | WelcomeMessage | ReplacedMessage;

// progress the tab reports for an export job, as the data of an 'export-progress' event
export interface ExportProgress {
  jobId: string;
  state: 'running' | 'uploading' | 'done' | 'error';
  progress: number;
  message?: string;
}
