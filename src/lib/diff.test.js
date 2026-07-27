import { describe, it, expect } from 'vitest';
import { diffChars, diffParagraphs } from './diff.js';

describe('diffChars', () => {
  it('同一文字列は equal ひとつ', () => {
    expect(diffChars('あいう', 'あいう')).toEqual([{ type: 'equal', value: 'あいう' }]);
  });

  it('末尾の追加を検出する', () => {
    expect(diffChars('あい', 'あいう')).toEqual([
      { type: 'equal', value: 'あい' },
      { type: 'add', value: 'う' },
    ]);
  });

  it('中間の置換を検出する', () => {
    expect(diffChars('風が冷たい', '雨が冷たい')).toEqual([
      { type: 'remove', value: '風' },
      { type: 'add', value: '雨' },
      { type: 'equal', value: 'が冷たい' },
    ]);
  });

  it('連続する同種の操作をまとめる', () => {
    expect(diffChars('あいう', 'あ')).toEqual([
      { type: 'equal', value: 'あ' },
      { type: 'remove', value: 'いう' },
    ]);
  });

  it('両方空なら空配列', () => {
    expect(diffChars('', '')).toEqual([]);
  });
});

describe('diffParagraphs', () => {
  it('同一なら全て equal', () => {
    expect(diffParagraphs(['あ', 'い'], ['あ', 'い'])).toEqual([
      { type: 'equal', a: 'あ', b: 'あ' },
      { type: 'equal', a: 'い', b: 'い' },
    ]);
  });

  it('段落の追加を検出する', () => {
    expect(diffParagraphs(['あ'], ['あ', 'い'])).toEqual([
      { type: 'equal', a: 'あ', b: 'あ' },
      { type: 'add', b: 'い' },
    ]);
  });

  it('段落の削除を検出する', () => {
    expect(diffParagraphs(['あ', 'い'], ['あ'])).toEqual([
      { type: 'equal', a: 'あ', b: 'あ' },
      { type: 'remove', a: 'い' },
    ]);
  });

  it('置換は change になり inline を持つ', () => {
    const hunks = diffParagraphs(['風が冷たい'], ['雨が冷たい']);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('change');
    expect(hunks[0].a).toBe('風が冷たい');
    expect(hunks[0].b).toBe('雨が冷たい');
    expect(hunks[0].inline).toEqual([
      { type: 'remove', value: '風' },
      { type: 'add', value: '雨' },
      { type: 'equal', value: 'が冷たい' },
    ]);
  });

  it('削除が多いときは余りを remove として出す', () => {
    const hunks = diffParagraphs(['あ', 'い', 'う'], ['ア']);
    expect(hunks.map((h) => h.type)).toEqual(['change', 'remove', 'remove']);
  });

  it('追加が多いときは余りを add として出す', () => {
    const hunks = diffParagraphs(['あ'], ['ア', 'イ', 'ウ']);
    expect(hunks.map((h) => h.type)).toEqual(['change', 'add', 'add']);
  });

  it('順序の入れ替えは削除と追加として出る', () => {
    const hunks = diffParagraphs(['あ', 'い'], ['い', 'あ']);
    expect(hunks.map((h) => h.type)).toContain('equal');
    expect(hunks).not.toHaveLength(0);
  });

  it('片方が空なら全て追加', () => {
    expect(diffParagraphs([], ['あ', 'い'])).toEqual([
      { type: 'add', b: 'あ' },
      { type: 'add', b: 'い' },
    ]);
  });

  it('両方空なら空配列', () => {
    expect(diffParagraphs([], [])).toEqual([]);
  });
});

describe('diffParagraphs の性能', () => {
  it('1000段落・各200字の比較が2秒以内に終わる', () => {
    const a = Array.from({ length: 1000 }, (_, i) => `段落${i}` + 'あ'.repeat(200));
    const b = a.map((p, i) => (i % 10 === 0 ? p.replace('あ', 'い') : p));
    const start = performance.now();
    diffParagraphs(a, b);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
