import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { CopilotPluginSettings } from "./types";
import type { CopilotService } from "./services/CopilotService";

type CopilotPlugin = Plugin & {
	settings: CopilotPluginSettings;
	saveSettings(): Promise<void>;
	getCopilotService?(): CopilotService | null;
};

export class CopilotSettingTab extends PluginSettingTab {
	plugin: CopilotPlugin;

	constructor(app: App, plugin: CopilotPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("GitHub copilot").setHeading();

		// Connection status section
		if (this.plugin.getCopilotService) {
			const service = this.plugin.getCopilotService();
			const statusContainer = containerEl.createDiv({ cls: "copilot-connection-status" });

			new Setting(containerEl).setName("Connection status").setHeading();

			const statusSetting = new Setting(statusContainer);
			if (service) {
				const status = service.getConnectionStatus();
				if (status.connected) {
					statusSetting.setName("🟢 connected").setDesc("Copilot client is running");
				} else {
					statusSetting
						.setName("🔴 not connected")
						.setDesc(status.error ?? "Unknown error");
				}
				statusSetting.addButton((btn) =>
					btn.setButtonText("Reconnect").onClick(async () => {
						btn.setButtonText("Reconnecting...");
						btn.setDisabled(true);
						try {
							await service.destroy();
						} catch {
							// destroy is best-effort
						}
						try {
							await service.initialize();
						} catch {
							// display will show updated status
						}
						this.display();
					}),
				);
			} else {
				statusSetting
					.setName("🔴 not connected")
					.setDesc("Copilot service is not available");
			}
		}

		new Setting(containerEl)
			.setName("Default model")
			.setDesc("The model to use by default")
			.addText((text) =>
				text.setValue(this.plugin.settings.defaultModel).onChange(async (value) => {
					this.plugin.settings.defaultModel = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Context").setHeading();

		new Setting(containerEl)
			.setName("Auto-attach active file")
			.setDesc("Automatically include the active file content as context")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoAttachActiveFile)
					.onChange(async (value) => {
						this.plugin.settings.autoAttachActiveFile = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-attach selection")
			.setDesc("Automatically include editor selection as context")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoAttachSelection)
					.onChange(async (value) => {
						this.plugin.settings.autoAttachSelection = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Max stored messages")
			.setDesc("Maximum number of messages to persist")
			.addSlider((slider) =>
				slider
					.setLimits(10, 500, 10)
					.setValue(this.plugin.settings.maxStoredMessages)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxStoredMessages = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
