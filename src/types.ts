// Plugin settings
export interface CopilotPluginSettings {
	defaultModel: string;
	autoAttachActiveFile: boolean;
	autoAttachSelection: boolean;
	maxStoredMessages: number;
}

// Chat message types
export type MessageRole = "user" | "assistant";

export interface ChatMessage {
	id: string;
	role: MessageRole;
	content: string;
	timestamp: number;
	contextFiles?: string[]; // paths of files attached as context
}

// Conversation state managed by the chat view
export interface ConversationState {
	messages: ChatMessage[];
	isStreaming: boolean;
	activeModel: string;
}

// Context that can be attached to a message
export interface MessageContext {
	activeFilePath?: string;
	activeFileContent?: string;
	selectedText?: string;
}
