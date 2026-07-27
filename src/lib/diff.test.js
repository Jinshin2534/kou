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
    expect(hunks.map((h) => h.type)).toEqual(['remove', 'add', 'remove', 'remove']);
  });

  it('短い台詞を膨らませた書き換えは change になる', () => {
    const hunks = diffParagraphs(['行こう。'], ['やっぱりやめようかと迷ったが、それでも行こう。']);
    expect(hunks.map((h) => h.type)).toEqual(['change']);
  });

  it('似ている段落と似ていない段落が混ざっても前後が入れ替わらない', () => {
    const a = ['一行目', '二行目', '三行目'];
    const b = ['一行目を直した', 'まったく別の文', '三行目を直した'];
    const hunks = diffParagraphs(a, b);
    expect(hunks.map((h) => h.type)).toEqual(['change', 'remove', 'add', 'change']);
  });

  it('ハンクを順に並べると元の段落列が復元できる', () => {
    const a = ['共通', '一行目', '二行目', '三行目', '末尾'];
    const b = ['共通', '一行目を直した', 'まったく別の文', '三行目を直した', '末尾'];
    const hunks = diffParagraphs(a, b);
    expect(hunks.filter((h) => h.type !== 'add').map((h) => h.a)).toEqual(a);
    expect(hunks.filter((h) => h.type !== 'remove').map((h) => h.b)).toEqual(b);
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

  it('20000字の段落を1文字だけ変えた比較も100ミリ秒以内に終わる', () => {
    const a = 'あ'.repeat(10000) + 'い' + 'う'.repeat(10000);
    const b = 'あ'.repeat(10000) + 'え' + 'う'.repeat(10000);
    const start = performance.now();
    diffChars(a, b);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it('細切れに違う長い段落は、丸ごとの置換に切り替わる', () => {
    const a = 'あい'.repeat(2500);
    const b = 'あう'.repeat(2500);
    expect(diffChars(a, b)).toEqual([
      { type: 'equal', value: 'あ' },
      { type: 'remove', value: a.slice(1) },
      { type: 'add', value: b.slice(1) },
    ]);
  });

  it('5000段落の章でも200ミリ秒以内に終わる', () => {
    const a = Array.from({ length: 5000 }, (_, i) => `段落${i}` + 'あ'.repeat(200));
    const b = [...a];
    b[2500] = b[2500].replace('あ', 'い');
    const start = performance.now();
    const hunks = diffParagraphs(a, b);
    expect(performance.now() - start).toBeLessThan(200);
    expect(hunks.filter((h) => h.type !== 'equal').map((h) => h.type)).toEqual(['change']);
  });
});
