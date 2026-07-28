import { describe, it, expect } from 'vitest';
import { detectConflict } from './conflict.js';

describe('detectConflict', () => {
  it('本文が同じなら競合しない', () => {
    expect(detectConflict({ text: 'あ', updatedAt: 1 }, { text: 'あ', updatedAt: 2 })).toEqual({
      conflicted: false,
      keep: 'remote',
      stash: null,
    });
  });

  it('リモートが新しく本文が違えばリモートを採り、ローカルを退避する', () => {
    expect(detectConflict({ text: 'ろーかる', updatedAt: 1 }, { text: 'りもーと', updatedAt: 2 })).toEqual({
      conflicted: true,
      keep: 'remote',
      stash: 'ろーかる',
    });
  });

  it('ローカルが新しければローカルを採り、リモートを退避する', () => {
    expect(detectConflict({ text: 'ろーかる', updatedAt: 5 }, { text: 'りもーと', updatedAt: 2 })).toEqual({
      conflicted: true,
      keep: 'local',
      stash: 'りもーと',
    });
  });

  it('リモートが無ければ競合しない', () => {
    expect(detectConflict({ text: 'あ', updatedAt: 1 }, null)).toEqual({
      conflicted: false,
      keep: 'local',
      stash: null,
    });
  });
});
