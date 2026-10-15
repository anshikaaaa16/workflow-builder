import { NODE_TYPES } from './catalog.js';
import { findPort, portKey } from './graph.js';
import {
  HEADER_HEIGHT,
  NODE_WIDTH,
  edgePath,
  nodeHeight,
  portOffset,
  portPosition,
  wirePath,
} from './geometry.js';
import { truncate } from './utils.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, parent = null) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  if (parent) parent.appendChild(el);
  return el;
}

function svgText(parent, attrs, text) {
  const el = svgEl('text', attrs, parent);
  el.textContent = text;
  return el;
}

function portShape(dataType, parent) {
  if (dataType === 'trigger') return svgEl('path', { class: 'port-shape', d: 'M 0 -6.5 L 6.5 0 L 0 6.5 L -6.5 0 Z' }, parent);
  if (dataType === 'data') return svgEl('rect', { class: 'port-shape', x: -5, y: -5, width: 10, height: 10, rx: 2 }, parent);
  return svgEl('circle', { class: 'port-shape', r: 5.5 }, parent);
}

function buildNode(node) {
  const def = NODE_TYPES[node.type];
  const height = nodeHeight(node);
  const r = 10;
  const g = svgEl('g', { class: `node cat-${def.category}`, 'data-node-id': node.id });

  svgEl('title', {}, g).textContent = `${node.label} (${def.label})`;
  svgEl('rect', { class: 'node-body', width: NODE_WIDTH, height, rx: r }, g);
  svgEl('path', {
    class: 'node-header',
    d: `M 0 ${r} A ${r} ${r} 0 0 1 ${r} 0 H ${NODE_WIDTH - r} A ${r} ${r} 0 0 1 ${NODE_WIDTH} ${r} V ${HEADER_HEIGHT} H 0 Z`,
  }, g);
  svgEl('circle', { class: 'node-stripe', cx: 15, cy: HEADER_HEIGHT / 2, r: 4 }, g);
  svgText(g, { class: 'node-title', x: 26, y: HEADER_HEIGHT / 2 + 4.5 }, truncate(node.label, 18));
  svgText(g, { class: 'node-tag', x: NODE_WIDTH - 12, y: HEADER_HEIGHT / 2 + 3.5, 'text-anchor': 'end' }, def.category.toUpperCase());
  svgEl('rect', { class: 'node-outline', width: NODE_WIDTH, height, rx: r }, g);

  node.ports.forEach((port) => {
    const offset = portOffset(node, port);
    const isInput = port.direction === 'in';
    const pg = svgEl('g', {
      class: `port port-${port.direction} type-${port.dataType}`,
      'data-node-id': node.id,
      'data-port-id': port.id,
      transform: `translate(${offset.x} ${offset.y})`,
    }, g);
    const limit = port.maxConnections ? ` · max ${port.maxConnections}` : '';
    svgEl('title', {}, pg).textContent = `${port.name} — ${port.dataType} ${isInput ? 'input' : 'output'}${limit}`;
    svgEl('circle', { class: 'port-hit', r: 11 }, pg);
    portShape(port.dataType, pg);
    svgText(pg, {
      class: 'port-label',
      x: isInput ? 12 : -12,
      y: 4,
      'text-anchor': isInput ? 'start' : 'end',
    }, truncate(port.name, 13));
  });

  return g;
}

export function createRenderer(editor, svg, hint) {
  const viewport = svg.querySelector('#viewport');
  const grid = svg.querySelector('#grid');
  const edgesLayer = svg.querySelector('#edges');
  const nodesLayer = svg.querySelector('#nodes');
  const draft = svg.querySelector('#draft');
  const nodeEls = new Map();

  function renderNodes() {
    const { graph, ui } = editor;
    const seen = new Set();

    graph.nodes.forEach((node) => {
      seen.add(node.id);
      const signature = JSON.stringify([node.type, node.label, node.ports]);
      let entry = nodeEls.get(node.id);
      if (!entry || entry.signature !== signature) {
        const el = buildNode(node);
        if (entry) entry.el.replaceWith(el);
        else nodesLayer.appendChild(el);
        entry = { el, signature };
        nodeEls.set(node.id, entry);
      }
      entry.el.setAttribute('transform', `translate(${node.position.x} ${node.position.y})`);
      entry.el.classList.toggle('selected', ui.selectedNodes.has(node.id));
    });

    for (const [id, entry] of nodeEls) {
      if (!seen.has(id)) {
        entry.el.remove();
        nodeEls.delete(id);
      }
    }

    const order = graph.nodes.map((n) => nodeEls.get(n.id).el);
    const inOrder = order.every((el, i) => nodesLayer.children[i] === el);
    if (!inOrder) order.forEach((el) => nodesLayer.appendChild(el));
  }

  function renderEdges() {
    const { graph, ui } = editor;
    edgesLayer.replaceChildren();
    graph.edges.forEach((edge) => {
      const d = edgePath(graph, edge);
      const source = findPort(graph, edge.source);
      if (!d || !source) return;
      const selected = ui.selectedEdge === edge.id ? ' selected' : '';
      const g = svgEl('g', { class: `edge type-${source.port.dataType}${selected}`, 'data-edge-id': edge.id }, edgesLayer);
      svgEl('path', { class: 'edge-hit', d }, g);
      svgEl('path', { class: 'edge-line', d }, g);
    });
  }

  function renderDraft() {
    const { graph, ui } = editor;
    const connecting = ui.connecting;
    const start = connecting && findPort(graph, connecting.from);

    if (!start) {
      draft.setAttribute('d', '');
      hint.hidden = true;
      return;
    }

    const anchor = portPosition(start.node, start.port);
    let end = connecting.pointer;
    let state = '';
    const hover = ui.hoverPort && findPort(graph, ui.hoverPort);
    if (hover) {
      end = portPosition(hover.node, hover.port);
      state = connecting.results.get(portKey(ui.hoverPort))?.ok ? 'ok' : 'bad';
    }

    const [p1, p2] = start.port.direction === 'out' ? [anchor, end] : [end, anchor];
    draft.setAttribute('d', wirePath(p1, p2, graph.routing));
    draft.setAttribute('class', `draft ${state}`);

    if (hover) {
      const result = connecting.results.get(portKey(ui.hoverPort));
      const { x, y, k } = ui.view;
      hint.hidden = false;
      hint.className = `wire-hint ${state}`;
      hint.textContent = result?.ok ? 'Release to connect' : result?.reason || 'Cannot connect here';
      hint.style.left = `${connecting.pointer.x * k + x}px`;
      hint.style.top = `${connecting.pointer.y * k + y}px`;
    } else {
      hint.hidden = true;
    }
  }

  function markPorts() {
    const { graph, ui } = editor;
    const connected = new Set();
    graph.edges.forEach((e) => {
      connected.add(portKey(e.source));
      connected.add(portKey(e.target));
    });

    const connecting = ui.connecting;
    const fromKey = connecting ? portKey(connecting.from) : null;
    svg.classList.toggle('is-connecting', Boolean(connecting));

    nodesLayer.querySelectorAll('.port').forEach((el) => {
      const key = `${el.dataset.nodeId}::${el.dataset.portId}`;
      const ok = Boolean(connecting && connecting.results.get(key)?.ok);
      el.classList.toggle('connected', connected.has(key));
      el.classList.toggle('is-source', key === fromKey);
      el.classList.toggle('can-drop', ok);
      el.classList.toggle('cannot-drop', Boolean(connecting) && !ok && key !== fromKey);
    });
  }

  function render() {
    const { x, y, k } = editor.ui.view;
    const transform = `translate(${x} ${y}) scale(${k})`;
    viewport.setAttribute('transform', transform);
    grid.setAttribute('patternTransform', transform);
    renderNodes();
    renderEdges();
    renderDraft();
    markPorts();
  }

  return { render };
}
