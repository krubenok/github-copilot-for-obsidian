import {
  CopilotClient,
  CopilotSession,
  type ModelInfo,
} from '@github/copilot-sdk';
import { existsSync } from 'fs';
import { join } from 'path';
import { arch, platform } from 'process';

/**
 * Wrapper around the @github/copilot-sdk that manages a single CopilotClient
 * and session lifecycle. Stateless with respect to Obsidian — only wraps the SDK.
 */
export class CopilotService {
  private client: CopilotClient | null = null;
  private session: CopilotSession | null = null;
  private pluginDir: string;

  constructor(pluginDir: string) {
    this.pluginDir = pluginDir;
  }

  /**
   * Resolves the Copilot CLI binary path.
   * Prefers the platform-specific native binary over the JS entry point,
   * because the JS entry uses process.execPath which points to Electron
   * (not node) inside Obsidian, causing the CLI to launch as an Electron app.
   */
  private getBundledCliPath(): string {
    // Try native binary first (e.g. @github/copilot-darwin-arm64/copilot)
    const nativePkg = `@github/copilot-${platform}-${arch}`;
    const nativeBin = join(this.pluginDir, 'node_modules', nativePkg, 'copilot');
    if (existsSync(nativeBin)) {
      return nativeBin;
    }
    // Fallback to JS entry (works outside Electron where process.execPath = node)
    return join(this.pluginDir, 'node_modules', '@github', 'copilot', 'index.js');
  }

  /** Creates and starts the CopilotClient. */
  async initialize(): Promise<void> {
    if (this.client) return;

    try {
      this.client = new CopilotClient({ cliPath: this.getBundledCliPath() });
      await this.client.start();
    } catch (error) {
      this.client = null;
      const msg = error instanceof Error ? error.message : String(error);
      if (/ENOENT|not found|command not found|copilot.*not.*found/i.test(msg)) {
        throw new Error(
          'GitHub Copilot CLI not found. Please install it with: npm install -g @github/copilot',
        );
      }
      if (/auth|unauthorized|401|forbidden|403|login/i.test(msg)) {
        throw new Error(
          "GitHub Copilot authentication failed. Please run 'copilot auth' in your terminal.",
        );
      }
      throw new Error(`Failed to initialize Copilot client: ${msg}`);
    }
  }

  /** Destroys the current session and stops the client gracefully. */
  async destroy(): Promise<void> {
    try {
      await this.destroySession();
    } catch {
      // best-effort
    }

    if (this.client) {
      try {
        await this.client.stop();
      } catch {
        // best-effort — don't let stop errors propagate
      } finally {
        this.client = null;
      }
    }
  }

  /** Creates a new session with the given model and enables streaming. */
  async createSession(model?: string): Promise<void> {
    if (!this.client) {
      throw new Error('Copilot client is not initialized. Call initialize() first.');
    }

    // Destroy any existing session before creating a new one
    await this.destroySession();

    try {
      const sessionConfig = model ? { model, streaming: true } : { streaming: true };
      this.session = await this.client.createSession(sessionConfig);
    } catch (error) {
      this.session = null;
      throw new Error(
        `Failed to create Copilot session: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Destroys the current session if one exists. */
  async destroySession(): Promise<void> {
    if (!this.session) return;

    try {
      await this.session.destroy();
    } catch {
      // best-effort
    } finally {
      this.session = null;
    }
  }

  /**
   * Sends a message and wires up streaming events.
   * Accumulates delta text into a full response and calls onComplete when the session goes idle.
   */
  async sendMessage(
    prompt: string,
    onDelta: (text: string) => void,
    onComplete: (fullText: string) => void,
    onError: (error: Error) => void,
  ): Promise<void> {
    if (!this.session) {
      throw new Error('No active session. Call createSession() first.');
    }

    let accumulated = '';

    const unsubscribe = this.session.on((event) => {
      switch (event.type) {
        case 'assistant.message_delta':
          accumulated += event.data.deltaContent;
          onDelta(event.data.deltaContent);
          break;
        case 'assistant.message':
          // Use the final message content as the authoritative full text
          accumulated = event.data.content;
          break;
        case 'session.idle':
          unsubscribe();
          onComplete(accumulated);
          break;
        case 'session.error':
          unsubscribe();
          onError(new Error(event.data.message));
          break;
      }
    });

    try {
      await this.session.send({ prompt });
    } catch (error) {
      unsubscribe();
      onError(
        error instanceof Error
          ? error
          : new Error(`Failed to send message: ${String(error)}`),
      );
    }
  }

  /** Returns available models from the Copilot backend. */
  async listModels(): Promise<ModelInfo[]> {
    if (!this.client) {
      throw new Error('Copilot client is not initialized. Call initialize() first.');
    }

    try {
      return await this.client.listModels();
    } catch (error) {
      throw new Error(
        `Failed to list models: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Returns whether the client is ready. */
  isInitialized(): boolean {
    return this.client !== null;
  }

  /** Returns whether a session exists. */
  hasActiveSession(): boolean {
    return this.session !== null;
  }

  /** Returns the current connection status of the Copilot client. */
  getConnectionStatus(): { connected: boolean; error?: string } {
    if (this.client) {
      return { connected: true };
    }
    return { connected: false, error: 'Copilot client is not initialized.' };
  }
}
