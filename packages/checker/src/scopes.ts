// Where a name the student declared counts (D13). In doubt it counts in the whole file.

import type { Token } from './tokenizer.ts';

// A name right after one of these, and right before `(`, `=`, `;` ..., is being declared.
// prettier-ignore
export const TYPE_KEYWORDS = new Set([
  'void', 'bool', 'char', 'char8_t', 'char16_t', 'char32_t', 'wchar_t', 'short', 'int', 'long',
  'float', 'double', 'signed', 'unsigned', 'auto',
]);
export const AFTER_DECLARED_NAME = new Set(['(', '=', ';', ',', '[', '{', ')']);
export const DECLARES_NEXT_NAME = new Set(['class', 'struct', 'union', 'enum', 'namespace']);
export const POINTER_OR_REFERENCE = new Set(['*', '&', '&&']);
const BEFORE_TYPE = new Set([
  ...['', ';', '{', '}', '>', '>>', ']', 'const', 'static', 'inline', 'constexpr', 'typename'],
  ...['struct', 'class', 'extern', 'virtual', 'friend', 'mutable', 'typedef', 'volatile'],
]);
// The words before the `{` of an enum, from `enum` on. Not `enum Kind f() {`, a function.
const ENUM_HEADER = /^enum( class| struct)?( \[ \[.*\] \])?( (:: )?\w+( :: \w+)*)?( : [\w: ]+)?$/;
const CLOSER = new Map(Object.entries({ '(': ')', '[': ']', '{': '}' }));

/** Can a declaration of `tokens[i]` be seen from there? Null when the brackets do not balance. */
export function visibleNames(tokens: Token[]): ((i: number) => boolean) | null {
  const code = tokens.filter((t) => !t.inDirective);
  const text = (i: number) => code[i]?.text ?? '';
  const pair: number[] = []; // the matching bracket
  const around: number[] = []; // the innermost bracket around a token, or -1
  const braceAt: number[] = []; // the innermost `{` around a token, or -1
  // What a `{` opens; none for a namespace, an unnamed class, ...
  const kind = new Map<number, 'class' | 'block' | 'enum' | 'scoped enum'>();
  const open: number[] = [];
  let membersFileWide = false;

  // 1. Match the brackets, and find out what each `{` opens from the words before it.
  for (let i = 0; i < code.length; i++) {
    if ([')', ']', '}'].includes(text(i))) {
      const k = open.pop() ?? -1;
      if (CLOSER.get(text(k)) !== text(i)) return null;
      [pair[k], pair[i]] = [i, k];
    }
    const parent = open.at(-1) ?? -1;
    around[i] = parent;
    const brace = text(parent) === '{' ? parent : (braceAt[parent] ?? -1);
    braceAt[i] = brace;
    // `S::f` outside a function: an out-of-line member.
    if (text(i) === '::' && kind.get(brace) !== 'block' && text(i - 1) !== 'std')
      membersFileWide = true;
    if (CLOSER.has(text(i))) open.push(i);
    if (text(i) !== '{') continue;
    let start = i;
    while (start > 0 && ![';', '{', '}'].includes(text(start - 1))) start--;
    const header = code.slice(start, i).map((t) => t.text);
    const last = header.at(-1) ?? '';
    const enumHeader = header.slice(header.lastIndexOf('enum')).join(' ');
    if (ENUM_HEADER.test(enumHeader)) {
      kind.set(i, /^enum (class|struct)\b/.test(enumHeader) ? 'scoped enum' : 'enum');
      continue;
    }
    const isClass = header.some(
      (t, k) => /^(class|struct|union)$/.test(t) && !['<', ','].includes(header[k - 1] ?? ''),
    );
    if (isClass && last !== ')') {
      if (!DECLARES_NEXT_NAME.has(last)) kind.set(i, 'class'); // not an unnamed class
      if (header.includes(':')) membersFileWide = true; // a base class
    } else if (!/\b(namespace|enum)\b|"$/.test(header.join(' '))) kind.set(i, 'block');
  }
  if (open.length > 0) return null;

  /** Can a declaration of `code[i]` start with the type that ends at `p`? Not in `y = x * max(`. */
  function typeStartsHere(p: number, i: number): boolean {
    let k = p;
    for (let angles = 0; k === p || angles > 0; k--) {
      if (text(k) === '>') angles++;
      else if (text(k) === '>>') angles += 2;
      else if (text(k) === '<') angles--;
      else if (angles === 0) break;
      if (k < 0 || p - k > 200 || CLOSER.has(text(k)) || text(k) === ';' || text(k) === '}')
        return false;
      if (text(k) === ')' || text(k) === ']') k = pair[k]!;
    }
    if (code[k]?.kind !== 'identifier') return false;
    if (text(k - 1) === '::') return typeStartsHere(k - 2, i);
    // In brackets `(a * max(b, c))` is a call, but not in `for (vector<int> max(3); ...)`.
    const inFor = text(around[i]! - 1) === 'for' && around[i] === k - 1;
    if (text(around[i]!) === '(' && text(i + 1) === '(') return inFor;
    if (text(k - 1) === '(' || text(k - 1) === ',') return text(around[i]!) === '(';
    if (text(k - 1) === ':')
      // `public:`, `case 1:`, but not `c ? x : y * max(a, b)`
      return /^(public|private|protected|default)$/.test(text(k - 2)) || text(k - 3) === 'case';
    return BEFORE_TYPE.has(text(k - 1)) || code[k - 1]!.kind === 'identifier';
  }

  function isDeclared(i: number): boolean {
    let p = i - 1;
    while (POINTER_OR_REFERENCE.has(text(p)) || text(p) === '...') p--;
    const [prev, next, bracket] = [text(p), text(i + 1), text(around[i]!)];
    const inFor = text(around[i]! - 1) === 'for';
    if (DECLARES_NEXT_NAME.has(prev)) return text(p - 1) !== 'using';
    if (prev === 'using') return next === '='; // `using sort = int;`, not `using std::sort;`
    // `[max = 3]` and `auto [a, max]`
    if (bracket === '[') return next === '=' || /^(auto|&&?)$/.test(text(around[i]! - 1));
    if (prev === '(' && p < i - 1 && next === ')')
      return TYPE_KEYWORDS.has(text(p - 1)) || code[p - 1]?.kind === 'identifier'; // `int (*max)(int)`
    if (next === '>' && TYPE_KEYWORDS.has(prev)) return true; // `template <int max>`
    if (!AFTER_DECLARED_NAME.has(next) && !(inFor && next === ':')) return false;
    if (prev === ',' && (bracket !== '(' || inFor)) return declaring.has(around[i]!); // `int a, max;`
    if (TYPE_KEYWORDS.has(prev) || prev === 'const') return true;
    return (p === i - 1 && code[p]?.kind === 'identifier') || typeStartsHere(p, i);
  }

  /** `sort` in `enum Cmd { none, sort = 2 };`. */
  const isEnumerator = (i: number) =>
    /enum$/.test(kind.get(around[i]!) ?? '') &&
    ['{', ','].includes(text(i - 1)) &&
    [',', '}', '=', '['].includes(text(i + 1));

  /** The end of the function that the parameter at `i` belongs to. */
  function functionEnd(i: number): number {
    let k = i;
    while (around[k]! >= 0 && text(around[k]!) !== '{') k = around[k]!;
    for (; k < code.length && text(k) !== ';' && text(k) !== '}'; k++) {
      const isBody = text(k) === '{';
      if (CLOSER.has(text(k))) k = pair[k]!;
      // `S(int max) : a{max}, b{1} { ... }`: the body is still to come.
      if (isBody && !['{', ',', 'catch'].includes(text(k + 1))) break;
    }
    return k;
  }

  // 2. Each declaration counts from one token to another.
  const declaring = new Set<number>(); // the brackets in which the current statement declares a name
  const places = new Map<string, [from: number, to: number][]>();
  const count = (name: string, from: number, to: number) => {
    if (!places.has(name)) places.set(name, []);
    places.get(name)!.push([from, to]);
  };
  code.forEach((token, i) => {
    if (token.text === ';') declaring.delete(around[i]!);
    if (token.kind === 'identifier' && isEnumerator(i)) {
      // An enumerator counts around its enum; one of a scoped enum only in it: outside it is `Cmd::sort`.
      const own = around[i]!;
      const outer = braceAt[own]!;
      if (kind.get(own) === 'scoped enum') count(token.text, own, pair[own]!);
      else if (kind.get(outer) === 'block') count(token.text, i, pair[outer]!);
      else if (kind.get(outer) === 'class' && !membersFileWide)
        count(token.text, outer, pair[outer]!);
      else count(token.text, 0, code.length);
      return;
    }
    if (token.kind !== 'identifier' || !isDeclared(i)) return;
    const brace = braceAt[i]!;
    const isType = DECLARES_NEXT_NAME.has(text(i - 1));
    if (!isType) declaring.add(around[i]!);
    const isDataMember = kind.get(brace) === 'class' && text(i + 1) !== '(' && !isType;
    if (kind.get(brace) === 'block') count(token.text, i, pair[brace]!);
    else if (text(around[i]!) === '(') count(token.text, i, functionEnd(i));
    else if (isDataMember && !membersFileWide) count(token.text, brace, pair[brace]!);
    else count(token.text, 0, code.length);
  });
  tokens.forEach((token, i) => {
    // `#define max(a, b)` and `#define DECLARE int max`, but not `#define BEST max(a, b)`.
    const prev = tokens[i - 1]?.text ?? '';
    if (token.inDirective && (prev === 'define' || TYPE_KEYWORDS.has(prev)))
      count(token.text, 0, code.length);
  });

  const indexOf = new Map(code.map((t, i) => [t, i]));
  return (i) => {
    const at = indexOf.get(tokens[i]!); // undefined in a macro, which can be used anywhere
    const found = places.get(tokens[i]!.text) ?? [];
    return found.some(([from, to]) => at === undefined || (from <= at && at <= to));
  };
}
