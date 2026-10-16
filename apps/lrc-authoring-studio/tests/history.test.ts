import { describe, expect, it } from 'vitest';
import { TapHistory } from '../src/core/history';

function snapshot(atMs: number) {
  return { project: { lines: [] }, cursor: { line: 0, token: atMs }, atMs };
}

describe('TapHistory', () => {
  it('pops snapshots in reverse order and then returns undefined', () => {
    const history = new TapHistory();
    history.push(snapshot(1));
    history.push(snapshot(2));
    expect(history.pop()?.atMs).toBe(2);
    expect(history.pop()?.atMs).toBe(1);
    expect(history.pop()).toBeUndefined();
  });

  it('drops the oldest snapshots past the limit', () => {
    const history = new TapHistory(2);
    [1, 2, 3].forEach((n) => history.push(snapshot(n)));
    expect(history.pop()?.atMs).toBe(3);
    expect(history.pop()?.atMs).toBe(2);
    expect(history.pop()).toBeUndefined();
  });

  it('clears everything', () => {
    const history = new TapHistory();
    history.push(snapshot(1));
    history.clear();
    expect(history.pop()).toBeUndefined();
  });
});
