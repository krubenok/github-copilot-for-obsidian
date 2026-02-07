import { mock } from "bun:test";

export class MockWorkspaceLeaf {
	app: MockApp;
	view: MockItemView | null = null;

	constructor(app: MockApp) {
		this.app = app;
	}

	async setViewState(): Promise<void> {
		return;
	}
}

export class MockWorkspace {
	app: MockApp;
	private leaves: MockWorkspaceLeaf[] = [];

	constructor(app: MockApp) {
		this.app = app;
	}

	on(): () => void {
		return () => {};
	}

	onLayoutReady(callback: () => void): void {
		callback();
	}

	getLeavesOfType(): MockWorkspaceLeaf[] {
		return this.leaves;
	}

	getRightLeaf(): MockWorkspaceLeaf {
		const leaf = new MockWorkspaceLeaf(this.app);
		this.leaves.push(leaf);
		return leaf;
	}

	async revealLeaf(): Promise<void> {
		return;
	}
}

export class MockVaultAdapter {
	getBasePath(): string {
		return "";
	}
}

export class MockVault {
	adapter = new MockVaultAdapter();
}

export class MockApp {
	workspace: MockWorkspace;
	vault: MockVault;

	constructor() {
		this.workspace = new MockWorkspace(this);
		this.vault = new MockVault();
	}
}

export class MockNotice {
	message: string;
	timeout: number | undefined;

	constructor(message: string, timeout?: number) {
		this.message = message;
		this.timeout = timeout;
	}
}

export class MockItemView {
	app: MockApp;
	leaf: MockWorkspaceLeaf;
	contentEl: HTMLDivElement;

	constructor(leaf: MockWorkspaceLeaf) {
		this.leaf = leaf;
		this.app = leaf.app;
		this.contentEl = document.createElement("div");
	}

	registerEvent(): void {}
}

export class MockPlugin {
	app: MockApp;
	manifest: { dir?: string } = {};

	constructor(app = new MockApp()) {
		this.app = app;
	}

	registerView(): void {}
	addRibbonIcon(): void {}
	registerEvent(): void {}
	addSettingTab(): void {}

	async loadData(): Promise<Record<string, unknown>> {
		return {};
	}

	async saveData(): Promise<void> {
		return;
	}
}

export class MockPluginSettingTab {
	app: MockApp;
	plugin: MockPlugin;
	containerEl: HTMLDivElement;

	constructor(app: MockApp, plugin: MockPlugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = document.createElement("div");
	}

	display(): void {}
}

export class MockSetting {
	constructor(_containerEl: HTMLElement) {}

	setName(): this {
		return this;
	}

	setHeading(): this {
		return this;
	}

	setDesc(): this {
		return this;
	}

	addText(
		callback: (text: {
			setValue: (value: string) => unknown;
			onChange: (cb: () => void) => unknown;
		}) => void,
	): this {
		const component = {
			setValue: () => component,
			onChange: () => component,
		};
		callback(component);
		return this;
	}

	addToggle(
		callback: (toggle: {
			setValue: (value: boolean) => unknown;
			onChange: (cb: () => void) => unknown;
		}) => void,
	): this {
		const component = {
			setValue: () => component,
			onChange: () => component,
		};
		callback(component);
		return this;
	}

	addSlider(
		callback: (slider: {
			setLimits: (min: number, max: number, step: number) => unknown;
			setValue: (value: number) => unknown;
			setDynamicTooltip: () => unknown;
			onChange: (cb: () => void) => unknown;
		}) => void,
	): this {
		const component = {
			setLimits: () => component,
			setValue: () => component,
			setDynamicTooltip: () => component,
			onChange: () => component,
		};
		callback(component);
		return this;
	}

	addButton(
		callback: (button: {
			setButtonText: (value: string) => unknown;
			onClick: (cb: () => void) => unknown;
			setDisabled: (value: boolean) => unknown;
		}) => void,
	): this {
		const component = {
			setButtonText: () => component,
			onClick: () => component,
			setDisabled: () => component,
		};
		callback(component);
		return this;
	}
}

let mockRegistered = false;

export const registerObsidianMock = (): void => {
	if (mockRegistered) return;
	mockRegistered = true;
	void mock.module("obsidian", () => ({
		App: MockApp,
		Plugin: MockPlugin,
		PluginSettingTab: MockPluginSettingTab,
		Setting: MockSetting,
		ItemView: MockItemView,
		WorkspaceLeaf: MockWorkspaceLeaf,
		MarkdownRenderer: {
			render: async (_app: MockApp, markdown: string, el: HTMLElement) => {
				el.textContent = markdown;
			},
		},
		Notice: MockNotice,
		setIcon: () => {},
	}));
};
