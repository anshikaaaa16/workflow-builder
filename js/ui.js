import { CATEGORIES, NODE_TYPES, PORT_TYPES } from './catalog.js';
import { AddPort, DeleteSelection, RemovePort, RenameNode, SetRouting } from './commands.js';
import { findNode, findPort } from './graph.js';
import { NODE_DRAG_TYPE } from './interactions.js';
import { canAddPort } from './rules.js';
import { exportGraph, importGraph } from './schema.js';
import { uid } from './utils.js';

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (value === true) el.setAttribute(key, '');
    else if (value !== false && value !== null && value !== undefined) el.setAttribute(key, value);
  });
  children.flat().forEach((child) => {
    if (child !== null && child !== undefined && child !== false) {
      el.append(child instanceof Node ? child : String(child));
    }
  });
  return el;
}

export function createToaster(container) {
  return function toast(message, kind = 'info') {
    const el = h('div', { class: `toast toast-${kind}` }, message);
    container.append(el);
    while (container.children.length > 3) container.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 300);
    }, 3200);
  };
}

export function downloadJson(graph) {
  const text = JSON.stringify(exportGraph(graph), null, 2);
  const slug = graph.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow';
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = h('a', { href: url, download: `${slug}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function setupPalette(container, actions) {
  Object.entries(CATEGORIES).forEach(([category, title]) => {
    container.append(h('div', { class: 'palette-group-title' }, title));
    Object.entries(NODE_TYPES)
      .filter(([, def]) => def.category === category)
      .forEach(([type, def]) => {
        container.append(h('button', {
          type: 'button',
          class: 'palette-item',
          draggable: 'true',
          title: `Drag onto the canvas or click to add a ${def.label} node`,
          onDragstart: (event) => {
            event.dataTransfer.setData(NODE_DRAG_TYPE, type);
            event.dataTransfer.effectAllowed = 'copy';
          },
          onClick: () => actions.addNodeAt(type, actions.viewCenter()),
        },
        h('span', { class: `swatch cat-${category}` }),
        h('span', {}, h('strong', {}, def.label), h('small', {}, def.description))));
      });
  });
}

export function setupToolbar(editor, els, actions) {
  els.undo.addEventListener('click', actions.undo);
  els.redo.addEventListener('click', actions.redo);
  els.routing.addEventListener('change', () => {
    const to = els.routing.value;
    if (to !== editor.graph.routing) editor.run(new SetRouting(editor.graph.routing, to));
  });
  els.name.addEventListener('change', () => {
    const name = els.name.value.trim();
    if (name) editor.graph.name = name;
    els.name.value = editor.graph.name;
    editor.emit('meta');
  });
  els.name.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') els.name.blur();
  });
  els.zoomIn.addEventListener('click', () => actions.zoomCenter(1.2));
  els.zoomOut.addEventListener('click', () => actions.zoomCenter(1 / 1.2));
  els.zoomReset.addEventListener('click', actions.resetZoom);
  els.fit.addEventListener('click', actions.fitView);

  return function update() {
    const { history, graph, ui } = editor;
    const { labels, position } = history.timeline();
    els.undo.disabled = !history.canUndo();
    els.redo.disabled = !history.canRedo();
    els.undo.title = history.canUndo() ? `Undo: ${labels[position - 1]} (Ctrl+Z)` : 'Nothing to undo';
    els.redo.title = history.canRedo() ? `Redo: ${labels[position]} (Ctrl+Y)` : 'Nothing to redo';
    els.routing.value = graph.routing;
    if (document.activeElement !== els.name) els.name.value = graph.name;
    els.zoomReset.textContent = `${Math.round(ui.view.k * 100)}%`;
    els.empty.hidden = graph.nodes.length > 0;
  };
}

function portSummary(port) {
  const parts = [port.direction === 'in' ? 'Input' : 'Output', PORT_TYPES[port.dataType].label];
  if (port.maxConnections) parts.push(`max ${port.maxConnections}`);
  return parts.join(' · ');
}

export function setupInspector(editor, container, { toast, deleteSelection }) {
  let lastSignature = null;

  function nodePanel(node) {
    const def = NODE_TYPES[node.type];
    const isTrigger = def.category === 'trigger';

    const nameInput = h('input', { type: 'text', value: node.label, maxlength: '40', spellcheck: 'false' });
    nameInput.addEventListener('change', () => {
      const next = nameInput.value.trim();
      if (!next) {
        nameInput.value = node.label;
        toast('A node needs a name.', 'error');
      } else if (next !== node.label) {
        editor.run(new RenameNode(node.id, node.label, next));
      }
    });
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') nameInput.blur();
    });

    const portName = h('input', { type: 'text', placeholder: 'New port name', maxlength: '24' });
    const direction = h('select', { 'aria-label': 'Direction' },
      h('option', { value: 'in', disabled: isTrigger }, 'Input'),
      h('option', { value: 'out', selected: isTrigger }, 'Output'));
    const dataType = h('select', { 'aria-label': 'Port type' },
      Object.entries(PORT_TYPES).map(([value, info]) => h('option', { value, selected: value === 'flow' }, info.label)));

    const addPortForm = h('form', {
      class: 'add-port',
      onSubmit: (event) => {
        event.preventDefault();
        const port = {
          id: uid('p'),
          name: portName.value.trim(),
          direction: direction.value,
          dataType: dataType.value,
          maxConnections: direction.value === 'in' && dataType.value === 'data' ? 1 : null,
        };
        const check = canAddPort(node, port);
        if (!check.ok) {
          toast(check.reason, 'error');
          return;
        }
        editor.run(new AddPort(node.id, port, node.label));
      },
    }, portName, direction, dataType, h('button', { type: 'submit' }, '+ Add port'));

    const portList = h('ul', { class: 'port-list' }, node.ports.map((port) => h('li', {},
      h('span', { class: `port-icon type-${port.dataType}` }),
      h('span', { class: 'port-name', title: port.name }, port.name, ' ', h('small', {}, portSummary(port))),
      h('button', {
        type: 'button',
        class: 'icon-button',
        title: `Remove "${port.name}"`,
        'aria-label': `Remove port ${port.name}`,
        onClick: () => editor.run(new RemovePort(node.id, port.id, `Remove port "${port.name}" from "${node.label}"`)),
      }, '✕'))));

    return [
      h('h2', {}, 'Node'),
      h('label', { class: 'field' }, h('span', {}, 'Name'), nameInput),
      h('div', { class: 'node-meta' },
        h('span', { class: `badge cat-${def.category}` }, def.category), ' ', def.label, ' — ', def.description),
      h('h3', {}, `Ports (${node.ports.length})`),
      node.ports.length ? portList : h('p', { class: 'muted' }, 'No ports yet.'),
      addPortForm,
      h('button', { type: 'button', class: 'danger', onClick: deleteSelection }, 'Delete node'),
    ];
  }

  function edgePanel(edge) {
    const source = findPort(editor.graph, edge.source);
    const target = findPort(editor.graph, edge.target);
    return [
      h('h2', {}, 'Connection'),
      h('div', { class: 'connection-summary' },
        h('div', {}, h('span', { class: 'muted' }, 'From '), h('strong', {}, source.node.label), ' › ', source.port.name),
        h('div', {}, h('span', { class: 'muted' }, 'To '), h('strong', {}, target.node.label), ' › ', target.port.name),
        h('div', { class: 'muted' }, `${PORT_TYPES[source.port.dataType].label} → ${PORT_TYPES[target.port.dataType].label}`)),
      h('button', { type: 'button', class: 'danger', onClick: deleteSelection }, 'Delete connection'),
    ];
  }

  function multiPanel(count) {
    return [
      h('h2', {}, 'Selection'),
      h('p', {}, `${count} nodes selected. Drag any of them to move them together.`),
      h('button', {
        type: 'button',
        class: 'danger',
        onClick: () => editor.run(new DeleteSelection([...editor.ui.selectedNodes])),
      }, `Delete ${count} nodes`),
    ];
  }

  function emptyPanel() {
    const tip = (...parts) => h('li', {}, ...parts);
    const key = (text) => h('kbd', {}, text);
    return [
      h('h2', {}, 'Inspector'),
      h('p', { class: 'muted' }, 'Select a node or connection to edit it.'),
      h('ul', { class: 'tips' },
        tip('Drag from an output port to an input port to connect.'),
        tip('Matching ports glow green while you drag a wire.'),
        tip(key('Shift'), ' + click to select several nodes.'),
        tip('Drag the background, or hold ', key('Space'), ', to pan. Scroll to zoom.'),
        tip(key('Ctrl'), ' + ', key('Z'), ' undo · ', key('Ctrl'), ' + ', key('Y'), ' redo'),
        tip(key('Delete'), ' removes the selection.'),
        tip('Hold ', key('Alt'), ' while dragging to turn off grid snapping.')),
    ];
  }

  return function update() {
    const { graph, ui } = editor;
    const selected = [...ui.selectedNodes];
    const node = selected.length === 1 ? findNode(graph, selected[0]) : null;
    const edge = ui.selectedEdge ? graph.edges.find((e) => e.id === ui.selectedEdge) : null;

    const nodeInfo = node && { id: node.id, label: node.label, ports: node.ports };
    const signature = JSON.stringify({ selected, nodeInfo, edge, nodes: graph.nodes.length });
    if (signature === lastSignature) return;
    lastSignature = signature;

    let content;
    if (node) content = nodePanel(node);
    else if (selected.length > 1) content = multiPanel(selected.length);
    else if (edge) content = edgePanel(edge);
    else content = emptyPanel();
    container.replaceChildren(...content);
  };
}

export function setupHistoryPanel(editor, list, count) {
  return function update() {
    const { labels, position } = editor.history.timeline();
    count.textContent = `${position} / ${labels.length}`;
    const items = ['Start', ...labels].map((label, index) => {
      let state = 'past';
      if (index === position) state = 'current';
      else if (index > position) state = 'future';
      return h('li', { class: state },
        h('button', {
          type: 'button',
          title: index === position ? 'Current state' : 'Jump to this point',
          onClick: () => editor.history.jumpTo(index),
        }, label));
    });
    list.replaceChildren(...items);
    list.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  };
}

export function setupJsonDialog(editor, els, { toast, applyImport }) {
  function showErrors(errors) {
    els.errors.replaceChildren(...errors.map((e) => h('li', {}, e)));
    els.errors.hidden = errors.length === 0;
  }

  function open(text = JSON.stringify(exportGraph(editor.graph), null, 2), errors = []) {
    els.text.value = text;
    showErrors(errors);
    els.dialog.showModal();
  }

  els.copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(els.text.value);
      toast('JSON copied to clipboard', 'success');
    } catch {
      els.text.select();
      toast('Press Ctrl+C to copy the selected JSON');
    }
  });

  els.download.addEventListener('click', () => {
    const result = importGraph(els.text.value);
    if (!result.ok) {
      showErrors(result.errors);
      return;
    }
    downloadJson(result.graph);
  });

  els.load.addEventListener('click', () => {
    const result = importGraph(els.text.value);
    if (!result.ok) {
      showErrors(result.errors);
      return;
    }
    els.dialog.close();
    applyImport(result.graph, 'Import JSON');
  });

  return { open };
}
