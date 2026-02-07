import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { join } from 'path';

const mockExistsSync = mock();
let existsSyncValue = false;

let platformValue = 'darwin';
let archValue = 'arm64';

const mockStart = mock();
const mockStop = mock();
const mockCreateSession = mock();
const mockListModels = mock();
const mockClientConstructor = mock();

let startError: Error | null = null;

class MockCopilotClient {
  constructor(options: { cliPath: string }) {
    mockClientConstructor(options);
  }

  async start(): Promise<void> {
    if (startError) {
      throw startError;
    }
    await mockStart();
  }

  async stop(): Promise<void> {
    await mockStop();
  }

  async createSession(config: unknown): Promise<unknown> {
    return await mockCreateSession(config);
  }

  async listModels(): Promise<unknown> {
    return await mockListModels();
  }
}

class MockCopilotSession {}

void mock.module('fs', () => ({
  existsSync: mockExistsSync,
}));

void mock.module('process', () => ({
  get platform() {
    return platformValue;
  },
  get arch() {
    return archValue;
  },
}));

void mock.module('@github/copilot-sdk', () => ({
  CopilotClient: MockCopilotClient,
  CopilotSession: MockCopilotSession,
}));

const createMockSession = () => {
  let handler: ((event: { type: string; data: any }) => void) | null = null;
  let unsubscribed = false;
  const unsubscribe = mock(() => {
    unsubscribed = true;
  });
  const on = mock((callback: (event: { type: string; data: any }) => void) => {
    handler = callback;
    return unsubscribe;
  });
  const send = mock(async () => {});
  const destroy = mock(async () => {});
  return {
    on,
    send,
    destroy,
    emit: (event: { type: string; data: any }) => handler?.(event),
    get unsubscribed() {
      return unsubscribed;
    },
    unsubscribe,
  };
};

let CopilotService: typeof import('../services/CopilotService').CopilotService;

beforeAll(async () => {
  ({ CopilotService } = await import('../services/CopilotService'));
});

beforeEach(() => {
  existsSyncValue = false;
  platformValue = 'darwin';
  archValue = 'arm64';
  startError = null;
  mockStart.mockReset();
  mockStop.mockReset();
  mockCreateSession.mockReset();
  mockListModels.mockReset();
  mockClientConstructor.mockReset();
  mockExistsSync.mockReset();
  mockExistsSync.mockImplementation(() => existsSyncValue);
});

describe('CopilotService initialize errors', () => {
  it('surfaces missing CLI errors', async () => {
    startError = new Error('ENOENT: copilot not found');
    const service = new CopilotService('/plugin');

    try {
      await service.initialize();
      throw new Error('Expected initialize to reject.');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        'GitHub Copilot CLI not found. Please install it with: npm install -g @github/copilot',
      );
    }
    expect(service.isInitialized()).toBe(false);
  });

  it('surfaces authentication errors', async () => {
    startError = new Error('401 unauthorized');
    const service = new CopilotService('/plugin');

    try {
      await service.initialize();
      throw new Error('Expected initialize to reject.');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "GitHub Copilot authentication failed. Please run 'copilot auth' in your terminal.",
      );
    }
    expect(service.isInitialized()).toBe(false);
  });
});

describe('CopilotService session lifecycle', () => {
  it('replaces existing sessions and stops the client', async () => {
    const service = new CopilotService('/plugin');
    const sessionA = createMockSession();
    const sessionB = createMockSession();
    mockCreateSession.mockResolvedValueOnce(sessionA).mockResolvedValueOnce(sessionB);

    await service.initialize();
    await service.createSession('gpt-4');
    await service.createSession('gpt-4o');

    expect(sessionA.destroy).toHaveBeenCalledTimes(1);
    expect(service.hasActiveSession()).toBe(true);

    await service.destroy();

    expect(sessionB.destroy).toHaveBeenCalledTimes(1);
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(service.isInitialized()).toBe(false);
    expect(service.hasActiveSession()).toBe(false);
  });

  it('passes the native CLI path when available', async () => {
    existsSyncValue = true;
    const service = new CopilotService('/plugin');

    await service.initialize();

    expect(mockClientConstructor).toHaveBeenCalledWith({
      cliPath: join(
        '/plugin',
        'node_modules',
        `@github/copilot-${platformValue}-${archValue}`,
        'copilot',
      ),
    });
  });
});

describe('CopilotService sendMessage', () => {
  it('streams deltas and completes on idle', async () => {
    const service = new CopilotService('/plugin');
    const session = createMockSession();
    mockCreateSession.mockResolvedValue(session);

    await service.initialize();
    await service.createSession();

    const onDelta = mock();
    const onComplete = mock();
    const onError = mock();

    const sendPromise = service.sendMessage('hello', onDelta, onComplete, onError);

    session.emit({ type: 'assistant.message_delta', data: { deltaContent: 'Hi' } });
    session.emit({ type: 'assistant.message', data: { content: 'Hi there' } });
    session.emit({ type: 'session.idle', data: {} });

    await sendPromise;

    expect(onDelta).toHaveBeenCalledWith('Hi');
    expect(onComplete).toHaveBeenCalledWith('Hi there');
    expect(onError).not.toHaveBeenCalled();
    expect(session.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('reports session errors', async () => {
    const service = new CopilotService('/plugin');
    const session = createMockSession();
    mockCreateSession.mockResolvedValue(session);

    await service.initialize();
    await service.createSession();

    const onDelta = mock();
    const onComplete = mock();
    const onError = mock();

    const sendPromise = service.sendMessage('hello', onDelta, onComplete, onError);

    session.emit({ type: 'session.error', data: { message: 'boom' } });

    await sendPromise;

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    expect(onComplete).not.toHaveBeenCalled();
    expect(session.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
