/// <reference types="@figma/plugin-typings" />
import { layerFillMap, prettyName, WarpParams } from './core';

const PARAMS_KEY = 'warp-type-params';

figma.showUI(__html__, { width: 360, height: 720, themeColors: true });

function prettify(node: BaseNode): void {
  node.name = prettyName(node.name);
  if ('children' in node) {
    for (const child of node.children) prettify(child);
  }
}

/** Walk up from a node to the generated type frame that contains it. */
function warpFrameFor(node: BaseNode): SceneNode | null {
  let cur: BaseNode | null = node;
  while (cur && cur.type !== 'PAGE' && cur.type !== 'DOCUMENT') {
    if (cur.getPluginData(PARAMS_KEY)) return cur as SceneNode;
    cur = cur.parent;
  }
  return null;
}

/** Tell the UI which generated frame (if any) the current selection targets. */
function postTarget(): void {
  for (const selected of figma.currentPage.selection) {
    const frame = warpFrameFor(selected);
    if (frame) {
      let params: unknown = null;
      try {
        params = JSON.parse(frame.getPluginData(PARAMS_KEY));
      } catch {
        // corrupt data — still allow targeting, just without hydration
      }
      figma.ui.postMessage({ type: 'target', nodeId: frame.id, name: frame.name, params });
      return;
    }
  }
  figma.ui.postMessage({ type: 'target', nodeId: null });
}

postTarget();
figma.on('selectionchange', postTarget);

/** "#rrggbb" of a single solid fill, else null (mixed/gradient/multiple). */
function solidHex(paints: readonly Paint[] | typeof figma.mixed): string | null {
  if (paints === figma.mixed || !Array.isArray(paints) || paints.length !== 1) return null;
  const p = paints[0];
  if (p.type !== 'SOLID') return null;
  const to = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(p.color.r)}${to(p.color.g)}${to(p.color.b)}`;
}

/** Leaf vectors keyed by layer name ("Background", "Glyph 001", …). Glyph
 *  numbering runs across the whole composition, so names stay unique even
 *  though the letters are grouped by line. */
function leafMap(root: SceneNode): Map<string, SceneNode> {
  const map = new Map<string, SceneNode>();
  const walk = (node: SceneNode): void => {
    if ('children' in node && node.children.length > 0) {
      for (const child of node.children) walk(child);
    } else {
      map.set(node.name, node);
    }
  };
  if ('children' in root) {
    for (const child of root.children) walk(child);
  }
  return map;
}

/** The background sits under everything and the grain sits over it — lock both
 *  so clicking a letter never grabs them (unlock in the Layers panel to edit). */
function lockChrome(frame: FrameNode): void {
  for (const child of frame.children) {
    if (child.name === 'Background' || child.name === 'Effects') child.locked = true;
  }
}

interface PluginMsg {
  type: string;
  svg?: string;
  seed?: number;
  style?: string;
  nodeId?: string | null;
  params?: WarpParams;
}

function stampAndPlace(frame: FrameNode, msg: PluginMsg, x?: number, y?: number): void {
  const suffix = msg.style === 'bw' ? ' (Outline)' : msg.style === 'shaded' ? ' (Shaded)' : '';
  const words = (msg.params?.text ?? '').split('\n').join(' ').trim().slice(0, 28);
  frame.name = `${words || 'Warp Type'} ${msg.seed ?? ''}${suffix}`.trim();
  prettify(frame);
  lockChrome(frame);
  if (msg.params) {
    frame.setPluginData(PARAMS_KEY, JSON.stringify(msg.params));
    frame.setRelaunchData({ edit: 'Reopen Warp Type with this lettering’s settings' });
  }
  frame.x = x ?? Math.round(figma.viewport.center.x - frame.width / 2);
  frame.y = y ?? Math.round(figma.viewport.center.y - frame.height / 2);
}

figma.ui.onmessage = async (msg: PluginMsg) => {
  try {
    await handle(msg);
  } catch (e) {
    figma.notify(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`, {
      error: true,
    });
  }
};

async function handle(msg: PluginMsg): Promise<void> {
  if (msg.type === 'insert' && msg.svg) {
    const frame = figma.createNodeFromSvg(msg.svg);
    stampAndPlace(frame, msg);
    figma.currentPage.appendChild(frame);
    figma.currentPage.selection = [frame];
    figma.viewport.scrollAndZoomIntoView([frame]);
    figma.notify('Type added. Every letter is its own vector, so you can recolor any of them.');
  } else if (msg.type === 'update' && msg.svg && msg.nodeId) {
    const old = await figma.getNodeByIdAsync(msg.nodeId);
    if (!old || old.removed || !('x' in old)) {
      figma.ui.postMessage({ type: 'target', nodeId: null });
      figma.notify('The original frame was deleted. Use Insert to add a new one.', { error: true });
      return;
    }
    // Collect manual fill overrides: any letter whose current fill differs from
    // what its stored params originally generated.
    const overrides = new Map<string, Paint[]>();
    try {
      const stored = JSON.parse(old.getPluginData(PARAMS_KEY)) as WarpParams;
      const original = layerFillMap(stored);
      for (const [key, node] of leafMap(old as SceneNode)) {
        const orig = original.get(key);
        if (!orig || !('fills' in node)) continue;
        const cur = solidHex(node.fills);
        if (cur === null || cur.toLowerCase() !== orig.toLowerCase()) {
          overrides.set(key, JSON.parse(JSON.stringify(node.fills)) as Paint[]);
        }
      }
    } catch {
      // no/corrupt stored params — update without preservation
    }

    const fresh = figma.createNodeFromSvg(msg.svg);
    stampAndPlace(fresh, msg, old.x, old.y);
    let kept = 0;
    if (overrides.size > 0) {
      const freshLeaves = leafMap(fresh);
      for (const [key, paints] of overrides) {
        const node = freshLeaves.get(key);
        if (node && 'fills' in node) {
          node.fills = paints;
          kept++;
        }
      }
    }
    const parent = old.parent ?? figma.currentPage;
    parent.insertChild(parent.children.indexOf(old as SceneNode), fresh);
    old.remove();
    figma.currentPage.selection = [fresh];
    figma.notify(
      kept > 0
        ? `Type updated. Kept ${kept} color${kept === 1 ? '' : 's'} you changed by hand.`
        : 'Type updated',
    );
  } else if (msg.type === 'close') {
    figma.closePlugin();
  }
}
