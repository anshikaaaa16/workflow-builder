import test from 'node:test';
import assert from 'node:assert/strict';
import { RetryError, retry } from '../js/utils.js';

const noWait = () => Promise.resolve();

test('returns straight away when the first attempt works', async () => {
  let calls = 0;
  const result = await retry(() => { calls += 1; return 'ok'; }, { wait: noWait });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('keeps trying until an attempt succeeds', async () => {
  const retried = [];
  const result = await retry((attempt) => {
    if (attempt < 3) throw new Error(`fail ${attempt}`);
    return `worked on ${attempt}`;
  }, { wait: noWait, onRetry: (attempt) => retried.push(attempt) });
  assert.equal(result, 'worked on 3');
  assert.deepEqual(retried, [1, 2]);
});

test('gives up after 5 attempts with the last error', async () => {
  let calls = 0;
  await assert.rejects(
    retry(async () => { calls += 1; throw new Error('offline'); }, { wait: noWait }),
    (error) => {
      assert.ok(error instanceof RetryError);
      assert.equal(error.attempts, 5);
      assert.equal(error.cause.message, 'offline');
      assert.match(error.message, /Failed after 5 attempts: offline/);
      return true;
    },
  );
  assert.equal(calls, 5);
});

test('waits longer before each retry (exponential backoff)', async () => {
  const waits = [];
  await assert.rejects(retry(() => { throw new Error('x'); }, {
    delay: 100,
    wait: (ms) => { waits.push(ms); return Promise.resolve(); },
  }));
  assert.deepEqual(waits, [100, 200, 400, 800]);
});

test('the number of attempts can be changed', async () => {
  let calls = 0;
  await assert.rejects(retry(() => { calls += 1; throw new Error('x'); }, { attempts: 2, wait: noWait }));
  assert.equal(calls, 2);
});
