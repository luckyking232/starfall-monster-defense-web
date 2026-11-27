export const UI_PROTOCOL = 'starfall.monster-defense.original-ui/1';

export interface UiControllerState {
  pages: { id: string; name: string }[];
  selected: number;
}

export interface UiTreeNode {
  id: number;
  name: string;
  type: string;
  objectType: string;
  packageId: string;
  componentId: string;
  refName?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  touchable: boolean;
  text?: string;
  url?: string;
  controllers: Record<string, UiControllerState>;
  children: UiTreeNode[];
  source?: unknown;
  list?: { numItems: number; defaultItem: string | null; scrollX: number };
  transitions?: unknown[];
  clickHandlerCount: number;
}

export type UiOp =
  | { op: 'set'; id: number; key: string; value: string | number | boolean }
  | { op: 'controller'; id: number; name: string; index: number }
  | { op: 'list-items'; id: number; items: UiTreeNode[] }
  | { op: 'list-add'; id: number; item: UiTreeNode }
  | { op: 'list-clear'; id: number }
  | { op: 'list-trim'; id: number; count: number }
  | { op: 'child-add'; id: number; item: UiTreeNode }
  | { op: 'child-remove'; id: number }
  | { op: 'transition-play'; id: number; name: string; playId: number; labels?: string[]; scaled?: boolean }
  | { op: 'transition-stop'; id: number; name: string }
  | { op: 'center'; id: number; x: number; y: number }
  | { op: 'scroll'; id: number; x: number }
  | { op: 'click-handlers'; id: number; count: number };

export type EndlessRunOrigin = Pick<import('../../src/platform/progress').EndlessRecord, 'source' | 'endedBy'>;

export type UiEvent =
  | { name: 'start-battle'; stageId: number }
  | { name: 'battle-close' }
  | { name: 'world'; state: import('../../src/engine/protocol').RuleState }
  | { name: 'clear-earned'; stageId: number; assisted?: true }
  | { name: 'progress-save-failed'; endless?: true }
  | { name: 'settlement'; stageId: number; frame: number; win: boolean; loss: boolean; wave: number; kills: number; endless?: EndlessRunOrigin }
  | { name: 'endless-record'; newRecord: boolean; runId: string; source: EndlessRunOrigin['source'] }
  | { name: 'endless-record-change' }
  | { name: 'audio-play'; id: number; kind: 'bgm' | 'sfx'; path: string; frame?: number; emitter?: number }
  | { name: 'audio-stop'; id: number | 'bgm' }
  | { name: 'audio-speed'; speed: number }

  | { name: 'warn-tips'; text: string }
  | { name: 'souvenir'; kind: 'gift' | 'task' | 'return' }
  | { name: 'item-tips'; itemId: number }
  | { name: 'item-rewards' }
  | { name: 'module-group'; group: string }
  | { name: 'unsupported'; capability: string; detail: string }
  | { name: 'stale-dropped'; what: string }
  | { name: 'log'; text: string };

interface Envelope {
  protocol: typeof UI_PROTOCOL;
  session: string;
}

export interface UiReadyMessage extends Envelope {
  type: 'ready';
  requestId: number;
  entryPoint: string;
  windows: string[];
  excludedCapabilities: string[];
}

export interface UiOpenMessage extends Envelope {
  type: 'open';
  window: string;
  rootId: number;
  tree: UiTreeNode;
}

export interface UiOpsMessage extends Envelope {
  type: 'ops';
  ops: UiOp[];
}

export interface UiCloseMessage extends Envelope {
  type: 'close';
  window: string;
}

export interface UiEventMessage extends Envelope {
  type: 'event';
  event: UiEvent;
}

export interface UiSettledMessage extends Envelope {
  type: 'settled';
  requestId: number;
}

export interface UiErrorMessage {
  protocol: typeof UI_PROTOCOL;
  session?: string;
  type: 'error';
  requestId?: number;
  code: string;
  message: string;
}

export interface UiDisposedMessage extends Envelope {
  type: 'disposed';
  requestId: number;
}

export type UiHostMessage =
  | (Envelope & { type: 'startup'; percent: number; phase: string })
  | UiReadyMessage
  | UiOpenMessage
  | UiOpsMessage
  | UiCloseMessage
  | UiEventMessage
  | UiSettledMessage
  | UiErrorMessage
  | UiDisposedMessage;

export interface UiInitRequest {
  protocol: typeof UI_PROTOCOL;
  type: 'init';
  requestId: number;
  baseUrl?: string;
  activityStartStamp: number;
  serverNowStamp: number;
  clearedStageIds?: readonly number[];
  assistedStageIds?: readonly number[];
  allUnlocked?: boolean;
  gameplay?: boolean;
}

export interface UiClickRequest {
  protocol: typeof UI_PROTOCOL;
  type: 'click';
  requestId: number;
  session: string;
  componentId: number;
}

export interface UiDisposeRequest {
  protocol: typeof UI_PROTOCOL;
  type: 'dispose';
  requestId: number;
}

export interface UiPresentationRequest {
  protocol: typeof UI_PROTOCOL;
  type: 'presentation';
  session: string;
  requestId: number;
  signal: { kind: 'shown'; rootId: number } | { kind: 'transition'; playId: number; label?: string }
    | { kind: 'tick'; ms: number } | { kind: 'background' } | { kind: 'debug-level' }
    | { kind: 'progress'; clearedStageIds: number[]; assistedStageIds: number[] };
}

export type UiClientRequest = UiInitRequest | UiClickRequest | UiPresentationRequest | UiDisposeRequest;
