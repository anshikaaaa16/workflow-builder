# Code Walkthrough

This guide explains how the Workflow Builder works, file by file, in plain language. Read it top to
bottom once and you'll be able to explain every part of the project in an interview.

---

## 1. The big picture

The whole app follows one loop:

```
 user does something  ──►  a Command changes the graph  ──►  History records it
        ▲                                                         │
        │                                                         ▼
   screen updates  ◄──  render() redraws SVG from the graph  ◄──  "changed!" event
```

- **The graph is the single source of truth.** It's a plain JavaScript object holding a list of nodes and a
  list of edges. The screen is always drawn *from* the graph and never edited directly.
- **Every change goes through a Command.** A command is a small object that knows how to `do()` a change
  and how to `undo()` it. That's what makes undo/redo possible.
- **Drawing is a pure function of state.** Wires have no stored shape. Each time we render, we calculate
  each wire's path from the current node positions. That's why wires follow nodes smoothly while you drag.

### What the graph looks like

```js
{
  name: 'New signup onboarding',
  routing: 'bezier',                       // or 'orthogonal'
  nodes: [
    {
      id: 'signup',
      type: 'webhook',                     // key into the catalog (catalog.js)
      label: 'New signup',
      position: { x: 40, y: 160 },
      ports: [
        { id: 'out-fired', name: 'On request', direction: 'out', dataType: 'trigger', maxConnections: null },
      ],
    },
  ],
  edges: [
    { id: 'e1', source: { nodeId: 'signup', portId: 'out-fired' }, target: { nodeId: 'is-business', portId: 'in-run' } },
  ],
}
```

An edge always goes **from an output port (source) to an input port (target)**. A `{ nodeId, portId }`
pair is called a **port ref** throughout the code.

The exported JSON has almost exactly the same shape, so export is mostly a clean copy.

---

## 2. Files, in the order the data flows

### `index.html` and `styles.css`

`index.html` is the static layout:

- a toolbar
- a palette on the left
- an `<svg>` canvas in the middle
- the inspector and history panels on the right
- a `<dialog>` for JSON

Inside the SVG:

```html
<rect class="grid-bg" fill="url(#grid)">   ← dotted grid background
<g id="viewport">                           ← everything that pans/zooms lives here
  <g id="edges">   wires
  <g id="nodes">   nodes
  <path id="draft"> the wire you are currently dragging
</g>
```

Panning and zooming change one attribute, `transform="translate(x y) scale(k)"`, on `#viewport`. The same
transform goes on the grid pattern so the dots move with the canvas.

`styles.css` defines colours as CSS variables in `:root`. Dark mode just redefines those variables inside
`@media (prefers-color-scheme: dark)`. Port and wire colours come from classes like `type-flow` and `type-data`.

### `js/catalog.js`: what nodes exist

This file holds the 8 node types (Webhook, Schedule, HTTP Request, Send Email, Transform, Delay, Condition,
Merge). Each type has:

- a `category`: `trigger`, `action` or `logic`, which sets its colour
- a list of default ports

It also defines the three **port types**:

| Port type | Meaning |
|---|---|
| `trigger` | An event that starts the workflow. Only trigger nodes have these, and only as outputs. |
| `flow` | "Run the next step." This is control flow. |
| `data` | A value handed from one node to another. |

`createNode(type, position)` copies a template into a fresh node with a unique id.

### `js/graph.js`: small helpers

- `findNode` and `findPort` look things up by id.
- `portKey(ref)` turns a port ref into a string like `"signup::out-fired"`, so it can be used in a `Set` or `Map`.
- `replaceContents(graph, next)` copies another graph's contents into the existing graph object. It's used
  by import and undo-of-import. We keep the **same object** because the rest of the app holds a reference to it.

### `js/rules.js`: what's allowed

`canConnect(graph, a, b)` returns `{ ok: true, source, target }` or `{ ok: false, reason }`. It checks, in order:

1. Both ports exist.
2. They're on different nodes (no self-loops).
3. One is an output and one is an input. If you dragged from an input, it **swaps them** so the result is
   always output → input. This is called normalising.
4. **Type compatibility**, using a lookup table:
   ```js
   const COMPATIBLE = { trigger: ['flow'], flow: ['flow'], data: ['data'] };
   ```
   So a Trigger output can only go into a Flow input, and so on.
5. No duplicate wire between the same two ports.
6. The input isn't full: `maxConnections`. Data inputs accept one wire, so a value has one clear source.
7. **No cycles.** If the target node can already reach the source node by following wires, adding this
   wire would make a loop.

The cycle check is a classic **depth-first search (DFS)**:

```js
function canReach(graph, startId, goalId) {
  const seen = new Set();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    if (id === goalId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of graph.edges) {
      if (edge.source.nodeId === id) stack.push(edge.target.nodeId);
    }
  }
  return false;
}
```

It starts at the target node, keeps following outgoing wires, and checks whether it ever arrives back at
the source node. The `seen` set stops it visiting the same node twice.

`canAddPort(node, port)` applies the rules for new ports:

- the port has a name
- the name is unique on that side of the node
- trigger nodes get no inputs
- only trigger nodes get trigger outputs

### `js/geometry.js`: where things are and how wires are shaped

**Node size and port positions.** Nodes are 200px wide. Their height grows with the number of ports.
Inputs sit on the left edge (`x = 0`) and outputs on the right edge (`x = 200`), one row of 24px each:

```js
y = HEADER_HEIGHT + PORT_TOP + index * PORT_ROW + PORT_ROW / 2
```

`portPosition(node, port)` adds the node's position to that offset, giving canvas coordinates.

**Bezier wires (curved).** An SVG cubic Bezier is written `M start C handle1, handle2, end`. The curve
leaves the start point heading towards `handle1` and arrives at the end coming from `handle2`.

```
 output ●───handle1                handle2───● input
          ╲__________________________╱
```

- `handle1` is placed to the **right** of the output and `handle2` to the **left** of the input, so the
  wire always leaves an output going right and enters an input from the left.
- How far the handles are pulled out (`pull`) is half the horizontal distance, with a minimum of 40px.
  That keeps short wires from looking kinked.
- When the target is **behind** the source (to its left), the handles are pulled further, between 80 and
  220px. The wire then makes a smooth S-shaped loop instead of a sharp zig-zag.

**Orthogonal wires (right-angle).** `orthogonalPoints(p1, p2, sourceBox, targetBox)` returns a list of
corner points, and `roundedPath(points)` turns them into an SVG path with rounded corners.

- Every wire first goes 24px straight out of its port. That short piece is the *stub*.
- **Forward case** (the target is to the right): the route is out, then down or up at the halfway x
  position, then into the target. That's 4 points.
- **Backward case** (the target is to the left): going straight would cut through the nodes, so the wire
  goes *around* them:
  - It travels right, past the right edge of **both** nodes.
  - It travels vertically to a horizontal "lane". The lane is in the gap between the two nodes if there's
    room. If the nodes overlap vertically, the lane runs underneath both.
  - It travels left, past the left edge of both nodes.
  - It travels into the target.

  ```
         ┌──────┐
         │source├──┐
         └──────┘  │
     ┌─────────────┘   ← lane in the gap
     │  ┌──────┐
     └─►│target│
        └──────┘
  ```

**Rounded corners.** For each corner, `roundedPath` stops the straight line `r` pixels before the corner.
It draws a small quadratic curve (`Q`) through the corner point, then continues `r` pixels after it. The
radius shrinks on very short segments so corners never overlap. `simplifyPoints` first removes duplicate
points and points in the middle of a straight line, so straight wires stay perfectly straight.

### `js/commands.js`: the Command Pattern

Every change to the graph is a class with the same shape:

```js
class RenameNode {
  constructor(nodeId, from, to) { ...; this.label = `Rename "${from}" to "${to}"`; }
  do(graph)   { findNode(graph, this.nodeId).label = this.to; }
  undo(graph) { findNode(graph, this.nodeId).label = this.from; }
}
```

The `label` is what appears in the History panel.

The commands are:

| Command | `do()` | `undo()` |
|---|---|---|
| `AddNode` | push node | remove it |
| `MoveNodes` | set positions to `to` | set positions to `from` |
| `AddEdge` | push edge | remove it |
| `DeleteSelection` | remove nodes, chosen edges **and every edge attached to those nodes** | put everything back **at its original index** |
| `AddPort` | push port | remove it |
| `RemovePort` | remove port **and its wires** | put both back |
| `RenameNode` | new label | old label |
| `SetRouting` | new routing | old routing |
| `ReplaceGraph` | snapshot the old graph, load the new one (import, load sample, clear) | restore the snapshot |

Delete and remove-port record **what they removed and where** (its index) inside `do()`. That lets
`undo()` restore the exact original order, so undo gives you a graph identical to the one before. The unit
tests check this with a deep-equality comparison.

**Why commands and not snapshots?** Snapshotting the whole graph on every change also works, and it's
simpler. But commands use less memory, give each history entry a readable name, and are the pattern the
assignment asked for. `ReplaceGraph` is the one command that does store a snapshot, because an import
really does replace everything.

### `js/history.js`: undo/redo stacks

There are two arrays, `done` and `undone`:

- `execute(cmd)` runs `cmd.do()`, pushes it onto `done`, and **clears `undone`**. Once you make a new
  change, the old "future" is gone, the same as in any editor.
- `undo()` pops from `done`, runs `undo()`, and pushes onto `undone`.
- `redo()` pops from `undone`, runs `do()`, and pushes back onto `done`.
- `jumpTo(n)` undoes or redoes repeatedly until exactly `n` commands are done. That's how clicking an item
  in the History panel time-travels. It fires one change event at the end, not one per step.
- `done` is capped at 200 entries, so memory can't grow forever.

### `js/state.js`: the editor object

`createEditor()` returns one object that every module shares:

- `graph`: the workflow data.
- `ui`: temporary screen state that is **not** part of the document and not in history:
  - `selectedNodes` (a Set)
  - `selectedEdge`
  - `view` (pan x/y and zoom k)
  - `connecting`, the wire currently being dragged
  - `hoverPort`
- `history`: the `History` instance.
- `subscribe(fn)` and `emit(reason)`: a tiny event system. Whenever something changes, `emit` calls every
  listener with a reason: `'graph'`, `'ui'`, `'view'`, `'drag'` or `'meta'`.

When history changes, the editor first removes any selected ids that no longer exist (for example after an
undo deleted that node), then emits `'graph'`.

### `js/render.js`: drawing the SVG

`render()` runs after every change and does four things:

1. **Viewport.** It sets the pan/zoom transform.
2. **Nodes.** It's *keyed*: each node's SVG element is kept in a `Map` by id. A node is rebuilt only if its
   label, type or ports changed, which is checked with a JSON "signature". Otherwise only its `transform`
   (position) and `selected` class are updated. This keeps dragging smooth.
3. **Edges.** All wire paths are recalculated from the current node positions with `edgePath()`. Each wire
   is two paths:
   - an invisible, 14px-wide one so it's easy to click
   - the visible thin one
4. **Ports.** It toggles CSS classes on each port:
   - `connected` fills the shape in
   - `can-drop` glows green while you drag a valid wire
   - `cannot-drop` fades out

   While you drag a wire, a draft path follows the mouse. It snaps to a port when you hover one, and a small
   hint says "Release to connect" or gives the exact reason it isn't allowed.

Port shapes differ by type, so they're readable without colour:

- ◆ diamond: trigger
- ● circle: flow
- ■ square: data

### `js/interactions.js`: mouse and keyboard

All pointer events are handled on the `<svg>` with **event delegation**. When you press down, the code
looks at what is under the pointer (`event.target.closest('.port')`, `.node`, `.edge`) and starts one
*gesture*:

| Pressed on | Gesture | During move | On release |
|---|---|---|---|
| a port | `connect` | the draft wire follows the mouse; `document.elementFromPoint` finds the port under the cursor | `canConnect` → `AddEdge`, or show the reason as a toast |
| a node | `drag` | positions update **directly** (live preview, snapped to the 20px grid) | **one** `MoveNodes` command from the start positions to the end positions |
| a wire | — | — | selects it |
| background | `pan` | `view.x` and `view.y` follow the mouse | — |

Why does dragging change positions directly and only create a command on release? If every pixel of
movement became a history entry, you'd need 100 undos to undo one drag.

Some other details:

- `setPointerCapture` keeps the drag working even if the mouse leaves the canvas.
- Validity is calculated **once**, when a connect gesture starts. It's stored in `ui.connecting.results`,
  so hovering doesn't re-run the rules. The graph can't change mid-drag anyway.
- **Zoom** keeps the point under the mouse fixed. It converts the mouse to world coordinates, changes `k`,
  then recomputes `x` and `y` so that world point lands under the mouse again.
- **Screen → world coordinates:** `world = (screen - canvasCorner - pan) / zoom`.
- `fitView()` finds the bounding box of all nodes and picks a zoom and pan that centre it on screen.
- Keyboard shortcuts are ignored while you're typing in an input or the JSON dialog is open, so Ctrl+Z
  inside a text box still undoes your typing.
- Palette drag-and-drop uses the browser's HTML5 drag events (`dragstart`, `dragover`, `drop`) with a
  custom data type.

### `js/schema.js`: export and import

`exportGraph(graph)` builds a clean JSON object:

- `version`
- `meta` (name, routing, export time)
- `nodes`
- `edges`

It copies only the known fields, so internal state never leaks into the export.

`importGraph(textOrObject)` is defensive. It never trusts the input. It:

1. Parses the JSON and reports syntax errors.
2. Checks `version === 1` and that `nodes` and `edges` are arrays.
3. Checks each node: text id, no duplicate ids, known type, numeric position, ports array.
4. Checks each port: unique id, known `dataType`, and the same `canAddPort` rules the UI uses.
5. Builds the graph **one edge at a time**, running each edge through the same `canConnect` as the UI.
   This catches duplicates, type mismatches, full inputs and cycles, exactly as if a user had drawn the wires.
6. Returns `{ ok, graph, errors }`.

If there are any errors, nothing is loaded and the JSON dialog lists them, for example
`edges[3]: A Trigger output cannot feed a Data input.`

Reusing the same rule functions for the UI and for import is important. A file can never sneak in a
connection that the UI would refuse.

### `js/ui.js`: panels

There's a small helper, `h(tag, props, ...children)`, that creates HTML elements. For example,
`h('button', { onClick: fn }, 'Delete')`. The rest of the file builds:

- **Palette:** a button per node type. Drag it onto the canvas or click it to add the node at the centre of the view.
- **Toolbar:** enables and disables Undo/Redo. Their tooltips say *what* will be undone ("Undo: Move 'Wait 1 day'").
- **Inspector:** shows one of four views:
  - a single node: rename it, list its ports with remove buttons, the add-port form, delete
  - a wire: from → to, delete
  - several nodes
  - nothing selected: tips

  It only rebuilds when the selection or the selected node's data changes. That way your cursor isn't
  kicked out of a text box while you type.
- **History panel:** a list of `Start` plus every command label. Past entries are normal, the current one
  is highlighted, and undone "future" entries are struck through. Clicking one calls `history.jumpTo(i)`.
- **JSON dialog:** copy, download, or edit and load.
- **Toasts:** short messages at the bottom of the screen.

### `js/main.js`: wiring it all together

1. Creates the editor, renderer and interactions.
2. Sets up all the panels.
3. Subscribes one listener that redraws the canvas and updates the panels for every change. It also
   autosaves to `localStorage` when the reason is `'graph'` or `'meta'`.
4. On start-up, loads the autosave if there's a valid one, otherwise the sample workflow, then fits the view.
   That initial load is not an undoable step.

`localStorage` calls are wrapped in `try/catch` because they can throw in private browsing or when storage
is full.

### `server.js`

This is a 30-line web server that uses Node's built-in `http` module. It serves files from the project
folder and refuses paths that try to escape it (like `/../secret`). It's needed only because browsers
won't load ES modules from `file://`.

---

## 3. Tests (`tests/`)

Run them with `npm test`. That uses Node's built-in test runner, so there's nothing to install. The tests
cover only the pure logic, which has no DOM:

- **rules.test.js:**
  - every valid and invalid connection case
  - normalising input→output drags
  - max connections
  - cycles
  - port-adding rules
- **history.test.js:**
  - for every command, undo gives back a graph *deep-equal* to the original, and redo gives the same result
    as the first `do`
  - a cascading delete restores the wires in their original order
  - a new command clears redo
  - `jumpTo`
  - the history limit
- **schema.test.js:**
  - export → import round-trip is lossless
  - the sample file is valid
  - invalid input is rejected with a clear message: bad JSON, wrong version, unknown type, missing node or
    port, illegal edge, backwards edge, illegal port
- **geometry.test.js:**
  - port positions
  - Bezier start and end points and handle direction
  - orthogonal wires only go horizontal or vertical
  - backward routes really go around both node boxes
  - rounded corners and point simplification

---

## 4. Demo script (2–3 minutes)

1. Open the app. The sample workflow loads.
2. Drag "Wait 1 day" around and show the wires re-curving live.
3. Switch **Wires** to *Right-angle* and drag "Notify sales CRM" to the left of "Wait 1 day". Show the wire
   routing around both nodes.
4. Drag from **New signup › On request**. Point out that only Flow inputs glow green. Drop it on a Data
   input and show the error message.
5. Try connecting **Notify sales CRM › Done** back to **Business email? › Run**. It's rejected because it
   would make a loop.
6. Add a Delay from the palette. Connect it, rename it in the inspector, and add a port.
7. Select "Format welcome" and press Delete. Its wires disappear too. Press **Ctrl+Z** and everything comes
   back. Click an early entry in the History panel to time-travel, then press **Ctrl+Y**.
8. Click **Export** and open the file to show the clean schema. Click **Clear**, then **Import** the file. Open
   **JSON**, break an edge on purpose, and show the validation errors.

---

## 5. Questions you might be asked

**Why no React or library like React Flow?**
The assignment is about custom geometry and state management. Writing them by hand shows I understand
them. The app is also small enough that plain DOM + SVG stays simple, and there's no build step for the
reviewer to run.

**How do wires update while dragging?**
Wire shapes aren't stored. Every render recalculates each path from the current node positions, and
dragging triggers a render on every pointer move.

**How does undo work for delete?**
`DeleteSelection.do()` remembers every removed node *and* every wire attached to them, along with their
original array positions. `undo()` puts them back at those positions, so the graph is identical to before.

**Why does a drag create only one history entry?**
During the drag we update positions directly for a live preview. On release we record a single `MoveNodes`
command with the start and end positions. Redo just sets the end positions again.

**How do you detect cycles?**
Before adding source → target, a depth-first search from the target checks whether it can already reach
the source. If it can, the new wire would close a loop.

**How is import kept safe?**
Imported data goes through the same `canAddPort` and `canConnect` rules the UI uses. It's built edge by
edge into a fresh graph. Any error means nothing is loaded and every error is shown.

**What would you add next?**
- Routing that avoids *all* nodes, not just the two endpoints. That would be A* on a grid or a
  visibility graph.
- Merging consecutive small moves into one history entry.
- Copy/paste.
- Minimap.
- Grouping of nodes.
- Real-time collaboration. Commands are a good base for syncing changes between users.
