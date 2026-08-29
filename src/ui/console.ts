/**
 * A minimal terminal. Output is appended as spans so stderr can be coloured
 * without re-rendering, and the input row is a real <input> that only appears
 * while Python is parked inside input().
 */
export class ConsolePane {
  private output: HTMLElement;
  private inputRow: HTMLElement;
  private field: HTMLInputElement;
  private onSubmit: ((line: string) => void) | null = null;
  private persistent = false;

  constructor(private root: HTMLElement) {
    this.root.innerHTML = `
      <div class="console-output" role="log" aria-live="polite"></div>
      <form class="console-input" hidden>
        <span class="console-caret" aria-hidden="true">&gt;</span>
        <input type="text" autocomplete="off" spellcheck="false" aria-label="Program input" />
      </form>`;
    this.output = this.root.querySelector('.console-output')!;
    this.inputRow = this.root.querySelector('.console-input')!;
    this.field = this.root.querySelector('input')!;

    this.inputRow.addEventListener('submit', (event) => {
      event.preventDefault();
      const line = this.field.value;
      this.field.value = '';
      const submit = this.onSubmit;
      // A pipe-backed process may read many times and never tells us when, so
      // the row stays open; Pyodide asks again explicitly for each read.
      if (!this.persistent) this.hideInput();
      this.write(`${line}\n`, 'stdin');
      submit?.(line);
    });
  }

  write(text: string, stream: 'stdout' | 'stderr' | 'stdin' = 'stdout') {
    const atBottom =
      this.output.scrollHeight - this.output.scrollTop - this.output.clientHeight < 40;
    const span = document.createElement('span');
    span.className = `s-${stream}`;
    span.textContent = text;
    this.output.append(span);
    if (atBottom) this.output.scrollTop = this.output.scrollHeight;
  }

  clear() {
    this.output.replaceChildren();
  }

  requestInput(onSubmit: (line: string) => void, options: { persistent?: boolean } = {}) {
    this.onSubmit = onSubmit;
    this.persistent = options.persistent ?? false;
    const wasHidden = this.inputRow.hidden;
    this.inputRow.hidden = false;
    // Only steal focus when the row first appears, so a persistent row does not
    // yank the caret away while someone is dragging blocks.
    if (wasHidden) this.field.focus();
    this.output.scrollTop = this.output.scrollHeight;
  }

  hideInput() {
    this.inputRow.hidden = true;
    this.onSubmit = null;
    this.persistent = false;
  }
}
