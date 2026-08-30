/**
 * Brings older saved projects up to the current block set.
 *
 * Blocks get replaced as the app grows -- loops and functions stopped using
 * Blockly's workspace-variable dropdowns, `make` moved its name into a socket --
 * and a project saved before a change would otherwise load with blocks that
 * still render but no longer connect to anything, silently losing behaviour.
 *
 * Migrations run on the serialized JSON before Blockly sees it, so a block type
 * that no longer exists never has to be registered. Each step upgrades exactly
 * one version, and they compose, so a very old file walks the whole chain.
 */

interface BlockJson {
  type: string;
  id?: string;
  x?: number;
  y?: number;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlockJson; shadow?: BlockJson }>;
  next?: { block?: BlockJson; shadow?: BlockJson };
  extraState?: Record<string, unknown>;
  [key: string]: unknown;
}

interface WorkspaceJson {
  variables?: { name: string; id: string; type?: string }[];
  blocks?: { languageVersion?: number; blocks?: BlockJson[] };
  [key: string]: unknown;
}

/** Walks every block in a workspace, letting the visitor replace each one. */
function mapBlocks(state: WorkspaceJson, visit: (block: BlockJson) => BlockJson): WorkspaceJson {
  const walk = (block: BlockJson): BlockJson => {
    const mapped = visit(block);
    if (mapped.inputs) {
      for (const slot of Object.values(mapped.inputs)) {
        if (slot.block) slot.block = walk(slot.block);
        if (slot.shadow) slot.shadow = walk(slot.shadow);
      }
    }
    if (mapped.next?.block) mapped.next.block = walk(mapped.next.block);
    return mapped;
  };

  return {
    ...state,
    blocks: { ...state.blocks, blocks: (state.blocks?.blocks ?? []).map(walk) },
  };
}

/** The variable name a Blockly `field_variable` referred to. */
function variableName(state: WorkspaceJson, field: unknown): string | null {
  if (typeof field === 'string') return field;
  const id = (field as { id?: string } | undefined)?.id;
  if (!id) return null;
  return state.variables?.find((variable) => variable.id === id)?.name ?? null;
}

const nameOval = (name: string) => ({
  block: { type: 'snappy_local_get', fields: { NAME: name } } as BlockJson,
});

/** Appends a block to the end of a `next` chain. */
function appendToChain(head: BlockJson | undefined, tail: BlockJson): BlockJson {
  if (!head) return tail;
  let cursor = head;
  while (cursor.next?.block) cursor = cursor.next.block;
  cursor.next = { block: tail };
  return head;
}

/**
 * v1 -> v2: loops, functions and `make` stopped naming things with workspace
 * variables and started using name ovals in sockets.
 */
function toVersion2(state: WorkspaceJson): WorkspaceJson {
  // Names bound by a loop or a parameter stop being workspace variables, so
  // every block that read or wrote one has to become a local name block too --
  // otherwise the variable stays referenced, stays in the palette, and the loop
  // body silently talks about a different thing than the loop header.
  const localIds = new Set<string>();
  mapBlocks(state, (block) => {
    if (block.type === 'controls_for' || block.type === 'controls_forEach') {
      const id = (block.fields?.VAR as { id?: string } | undefined)?.id;
      if (id) localIds.add(id);
    }
    if (block.type === 'procedures_defnoreturn' || block.type === 'procedures_defreturn') {
      for (const param of (block.extraState?.params as { id?: string }[] | undefined) ?? []) {
        if (param.id) localIds.add(param.id);
      }
    }
    return block;
  });

  const localName = (field: unknown): string | null => {
    const id = (field as { id?: string } | undefined)?.id;
    return id && localIds.has(id) ? variableName(state, field) : null;
  };

  const migrated = mapBlocks(state, (block): BlockJson => {
    switch (block.type) {
      case 'variables_get': {
        const name = localName(block.fields?.VAR);
        return name ? { ...block, type: 'snappy_local_get', fields: { NAME: name } } : block;
      }

      case 'variables_set': {
        const name = localName(block.fields?.VAR);
        if (!name) return block;
        return {
          ...block,
          type: 'snappy_local_set',
          fields: {},
          inputs: { VAR: nameOval(name), ...(block.inputs ?? {}) },
        };
      }

      case 'math_change': {
        const name = localName(block.fields?.VAR);
        if (!name) return block;
        // `change x by n` has no local equivalent, so it becomes `make x = x + n`.
        return {
          ...block,
          type: 'snappy_local_set',
          fields: {},
          inputs: {
            VAR: nameOval(name),
            VALUE: {
              block: {
                type: 'math_arithmetic',
                fields: { OP: 'ADD' },
                inputs: {
                  A: nameOval(name),
                  B: block.inputs?.DELTA ?? { shadow: { type: 'math_number', fields: { NUM: 1 } } },
                },
              } as BlockJson,
            },
          },
        };
      }

      case 'controls_forEach':
      case 'controls_for': {
        const name = variableName(state, block.fields?.VAR) ?? 'item';
        const fields = { ...block.fields };
        delete fields.VAR;

        // The name socket comes first so the block reads in the same order.
        const inputs: NonNullable<BlockJson['inputs']> = { VAR: nameOval(name) };
        for (const [key, slot] of Object.entries(block.inputs ?? {})) {
          if (key !== 'VAR' && slot) inputs[key] = slot;
        }

        return {
          ...block,
          type: block.type === 'controls_for' ? 'snappy_for_range' : 'snappy_for_each',
          fields,
          inputs,
        };
      }

      case 'procedures_defnoreturn':
      case 'procedures_defreturn': {
        const params = ((block.extraState?.params as { name: string }[] | undefined) ?? []).map(
          (param) => ({ name: param.name, type: 'value' as const }),
        );
        const STACK = block.inputs?.STACK;
        const RETURN = block.inputs?.RETURN;

        // A returning function becomes a plain definition plus a return
        // statement, because that is all Python ever had.
        let body = STACK?.block;
        if (RETURN?.block ?? RETURN?.shadow) {
          body = appendToChain(body, {
            type: 'snappy_return',
            inputs: { VALUE: RETURN as { block?: BlockJson; shadow?: BlockJson } },
          });
        }

        const inputs: BlockJson['inputs'] = {};
        params.forEach((param, index) => {
          inputs[`PARAM${index}`] = nameOval(param.name);
        });
        if (body) inputs.DO = { block: body };

        return {
          ...block,
          type: 'snappy_function_def',
          fields: { NAME: String(block.fields?.NAME ?? 'do_something') },
          extraState: { params },
          inputs,
        };
      }

      case 'procedures_callnoreturn':
      case 'procedures_callreturn': {
        const names = (block.extraState?.params as string[] | undefined) ?? [];
        return {
          ...block,
          type: block.type === 'procedures_callreturn' ? 'snappy_call_value' : 'snappy_call',
          fields: { NAME: String(block.fields?.NAME ?? '') },
          extraState: { params: names.map((name) => ({ name, type: 'value' as const })) },
        };
      }

      case 'snappy_call':
      case 'snappy_call_value': {
        // Parameters used to be a bare list of names, before they had shapes.
        const params = block.extraState?.params as unknown[] | undefined;
        if (!params?.length || typeof params[0] !== 'string') return block;
        return {
          ...block,
          extraState: {
            params: (params as string[]).map((name) => ({ name, type: 'value' as const })),
          },
        };
      }

      case 'snappy_local_set': {
        // The name moved from a field into a socket.
        if (block.inputs?.VAR) return block;
        const name = typeof block.fields?.NAME === 'string' ? block.fields.NAME : 'counter';
        const fields = { ...block.fields };
        delete fields.NAME;
        return { ...block, fields, inputs: { VAR: nameOval(name), ...(block.inputs ?? {}) } };
      }

      default:
        return block;
    }
  });

  return dropUnusedVariables(migrated);
}

/**
 * Names that were only ever a loop target or a parameter are no longer
 * variables at all, so leaving them behind would clutter the palette with
 * entries nothing references.
 */
function dropUnusedVariables(state: WorkspaceJson): WorkspaceJson {
  if (!state.variables?.length) return state;

  const used = new Set<string>();
  mapBlocks(state, (block) => {
    for (const value of Object.values(block.fields ?? {})) {
      const id = (value as { id?: string } | null)?.id;
      if (id) used.add(id);
    }
    return block;
  });

  return { ...state, variables: state.variables.filter((variable) => used.has(variable.id)) };
}

/** Applied in order; index 0 upgrades a version-1 file to version 2. */
const STEPS: ((state: WorkspaceJson) => WorkspaceJson)[] = [toVersion2];

/** The version a freshly saved project carries. */
export const CURRENT_VERSION = STEPS.length + 1;

/**
 * @param from the version the file was written with; anything below
 *   CURRENT_VERSION is walked forward one step at a time.
 */
export function migrateWorkspace(workspace: object, from: number): object {
  let state = JSON.parse(JSON.stringify(workspace)) as WorkspaceJson;
  for (let version = Math.max(1, from); version < CURRENT_VERSION; version++) {
    state = STEPS[version - 1](state);
  }
  return state;
}
