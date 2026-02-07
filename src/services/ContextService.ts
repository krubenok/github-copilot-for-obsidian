import { App } from 'obsidian';
import type { MessageContext } from '../types';

export class ContextService {
  constructor(private app: App) {}

  getActiveFilePath(): string | null {
    return this.app.workspace.getActiveFile()?.path ?? null;
  }

  async getActiveFileContent(): Promise<string | null> {
    const file = this.app.workspace.getActiveFile();
    if (!file) return null;
    return this.app.vault.cachedRead(file);
  }

  getEditorSelection(): string | null {
    const selection = this.app.workspace.activeEditor?.editor?.getSelection();
    return selection || null;
  }

  getActiveFileMetadata(): { path: string; name: string; extension: string } | null {
    const file = this.app.workspace.getActiveFile();
    if (!file) return null;
    return { path: file.path, name: file.name, extension: file.extension };
  }

  async buildMessageContext(
    includeFile: boolean,
    includeSelection: boolean,
  ): Promise<MessageContext> {
    const context: MessageContext = {};

    if (includeFile) {
      const path = this.getActiveFilePath();
      if (path) {
        context.activeFilePath = path;
        context.activeFileContent = (await this.getActiveFileContent()) ?? undefined;
      }
    }

    if (includeSelection) {
      const selection = this.getEditorSelection();
      if (selection) {
        context.selectedText = selection;
      }
    }

    return context;
  }

  buildContextPrompt(context: MessageContext): string {
    const parts: string[] = [];

    if (context.activeFilePath && context.activeFileContent) {
      parts.push(`Active file: ${context.activeFilePath}\n\`\`\`\n${context.activeFileContent}\n\`\`\``);
    }

    if (context.selectedText) {
      parts.push(`Selected text:\n\`\`\`\n${context.selectedText}\n\`\`\``);
    }

    return parts.length > 0 ? parts.join('\n\n') + '\n\n' : '';
  }
}
