import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { App, Plugin, WorkspaceLeaf } from "obsidian";
import { CopilotService } from "../services/CopilotService";
import { ContextService } from "../services/ContextService";
import { resetDom, setupDom } from "../test-utils/dom";
import { MockApp, MockWorkspaceLeaf, registerObsidianMock } from "../test-utils/obsidian";
import type { ChatMessage, CopilotPluginSettings } from "../types";

let ChatView: typeof import("../views/ChatView").ChatView;
let registerCommands: typeof import("../commands").registerCommands;

const baseSettings: CopilotPluginSettings = {
	defaultModel: "gpt-4o",
	autoAttachActiveFile: false,
	autoAttachSelection: false,
	maxStoredMessages: 100,
};

beforeAll(async () => {
	registerObsidianMock();
	({ ChatView } = await import("../views/ChatView"));
	({ registerCommands } = await import("../commands"));
});

describe.serial("ChatView", () => {
	beforeEach(() => {
		setupDom();
	});

	afterEach(() => {
		resetDom();
	});

	const createChatView = (overrides: Partial<CopilotPluginSettings> = {}) => {
		const app = new MockApp();
		const leaf = new MockWorkspaceLeaf(app);
		const view = new ChatView(leaf as unknown as WorkspaceLeaf);
		const contextService = new ContextService(app as unknown as App);
		const copilotService = new CopilotService("/plugin");
		view.setSettings({ ...baseSettings, ...overrides });
		view.setContextService(contextService);
		view.setCopilotService(copilotService);
		return { app, leaf, view };
	};

	it("renders messages in the chat log", async () => {
		const { view } = createChatView();
		await view.onOpen();

		const originalDateNow = Date.now;
		const originalRandom = Math.random;
		const randomValues = [0.123456, 0.654321];
		Date.now = () => 1_700_000_000_000;
		Math.random = () => randomValues.shift() ?? 0.5;

		const appendMessage = (
			view as unknown as {
				appendMessage: (role: "user" | "assistant", content: string) => ChatMessage;
			}
		).appendMessage.bind(view);

		appendMessage("user", "Hello there");
		appendMessage("assistant", "Hi from Copilot");

		Date.now = originalDateNow;
		Math.random = originalRandom;

		const container = (view as unknown as { messagesContainer: HTMLDivElement })
			.messagesContainer;
		expect(container.querySelectorAll(".copilot-chat-message")).toHaveLength(2);
		expect(container.innerHTML).toMatchSnapshot();
	});

	it("streams assistant responses and finalizes content", async () => {
		const { view } = createChatView();
		await view.onOpen();

		const appendMessage = (
			view as unknown as {
				appendMessage: (role: "user" | "assistant", content: string) => ChatMessage;
			}
		).appendMessage.bind(view);
		const setStreaming = (
			view as unknown as { setStreaming: (streaming: boolean) => void }
		).setStreaming.bind(view);
		const handleStreamDelta = (
			view as unknown as { handleStreamDelta: (delta: string) => void }
		).handleStreamDelta.bind(view);
		const handleStreamComplete = (
			view as unknown as {
				handleStreamComplete: (message: ChatMessage, fullText: string) => void;
			}
		).handleStreamComplete.bind(view);

		setStreaming(true);
		const assistantMsg = appendMessage("assistant", "");

		const container = (view as unknown as { messagesContainer: HTMLDivElement })
			.messagesContainer;
		const contentEl = container.querySelector(
			".copilot-chat-message-assistant .copilot-chat-message-content",
		) as HTMLDivElement;
		expect(contentEl.textContent).toBe("");

		handleStreamDelta("Streaming");
		expect(contentEl.textContent).toBe("Streaming");

		handleStreamComplete(assistantMsg, "Streaming complete");
		const updated = container.querySelector(
			".copilot-chat-message-assistant .copilot-chat-message-content",
		) as HTMLDivElement;
		expect(updated.textContent).toBe("Streaming complete");
		expect(container.querySelector(".copilot-chat-typing")).toBeNull();
	});

	it("loads and persists message history", async () => {
		const savedMessages: ChatMessage[] = [
			{ id: "1", role: "user", content: "Saved user", timestamp: 1 },
			{ id: "2", role: "assistant", content: "Saved assistant", timestamp: 2 },
		];
		let latestPayload: { messages: ChatMessage[] } | null = null;
		const saveSpy = mock(async (payload: unknown) => {
			latestPayload = payload as { messages: ChatMessage[] };
		});
		const loadSpy = mock(async () => ({ messages: savedMessages }));

		const { view } = createChatView({ maxStoredMessages: 1 });
		view.setDataHandlers(saveSpy, loadSpy);
		await view.onOpen();

		const container = (view as unknown as { messagesContainer: HTMLDivElement })
			.messagesContainer;
		expect(container.querySelectorAll(".copilot-chat-message")).toHaveLength(2);
		expect(container.textContent).toContain("Saved assistant");

		const appendMessage = (
			view as unknown as {
				appendMessage: (role: "user" | "assistant", content: string) => ChatMessage;
			}
		).appendMessage.bind(view);
		const saveMessages = (view as unknown as { saveMessages: () => void }).saveMessages.bind(
			view,
		);

		appendMessage("user", "Newest user");
		appendMessage("assistant", "Newest assistant");
		saveMessages();

		await new Promise((resolve) => setTimeout(resolve, 1100));

		if (!latestPayload) {
			throw new Error("Expected a saved message payload.");
		}
		const savedPayload = latestPayload as { messages: ChatMessage[] };
		expect(savedPayload.messages).toHaveLength(1);
		expect(savedPayload.messages[0]?.content).toBe("Newest assistant");
	});
});

describe.concurrent("registerCommands", () => {
	const buildPlugin = (options?: {
		activeFile?: { path: string; name: string; extension: string } | null;
	}) => {
		const commands: Array<{
			id: string;
			name: string;
			callback?: () => Promise<void> | void;
			editorCallback?: (editor: { getSelection: () => string }) => Promise<void> | void;
			checkCallback?: (checking: boolean) => boolean;
		}> = [];
		const sendPrefilled = mock(() => {});
		const leaf = {
			view: { sendPrefilled },
			setViewState: mock(async () => {}),
		};
		const workspace = {
			getLeavesOfType: mock(() => [leaf]),
			getRightLeaf: mock((_create?: boolean) => leaf),
			revealLeaf: mock(async () => {}),
			getActiveFile: mock(() => options?.activeFile ?? null),
		};
		const app = { workspace };
		const plugin = {
			app,
			addCommand: (command: (typeof commands)[number]) => commands.push(command),
		};
		return { plugin, commands, leaf, workspace, sendPrefilled };
	};

	it("registers the copilot command set", () => {
		const { plugin, commands } = buildPlugin();
		registerCommands(plugin as unknown as Plugin);
		expect(commands.map((command) => ({ id: command.id, name: command.name }))).toEqual([
			{ id: "open-copilot-chat", name: "Open copilot chat" },
			{ id: "send-selection-to-chat", name: "Send selection to copilot chat" },
			{ id: "summarize-note", name: "Summarize active note with copilot" },
			{ id: "explain-selection", name: "Explain selection with copilot" },
		]);
	});

	it("opens the chat view when requested", async () => {
		const { plugin, commands, workspace } = buildPlugin();
		registerCommands(plugin as unknown as Plugin);

		const command = commands.find((entry) => entry.id === "open-copilot-chat");
		await command?.callback?.();

		expect(workspace.revealLeaf).toHaveBeenCalled();
	});

	it("sends selection commands into the chat view", async () => {
		const { plugin, commands, sendPrefilled } = buildPlugin();
		registerCommands(plugin as unknown as Plugin);

		const editor = { getSelection: () => "const answer = 42;" };

		const sendSelection = commands.find((entry) => entry.id === "send-selection-to-chat");
		await sendSelection?.editorCallback?.(editor);

		const explainSelection = commands.find((entry) => entry.id === "explain-selection");
		await explainSelection?.editorCallback?.(editor);

		expect(sendPrefilled).toHaveBeenCalledWith(expect.stringContaining("const answer = 42;"));
		expect(sendPrefilled).toHaveBeenCalledWith(
			expect.stringContaining("Please explain the following"),
		);
	});

	it("summarizes active notes via the chat view", async () => {
		const { plugin, commands, sendPrefilled } = buildPlugin({
			activeFile: { path: "notes/todo.md", name: "todo.md", extension: "md" },
		});
		registerCommands(plugin as unknown as Plugin);

		const command = commands.find((entry) => entry.id === "summarize-note");
		expect(command?.checkCallback?.(true)).toBe(true);
		expect(command?.checkCallback?.(false)).toBe(true);

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(sendPrefilled).toHaveBeenCalledWith("Please summarize this note concisely.");
	});
});
