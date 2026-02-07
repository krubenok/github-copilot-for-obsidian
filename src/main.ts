import { Notice, Plugin } from "obsidian";
import { join } from "path";
import { DEFAULT_SETTINGS, VIEW_TYPE_COPILOT_CHAT } from "./constants";
import { registerCommands } from "./commands";
import { CopilotService } from "./services/CopilotService";
import { ContextService } from "./services/ContextService";
import { CopilotSettingTab } from "./settings";
import { ChatView } from "./views/ChatView";
import type { CopilotPluginSettings } from "./types";

export default class CopilotPlugin extends Plugin {
	settings!: CopilotPluginSettings;
	private copilotService!: CopilotService;
	private contextService!: ContextService;

	async onload() {
		await this.loadSettings();

		// Resolve the plugin's filesystem directory for locating node_modules
		const adapter = this.app.vault.adapter;
		const vaultBasePath =
			"getBasePath" in adapter ? (adapter as { getBasePath(): string }).getBasePath() : "";
		const pluginDir = join(vaultBasePath, this.manifest.dir ?? "");
		this.copilotService = new CopilotService(pluginDir);
		this.contextService = new ContextService(this.app);

		// Register the chat sidebar view
		this.registerView(VIEW_TYPE_COPILOT_CHAT, (leaf) => {
			const view = new ChatView(leaf);
			view.setCopilotService(this.copilotService);
			view.setContextService(this.contextService);
			view.setSettings(this.settings);
			view.setDataHandlers(
				(data) => this.saveData(data),
				() => this.loadData(),
			);
			return view;
		});

		// Ribbon icon to open chat
		this.addRibbonIcon("message-square", "Open copilot chat", () => {
			void this.activateChatView();
		});

		// Register commands
		registerCommands(this);

		// Settings tab
		this.addSettingTab(new CopilotSettingTab(this.app, this));

		// Initialize the Copilot client after layout is ready
		this.app.workspace.onLayoutReady(async () => {
			try {
				await this.copilotService.initialize();
			} catch (err) {
				new Notice(`Copilot: ${err instanceof Error ? err.message : String(err)}`, 10_000);
			}
			// Update any already-open chat views with the initialized service
			this.refreshChatViews();
		});
	}

	onunload() {
		void this.copilotService.destroy().catch(() => {
			// Best-effort cleanup
		});
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<CopilotPluginSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	getCopilotService(): CopilotService | null {
		return this.copilotService;
	}

	private async activateChatView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_COPILOT_CHAT)[0];

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (!rightLeaf) return;
			leaf = rightLeaf;
			await leaf.setViewState({ type: VIEW_TYPE_COPILOT_CHAT, active: true });
		}

		await workspace.revealLeaf(leaf);
	}

	/** Push service references to any open chat view leaves. */
	private refreshChatViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_COPILOT_CHAT)) {
			const view = leaf.view;
			if (view instanceof ChatView) {
				view.setCopilotService(this.copilotService);
				view.setContextService(this.contextService);
				view.setSettings(this.settings);
			}
		}
	}
}
