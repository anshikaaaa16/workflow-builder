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

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RetryError extends Error {
  constructor(attempts, cause) {
    super(`Failed after ${attempts} attempts: ${cause?.message || cause}`);
    this.name = 'RetryError';
    this.attempts = attempts;
    this.cause = cause;
  }
}

export async function retry(task, { attempts = 5, delay = 300, onRetry = () => {}, wait = sleep } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      onRetry(attempt, error);
      await wait(delay * 2 ** (attempt - 1));
    }
  }
  throw new RetryError(attempts, lastError);
}
