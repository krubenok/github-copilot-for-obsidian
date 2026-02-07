import { beforeEach, describe, expect, it } from 'bun:test';
import type { App } from 'obsidian';
import { ContextService } from '../services/ContextService';

const baseFile = {
  path: 'notes/idea.md',
  name: 'idea.md',
  extension: 'md',
};

type MockFile = typeof baseFile;

type ServiceOptions = {
  file?: MockFile | null;
  selection?: string | undefined;
  content?: string | null;
};

const createService = (options: ServiceOptions = {}) => {
  const { file = baseFile, selection, content = 'Hello from the vault.' } = options;
  const cachedReadCalls: MockFile[] = [];
  const getActiveFile = () => file ?? null;
  const cachedRead = async (activeFile: MockFile) => {
    cachedReadCalls.push(activeFile);
    return content ?? null;
  };
  const activeEditor = selection === undefined ? null : { editor: { getSelection: () => selection } };

  const app = {
    workspace: {
      getActiveFile,
      activeEditor,
    },
    vault: {
      cachedRead,
    },
  } as unknown as App;

  return {
    service: new ContextService(app),
    cachedReadCalls,
  };
};

describe('ContextService', () => {
  let service: ContextService;

  beforeEach(() => {
    service = createService().service;
  });

  it('returns the active file path when available', () => {
    expect(service.getActiveFilePath()).toBe(baseFile.path);
  });

  it('returns null when there is no active file', () => {
    const { service: nullService } = createService({ file: null });
    expect(nullService.getActiveFilePath()).toBeNull();
  });

  it('reads the active file content from the vault', async () => {
    const { service: contentService, cachedReadCalls } = createService({ content: 'Cached content.' });

    const content = await contentService.getActiveFileContent();
    expect(content).toBe('Cached content.');
    expect(cachedReadCalls).toHaveLength(1);
    expect(cachedReadCalls[0]).toBe(baseFile);
  });

  it('returns null for content when no active file exists', async () => {
    const { service: contentService, cachedReadCalls } = createService({ file: null });

    const content = await contentService.getActiveFileContent();
    expect(content).toBeNull();
    expect(cachedReadCalls).toHaveLength(0);
  });

  it('returns the editor selection when available', () => {
    const { service: selectionService } = createService({ selection: 'selected' });
    expect(selectionService.getEditorSelection()).toBe('selected');
  });

  it('returns null when the selection is empty or editor is missing', () => {
    const { service: emptySelectionService } = createService({ selection: '' });
    expect(emptySelectionService.getEditorSelection()).toBeNull();

    const { service: noEditorService } = createService({ selection: undefined });
    expect(noEditorService.getEditorSelection()).toBeNull();
  });

  it('returns active file metadata when available', () => {
    expect(service.getActiveFileMetadata()).toEqual({
      path: baseFile.path,
      name: baseFile.name,
      extension: baseFile.extension,
    });
  });

  it('returns null metadata when no file is active', () => {
    const { service: metadataService } = createService({ file: null });
    expect(metadataService.getActiveFileMetadata()).toBeNull();
  });

  describe('buildMessageContext', () => {
    it('includes active file content and selection when requested', async () => {
      const { service: contextService, cachedReadCalls } = createService({
        selection: 'Selected snippet',
        content: 'File body.',
      });

      const context = await contextService.buildMessageContext(true, true);
      expect(context).toEqual({
        activeFilePath: baseFile.path,
        activeFileContent: 'File body.',
        selectedText: 'Selected snippet',
      });
      expect(cachedReadCalls).toHaveLength(1);
    });

    it('skips file context when no active file exists', async () => {
      const { service: contextService, cachedReadCalls } = createService({
        file: null,
        selection: 'Selected snippet',
      });

      const context = await contextService.buildMessageContext(true, true);
      expect(context).toEqual({
        selectedText: 'Selected snippet',
      });
      expect(cachedReadCalls).toHaveLength(0);
    });

    it('omits empty selections from the context', async () => {
      const { service: contextService } = createService({ selection: '' });

      const context = await contextService.buildMessageContext(true, true);
      expect(context).toEqual({
        activeFilePath: baseFile.path,
        activeFileContent: 'Hello from the vault.',
      });
    });
  });

  describe('buildContextPrompt', () => {
    it('formats file context and selection into a prompt', () => {
      const prompt = service.buildContextPrompt({
        activeFilePath: baseFile.path,
        activeFileContent: 'File body.',
        selectedText: 'Selection text.',
      });

      expect(prompt).toMatchSnapshot();
    });

    it('returns an empty string when no context is provided', () => {
      expect(service.buildContextPrompt({})).toBe('');
    });
  });
});
