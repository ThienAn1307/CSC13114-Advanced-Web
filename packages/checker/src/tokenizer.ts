// A small C++ lexer for the hard rules (D13) and for blanking comments before a model call (D15).
// It does not parse C++. It only has to know what is code and what is not: comments and
// string, char and raw-string literals are not code; preprocessor lines are.

export type TokenKind = 'identifier' | 'keyword' | 'number' | 'literal' | 'punct' | 'header-name';

export interface Token {
  kind: TokenKind;
  text: string;
  /** 1-based line of the token's first character in the original source. */
  line: number;
  /** True when the token is on a preprocessor line (`#define ...`), continued lines included. */
  inDirective: boolean;
}

// prettier-ignore
const KEYWORDS = new Set([
  'alignas', 'alignof', 'and', 'and_eq', 'asm', 'auto', 'bitand', 'bitor', 'bool', 'break',
  'case', 'catch', 'char', 'char8_t', 'char16_t', 'char32_t', 'class', 'co_await', 'co_return',
  'co_yield', 'compl', 'concept', 'const', 'consteval', 'constexpr', 'constinit', 'const_cast',
  'continue', 'decltype', 'default', 'delete', 'do', 'double', 'dynamic_cast', 'else', 'enum',
  'explicit', 'export', 'extern', 'false', 'float', 'for', 'friend', 'goto', 'if', 'inline',
  'int', 'long', 'mutable', 'namespace', 'new', 'noexcept', 'not', 'not_eq', 'nullptr',
  'operator', 'or', 'or_eq', 'private', 'protected', 'public', 'register', 'reinterpret_cast',
  'requires', 'return', 'short', 'signed', 'sizeof', 'static', 'static_assert', 'static_cast',
  'struct', 'switch', 'template', 'this', 'thread_local', 'throw', 'true', 'try', 'typedef',
  'typeid', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile', 'wchar_t',
  'while', 'xor', 'xor_eq',
]);

/** Longest first, so `>>=` is read before `>>` and `>`. */
// prettier-ignore
const PUNCTUATORS = [
  '>>=', '<<=', '<=>', '...', '->*',
  '::', '->', '>>', '<<', '<=', '>=', '==', '!=', '&&', '||', '++', '--',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '##', '.*',
];

const STRING_PREFIXES = new Set(['L', 'u', 'U', 'u8']);
const RAW_PREFIXES = new Set(['R', 'LR', 'uR', 'UR', 'u8R']);

const isIdentStart = (c: string | undefined) => c !== undefined && /[\p{L}_$]/u.test(c);
const isIdentPart = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_$]/u.test(c);
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isAlnum = (c: string | undefined) => c !== undefined && /[0-9A-Za-z_]/.test(c);

/** A backslash and a newline (LF or CR LF) join two lines; g++ also allows spaces between them. */
const SPLICE = /\\[ \t\f\v]*\r?\n/y;

interface Spliced {
  /** The source without its line splices: `so\`, newline, `rt` is `sort`. */
  text: string;
  /** `origin[k]` is the offset of `text[k]` in the source; one more entry for the end. */
  origin: number[];
}

/** Takes the line splices out before anything else is read, as the C++ standard does. */
function removeSplices(source: string): Spliced {
  const origin: number[] = [];
  let text = '';
  let i = 0;
  while (i < source.length) {
    SPLICE.lastIndex = i;
    const splice = SPLICE.exec(source);
    if (splice) {
      i += splice[0].length;
    } else {
      text += source[i];
      origin.push(i++);
    }
  }
  origin.push(source.length);
  return { text, origin };
}

interface Scan {
  tokens: Token[];
  /** [start, end) offsets of every comment, in the original source. */
  comments: [number, number][];
}

// Reads the text without splices. Lines and comment offsets go back to the original source through
// `origin`, so line numbers never move (D15).
function scan(source: string): Scan {
  const { text, origin } = removeSplices(source);
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const tokens: Token[] = [];
  const comments: [number, number][] = [];
  let atLineStart = true;
  let inDirective = false;
  let directiveTokens = 0;
  let i = 0;

  const push = (kind: TokenKind, start: number, end: number) => {
    const line = lineAt(origin[start]!);
    tokens.push({ kind, text: text.slice(start, end), line, inDirective });
    atLineStart = false;
    if (inDirective) directiveTokens++;
  };

  /** End of a quoted literal that opens at `quote`: past the closing quote, or at the end of the line. */
  const quotedEnd = (quote: number) => {
    const q = text[quote];
    let k = quote + 1;
    while (k < text.length) {
      const c = text[k];
      if (c === '\\') k += 2;
      else if (c === q) return k + 1;
      else if (c === '\n') return k;
      else k++;
    }
    return text.length;
  };

  /**
   * End of a raw string `R"delim( ... )delim"`, from and to an offset in the original source:
   * a backslash before a newline is plain text there.
   */
  const rawEnd = (quote: number) => {
    const open = source.indexOf('(', quote + 1);
    if (open < 0) return source.length;
    const close = `)${source.slice(quote + 1, open)}"`;
    const at = source.indexOf(close, open + 1);
    return at < 0 ? source.length : at + close.length;
  };

  while (i < text.length) {
    const c = text[i]!;
    const next = text[i + 1];

    if (c === '\n') {
      atLineStart = true;
      inDirective = false;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
      i++;
      continue;
    }

    if (c === '/' && next === '/') {
      let k = i + 2;
      while (k < text.length && text[k] !== '\n') k++;
      if (text[k - 1] === '\r') k--;
      comments.push([origin[i]!, origin[k]!]);
      i = k;
      continue;
    }
    if (c === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close < 0 ? text.length : close + 2;
      comments.push([origin[i]!, origin[end - 1]! + 1]);
      i = end;
      continue;
    }

    if (c === '#' && atLineStart) {
      inDirective = true;
      directiveTokens = 0;
      push('punct', i, i + 1);
      i++;
      continue;
    }

    // `#include <x>` and `#include "x"`: the header name is one token.
    if (inDirective && directiveTokens === 2 && (c === '<' || c === '"')) {
      const prev = tokens.at(-1)?.text;
      if (prev === 'include' || prev === 'include_next' || prev === 'import') {
        const close = text.indexOf(c === '<' ? '>' : '"', i + 1);
        const eol = text.indexOf('\n', i);
        const end =
          close >= 0 && (eol < 0 || close < eol) ? close + 1 : eol < 0 ? text.length : eol;
        push('header-name', i, end);
        i = end;
        continue;
      }
    }

    if (isIdentStart(c)) {
      let k = i + 1;
      while (isIdentPart(text[k])) k++;
      const word = text.slice(i, k);
      if (text[k] === '"' && RAW_PREFIXES.has(word)) {
        const quote = origin[k]!;
        const end = rawEnd(quote);
        push('literal', i, k);
        tokens.at(-1)!.text = word + source.slice(quote, end);
        while (origin[k]! < end) k++;
        i = k;
        continue;
      }
      if ((text[k] === '"' || text[k] === "'") && STRING_PREFIXES.has(word)) {
        const end = quotedEnd(k);
        push('literal', i, end);
        i = end;
        continue;
      }
      push(KEYWORDS.has(word) ? 'keyword' : 'identifier', i, k);
      i = k;
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(next))) {
      // A pp-number: digits, letters, dots, exponent signs and digit separators (`1'000`).
      let k = i + 1;
      while (k < text.length) {
        const d = text[k];
        if (
          (d === 'e' || d === 'E' || d === 'p' || d === 'P') &&
          (text[k + 1] === '+' || text[k + 1] === '-')
        )
          k += 2;
        else if (d === "'" && isAlnum(text[k + 1])) k += 2;
        else if (isAlnum(d) || d === '.') k++;
        else break;
      }
      push('number', i, k);
      i = k;
      continue;
    }

    if (c === '"' || c === "'") {
      const end = quotedEnd(i);
      push('literal', i, end);
      i = end;
      continue;
    }

    const punct = PUNCTUATORS.find((p) => text.startsWith(p, i)) ?? c;
    push('punct', i, i + punct.length);
    i += punct.length;
  }

  return { tokens, comments };
}

/** The code tokens of a C++ source, each with its line in the original source. */
export function tokenize(source: string): Token[] {
  return scan(source).tokens;
}

/**
 * The source with every comment character replaced by a space. Newlines (and the CR of a CRLF)
 * are kept, so line N of the result is line N of the source (D15). Strings are left alone.
 */
export function blankComments(source: string): string {
  const chars = source.split('');
  for (const [start, end] of scan(source).comments) {
    for (let k = start; k < end; k++) {
      if (chars[k] !== '\n' && chars[k] !== '\r') chars[k] = ' ';
    }
  }
  return chars.join('');
}
