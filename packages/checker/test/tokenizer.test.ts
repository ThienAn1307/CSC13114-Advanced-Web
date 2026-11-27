import { describe, expect, it } from 'vitest';
import { blankComments, tokenize, type Token } from '../src/tokenizer.ts';

const code = (...lines: string[]) => lines.join('\n') + '\n';
const kinds = (tokens: Token[]) => tokens.map((t) => [t.kind, t.text]);
const codeTexts = (source: string) =>
  tokenize(source)
    .filter((t) => t.kind !== 'literal')
    .map((t) => t.text);

describe('tokenize', () => {
  it('splits code into identifiers, keywords, numbers and punctuation', () => {
    expect(kinds(tokenize('std::sort(v.begin(), 10); p->rend(); for'))).toEqual([
      ['identifier', 'std'],
      ['punct', '::'],
      ['identifier', 'sort'],
      ['punct', '('],
      ['identifier', 'v'],
      ['punct', '.'],
      ['identifier', 'begin'],
      ['punct', '('],
      ['punct', ')'],
      ['punct', ','],
      ['number', '10'],
      ['punct', ')'],
      ['punct', ';'],
      ['identifier', 'p'],
      ['punct', '->'],
      ['identifier', 'rend'],
      ['punct', '('],
      ['punct', ')'],
      ['punct', ';'],
      ['keyword', 'for'],
    ]);
  });

  it('reads a whole word, so a keyword inside a longer name is not a keyword', () => {
    expect(kinds(tokenize('double done; int forward;'))).toEqual([
      ['keyword', 'double'],
      ['identifier', 'done'],
      ['punct', ';'],
      ['keyword', 'int'],
      ['identifier', 'forward'],
      ['punct', ';'],
    ]);
  });

  it('skips line comments and block comments', () => {
    expect(codeTexts(code('a // std::sort', '/* std::sort', '   std::sort */ b'))).toEqual([
      'a',
      'b',
    ]);
  });

  it('turns string, char and raw-string literals into one literal token each', () => {
    const source = 'f("std::sort", \'"\', R"x( )" std::sort )x", L"for");';
    const tokens = tokenize(source);
    expect(tokens.filter((t) => t.kind === 'literal').map((t) => t.text)).toEqual([
      '"std::sort"',
      "'\"'",
      'R"x( )" std::sort )x"',
      'L"for"',
    ]);
    expect(codeTexts(source)).toEqual(['f', '(', ',', ',', ',', ')', ';']);
  });

  it('keeps an escaped quote inside the string it belongs to', () => {
    expect(codeTexts('puts("say \\"std::sort\\" here"); x;')).toEqual([
      'puts',
      '(',
      ')',
      ';',
      'x',
      ';',
    ]);
  });

  it('reads digit separators as part of the number, not as a char literal', () => {
    const tokens = tokenize("int n = 1'000'000; std::sort(a, b); char c = 'x';");
    expect(tokens.filter((t) => t.kind === 'number').map((t) => t.text)).toEqual(["1'000'000"]);
    expect(tokens.filter((t) => t.kind === 'literal').map((t) => t.text)).toEqual(["'x'"]);
    expect(tokens.some((t) => t.text === 'sort')).toBe(true);
  });

  it('continues a line comment onto the next line after a backslash', () => {
    expect(codeTexts(code('// note \\', 'std::sort(a, b);', 'int x;'))).toEqual(['int', 'x', ';']);
  });

  it('gives every token its line in the original source (D15)', () => {
    const source = code(
      '/* first',
      '   second */',
      'auto s = R"(',
      'two lines)";',
      'std::sort(a, b);',
    );
    const sort = tokenize(source).find((t) => t.text === 'sort');
    expect(sort?.line).toBe(5);
  });

  it('marks the tokens of preprocessor lines, continued lines included', () => {
    const tokens = tokenize(
      code('#define FOR(i, n) \\', '  for (int i = 0; i < n; ++i)', 'int x;'),
    );
    const forToken = tokens.find((t) => t.text === 'for');
    const intAfter = tokens.filter((t) => t.text === 'int').at(-1);
    expect(forToken).toMatchObject({ kind: 'keyword', line: 2, inDirective: true });
    expect(intAfter).toMatchObject({ line: 3, inDirective: false });
  });

  it('reads the header name of an #include as one token, not as names', () => {
    const tokens = tokenize(code('#include <stack>', '#include "my_sort.h"'));
    expect(kinds(tokens)).toEqual([
      ['punct', '#'],
      ['identifier', 'include'],
      ['header-name', '<stack>'],
      ['punct', '#'],
      ['identifier', 'include'],
      ['header-name', '"my_sort.h"'],
    ]);
  });
});

// A backslash right before a newline joins two lines before anything else is read (a line splice).
describe('tokenize: line splices', () => {
  const at = (source: string, text: string) => tokenize(source).find((t) => t.text === text);

  it('joins a name split by a splice, on the line of its first character', () => {
    const source = code('int x;', 'std::so\\', 'rt(a, b);', 'int y;');
    expect(at(source, 'sort')).toMatchObject({ kind: 'identifier', line: 2 });
    expect(at(source, 'y')?.line).toBe(4);
  });

  it('joins a name split by a CRLF splice, and one with spaces after the backslash as g++ does', () => {
    expect(at('std::so\\\r\nrt(a, b);\r\n', 'sort')?.line).toBe(1);
    expect(at('std::so\\  \nrt(a, b);\n', 'sort')?.line).toBe(1);
  });

  it('joins keywords, numbers and punctuators', () => {
    expect(kinds(tokenize(code('f\\', 'or 1\\', '2 std:\\', ':x p-\\', '>y')))).toEqual([
      ['keyword', 'for'],
      ['number', '12'],
      ['identifier', 'std'],
      ['punct', '::'],
      ['identifier', 'x'],
      ['identifier', 'p'],
      ['punct', '->'],
      ['identifier', 'y'],
    ]);
  });

  it('reads a comment whose `//`, `/*` or `*/` is split by a splice', () => {
    expect(codeTexts(code('a /\\', '/ std::sort', 'b'))).toEqual(['a', 'b']);
    expect(codeTexts(code('a /\\', '* std::sort *\\', '/ b'))).toEqual(['a', 'b']);
    expect(codeTexts('a /\\\r\n/ std::sort\r\nb')).toEqual(['a', 'b']);
  });

  it('continues a string over a splice, with LF and with CRLF', () => {
    const lf = code('puts("a\\', 'b"); std::sort(x, y); // "');
    const expected = ['puts', '(', ')', ';', 'std', '::', 'sort', '(', 'x', ',', 'y', ')', ';'];
    expect(codeTexts(lf)).toEqual(expected);
    expect(codeTexts(lf.replaceAll('\n', '\r\n'))).toEqual(expected);
  });

  it('joins a string prefix and its quote', () => {
    expect(codeTexts(code('u\\', '8"std::sort" R\\', '"(std::sort " )" x'))).toEqual(['x']);
  });

  it('does not splice inside a raw string, and finds its end', () => {
    const source = code('auto s = R"x(a\\', ')x\\', '" b)x"; std::sort(p, q);');
    const tokens = tokenize(source);
    expect(tokens.find((t) => t.kind === 'literal')?.text).toBe('R"x(a\\\n)x\\\n" b)x"');
    expect(tokens.find((t) => t.text === 'sort')?.line).toBe(3);
  });

  it('keeps a directive going over a splice in the middle of a name', () => {
    const tokens = tokenize(code('#define SORT std::so\\', 'rt', 'int x;'));
    expect(tokens.find((t) => t.text === 'sort')).toMatchObject({ line: 1, inDirective: true });
    expect(tokens.find((t) => t.text === 'x')).toMatchObject({ line: 3, inDirective: false });
  });
});

describe('blankComments', () => {
  it('replaces every comment character with a space and keeps every newline (D15)', () => {
    const line = '// std::sort is fine here';
    const block = ['/* one', '   two */'];
    const source = code(`int a; ${line}`, block[0]!, `${block[1]!} int b;`);
    expect(blankComments(source)).toBe(
      code(
        `int a; ${' '.repeat(line.length)}`,
        ' '.repeat(block[0]!.length),
        `${' '.repeat(block[1]!.length)} int b;`,
      ),
    );
  });

  it('leaves strings alone, even when they hold comment markers', () => {
    const source = code('puts("// not a comment /* nor this */");');
    expect(blankComments(source)).toBe(source);
  });

  it('keeps CRLF line ends as they are', () => {
    expect(blankComments('a; // x\r\nb;\r\n')).toBe('a;     \r\nb;\r\n');
  });
});

describe('blankComments: line splices', () => {
  it('blanks a comment whose opener is split, and moves no line (D15)', () => {
    expect(blankComments(code('a; /\\', '/ x', 'b; /\\', '* y *\\', '/ c;'))).toBe(
      code('a;   ', '   ', 'b;   ', '      ', '  c;'),
    );
  });

  it('keeps a splice that is code, and a splice in a string', () => {
    const source = code('std::so\\', 'rt(a, b); puts("x\\', '// y");');
    expect(blankComments(source)).toBe(source);
  });

  it('blanks a comment after a string continued by a CRLF splice', () => {
    expect(blankComments('puts("a\\\r\nb"); // hi\r\nc;\r\n')).toBe(
      'puts("a\\\r\nb");      \r\nc;\r\n',
    );
  });

  it('keeps a splice that follows a block comment', () => {
    expect(blankComments(code('/* x */\\', 'a;'))).toBe(code('       \\', 'a;'));
  });
});
