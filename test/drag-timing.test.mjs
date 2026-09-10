import test from 'node:test';
import assert from 'node:assert/strict';
import { createDragTimingForwarder } from '../host/windows.mjs';

test('drag timing is opt-in, numeric-only, exact-schema, chunk-safe and bounded', () => {
  const previous = process.env.BOTDESK_DRAG_TIMING;
  const record = { phase: 1, checkCount: 3, moveCount: 0, elapsedMs: 500, costMs: 125, targetMs: 100, pointMs: 25, completed: 1 };
  const line = value => `BOTDESK_DRAG_TIMING ${JSON.stringify(value)}\n`;
  try {
    delete process.env.BOTDESK_DRAG_TIMING;
    const disabled = [];
    createDragTimingForwarder(value => disabled.push(value))(line(record));
    assert.deepEqual(disabled, []);
    process.env.BOTDESK_DRAG_TIMING = 'true';
    createDragTimingForwarder(value => disabled.push(value))(line(record));
    assert.deepEqual(disabled, []);
    process.env.BOTDESK_DRAG_TIMING = '1';
    const output = [], forward = createDragTimingForwarder(value => output.push(value));
    forward('private native exception/window title/token\n');
    for (const invalid of [
      { ...record, title: 'private' }, { ...record, pointMs: '25' }, { ...record, phase: 6 },
      { ...record, completed: 2 }, { ...record, elapsedMs: -1 }, { ...record, costMs: 1.5 },
      { ...record, moveCount: 257 }, { ...record, elapsedMs: 60001 },
    ]) forward(line(invalid));
    const valid = line(record);
    forward(valid.slice(0, 11));
    assert.deepEqual(output, []);
    forward(valid.slice(11));
    assert.deepEqual(output, [record]);
    for (let index = 0; index < 300; index++) forward(valid);
    assert.equal(output.length, 256);
    assert.ok(output.every(value => JSON.stringify(value) === JSON.stringify(record)));
    const oversized = [], limited = createDragTimingForwarder(value => oversized.push(value));
    limited('private'.repeat(10000)); limited(valid);
    assert.deepEqual(oversized, []);
  } finally {
    if (previous === undefined) delete process.env.BOTDESK_DRAG_TIMING;
    else process.env.BOTDESK_DRAG_TIMING = previous;
  }
});
