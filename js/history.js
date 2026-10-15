export class History {
  constructor(graph, { limit = 200, onChange = () => {} } = {}) {
    this.graph = graph;
    this.limit = limit;
    this.onChange = onChange;
    this.done = [];
    this.undone = [];
  }

  execute(command) {
    command.do(this.graph);
    this.done.push(command);
    if (this.done.length > this.limit) this.done.shift();
    this.undone = [];
    this.onChange();
  }

  undo({ silent = false } = {}) {
    const command = this.done.pop();
    if (!command) return false;
    command.undo(this.graph);
    this.undone.push(command);
    if (!silent) this.onChange();
    return true;
  }

  redo({ silent = false } = {}) {
    const command = this.undone.pop();
    if (!command) return false;
    command.do(this.graph);
    this.done.push(command);
    if (!silent) this.onChange();
    return true;
  }

  jumpTo(position) {
    let changed = false;
    while (this.done.length > position && this.undo({ silent: true })) changed = true;
    while (this.done.length < position && this.redo({ silent: true })) changed = true;
    if (changed) this.onChange();
  }

  canUndo() {
    return this.done.length > 0;
  }

  canRedo() {
    return this.undone.length > 0;
  }

  timeline() {
    return {
      labels: [...this.done, ...[...this.undone].reverse()].map((c) => c.label),
      position: this.done.length,
    };
  }

  clear() {
    this.done = [];
    this.undone = [];
    this.onChange();
  }
}
