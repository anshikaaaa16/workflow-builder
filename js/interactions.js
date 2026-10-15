import { createNode, NODE_TYPES } from './catalog.js';
import { AddEdge, AddNode, DeleteSelection, MoveNodes } from './commands.js';
import { findNode, findPort, portKey } from './graph.js';
import { NODE_WIDTH, graphBounds } from './geometry.js';
import { canConnect } from './rules.js';
import { clamp, snap, uid } from './utils.js';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;
const DRAG_THRESHOLD = 3;
export const NODE_DRAG_TYPE = 'application/x-workflow-node';

export function setupInteractions(editor, svg, wrap, { toast }) {
  const { ui } = editor;
  let gesture = null;
  let spaceHeld = false;
  let fitPending = false;

  function clientToWorld(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const { x, y, k } = ui.view;
    return { x: (clientX - rect.left - x) / k, y: (clientY - rect.top - y) / k };
  }

  function viewCenter() {
    const rect = svg.getBoundingClientRect();
    return clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function portRefAt(target) {
    const el = target?.closest?.('.port');
    return el ? { nodeId: el.dataset.nodeId, portId: el.dataset.portId } : null;
  }

  function describe(ref) {
    const found = findPort(editor.graph, ref);
    return found ? `${found.node.label} › ${found.port.name}` : '?';
  }

  function startConnecting(from, clientX, clientY) {
    const results = new Map();
    editor.graph.nodes.forEach((node) => {
      node.ports.forEach((port) => {
        const ref = { nodeId: node.id, portId: port.id };
        results.set(portKey(ref), canConnect(editor.graph, from, ref));
      });
    });
    ui.connecting = { from, pointer: clientToWorld(clientX, clientY), results };
    ui.hoverPort = null;
    gesture = { type: 'connect' };
  }

  function finishConnecting() {
    const { from } = ui.connecting;
    const target = ui.hoverPort;
    ui.connecting = null;
    ui.hoverPort = null;
    if (!target) return;

    const result = canConnect(editor.graph, from, target);
    if (!result.ok) {
      toast(result.reason, 'error');
      return;
    }
    const edge = { id: uid('e'), source: result.source, target: result.target };
    editor.run(new AddEdge(edge, `Connect ${describe(result.source)} → ${describe(result.target)}`));
  }

  function startDragging(nodeId, event) {
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (additive) {
      if (ui.selectedNodes.has(nodeId)) {
        ui.selectedNodes.delete(nodeId);
        return;
      }
      ui.selectedNodes.add(nodeId);
    } else if (!ui.selectedNodes.has(nodeId)) {
      ui.selectedNodes = new Set([nodeId]);
    }
    ui.selectedEdge = null;

    const origins = new Map();
    ui.selectedNodes.forEach((id) => {
      const node = findNode(editor.graph, id);
      if (node) origins.set(id, { ...node.position });
    });
    gesture = { type: 'drag', start: clientToWorld(event.clientX, event.clientY), origins, moved: false };
  }

  function finishDragging(drag, cancelled) {
    const moves = [];
    drag.origins.forEach((from, id) => {
      const node = findNode(editor.graph, id);
      if (!node) return;
      if (cancelled) node.position = { ...from };
      else if (node.position.x !== from.x || node.position.y !== from.y) {
        moves.push({ id, from, to: { ...node.position } });
      }
    });
    if (!moves.length) return;
    const label = moves.length === 1 ? `Move "${findNode(editor.graph, moves[0].id).label}"` : undefined;
    editor.run(new MoveNodes(moves, label));
  }

  function onPointerDown(event) {
    if (event.button === 2) return;
    if (gesture) onPointerUp(event, true);
    if (document.activeElement instanceof HTMLElement && document.activeElement !== svg) {
      document.activeElement.blur();
    }
    svg.focus({ preventScroll: true });

    const target = event.target;
    const wantsPan = event.button === 1 || spaceHeld;
    const port = !wantsPan && portRefAt(target);
    const nodeEl = !wantsPan && target.closest('.node');
    const edgeEl = !wantsPan && target.closest('.edge');

    if (port) {
      startConnecting(port, event.clientX, event.clientY);
    } else if (nodeEl) {
      startDragging(nodeEl.dataset.nodeId, event);
    } else if (edgeEl) {
      editor.clearSelection();
      ui.selectedEdge = edgeEl.dataset.edgeId;
    } else {
      if (!wantsPan && !event.shiftKey) editor.clearSelection();
      gesture = { type: 'pan', clientX: event.clientX, clientY: event.clientY, view: { ...ui.view }, moved: false };
    }

    if (gesture) {
      if (event.isTrusted) svg.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
    editor.emit('ui');
  }

  function onPointerMove(event) {
    if (!gesture) return;

    if (gesture.type === 'drag') {
      const point = clientToWorld(event.clientX, event.clientY);
      const dx = point.x - gesture.start.x;
      const dy = point.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) * ui.view.k < DRAG_THRESHOLD) return;
      gesture.moved = true;
      gesture.origins.forEach((origin, id) => {
        const node = findNode(editor.graph, id);
        const x = origin.x + dx;
        const y = origin.y + dy;
        node.position = event.altKey ? { x, y } : { x: snap(x), y: snap(y) };
      });
      editor.emit('drag');
    } else if (gesture.type === 'connect') {
      ui.connecting.pointer = clientToWorld(event.clientX, event.clientY);
      const hovered = portRefAt(document.elementFromPoint(event.clientX, event.clientY));
      ui.hoverPort = hovered && portKey(hovered) !== portKey(ui.connecting.from) ? hovered : null;
      editor.emit('drag');
    } else if (gesture.type === 'pan') {
      gesture.moved = true;
      ui.view.x = gesture.view.x + (event.clientX - gesture.clientX);
      ui.view.y = gesture.view.y + (event.clientY - gesture.clientY);
      svg.classList.add('is-panning');
      editor.emit('view');
    }
  }

  function onPointerUp(event, cancelled = false) {
    if (!gesture) return;
    const current = gesture;
    gesture = null;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    svg.classList.remove('is-panning');

    if (current.type === 'drag') {
      finishDragging(current, cancelled);
    } else if (current.type === 'connect') {
      if (cancelled) {
        ui.connecting = null;
        ui.hoverPort = null;
      } else {
        finishConnecting();
      }
    }
    editor.emit('ui');
  }

  function zoomAt(factor, clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const { x, y, k } = ui.view;
    const next = clamp(k * factor, MIN_ZOOM, MAX_ZOOM);
    const wx = (sx - x) / k;
    const wy = (sy - y) / k;
    ui.view = { x: sx - wx * next, y: sy - wy * next, k: next };
    editor.emit('view');
  }

  function zoomCenter(factor) {
    const rect = svg.getBoundingClientRect();
    zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function resetZoom() {
    zoomCenter(1 / ui.view.k);
  }

  function fitView() {
    const bounds = graphBounds(editor.graph);
    const rect = svg.getBoundingClientRect();
    fitPending = !rect.width;
    if (!bounds || !rect.width) {
      ui.view = { x: 0, y: 0, k: 1 };
    } else {
      const pad = 60;
      const width = bounds.right - bounds.left + pad * 2;
      const height = bounds.bottom - bounds.top + pad * 2;
      const k = clamp(Math.min(rect.width / width, rect.height / height), MIN_ZOOM, 1.2);
      ui.view = {
        k,
        x: (rect.width - (bounds.right - bounds.left) * k) / 2 - bounds.left * k,
        y: (rect.height - (bounds.bottom - bounds.top) * k) / 2 - bounds.top * k,
      };
    }
    editor.emit('view');
  }

  function addNodeAt(type, point) {
    const position = { x: snap(point.x - NODE_WIDTH / 2), y: snap(point.y - 20) };
    while (editor.graph.nodes.some((n) => n.position.x === position.x && n.position.y === position.y)) {
      position.x += 20;
      position.y += 20;
    }
    const node = createNode(type, position);
    editor.run(new AddNode(node));
    ui.selectedNodes = new Set([node.id]);
    ui.selectedEdge = null;
    editor.emit('ui');
  }

  function deleteSelection() {
    const nodeIds = [...ui.selectedNodes];
    const edgeIds = ui.selectedEdge ? [ui.selectedEdge] : [];
    if (!nodeIds.length && !edgeIds.length) return;
    editor.run(new DeleteSelection(nodeIds, edgeIds));
  }

  function undo() {
    if (!gesture) editor.history.undo();
  }

  function redo() {
    if (!gesture) editor.history.redo();
  }

  function onKeyDown(event) {
    const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    const dialogOpen = document.querySelector('dialog[open]');
    if (typing || dialogOpen) return;

    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (mod && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
    } else if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
      event.preventDefault();
      redo();
    } else if (mod && key === 'a') {
      event.preventDefault();
      ui.selectedNodes = new Set(editor.graph.nodes.map((n) => n.id));
      ui.selectedEdge = null;
      editor.emit('ui');
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelection();
    } else if (event.key === 'Escape') {
      ui.connecting = null;
      ui.hoverPort = null;
      gesture = null;
      editor.clearSelection();
      editor.emit('ui');
    } else if (event.code === 'Space' && !spaceHeld) {
      event.preventDefault();
      spaceHeld = true;
      svg.classList.add('space-pan');
    }
  }

  function onKeyUp(event) {
    if (event.code === 'Space') {
      spaceHeld = false;
      svg.classList.remove('space-pan');
    }
  }

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', (e) => onPointerUp(e));
  svg.addEventListener('pointercancel', (e) => onPointerUp(e, true));
  svg.addEventListener('lostpointercapture', (e) => onPointerUp(e));
  svg.addEventListener('auxclick', (e) => e.preventDefault());
  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
  }, { passive: false });

  wrap.addEventListener('dragover', (event) => {
    if (event.dataTransfer.types.includes(NODE_DRAG_TYPE)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  });
  wrap.addEventListener('drop', (event) => {
    const type = event.dataTransfer.getData(NODE_DRAG_TYPE);
    if (!NODE_TYPES[type]) return;
    event.preventDefault();
    addNodeAt(type, clientToWorld(event.clientX, event.clientY));
  });

  new ResizeObserver(() => {
    if (fitPending) fitView();
    else editor.emit('view');
  }).observe(svg);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => {
    spaceHeld = false;
    svg.classList.remove('space-pan');
  });

  return { addNodeAt, viewCenter, fitView, zoomCenter, resetZoom, deleteSelection, undo, redo };
}
