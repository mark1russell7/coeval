/**
 * The probe of the playground. The site check of the Pages workflow starts it in a browser at each width, before the
 * deploy. A failed check stops the deploy.
 *
 * The probe drives the core of the site. A starting document and a text each change the result. A bad text keeps the
 * last good document. A card takes a new part, and the steps of the evaluation move.
 *
 * The site check reads this TypeScript file directly. It removes the types and the `export` line, and it starts the
 * result as the body of an async function.
 */

// The site check gives these helpers to the probe.
declare const check: (name: string, ok: unknown, detail?: unknown) => boolean;
declare const until: <T>(fn: () => T | Promise<T>, ms?: number) => Promise<T>;
declare const $: (selector: string) => Element | null;
declare const $$: (selector: string) => Element[];
declare const click: (target: string | Element) => void;

const PLAYGROUND = ".cv-playground";
const TEXT = `${PLAYGROUND} .cv-syntax-text`;
const PORT = `${PLAYGROUND} .cv-final .cv-port`;
const PROBLEM = `${PLAYGROUND} .cv-syntax-problem`;

/** This function gives the result of the document as a text. */
const result = (): string => $(PORT)?.getAttribute("title")?.replace("The result of this document: ", "") ?? "";
/** This function gives the text of the document. */
const text = (): string => ($(TEXT) as HTMLTextAreaElement | null)?.value ?? "";
/** This function gives the button of the playground with this text. */
const button = (label: string): Element | undefined => $$(`${PLAYGROUND} button`).find((b) => b.textContent?.trim() === label);
/** This function writes a text into the pane. React reads the value through the setter of the prototype. */
const write = (value: string): void => {
  const box = $(TEXT) as HTMLTextAreaElement;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, value);
  box.dispatchEvent(new Event("input", { bubbles: true }));
};
/** This function gives the input or the menu of the panel with this label. */
const field = (label: string): HTMLInputElement | HTMLSelectElement | undefined =>
  $$(`${PLAYGROUND} .cv-panel label.cv-field-edit`)
    .find((each) => each.querySelector("span")?.textContent?.trim() === label)
    ?.querySelector<HTMLInputElement | HTMLSelectElement>("input, select") ?? undefined;
/** This function sets the value of an input or a menu. React reads the value through the setter of the prototype. */
const set = (target: HTMLInputElement | HTMLSelectElement, value: string): void => {
  const prototype = target instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(target, value);
  target.dispatchEvent(new Event(target instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
};

check("the playground starts", await until(() => $(PLAYGROUND)?.closest("astro-island")?.hasAttribute("ssr") === false), $(PLAYGROUND)?.closest("astro-island")?.outerHTML.slice(0, 120));

// The first document is the one with names, and it has a result.
check("the playground has the starting documents", $$('[aria-label="Start from"] button').length === 8, $$('[aria-label="Start from"] button').length);
check("the playground draws the cards", $$(`${PLAYGROUND} .cv-card`).length >= 3, $$(`${PLAYGROUND} .cv-card`).length);
check("the first document has a result", result() === "30", result());

// A starting document gives another result and its text.
click(button("Arithmetic") as Element);
check("a starting document gives its result", await until(() => result() === "14"), result());
check("a starting document gives its text", text() === "2 + 3 * 4", text());

// A new text gives a new result.
write("5 * 5");
check("a text gives a new result", await until(() => result() === "25"), result());
check("a good text shows no problem", $(PROBLEM) === null);

// A bad text shows a problem, and the last good document stays.
write("5 *");
check("a bad text shows the problem", await until(() => $(PROBLEM) !== null), text());
check("a bad text keeps the last result", result() === "25", result());
write("3 + 4");
check("a good text removes the problem", await until(() => $(PROBLEM) === null && result() === "7"), result());

// A card takes a new part. The new part is an empty place (D151). It gets the kind `number` and the value 1.
click(button("Arithmetic") as Element);
await until(() => result() === "14");
click(`${PLAYGROUND} .cv-card[data-path="1"]`);
check("a card shows in the panel", await until(() => $(`${PLAYGROUND} .cv-card[data-path="1"]`)?.getAttribute("data-selected") === "true"), $(`${PLAYGROUND} .cv-panel-title`)?.textContent);
click(button("Select the parent") as Element);
check("the root card shows in the panel", await until(() => $(`${PLAYGROUND} .cv-card[data-path=""]`)?.getAttribute("data-selected") === "true"));
click(button("Add a part") as Element);
check("a new part is an empty place with an error", await until(() => $(PORT)?.getAttribute("data-ok") === "false"), result());
click(`${PLAYGROUND} .cv-card[data-path="2"]`);
check("the empty place shows in the panel", await until(() => field("Kind")?.value === ""), $(`${PLAYGROUND} .cv-panel-title`)?.textContent);
set(field("Kind") as HTMLSelectElement, "number");
check("the empty place takes a kind", await until(() => field("Value") !== undefined), $(`${PLAYGROUND} .cv-panel-title`)?.textContent);
set(field("Value") as HTMLInputElement, "1");
check("a new part changes the result", await until(() => result() === "15"), result());

// A missing name gives an error at the result, and not a broken page.
click(button("A missing name") as Element);
check("a missing name gives an error", await until(() => $(PORT)?.getAttribute("data-ok") === "false"), $(PORT)?.textContent);

// The steps of the evaluation move.
click(button("Arithmetic") as Element);
await until(() => result() === "14");
click(button("Step through it") as Element);
const events = (): string => $(`${PLAYGROUND} .cv-stepping .ce-bar-label`)?.textContent ?? "";
check("the steps start at the first event", await until(() => /^Event 0 of [1-9]/.test(events())), events());
click(`${PLAYGROUND} .cv-stepping .ce-btn[data-variant="primary"]`);
check("the button Next moves one event", await until(() => /^Event 1 of /.test(events())), events());

export {};
