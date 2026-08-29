/**
 * Both backends wrap the user's program, so tracebacks arrive with frames from
 * the harness on top. Pyodide compiles into a module named `<exec>`; CPython's
 * `-c` names it `<string>`. Keep from the first frame that names either, so the
 * line numbers a learner sees line up with the generated code pane.
 */
export function cleanTraceback(message: string): string {
  const lines = message.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => /File "<(exec|string)>"/.test(l));
  if (start === -1) return message.trim();
  return ['Traceback (most recent call last):', ...lines.slice(start)].join('\n').trim();
}

/** Windows pipes deliver CRLF; the console renders \r as a stray blank line. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n');
}
