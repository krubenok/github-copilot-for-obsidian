import { describe, expect, it } from "bun:test";
import { setupDom } from "../test-utils/dom";
import { MockApp, registerObsidianMock } from "../test-utils/obsidian";

describe("test scaffold", () => {
	it("initializes DOM helpers and Obsidian mocks", () => {
		setupDom();
		registerObsidianMock();

		const host = document.createElement("div");
		host.createDiv({ cls: "greeting", text: "hello" });
		expect(host.querySelector(".greeting")?.textContent).toBe("hello");

		const app = new MockApp();
		expect(app.workspace.getLeavesOfType()).toEqual([]);
	});
});
