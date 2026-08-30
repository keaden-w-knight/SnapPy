import type * as Blockly from 'blockly/core';

/** Class applied to the failing block; styled in style.css. */
const ERROR_CLASS = 'snappy-error-block';

let highlighted: Blockly.BlockSvg | null = null;

export function clearErrorHighlight() {
  highlighted?.getSvgRoot()?.classList.remove(ERROR_CLASS);
  highlighted = null;
}

/**
 * Scroll the failing block into view and outline it in red.
 *
 * Returns false when the block cannot be found -- the traceback may point at a
 * line the map does not cover (a hoisted import, say), and it is better to leave
 * the workspace alone than to highlight the wrong thing.
 */
export function showErrorBlock(workspace: Blockly.WorkspaceSvg, blockId: string): boolean {
  const block = workspace.getBlockById(blockId);
  if (!block) return false;

  clearErrorHighlight();
  highlighted = block;
  block.getSvgRoot().classList.add(ERROR_CLASS);

  // Only scroll if it is actually off screen: yanking the viewport around when
  // the block is already visible is disorienting.
  if (!isVisible(workspace, block)) workspace.centerOnBlock(blockId);
  return true;
}

function isVisible(workspace: Blockly.WorkspaceSvg, block: Blockly.BlockSvg): boolean {
  const view = workspace.getMetricsManager().getViewMetrics(true);
  const position = block.getRelativeToSurfaceXY();
  const height = block.getHeightWidth().height;
  return (
    position.x >= view.left &&
    position.x <= view.left + view.width &&
    position.y >= view.top &&
    position.y + height <= view.top + view.height
  );
}
