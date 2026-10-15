export const GRID_SIZE = 20;

let counter = 0;

export function uid(prefix) {
  counter += 1;
  return `${prefix}_${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}

export function clone(value) {
  return structuredClone(value);
}

export function snap(value, size = GRID_SIZE) {
  return Math.round(value / size) * size;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
