import { describe, it, expect } from 'vitest';
import { countChars, countLines, countManuscriptPages } from './counter.js';

describe('countChars', () => {
  it('本文の文字数を数える', () => {
    expect(countChars('あいうえお')).toBe(5);
  });

  it('改行は数えない', () => {
    expect(countChars('あい\nうえお')).toBe(5);
  });

  it('ルビは数えず親文字だけ数える', () => {
    expect(countChars('｜黄昏《たそがれ》')).toBe(2);
  });

  it('傍点の記号は数えない', () => {
    expect(countChars('《《絶対》》')).toBe(2);
  });

  it('空文字列は 0', () => {
    expect(countChars('')).toBe(0);
  });
});

describe('countLines', () => {
  it('20字に満たない段落は1行', () => {
    expect(countLines('あいうえお')).toBe(1);
  });

  it('ちょうど20字は1行', () => {
    expect(countLines('あ'.repeat(20))).toBe(1);
  });

  it('21字は2行', () => {
    expect(countLines('あ'.repeat(21))).toBe(2);
  });

  it('空行も1行として数える', () => {
    expect(countLines('あ\n\nい')).toBe(3);
  });

  it('1行あたりの字数を変えられる', () => {
    expect(countLines('あ'.repeat(30), 15)).toBe(2);
  });
});

describe('countManuscriptPages', () => {
  it('400字ちょうどは1.0枚', () => {
    expect(countManuscriptPages('あ'.repeat(20) + ('\n' + 'あ'.repeat(20)).repeat(19))).toBe(1);
  });

  it('半端な枚数は小数第1位に丸める', () => {
    expect(countManuscriptPages('あ'.repeat(20) + ('\n' + 'あ'.repeat(20)).repeat(9))).toBe(0.5);
  });

  it('空文字列は 0', () => {
    expect(countManuscriptPages('')).toBe(0);
  });
});
