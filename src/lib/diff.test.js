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

  it('元が空なら全て追加', () => {
    expect(diffChars('', 'あい')).toEqual([{ type: 'add', value: 'あい' }]);
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

  it('削除が多いときは、似た段落だけ change にして余りを remove にする', () => {
    const hunks = diffParagraphs(['雨が降る', '風が吹く', '雪が舞う'], ['雨が降った']);
    expect(hunks.map((h) => h.type)).toEqual(['change', 'remove', 'remove']);
  });

  it('追加が多いときは、似た段落だけ change にして余りを add にする', () => {
    const hunks = diffParagraphs(['雨が降る'], ['雨が降った', '風が吹く', '雪が舞う']);
    expect(hunks.map((h) => h.type)).toEqual(['change', 'add', 'add']);
  });

  it('似ていない段落はペアにせず、削除と追加に分ける', () => {
    const hunks = diffParagraphs(['あ', 'い', 'う'], ['ア']);
    expect(hunks.map((h) => h.type)).toEqual(['remove', 'remove', 'remove', 'add']);
  });

  it('全て削除しても remove として出る', () => {
    expect(diffParagraphs(['あ'], [])).toEqual([{ type: 'remove', a: 'あ' }]);
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

describe('性能', () => {
  it('5000字の段落を1文字だけ変えた比較が100ミリ秒以内に終わる', () => {
    const a = 'あ'.repeat(2500) + 'い' + 'う'.repeat(2500);
    const b = 'あ'.repeat(2500) + 'え' + 'う'.repeat(2500);
    const start = performance.now();
    const result = diffChars(a, b);
    expect(performance.now() - start).toBeLessThan(100);
    expect(result).toEqual([
      { type: 'equal', value: 'あ'.repeat(2500) },
      { type: 'remove', value: 'い' },
      { type: 'add', value: 'え' },
      { type: 'equal', value: 'う'.repeat(2500) },
    ]);
  });

  it('長い段落を全面書き換えしても、段落まるごとの置換として返る', () => {
    const a = 'あ'.repeat(5000);
    const b = 'い'.repeat(5000);
    expect(diffChars(a, b)).toEqual([
      { type: 'remove', value: a },
      { type: 'add', value: b },
    ]);
  });

  it('1000段落・各200字の比較が2秒以内に終わる', () => {
    const a = Array.from({ length: 1000 }, (_, i) => `段落${i}` + 'あ'.repeat(200));
    const b = a.map((p, i) => (i % 10 === 0 ? p.replace('あ', 'い') : p));
    const start = performance.now();
    diffParagraphs(a, b);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
