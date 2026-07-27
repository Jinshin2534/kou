import { describe, it, expect } from 'vitest';
import { splitParagraphs, joinParagraphs, parseAnnotations, stripAnnotations } from './text.js';

describe('splitParagraphs', () => {
  it('改行で段落に分ける', () => {
    expect(splitParagraphs('一行目\n二行目')).toEqual(['一行目', '二行目']);
  });

  it('空行も段落として残す', () => {
    expect(splitParagraphs('一行目\n\n三行目')).toEqual(['一行目', '', '三行目']);
  });

  it('空文字列は空配列', () => {
    expect(splitParagraphs('')).toEqual([]);
  });
});

describe('joinParagraphs', () => {
  it('splitParagraphs の逆になる', () => {
    const text = '一行目\n\n三行目';
    expect(joinParagraphs(splitParagraphs(text))).toBe(text);
  });
});

describe('parseAnnotations', () => {
  it('記法が無ければ text ひとつ', () => {
    expect(parseAnnotations('普通の文')).toEqual([{ type: 'text', value: '普通の文' }]);
  });

  it('全角縦棒のルビを解析する', () => {
    expect(parseAnnotations('彼は｜黄昏《たそがれ》を見た')).toEqual([
      { type: 'text', value: '彼は' },
      { type: 'ruby', base: '黄昏', ruby: 'たそがれ' },
      { type: 'text', value: 'を見た' },
    ]);
  });

  it('半角縦棒のルビも解析する', () => {
    expect(parseAnnotations('|黄昏《たそがれ》')).toEqual([
      { type: 'ruby', base: '黄昏', ruby: 'たそがれ' },
    ]);
  });

  it('傍点を解析する', () => {
    expect(parseAnnotations('これは《《絶対》》に違う')).toEqual([
      { type: 'text', value: 'これは' },
      { type: 'emphasis', value: '絶対' },
      { type: 'text', value: 'に違う' },
    ]);
  });

  it('ルビと傍点が混在しても順に解析する', () => {
    expect(parseAnnotations('《《雨》》の｜匂《にお》い')).toEqual([
      { type: 'emphasis', value: '雨' },
      { type: 'text', value: 'の' },
      { type: 'ruby', base: '匂', ruby: 'にお' },
      { type: 'text', value: 'い' },
    ]);
  });

  it('空行は空配列', () => {
    expect(parseAnnotations('')).toEqual([]);
  });
});

describe('stripAnnotations', () => {
  it('ルビを落として親文字だけ残す', () => {
    expect(stripAnnotations('彼は｜黄昏《たそがれ》を見た')).toBe('彼は黄昏を見た');
  });

  it('傍点の記号を落とす', () => {
    expect(stripAnnotations('これは《《絶対》》に違う')).toBe('これは絶対に違う');
  });

  it('複数行を処理して改行を保つ', () => {
    expect(stripAnnotations('｜雨《あめ》\n《《風》》')).toBe('雨\n風');
  });
});
