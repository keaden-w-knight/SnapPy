import { CURRENT_VERSION, migrateWorkspace } from './migrate';

export const FILE_EXTENSION = 'snappy';
/** Bumped whenever a block changes shape; see migrate.ts. */
export const FORMAT_VERSION = CURRENT_VERSION;

export interface Project {
  name: string;
  workspace: object;
}

interface ProjectFile {
  format: 'snappy';
  version: number;
  name: string;
  workspace: object;
}

export function serialize(project: Project): string {
  const file: ProjectFile = {
    format: 'snappy',
    version: FORMAT_VERSION,
    name: project.name,
    workspace: project.workspace,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Throws an Error with a message worth showing the user. */
export function parse(text: string, fallbackName: string): Project {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON, so it isn't a SnapPy project.");
  }

  if (typeof data !== 'object' || data === null) {
    throw new Error('That file does not contain a SnapPy project.');
  }

  const file = data as Partial<ProjectFile>;
  if (file.format !== 'snappy') {
    throw new Error('That file is not a SnapPy project.');
  }
  // Forward compatibility: refuse loudly rather than silently dropping blocks a
  // newer version understood.
  if (typeof file.version !== 'number' || file.version > FORMAT_VERSION) {
    throw new Error(
      `That project was saved by a newer version of SnapPy (format ${String(file.version)}).`,
    );
  }
  if (typeof file.workspace !== 'object' || file.workspace === null) {
    throw new Error('That project file is missing its blocks.');
  }

  return {
    name: typeof file.name === 'string' && file.name.trim() ? file.name : fallbackName,
    // Older files are walked forward before Blockly ever sees them, so a block
    // type that has since been replaced never needs to still exist.
    workspace: migrateWorkspace(file.workspace, file.version),
  };
}

/** Strips a directory path and the extension, for showing in the title bar. */
export function nameFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(new RegExp(`\\.${FILE_EXTENSION}$`, 'i'), '') || 'Untitled';
}
