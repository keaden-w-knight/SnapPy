/**
 * The turtle's drawing surface.
 *
 * Two layers: the ink, which accumulates, and the turtle marker, which is
 * cleared and redrawn on every move. Keeping them apart means a moving turtle
 * does not force the whole drawing to be repainted.
 *
 * Operations are kept so the ink can be replayed after a resize -- a canvas
 * loses its contents when its backing store changes size, and a drawing that
 * vanished when the window moved would look like a bug.
 */

type Op = [string, ...unknown[]];

const MAX_OPS = 40_000;

/** Turtle coordinates: origin in the middle, y upwards. */
interface Frame {
  cx: number;
  cy: number;
}

export interface Stage {
  draw(op: string, args: unknown[]): void;
  clear(): void;
  setVisible(visible: boolean): void;
  readonly overflowed: boolean;
  /** Diagnostics, used by the browser tests. */
  readonly stats: { ops: number; turtle: unknown[] | null; width: number; height: number };
}

export function createStage(root: HTMLElement): Stage {
  root.innerHTML = `
    <canvas class="stage-ink"></canvas>
    <canvas class="stage-turtle"></canvas>`;

  const ink = root.querySelector<HTMLCanvasElement>('.stage-ink')!;
  const marker = root.querySelector<HTMLCanvasElement>('.stage-turtle')!;
  const inkCtx = ink.getContext('2d')!;
  const markerCtx = marker.getContext('2d')!;

  let ops: Op[] = [];
  let turtleState: Op | null = null;
  let overflowed = false;
  let frame: Frame = { cx: 0, cy: 0 };

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, root.clientWidth);
    const height = Math.max(1, root.clientHeight);

    for (const canvas of [ink, marker]) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.getContext('2d')!.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    frame = { cx: width / 2, cy: height / 2 };
    replay();
  }

  const toX = (x: number) => frame.cx + x;
  const toY = (y: number) => frame.cy - y; // turtle y points up

  function paint(ctx: CanvasRenderingContext2D, op: Op) {
    const [kind, ...args] = op;
    if (kind === 'line') {
      const [x1, y1, x2, y2, color, size] = args as [
        number, number, number, number, string, number,
      ];
      ctx.beginPath();
      ctx.moveTo(toX(x1), toY(y1));
      ctx.lineTo(toX(x2), toY(y2));
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.stroke();
    } else if (kind === 'dot') {
      const [x, y, size, color] = args as [number, number, number, string];
      ctx.beginPath();
      ctx.arc(toX(x), toY(y), size / 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  function paintTurtle() {
    markerCtx.clearRect(0, 0, marker.width, marker.height);
    if (!turtleState) return;

    const [, x, y, angle, visible] = turtleState as [string, number, number, number, boolean];
    if (!visible) return;

    markerCtx.save();
    markerCtx.translate(toX(x), toY(y));
    markerCtx.rotate(-(angle * Math.PI) / 180); // canvas y is flipped
    markerCtx.beginPath();
    markerCtx.moveTo(12, 0);
    markerCtx.lineTo(-8, 7);
    markerCtx.lineTo(-4, 0);
    markerCtx.lineTo(-8, -7);
    markerCtx.closePath();
    markerCtx.fillStyle = '#4c97ff';
    markerCtx.strokeStyle = '#2e3550';
    markerCtx.lineWidth = 1.5;
    markerCtx.fill();
    markerCtx.stroke();
    markerCtx.restore();
  }

  function replay() {
    inkCtx.clearRect(0, 0, ink.width, ink.height);
    for (const op of ops) paint(inkCtx, op);
    paintTurtle();
  }

  new ResizeObserver(resize).observe(root);
  resize();

  return {
    get overflowed() {
      return overflowed;
    },

    get stats() {
      return {
        ops: ops.length,
        turtle: turtleState,
        width: marker.width,
        height: marker.height,
      };
    },

    draw(op: string, args: unknown[]) {
      if (op === 'clear') {
        ops = [];
        overflowed = false;
        inkCtx.clearRect(0, 0, ink.width, ink.height);
        return;
      }
      if (op === 'turtle') {
        turtleState = [op, ...args];
        paintTurtle();
        return;
      }

      // A runaway loop can emit drawing forever; keep the most recent work
      // rather than growing without bound.
      if (ops.length >= MAX_OPS) {
        ops.splice(0, Math.floor(MAX_OPS / 4));
        overflowed = true;
      }
      const entry: Op = [op, ...args];
      ops.push(entry);
      paint(inkCtx, entry);
    },

    clear() {
      ops = [];
      turtleState = null;
      overflowed = false;
      inkCtx.clearRect(0, 0, ink.width, ink.height);
      markerCtx.clearRect(0, 0, marker.width, marker.height);
    },

    setVisible(visible: boolean) {
      root.hidden = !visible;
      if (visible) resize();
    },
  };
}
