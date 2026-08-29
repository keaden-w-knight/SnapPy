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
      this.hideInput();
      this.write(`${line}\n`, 'stdin');
      this.onSubmit?.(line);
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

  requestInput(onSubmit: (line: string) => void) {
    this.onSubmit = onSubmit;
    this.inputRow.hidden = false;
    this.field.focus();
    this.output.scrollTop = this.output.scrollHeight;
  }

  hideInput() {
    this.inputRow.hidden = true;
    this.onSubmit = null;
  }
}
