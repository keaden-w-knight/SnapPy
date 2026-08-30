import * as Blockly from 'blockly/core';

/**
 * In-app replacements for Blockly's dialogs.
 *
 * Blockly defaults to `window.alert`/`confirm`/`prompt`. WebView2 -- which is
 * what the Tauri desktop build renders in -- does not implement `window.prompt`
 * at all, so "Rename variable..." silently did nothing there: the menu item
 * fired, the prompt never appeared, and the callback received nothing.
 *
 * These also avoid the browser's own modal styling, which looks nothing like
 * the rest of the app, and let Enter/Escape behave as expected.
 */

export interface Choice {
  label: string;
  value: string;
}

interface Options {
  message: string;
  defaultValue?: string;
  okLabel?: string;
  showCancel: boolean;
  showInput: boolean;
  /** Radio buttons shown under the text input, if any. */
  choices?: Choice[];
  defaultChoice?: string;
  /** null means cancelled; a string is the entered text; true/false for confirm. */
  onClose(result: string | null, choice: string | null): void;
}

let host: HTMLDivElement | null = null;
let afterClose: (() => void) | null = null;

function open(options: Options) {
  close();

  host = document.createElement('div');
  host.className = 'snappy-dialog-backdrop';
  host.innerHTML = `
    <div class="snappy-dialog" role="dialog" aria-modal="true">
      <p class="snappy-dialog-message"></p>
      ${options.showInput ? '<input class="snappy-dialog-input" type="text" />' : ''}
      <div class="snappy-dialog-choices"></div>
      <div class="snappy-dialog-buttons">
        ${options.showCancel ? '<button class="btn-ghost" data-act="cancel">Cancel</button>' : ''}
        <button class="btn btn-run" data-act="ok"></button>
      </div>
    </div>`;

  // textContent, not innerHTML: the message can contain a user-chosen name.
  host.querySelector('.snappy-dialog-message')!.textContent = options.message;
  host.querySelector<HTMLButtonElement>('[data-act="ok"]')!.textContent = options.okLabel ?? 'OK';

  const input = host.querySelector<HTMLInputElement>('.snappy-dialog-input');
  if (input) input.value = options.defaultValue ?? '';

  const choiceHost = host.querySelector<HTMLDivElement>('.snappy-dialog-choices')!;
  for (const choice of options.choices ?? []) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'snappy-dialog-choice';
    radio.value = choice.value;
    radio.checked = choice.value === (options.defaultChoice ?? options.choices?.[0]?.value);
    label.append(radio, document.createTextNode(` ${choice.label}`));
    choiceHost.append(label);
  }
  choiceHost.hidden = !options.choices?.length;

  const chosen = () =>
    choiceHost.querySelector<HTMLInputElement>('input:checked')?.value ?? null;

  const finish = (result: string | null) => {
    const choice = result === null ? null : chosen();
    close();
    options.onClose(result, choice);
    // Renaming a variable happens inside that callback, and Blockly batches the
    // resulting change event behind requestAnimationFrame. Nudging the app on
    // the next tick means the code pane reflects the rename immediately rather
    // than whenever the next frame happens to arrive.
    if (afterClose) setTimeout(afterClose, 0);
  };

  host.addEventListener('click', (event) => {
    const act = (event.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
    if (act === 'ok') finish(input ? input.value : '');
    else if (act === 'cancel') finish(null);
  });

  host.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(input ? input.value : '');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(null);
    }
  });

  document.body.append(host);
  (input ?? host.querySelector<HTMLButtonElement>('[data-act="ok"]'))?.focus();
  input?.select();
}

function close() {
  host?.remove();
  host = null;
}

/**
 * Replaces Blockly's window.* dialogs. Call once, before the workspace is used.
 *
 * @param onClosed run after any dialog resolves, so the app can pick up whatever
 *   the dialog caused -- a variable rename, most of all.
 */
export function installDialogs({ onClosed }: { onClosed?: () => void } = {}) {
  afterClose = onClosed ?? null;

  Blockly.dialog.setPrompt((message, defaultValue, callback) => {
    open({
      message,
      defaultValue,
      showInput: true,
      showCancel: true,
      onClose: (result) => callback(result),
    });
  });

  Blockly.dialog.setAlert((message, callback) => {
    open({
      message,
      showInput: false,
      showCancel: false,
      onClose: () => callback?.(),
    });
  });

  Blockly.dialog.setConfirm((message, callback) => {
    open({
      message,
      okLabel: 'Yes',
      showInput: false,
      showCancel: true,
      onClose: (result) => callback(result !== null),
    });
  });
}

/**
 * A name plus a choice of kind, used by the function block's "add input" button.
 * Kept here so every modal in the app looks and behaves the same.
 */
export function askForChoice(options: {
  message: string;
  defaultValue: string;
  choices: Choice[];
  defaultChoice?: string;
  onDone(result: { text: string; choice: string } | null): void;
}) {
  open({
    message: options.message,
    defaultValue: options.defaultValue,
    choices: options.choices,
    defaultChoice: options.defaultChoice,
    showInput: true,
    showCancel: true,
    onClose: (text, choice) => {
      options.onDone(text === null ? null : { text, choice: choice ?? options.choices[0].value });
    },
  });
}
