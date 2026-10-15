# Visual Workflow Builder

A node-based workflow editor. You drag nodes onto a grid and connect their typed ports with wires.
It has:

- custom connector routing: curved (Bezier) or right-angle (orthogonal)
- rules that block illegal connections
- full undo/redo built on the Command Pattern
- JSON export and import

It's built with **plain HTML, CSS and JavaScript (ES modules)**. There's no framework, no build step and
no npm dependencies. The canvas, routing geometry, port rules and history engine are all hand-written.

## Run it

You need **Node.js 18 or newer**.

```bash
npm start
```

Then open **http://localhost:3000**. There's nothing to install: `npm start` runs a small static server
(`server.js`) that uses Node's built-in modules.

> You can't open `index.html` by double-clicking it, because browsers block ES modules on `file://`.
> Any static server works instead, e.g. VS Code "Live Server" or `npx serve`.

Run the unit tests (Node's built-in test runner, also nothing to install):

```bash
npm test
```

## Features

| Requirement | Where | How |
|---|---|---|
| Dynamic Bezier / orthogonal connectors | `js/geometry.js` | Wires are recalculated from node positions on every frame while you drag. The **Wires** dropdown switches between curved and right-angle routing. Right-angle wires detour around their source and target nodes when the target is behind the source. |
| Port matching rules | `js/rules.js` | Ports are typed: **Trigger**, **Flow** or **Data**. While you drag a wire, valid targets glow green and the rest fade. An invalid drop shows the reason. |
| Undo / redo (time travel) | `js/commands.js`, `js/history.js` | Every change is a command object with `do()` and `undo()`. **Ctrl+Z**, **Ctrl+Y** and **Ctrl+Shift+Z** work, and you can click any entry in the History panel to jump there. |
| Export / import JSON | `js/schema.js` | **Export** downloads a `.json` file, **Import** loads one, and **JSON** opens an editor where you can view, paste or edit the raw JSON. Imports are fully validated and can be undone. |

Extras:
- snap-to-grid, which you can turn off by holding **Alt** while dragging
- pan and zoom
- multi-select
- inspector panel to rename nodes and add or remove ports
- autosave to `localStorage`
- bundled sample workflow

## Port rules

| From (output) | Can connect to (input) |
|---|---|
| Trigger | Flow |
| Flow | Flow |
| Data | Data |

The app also rejects:

- connecting a node to itself
- output → output or input → input
- duplicate wires
- wires that would create a **loop** (a cycle)
- more wires than an input's `maxConnections` (Data inputs take one)
- inputs on trigger nodes, and trigger outputs on non-trigger nodes

## What counts as an undoable change

- add node
- move node(s)
- delete node(s) or connection(s), including the wires attached to deleted nodes
- connect
- add port
- remove port, including its wires
- rename node
- switch routing mode
- import, load sample and clear canvas

Dragging records **one** history entry when you release the mouse, not one per pixel.

## JSON schema

```json
{
  "version": 1,
  "meta": { "name": "New signup onboarding", "routing": "bezier", "exportedAt": "2026-10-15T10:00:00.000Z" },
  "nodes": [
    {
      "id": "signup",
      "type": "webhook",
      "label": "New signup",
      "position": { "x": 40, "y": 160 },
      "ports": [
        { "id": "out-fired", "name": "On request", "direction": "out", "dataType": "trigger", "maxConnections": null }
      ]
    }
  ],
  "edges": [
    { "id": "e1", "source": { "nodeId": "signup", "portId": "out-fired" }, "target": { "nodeId": "is-business", "portId": "in-run" } }
  ]
}
```

- `type`: one of `webhook`, `schedule`, `http`, `email`, `transform`, `delay`, `condition`, `merge`.
- `direction`: `in` or `out`.
- `dataType`: `trigger`, `flow` or `data`.
- `maxConnections`: a positive integer, or `null` for unlimited.
- `source` must be an output port and `target` an input port.

An import is checked before anything changes. The checks cover:

- valid JSON
- the version number
- required fields and types
- unique ids
- known node types
- numeric positions
- every port, against the port rules
- every edge, against the connection rules (including loops and limits)

If anything fails, the canvas is left untouched and every problem is listed. A sample file is in
[`samples/sample.json`](samples/sample.json).

## Keyboard & mouse

| Action | Input |
|---|---|
| Add a node | Drag from the palette, or click a palette item |
| Connect | Drag from a port to a port on another node |
| Move | Drag a node. Hold **Alt** to turn off snapping |
| Multi-select | **Shift**+click, or **Ctrl+A** |
| Delete selection | **Delete** / **Backspace** |
| Undo / redo | **Ctrl+Z** / **Ctrl+Y** or **Ctrl+Shift+Z** |
| Pan | Drag the background, middle-drag, or hold **Space** and drag |
| Zoom | Mouse wheel, or the controls in the bottom-right |
| Cancel / deselect | **Esc** |

## Project layout

```
index.html          page layout
styles.css          all styling, light + dark themes
server.js           tiny static server for npm start
js/main.js          starts the app and connects the pieces
js/state.js         the editor object: graph, UI state, events
js/graph.js         graph helpers (find node/port, etc.)
js/catalog.js       node types and port types
js/rules.js         connection and port rules
js/geometry.js      node sizes, port positions, Bezier + orthogonal routing
js/commands.js      the undoable commands
js/history.js       undo/redo stacks
js/schema.js        JSON export/import + validation
js/render.js        draws nodes and wires as SVG
js/interactions.js  mouse, keyboard, pan/zoom, drag-and-drop
js/ui.js            palette, toolbar, inspector, history list, JSON dialog, toasts
samples/sample.json example workflow
tests/              unit tests (node --test)
docs/WALKTHROUGH.md how the code works, file by file
```

See [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md) for a detailed explanation of the design.

## Assumptions

- Workflows are directed and acyclic: a wire can never make a loop. That's what most workflow engines
  expect, and it keeps execution order well-defined.
- Node types come from a fixed catalog. Users can add or remove ports on any node, but the port rules still apply.
- The workflow name isn't part of undo history. It's a document setting, not a canvas change.
- The app targets desktop browsers (latest Chrome, Edge, Firefox or Safari).

## Use of AI tools

AI coding assistants were used while building this project, which the assignment allows.
