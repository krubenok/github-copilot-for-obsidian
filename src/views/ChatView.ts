import { ItemView, MarkdownRenderer, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import { VIEW_TYPE_COPILOT_CHAT } from '../constants';
import type { CopilotService } from '../services/CopilotService';
import type { ContextService } from '../services/ContextService';
import type { ChatMessage, CopilotPluginSettings, MessageRole } from '../types';

export class ChatView extends ItemView {
  private copilotService: CopilotService | null = null;
  private contextService: ContextService | null = null;
  private settings: CopilotPluginSettings | null = null;

  private messages: ChatMessage[] = [];
  private isStreaming = false;

  // DOM references
  private messagesContainer!: HTMLDivElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private streamingEl: HTMLDivElement | null = null;
  private errorEl: HTMLDivElement | null = null;
  private errorTimeout: ReturnType<typeof setTimeout> | null = null;
  private contextBarEl!: HTMLDivElement;
  private modelSelectEl!: HTMLSelectElement;

  // Persistence
  private saveData: ((data: unknown) => Promise<void>) | null = null;
  private loadDataFn: (() => Promise<unknown>) | null = null;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_COPILOT_CHAT;
  }

  getDisplayText(): string {
    return 'Copilot chat';
  }

  getIcon(): string {
    return 'message-square';
  }

  setCopilotService(service: CopilotService): void {
    this.copilotService = service;
    this.updateInitState();
  }

  setContextService(service: ContextService): void {
    this.contextService = service;
    this.updateInitState();
  }

  setSettings(settings: CopilotPluginSettings): void {
    this.settings = settings;
  }

  setDataHandlers(
    save: (data: unknown) => Promise<void>,
    load: () => Promise<unknown>,
  ): void {
    this.saveData = save;
    this.loadDataFn = load;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();

    const container = contentEl.createDiv({ cls: 'copilot-chat-container' });

    // Header
    const header = container.createDiv({ cls: 'copilot-chat-header' });
    header.createSpan({ cls: 'copilot-chat-title', text: 'Copilot Chat' });
    const newBtn = header.createEl('button', { cls: 'copilot-chat-new-btn' });
    setIcon(newBtn, 'plus');
    newBtn.addEventListener('click', () => { void this.newConversation(); });

    // Messages area
    this.messagesContainer = container.createDiv({ cls: 'copilot-chat-messages' });

    // Context bar
    this.contextBarEl = container.createDiv({ cls: 'copilot-chat-context-bar' });

    // Input area
    const inputArea = container.createDiv({ cls: 'copilot-chat-input-area' });
    const inputRow = inputArea.createDiv({ cls: 'copilot-chat-input-row' });
    this.inputEl = inputRow.createEl('textarea', {
      cls: 'copilot-chat-input',
      attr: { placeholder: 'Ask copilot...', rows: '1' },
    });
    this.sendBtn = inputRow.createEl('button', { cls: 'copilot-chat-send-btn' });
    setIcon(this.sendBtn, 'send');

    // Model selector at bottom
    const inputFooter = inputArea.createDiv({ cls: 'copilot-chat-input-footer' });
    this.modelSelectEl = inputFooter.createEl('select', { cls: 'copilot-chat-model-select' });
    this.modelSelectEl.addEventListener('change', () => {
      if (this.settings) {
        this.settings.defaultModel = this.modelSelectEl.value;
      }
    });

    // Wire events: Enter sends, Shift+Enter inserts newline
    this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.handleSend();
      }
    });
    // Auto-resize textarea as content grows
    this.inputEl.addEventListener('input', () => {
      this.inputEl.setCssProps({ '--input-height': 'auto' });
      this.inputEl.setCssProps({ '--input-height': Math.min(this.inputEl.scrollHeight, 150) + 'px' });
    });
    this.sendBtn.addEventListener('click', () => { void this.handleSend(); });

    this.updateContextBar();
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => this.updateContextBar()),
    );

    this.updateInitState();

    await this.loadMessages();
  }

  async onClose(): Promise<void> {
    this.messages = [];
    this.streamingEl = null;
    this.contentEl.empty();
  }

  // --- Core chat logic ---

  private async handleSend(): Promise<void> {
    if (this.isStreaming) return;

    const text = this.inputEl.value.trim();
    if (!text) return;

    if (!this.copilotService || !this.contextService || !this.settings) {
      this.showError('Copilot is not initialized yet. Please wait or check the settings for connection status.');
      return;
    }

    this.inputEl.value = '';
    this.inputEl.setCssProps({ '--input-height': 'auto' });
    this.clearError();

    // Build context and augment the prompt
    const context = await this.contextService.buildMessageContext(
      this.settings.autoAttachActiveFile,
      this.settings.autoAttachSelection,
    );
    const contextPrompt = this.contextService.buildContextPrompt(context);
    const fullPrompt = contextPrompt + text;

    // User message (display the raw user text, not context-augmented)
    const userMsg = this.appendMessage('user', text);
    if (context.activeFilePath) {
      userMsg.contextFiles = [context.activeFilePath];
    }
    this.saveMessages();

    // Prepare assistant streaming placeholder
    const assistantMsg = this.appendMessage('assistant', '');
    this.setStreaming(true);

    // Ensure a session exists
    if (!this.copilotService.hasActiveSession()) {
      try {
        // Lazily initialize the client if it hasn't connected yet
        if (!this.copilotService.isInitialized()) {
          await this.copilotService.initialize();
        }
        await this.copilotService.createSession(this.settings.defaultModel);
      } catch (err) {
        assistantMsg.content = `Error creating session: ${err instanceof Error ? err.message : String(err)}`;
        this.renderMessage(assistantMsg, true);
        this.setStreaming(false);
        return;
      }
    }

    try {
      await this.copilotService.sendMessage(
        fullPrompt,
        (delta) => this.handleStreamDelta(delta),
        (fullText) => this.handleStreamComplete(assistantMsg, fullText),
        (error) => {
          assistantMsg.content = `Error: ${error.message}`;
          this.renderMessage(assistantMsg, true);
          this.setStreaming(false);
        },
      );
    } catch (err) {
      assistantMsg.content = `Error: ${err instanceof Error ? err.message : String(err)}`;
      this.renderMessage(assistantMsg, true);
      this.setStreaming(false);
    }
  }

  private appendMessage(role: MessageRole, content: string): ChatMessage {
    const message: ChatMessage = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      role,
      content,
      timestamp: Date.now(),
    };
    this.messages.push(message);
    this.renderMessage(message);
    return message;
  }

  private renderMessage(message: ChatMessage, replace = false): void {
    const existing = replace
      ? this.messagesContainer.querySelector(`[data-msg-id="${message.id}"]`)
      : null;

    const msgEl = existing
      ? (existing as HTMLDivElement)
      : this.messagesContainer.createDiv({
          cls: `copilot-chat-message copilot-chat-message-${message.role}`,
          attr: { 'data-msg-id': message.id },
        });

    if (replace) msgEl.empty();

    if (message.role === 'user') {
      msgEl.createDiv({ cls: 'copilot-chat-message-content', text: message.content });
    } else {
      const contentDiv = msgEl.createDiv({ cls: 'copilot-chat-message-content' });
      if (message.content) {
        void MarkdownRenderer.render(this.app, message.content, contentDiv, '', this);
      }
      // Track the streaming element for delta appends
      if (!replace && !message.content) {
        this.streamingEl = contentDiv;
      }
    }

    this.scrollToBottom();
  }

  private handleStreamDelta(delta: string): void {
    if (!this.streamingEl) return;
    this.streamingEl.appendText(delta);
    this.scrollToBottom();
  }

  private handleStreamComplete(message: ChatMessage, fullText: string): void {
    message.content = fullText;
    this.streamingEl = null;
    this.renderMessage(message, true);
    this.setStreaming(false);
    this.saveMessages();
  }

  private async newConversation(): Promise<void> {
    this.messages = [];
    this.messagesContainer.empty();
    this.streamingEl = null;
    if (this.saveData) {
      await this.saveData({ messages: [] });
    }

    if (this.copilotService?.hasActiveSession()) {
      try {
        await this.copilotService.destroySession();
        if (this.settings) {
          await this.copilotService.createSession(this.settings.defaultModel);
        }
      } catch {
        // Session cleanup is best-effort
      }
    }
  }

  private scrollToBottom(): void {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  private setStreaming(streaming: boolean): void {
    this.isStreaming = streaming;
    this.inputEl.disabled = streaming;
    this.sendBtn.disabled = streaming;

    // Toggle typing indicator
    const existing = this.messagesContainer.querySelector('.copilot-chat-typing');
    if (streaming && !existing) {
      const indicator = this.messagesContainer.createDiv({ cls: 'copilot-chat-typing' });
      indicator.createSpan({ cls: 'copilot-chat-typing-dot' });
      indicator.createSpan({ cls: 'copilot-chat-typing-dot' });
      indicator.createSpan({ cls: 'copilot-chat-typing-dot' });
      this.scrollToBottom();
    } else if (!streaming && existing) {
      existing.remove();
    }
  }

  // --- Persistence ---

  private saveMessages(): void {
    if (!this.saveData) return;
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      const max = this.settings?.maxStoredMessages ?? 100;
      const trimmed = this.messages.length > max
        ? this.messages.slice(-max)
        : this.messages;
      void this.saveData?.({ messages: trimmed });
    }, 1000);
  }

  private async loadMessages(): Promise<void> {
    if (!this.loadDataFn) return;
    try {
      const data = await this.loadDataFn();
      if (
        data &&
        typeof data === 'object' &&
        'messages' in data &&
        Array.isArray((data as { messages: unknown }).messages)
      ) {
        this.messages = (data as { messages: ChatMessage[] }).messages;
        for (const msg of this.messages) {
          this.renderMessage(msg);
        }
      }
    } catch {
      // Malformed data — start with empty messages
    }
  }

  /** Sets the input text and triggers a send. Used by commands. */
  sendPrefilled(text: string): void {
    this.inputEl.value = text;
    void this.handleSend();
  }

  /** Displays an error message banner in the chat. Auto-removes after 10 seconds. */
  showError(message: string): void {
    this.clearError();

    this.errorEl = this.messagesContainer.createDiv({ cls: 'copilot-chat-error' });
    const iconSpan = this.errorEl.createSpan({ cls: 'copilot-chat-error-icon' });
    setIcon(iconSpan, 'alert-triangle');
    this.errorEl.createSpan({ cls: 'copilot-chat-error-text', text: message });

    this.errorTimeout = setTimeout(() => this.clearError(), 10_000);
  }

  /** Creates an Obsidian Notice with the given message. */
  showNotice(message: string): void {
    new Notice(message);
  }

  private clearError(): void {
    if (this.errorTimeout) {
      clearTimeout(this.errorTimeout);
      this.errorTimeout = null;
    }
    if (this.errorEl) {
      this.errorEl.remove();
      this.errorEl = null;
    }
  }

  /** Show an initializing message when services aren't yet wired up. */
  private updateInitState(): void {
    if (!this.messagesContainer) return;

    const initMsg = this.messagesContainer.querySelector('.copilot-chat-init');
    if (!this.copilotService || !this.contextService) {
      if (!initMsg) {
        this.messagesContainer.createDiv({
          cls: 'copilot-chat-init',
          text: 'Initializing...',
        });
      }
    } else {
      initMsg?.remove();
      void this.populateModels();
    }
  }

  private updateContextBar(): void {
    if (!this.contextBarEl) return;
    this.contextBarEl.empty();

    let hasContext = false;

    if (this.settings?.autoAttachActiveFile) {
      const file = this.app.workspace.getActiveFile();
      if (file) {
        this.contextBarEl.createSpan({ cls: 'copilot-context-pill', text: `📎 ${file.name}` });
        hasContext = true;
      }
    }

    if (this.settings?.autoAttachSelection) {
      const selection = this.app.workspace.activeEditor?.editor?.getSelection();
      if (selection) {
        this.contextBarEl.createSpan({ cls: 'copilot-context-pill', text: '✂️ Selection' });
        hasContext = true;
      }
    }

    if (!hasContext) {
      this.contextBarEl.createSpan({ cls: 'copilot-context-muted', text: 'No context attached' });
    }
  }

  private modelsPopulated = false;

  private async populateModels(): Promise<void> {
    if (!this.modelSelectEl) return;
    // Skip if already successfully populated with the full model list
    if (this.modelsPopulated) return;

    this.modelSelectEl.empty();

    const defaultModel = this.settings?.defaultModel ?? 'gpt-4o';

    if (this.copilotService && this.copilotService.isInitialized()) {
      try {
        const models = await this.copilotService.listModels();
        this.modelSelectEl.empty(); // clear again in case of concurrent call
        for (const model of models) {
          const opt = this.modelSelectEl.createEl('option', {
            value: model.id,
            text: model.name || model.id,
          });
          if (model.id === defaultModel) opt.selected = true;
        }
        this.modelsPopulated = true;
        return;
      } catch {
        // fall through to default
      }
    }
    // Fallback: show just the default model name
    if (this.modelSelectEl.options.length === 0) {
      this.modelSelectEl.createEl('option', { value: defaultModel, text: defaultModel });
    }
  }
}
