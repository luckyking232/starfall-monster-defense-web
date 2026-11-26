import { createOriginalUiHost, type OriginalUiHost } from './host';
import { UI_PROTOCOL, type UiClientRequest, type UiHostMessage } from './protocol';

const scope = self as unknown as {
  location: Location;
  postMessage(message: UiHostMessage): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

let host: OriginalUiHost | null = null;
let serial: Promise<void> = Promise.resolve();

function errorMessage(error: unknown, requestId?: number): UiHostMessage {
  const err = error as Error & { code?: string };
  const message: UiHostMessage = {
    protocol: UI_PROTOCOL,
    type: 'error',
    code: err.code ?? 'ui-host-failed',
    message: err.message ?? String(error),
  };
  if (host) message.session = host.session;
  if (requestId !== undefined) message.requestId = requestId;
  return message;
}

function validStamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

async function handle(message: UiClientRequest): Promise<void> {
  if (message?.protocol !== UI_PROTOCOL) return;
  const { type, requestId } = message;
  try {
    if (type === 'init') {
      if (host) {
        await host.dispose();
        host = null;
      }
      if (!validStamp(message.activityStartStamp)) {
        const error = new Error('activityStartStamp (seconds) must be provided by the caller') as Error & { code?: string };
        error.code = 'bad-time';
        throw error;
      }
      if (!validStamp(message.serverNowStamp)) {
        const error = new Error('serverNowStamp (seconds) must be provided by the caller (platform time)') as Error & { code?: string };
        error.code = 'bad-time';
        throw error;
      }
      const baseUrl = typeof message.baseUrl === 'string' ? message.baseUrl : new URL('./', scope.location.href).href;
      const base = new URL(baseUrl);
      if (base.origin !== scope.location.origin) {
        const error = new Error('Runtime must share the app origin') as Error & { code?: string };
        error.code = 'runtime-origin';
        throw error;
      }
      host = createOriginalUiHost({
        postMessage: (outgoing) => scope.postMessage(outgoing),
        runtimeBase: base.href,
        activityStartStamp: message.activityStartStamp,
        serverNowStamp: message.serverNowStamp,
        clearedStageIds: message.clearedStageIds ?? [],
        assistedStageIds: message.assistedStageIds ?? [],
        allUnlocked: message.allUnlocked === true,
        gameplay: message.gameplay === true,
      });
      await host.init(requestId);
      return;
    }
    if (type === 'click') {
      if (!host) {
        const error = new Error('ui host is not initialised') as Error & { code?: string };
        error.code = 'not-ready';
        throw error;
      }
      await host.click(requestId, message.session, message.componentId);
      return;
    }
    if (type === 'presentation') {
      if (!host) throw new Error('UI host is not initialised');
      await host.present(requestId, message.session, message.signal);
      return;
    }
    if (type === 'dispose') {
      if (host) {
        await host.dispose(requestId);
        host = null;
      } else {
        scope.postMessage({ protocol: UI_PROTOCOL, session: '', type: 'disposed', requestId });
      }
      return;
    }
    const error = new Error(`Unknown request: ${String(type)}`) as Error & { code?: string };
    error.code = 'bad-action';
    throw error;
  } catch (error) {
    scope.postMessage(errorMessage(error, requestId));
  }
}

scope.onmessage = (event) => {
  serial = serial.then(() => handle(event.data as UiClientRequest)).catch((error) => {
    scope.postMessage(errorMessage(error));
  });
};
