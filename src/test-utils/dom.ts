import { Window } from 'happy-dom';

type CreateElOptions = {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
};

let domWindow: Window | null = null;

const applyCreateOptions = (el: HTMLElement, options?: CreateElOptions): void => {
  if (!options) return;
  if (options.cls) el.className = options.cls;
  if (options.text !== undefined) el.textContent = options.text;
  if (options.attr) {
    for (const [key, value] of Object.entries(options.attr)) {
      el.setAttribute(key, value);
    }
  }
};

const ensureObsidianDomHelpers = (): void => {
  const proto = globalThis.HTMLElement?.prototype as unknown as Record<string, unknown> | undefined;
  if (!proto) return;
  let createEl = proto.createEl as ((tag: string, options?: CreateElOptions) => HTMLElement) | undefined;
  if (typeof createEl !== 'function') {
    createEl = function createElFn(this: HTMLElement, tag: string, options?: CreateElOptions): HTMLElement {
      const element = (this.ownerDocument ?? document).createElement(tag);
      applyCreateOptions(element, options);
      this.appendChild(element);
      return element;
    };
    proto.createEl = createEl as unknown;
  }
  if (typeof proto.createDiv !== 'function') {
    proto.createDiv = function createDiv(this: HTMLElement, options?: CreateElOptions): HTMLDivElement {
      return createEl?.call(this, 'div', options) as HTMLDivElement;
    };
  }
  if (typeof proto.createSpan !== 'function') {
    proto.createSpan = function createSpan(this: HTMLElement, options?: CreateElOptions): HTMLSpanElement {
      return createEl?.call(this, 'span', options) as HTMLSpanElement;
    };
  }
  if (typeof proto.empty !== 'function') {
    proto.empty = function empty(this: HTMLElement): void {
      while (this.firstChild) {
        this.removeChild(this.firstChild);
      }
    };
  }
  if (typeof proto.setCssProps !== 'function') {
    proto.setCssProps = function setCssProps(this: HTMLElement, props: Record<string, string>): void {
      for (const [key, value] of Object.entries(props)) {
        this.style.setProperty(key, value);
      }
    };
  }
  if (typeof proto.appendText !== 'function') {
    proto.appendText = function appendText(this: HTMLElement, text: string): Text {
      const node = (this.ownerDocument ?? document).createTextNode(text);
      this.appendChild(node);
      return node;
    };
  }
};

export const setupDom = (): Window => {
  if (globalThis.window && globalThis.document) {
    ensureObsidianDomHelpers();
    return globalThis.window as unknown as Window;
  }

  domWindow = new Window();
  const globals = globalThis as unknown as Record<string, unknown>;

  globals.window = domWindow as unknown as Window;
  globals.document = domWindow.document as unknown as Document;
  globals.HTMLElement = domWindow.HTMLElement as unknown as typeof HTMLElement;
  globals.Node = domWindow.Node as unknown as typeof Node;
  globals.Event = domWindow.Event as unknown as typeof Event;
  globals.KeyboardEvent = domWindow.KeyboardEvent as unknown as typeof KeyboardEvent;
  globals.MouseEvent = domWindow.MouseEvent as unknown as typeof MouseEvent;
  globals.navigator = domWindow.navigator as unknown as Navigator;

  ensureObsidianDomHelpers();
  return domWindow;
};

export const resetDom = (): void => {
  if (!domWindow) return;
  domWindow.close();
  domWindow = null;
  const globals = globalThis as unknown as Record<string, unknown>;
  delete globals.window;
  delete globals.document;
  delete globals.HTMLElement;
  delete globals.Node;
  delete globals.Event;
  delete globals.KeyboardEvent;
  delete globals.MouseEvent;
  delete globals.navigator;
};
