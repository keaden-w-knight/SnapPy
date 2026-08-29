import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { python } from '@codemirror/lang-python';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';

/**
 * Read-only Python view. Blocks are the single source of truth -- making this
 * editable would mean parsing Python back into blocks, which is a much larger
 * problem and a deliberate v2 decision rather than an accident.
 */
export function createCodePane(parent: HTMLElement): {
  setCode(code: string): void;
} {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        python(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' },
        }),
      ],
    }),
  });

  return {
    setCode(code: string) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: code },
      });
    },
  };
}
