import { Plugin } from "obsidian";
import { VIEW_TYPE_COPILOT_CHAT } from "../constants";
import type { ChatView } from "../views/ChatView";

/**
 * Activates the chat view in the right sidebar, creating it if needed.
 * Returns the ChatView instance.
 */
async function activateChatView(plugin: Plugin): Promise<ChatView | null> {
	const { workspace } = plugin.app;
	let leaf = workspace.getLeavesOfType(VIEW_TYPE_COPILOT_CHAT)[0];

	if (!leaf) {
		const rightLeaf = workspace.getRightLeaf(false);
		if (!rightLeaf) return null;
		leaf = rightLeaf;
		await leaf.setViewState({ type: VIEW_TYPE_COPILOT_CHAT, active: true });
	}

	await workspace.revealLeaf(leaf);
	return leaf.view as ChatView;
}

export function registerCommands(plugin: Plugin): void {
	// Open Copilot Chat
	plugin.addCommand({
		id: "open-copilot-chat",
		name: "Open copilot chat",
		callback: async () => {
			await activateChatView(plugin);
		},
	});

	// Send selection to chat
	plugin.addCommand({
		id: "send-selection-to-chat",
		name: "Send selection to copilot chat",
		editorCallback: async (editor) => {
			const selection = editor.getSelection();
			if (!selection) return;

			const chatView = await activateChatView(plugin);
			if (chatView && "sendPrefilled" in chatView) {
				chatView.sendPrefilled(
					`Regarding this text:\n\`\`\`\n${selection}\n\`\`\`\n\nPlease explain this.`,
				);
			}
		},
	});

	// Summarize active note
	plugin.addCommand({
		id: "summarize-note",
		name: "Summarize active note with copilot",
		checkCallback: (checking) => {
			const activeFile = plugin.app.workspace.getActiveFile();
			if (!activeFile) return false;
			if (checking) return true;

			void activateChatView(plugin).then((chatView) => {
				if (chatView && "sendPrefilled" in chatView) {
					chatView.sendPrefilled("Please summarize this note concisely.");
				}
			});
			return true;
		},
	});

	// Explain selection
	plugin.addCommand({
		id: "explain-selection",
		name: "Explain selection with copilot",
		editorCallback: async (editor) => {
			const selection = editor.getSelection();
			if (!selection) return;

			const chatView = await activateChatView(plugin);
			if (chatView && "sendPrefilled" in chatView) {
				chatView.sendPrefilled(
					`Please explain the following:\n\`\`\`\n${selection}\n\`\`\``,
				);
			}
		},
	});
}
