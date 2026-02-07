import type { CopilotPluginSettings } from "./types";

export const VIEW_TYPE_COPILOT_CHAT = "copilot-chat-view";

export const DEFAULT_SETTINGS: CopilotPluginSettings = {
	defaultModel: "gpt-4o",
	autoAttachActiveFile: true,
	autoAttachSelection: true,
	maxStoredMessages: 100,
};

export const PLUGIN_ID = "github-copilot-for-obsidian";
