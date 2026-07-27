import { describe, it, expect } from 'vitest';
import { diffParagraphs } from './diff.js';
import { defaultChoices, mergeParagraphs } from './merge.js';

const hunks = diffParagraphs(['共通', '風が冷たい', '消える段落'], ['共通', '雨が冷たい', '増える段落']);

describe('defaultChoices', () => {
  it('変更のあるハンクだけを b で埋める', () => {
    const choices = defaultChoices(hunks);
    expect(choices[0]).toBeUndefined();
    expect(choices[1]).toBe('b');
  });
});

describe('mergeParagraphs', () => {
  it('選択を省略すると b 側になる', () => {
    expect(mergeParagraphs(hunks)).toEqual(['共通', '雨が冷たい', '増える段落']);
  });

  it('change で a を選ぶと元の段落が残る', () => {
    expect(mergeParagraphs(hunks, { 1: 'a' })).toEqual(['共通', '風が冷たい', '増える段落']);
  });

  it('change で both を選ぶと両方が並ぶ', () => {
    expect(mergeParagraphs(hunks, { 1: 'both' })).toEqual([
      '共通',
      '風が冷たい',
      '雨が冷たい',
      '増える段落',
    ]);
  });

  it('remove で a を選ぶと消えた段落が復活する', () => {
    const h = diffParagraphs(['あ', 'い'], ['あ']);
    expect(mergeParagraphs(h, { 1: 'a' })).toEqual(['あ', 'い']);
  });

  it('remove で b を選ぶと段落は消えたまま', () => {
    const h = diffParagraphs(['あ', 'い'], ['あ']);
    expect(mergeParagraphs(h, { 1: 'b' })).toEqual(['あ']);
  });

  it('add で a を選ぶと追加を取り込まない', () => {
    const h = diffParagraphs(['あ'], ['あ', 'い']);
    expect(mergeParagraphs(h, { 1: 'a' })).toEqual(['あ']);
  });

  it('add で b を選ぶと追加を取り込む', () => {
    const h = diffParagraphs(['あ'], ['あ', 'い']);
    expect(mergeParagraphs(h, { 1: 'b' })).toEqual(['あ', 'い']);
  });

  it('空のハンクは空配列', () => {
    expect(mergeParagraphs([])).toEqual([]);
  });

  it('全て a を選ぶと比較元と一致する', () => {
    const a = ['共通', '風が冷たい', '消える段落'];
    const choices = Object.fromEntries(hunks.map((_, i) => [i, 'a']));
    expect(mergeParagraphs(hunks, choices)).toEqual(a);
  });

  it('削除と追加が混ざっていても、全て a なら比較元・全て b なら比較先と一致する', () => {
    const a = ['共通', '風が冷たい', '消える段落', '末尾'];
    const b = ['共通', '雨が冷たい', 'まったく別の文', '増える段落', '末尾'];
    const mixed = diffParagraphs(a, b);
    expect(mixed.map((h) => h.type)).toContain('remove');
    expect(mixed.map((h) => h.type)).toContain('add');

    const allA = Object.fromEntries(mixed.map((_, i) => [i, 'a']));
    const allB = Object.fromEntries(mixed.map((_, i) => [i, 'b']));
    expect(mergeParagraphs(mixed, allA)).toEqual(a);
    expect(mergeParagraphs(mixed, allB)).toEqual(b);
  });

  it('想定外の選択値は b として扱い、段落を落とさない', () => {
    const h = diffParagraphs(['あ'], ['あ', 'い']);
    expect(mergeParagraphs(h, { 1: 'x' })).toEqual(['あ', 'い']);
  });
});
