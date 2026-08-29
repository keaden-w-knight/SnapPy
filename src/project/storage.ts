import { FILE_EXTENSION, nameFromPath } from './format';
import { isTauri } from '../python/select';

export interface OpenedFile {
  text: string;
  name: string;
}

export interface ProjectIO {
  /** True when Save can write back to the last-used file without a dialog. */
  readonly canSaveInPlace: boolean;
  /** True once a target exists, so Save need not fall back to Save As. */
  hasTarget(): boolean;
  open(): Promise<OpenedFile | null>;
  /** Returns the saved project name, or null if the user cancelled. */
  save(text: string, suggestedName: string, forceNew: boolean): Promise<string | null>;
  /** Drop the remembered target, e.g. after New. */
  forget(): void;
}

// --- Tauri: real native dialogs and real paths -------------------------------

class TauriIO implements ProjectIO {
  readonly canSaveInPlace = true;
  private path: string | null = null;

  hasTarget() {
    return this.path !== null;
  }

  forget() {
    this.path = null;
  }

  async open(): Promise<OpenedFile | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const selected = await open({
      multiple: false,
      filters: [{ name: 'SnapPy project', extensions: [FILE_EXTENSION] }],
    });
    if (typeof selected !== 'string') return null;
    this.path = selected;
    return { text: await readTextFile(selected), name: nameFromPath(selected) };
  }

  async save(text: string, suggestedName: string, forceNew: boolean): Promise<string | null> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');

    let target = forceNew ? null : this.path;
    if (!target) {
      target = await save({
        defaultPath: `${suggestedName}.${FILE_EXTENSION}`,
        filters: [{ name: 'SnapPy project', extensions: [FILE_EXTENSION] }],
      });
      if (!target) return null;
    }
    await writeTextFile(target, text);
    this.path = target;
    return nameFromPath(target);
  }
}

// --- Browsers with the File System Access API (Chrome, Edge) -----------------

interface WritableStreamLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface FileHandleLike {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableStreamLike>;
}
interface PickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}
type PickerWindow = Window & {
  showOpenFilePicker?: (o: PickerOptions & { multiple: boolean }) => Promise<FileHandleLike[]>;
  showSaveFilePicker?: (o: PickerOptions) => Promise<FileHandleLike>;
};

const PICKER_TYPES = [
  {
    description: 'SnapPy project',
    accept: { 'application/json': [`.${FILE_EXTENSION}`] },
  },
];

class FileSystemAccessIO implements ProjectIO {
  readonly canSaveInPlace = true;
  private handle: FileHandleLike | null = null;

  hasTarget() {
    return this.handle !== null;
  }

  forget() {
    this.handle = null;
  }

  async open(): Promise<OpenedFile | null> {
    const picker = (window as PickerWindow).showOpenFilePicker!;
    try {
      const [handle] = await picker({ multiple: false, types: PICKER_TYPES });
      if (!handle) return null;
      this.handle = handle;
      const file = await handle.getFile();
      return { text: await file.text(), name: nameFromPath(handle.name) };
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }

  async save(text: string, suggestedName: string, forceNew: boolean): Promise<string | null> {
    try {
      let handle = forceNew ? null : this.handle;
      if (!handle) {
        const picker = (window as PickerWindow).showSaveFilePicker!;
        handle = await picker({
          suggestedName: `${suggestedName}.${FILE_EXTENSION}`,
          types: PICKER_TYPES,
        });
      }
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      this.handle = handle;
      return nameFromPath(handle.name);
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
}

/** Cancelling a picker rejects rather than resolving null. */
function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

// --- Anywhere else: download and file input ---------------------------------

class DownloadIO implements ProjectIO {
  // A download has no handle to write back to, so Save always behaves as Save As.
  readonly canSaveInPlace = false;

  hasTarget() {
    return false;
  }

  forget() {}

  open(): Promise<OpenedFile | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = `.${FILE_EXTENSION},application/json`;
      // 'cancel' is not universally supported; the promise simply never settles
      // if the user dismisses the dialog in an older browser, which is harmless.
      input.addEventListener('cancel', () => resolve(null));
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        void file.text().then((text) => resolve({ text, name: nameFromPath(file.name) }));
      });
      input.click();
    });
  }

  async save(text: string, suggestedName: string): Promise<string | null> {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${suggestedName}.${FILE_EXTENSION}`;
    anchor.click();
    URL.revokeObjectURL(url);
    return suggestedName;
  }
}

export function createProjectIO(): ProjectIO {
  if (isTauri) return new TauriIO();
  const w = window as PickerWindow;
  if (w.showOpenFilePicker && w.showSaveFilePicker) return new FileSystemAccessIO();
  return new DownloadIO();
}
