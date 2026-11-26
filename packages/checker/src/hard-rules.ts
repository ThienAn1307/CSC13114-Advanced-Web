// Hard rules (D13): a ban-list constraint is decided by reading the code's tokens, never by the model.

import {
  AFTER_DECLARED_NAME,
  DECLARES_NEXT_NAME,
  POINTER_OR_REFERENCE,
  TYPE_KEYWORDS,
  visibleNames,
} from './scopes.ts';
import { tokenize, type Token } from './tokenizer.ts';

export interface Evidence {
  /** 1-based line in the original source. */
  line: number;
  /** That line of the original source, as written. */
  text: string;
}

export interface HardRuleVerdict {
  verdict: 'pass' | 'violation';
  evidence: Evidence[];
  /** Which banned names were found on which lines; only for a violation. */
  reason?: string;
}

// The dev set README: a constraint that starts with "Do not use" or "Do not call" is a ban list,
// and every banned name is written in backticks.
const BAN_LIST_START = /^do not (use|call)\b/i;
const QUALIFIED_NAME = /^(::)?[A-Za-z_]\w*(::[A-Za-z_]\w*)*$/;

/**
 * The banned names of a ban-list constraint, in order, each once. Null for a semantic constraint,
 * and for a ban list whose backticks hold something that is not a name: no rule guesses then.
 */
export function banListNames(constraintText: string): string[] | null {
  if (!BAN_LIST_START.test(constraintText.trim())) return null;
  const names: string[] = [];
  for (const match of constraintText.matchAll(/`([^`]*)`/g)) {
    const name = (match[1] ?? '').replace(/\s+/g, '').replace(/\(\)$/, '');
    if (!QUALIFIED_NAME.test(name)) return null;
    const bare = name.replace(/^::/, '');
    if (!names.includes(bare)) names.push(bare);
  }
  return names.length > 0 ? names : null;
}

/** Names the student declared: functions, variables, classes, namespaces. */
function declaredNames(tokens: Token[]): Set<string> {
  const declared = new Set<string>();
  tokens.forEach((token, i) => {
    if (token.kind !== 'identifier') return;
    let p = i - 1;
    while (p >= 0 && POINTER_OR_REFERENCE.has(tokens[p]!.text)) p--;
    const prev = tokens[p];
    if (!prev) return;
    if (DECLARES_NEXT_NAME.has(prev.text)) {
      if (tokens[p - 1]?.text !== 'using') declared.add(token.text); // not `using namespace std;`
      return;
    }
    if (prev.text === 'using') {
      if (tokens[i + 1]?.text === '=') declared.add(token.text); // `using sort = int;`
      return;
    }
    const typeBefore =
      prev.kind === 'identifier' ||
      TYPE_KEYWORDS.has(prev.text) ||
      prev.text === '>' ||
      prev.text === '>>';
    if (typeBefore && AFTER_DECLARED_NAME.has(tokens[i + 1]?.text ?? '')) declared.add(token.text);
  });
  return declared;
}

/** `namespace rg = std::ranges;` maps `rg` to `['std', 'ranges']`. */
function namespaceAliases(tokens: Token[]): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  tokens.forEach((token, i) => {
    const alias = tokens[i + 1];
    if (token.text !== 'namespace' || alias?.kind !== 'identifier' || tokens[i + 2]?.text !== '=') {
      return;
    }
    const target: string[] = [];
    for (let k = i + 3; k < tokens.length && tokens[k]!.text !== ';'; k++) {
      if (tokens[k]!.kind === 'identifier') target.push(tokens[k]!.text);
    }
    aliases.set(alias.text, target);
  });
  return aliases;
}

interface NameUse {
  /** The segments as written, aliases expanded: `std::ranges::sort` is `['std', 'ranges', 'sort']`. */
  segments: string[];
  /** Written with a leading `::`. */
  global: boolean;
  /** Written after `.` or `->`. */
  member: boolean;
}

/** How the name at `tokens[i]` is written, or null when it is not the last part of a name. */
function nameUse(tokens: Token[], i: number, aliases: Map<string, string[]>): NameUse | null {
  if (tokens[i + 1]?.text === '::') return null;
  const segments = [tokens[i]!.text];
  let j = i;
  let global = false;
  while (tokens[j - 1]?.text === '::') {
    const before = tokens[j - 2];
    if (before?.kind !== 'identifier') {
      global = true;
      break;
    }
    segments.unshift(before.text);
    j -= 2;
  }
  const member =
    segments.length === 1 && !global && ['.', '->'].includes(tokens[j - 1]?.text ?? '');
  const alias = segments.length > 1 ? aliases.get(segments[0]!) : undefined;
  return { segments: alias ? [...alias, ...segments.slice(1)] : segments, global, member };
}

const sameSegments = (a: string[], b: string[]) =>
  a.length === b.length && a.every((s, k) => s === b[k]);
const endsWith = (whole: string[], tail: string[]) =>
  tail.length <= whole.length && sameSegments(whole.slice(whole.length - tail.length), tail);

/** `goto sort;` or the label `sort:` itself: labels have names of their own, never a library's. */
function isLabel(tokens: Token[], i: number): boolean {
  const before = tokens[i - 1]?.text ?? '';
  return before === 'goto' || (tokens[i + 1]?.text === ':' && [';', '{', '}'].includes(before));
}

/** Does this use of a name refer to the banned name? */
function refersTo(use: NameUse, banned: string[], declared: Set<string>, isOwn: boolean): boolean {
  const name = use.segments.at(-1)!;
  if (use.member) return banned.length === 1 && !declared.has(name);
  if (use.global) return sameSegments(use.segments, banned);
  if (use.segments.length === 1) return !isOwn;
  if (sameSegments(use.segments, banned)) return true;
  if (banned.length === 1) return use.segments.length === 2 && use.segments[0] === 'std';
  // `ranges::sort` for `std::ranges::sort`, under `using namespace std;`.
  return endsWith(banned, use.segments) && !declared.has(use.segments[0]!);
}

/**
 * Decides a ban-list constraint from the code alone. Null when the constraint is not a ban list
 * (it is semantic, or its names cannot be read), or when no banned name is seen but a macro pastes
 * tokens, so the hard rules do not decide it.
 */
export function decideBanList(constraintText: string, source: string): HardRuleVerdict | null {
  const names = banListNames(constraintText);
  if (!names) return null;

  const tokens = tokenize(source);
  const declared = declaredNames(tokens);
  const visible = visibleNames(tokens);
  const aliases = namespaceAliases(tokens);
  const found = new Map<number, Set<string>>();

  tokens.forEach((token, i) => {
    if (token.kind !== 'identifier' && token.kind !== 'keyword') return;
    for (const banned of names) {
      const segments = banned.split('::');
      if (segments.at(-1) !== token.text) continue;
      let hit: boolean;
      if (token.kind === 'keyword') {
        hit = segments.length === 1;
      } else {
        const use = nameUse(tokens, i, aliases);
        // If the brackets do not balance, any declaration in the file counts.
        const isOwn = visible ? visible(i) : declared.has(token.text);
        hit = use !== null && !isLabel(tokens, i) && refersTo(use, segments, declared, isOwn);
      }
      if (hit) found.set(token.line, (found.get(token.line) ?? new Set()).add(banned));
    }
  });

  // `a##b` makes names that are written nowhere (`J(so, rt)` is `sort`): no pass is decided then,
  // and the constraint goes to the model like a semantic one. A banned name seen is still a violation.
  const pastes = tokens.some((token) => token.inDirective && token.text === '##');
  if (found.size === 0) return pastes ? null : { verdict: 'pass', evidence: [] };
  const lines = source.split('\n').map((l) => l.replace(/\r$/, ''));
  const evidence = [...found.keys()]
    .sort((a, b) => a - b)
    .map((line) => ({ line, text: lines[line - 1] ?? '' }));
  const reason = evidence
    .map(({ line }) => `line ${line} uses ${[...found.get(line)!].join(', ')}`)
    .join('; ');
  return { verdict: 'violation', evidence, reason: `Banned name in the code: ${reason}.` };
}
