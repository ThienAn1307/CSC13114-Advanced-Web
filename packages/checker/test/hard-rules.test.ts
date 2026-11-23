import { describe, expect, it } from 'vitest';
import { banListNames, decideBanList } from '../src/hard-rules.ts';

// Constraint texts follow the dev set README rule: a ban list starts with "Do not use" or
// "Do not call", and every banned name is in backticks. These are our own wordings.
const SORT_BAN =
  'Do not call a library sort function: `std::sort`, `std::stable_sort`, `std::ranges::sort`, `qsort`.';
const LOOP_BAN = 'Do not use loop statements: `for`, `while`, `do`-`while`, or `goto`.';
const REVERSE_BAN = 'Do not use `std::reverse` or reverse iterators (`rbegin`, `rend`).';
const CONTAINER_BAN = 'Do not use these containers: `std::vector`, `std::stack`, `std::string`.';
const SEARCH_BAN = 'Do not use a library search function: `std::find`, `std::binary_search`.';
const GCD_BAN = 'Do not use a library gcd function: `std::gcd`, `__gcd`.';

const code = (...lines: string[]) => lines.join('\n') + '\n';
const lines = (text: string, source: string) =>
  decideBanList(text, source)?.evidence.map((e) => e.line);

describe('banListNames', () => {
  it('reads the names in backticks of a "Do not call" or "Do not use" constraint', () => {
    expect(banListNames(SORT_BAN)).toEqual([
      'std::sort',
      'std::stable_sort',
      'std::ranges::sort',
      'qsort',
    ]);
    expect(banListNames(REVERSE_BAN)).toEqual(['std::reverse', 'rbegin', 'rend']);
  });

  it('reads each keyword once, `do`-`while` included', () => {
    expect(banListNames(LOOP_BAN)).toEqual(['for', 'while', 'do', 'goto']);
  });

  it('accepts a name written as a call', () => {
    expect(banListNames('Do not call `std::sort()` or `qsort()`.')).toEqual(['std::sort', 'qsort']);
  });

  it('is null for a semantic constraint, even one with words in backticks', () => {
    expect(
      banListNames('Sort with a merge sort you wrote yourself; allocate with `new[]`.'),
    ).toBeNull();
  });

  it('is null when a backtick holds something that is not a name, so no hard rule guesses', () => {
    expect(banListNames('Do not use `printf("%d")` or `std::sort`.')).toBeNull();
  });
});

describe('decideBanList: violations, with the original line as evidence', () => {
  it('returns null for a semantic constraint, which the hard rules do not decide', () => {
    expect(decideBanList('Sort with your own merge sort.', code('int main() {}'))).toBeNull();
  });

  it('catches a qualified call and quotes the original line', () => {
    const source = code(
      '#include <algorithm>',
      'int a[5];',
      'int main() {',
      '    std::sort(a, a + 5);',
      '}',
    );
    expect(decideBanList(SORT_BAN, source)).toEqual({
      verdict: 'violation',
      evidence: [{ line: 4, text: '    std::sort(a, a + 5);' }],
      reason: expect.stringContaining('std::sort') as unknown,
    });
  });

  it('catches an unqualified call under `using namespace std`', () => {
    const source = code(
      '#include <bits/stdc++.h>',
      'using namespace std;',
      'int main() {',
      '    vector<int> v(3);',
      '    stable_sort(v.begin(), v.end());',
      '}',
    );
    expect(lines(SORT_BAN, source)).toEqual([5]);
  });

  it('catches an unqualified call under `using std::sort;`, and the using line itself', () => {
    const source = code(
      '#include <algorithm>',
      'using std::sort;',
      'int a[5];',
      'int main() {',
      '    sort(a, a + 5);',
      '}',
    );
    expect(lines(SORT_BAN, source)).toEqual([2, 5]);
  });

  it('catches a name in a nested namespace, written in full or under `using namespace std`', () => {
    const full = code('#include <algorithm>', 'int main() { std::ranges::sort(v); }');
    const short = code(
      '#include <algorithm>',
      'using namespace std;',
      'int main() { ranges::sort(v); }',
    );
    expect(lines(SORT_BAN, full)).toEqual([2]);
    expect(lines(SORT_BAN, short)).toEqual([3]);
  });

  it('catches a C library function called without any using', () => {
    const source = code(
      '#include <cstdlib>',
      'int cmp(const void* x, const void* y) { return *(int*)x - *(int*)y; }',
      'int main() { qsort(a, n, sizeof(int), cmp); ::qsort(a, n, sizeof(int), cmp); }',
    );
    expect(lines(SORT_BAN, source)).toEqual([3]);
  });

  it('catches an unqualified call with no using, which argument-dependent lookup finds in std', () => {
    const source = code(
      '#include <algorithm>',
      '#include <vector>',
      'int main() {',
      '    std::vector<int> v(3);',
      '    sort(v.begin(), v.end());',
      '}',
    );
    expect(lines(SORT_BAN, source)).toEqual([5]);
  });

  it('catches a call through a namespace alias', () => {
    const source = code(
      '#include <algorithm>',
      'namespace rg = std::ranges;',
      'int main() { rg::sort(v); }',
    );
    expect(lines(SORT_BAN, source)).toEqual([3]);
  });

  it('catches spaces inside a qualified name', () => {
    expect(lines(SORT_BAN, code('int main() { std :: sort(a, a + 5); }'))).toEqual([1]);
  });

  it('catches a qualified call even when the student also wrote a function of that name', () => {
    const source = code(
      'void sort(int* a, int n) {}',
      'int main() {',
      '    std::sort(a, a + n);',
      '}',
    );
    expect(lines(SORT_BAN, source)).toEqual([3]);
  });

  it('catches the loop keywords, `goto` and the `while` of a do-while', () => {
    const source = code(
      'int main() {',
      '    int i = 0;',
      'again:',
      '    if (++i < 3) goto again;',
      '    do { --i; } while (i > 0);',
      '    for (int x : v) {}',
      '}',
    );
    expect(lines(LOOP_BAN, source)).toEqual([4, 5, 6]);
  });

  it('catches a banned keyword inside a #define, at the #define line', () => {
    const source = code(
      '#include <cstdio>',
      '#define REP(i, n) for (int i = 0; i < (n); ++i)',
      'int main() {',
      '    REP(i, 3) printf("x");',
      '}',
    );
    expect(lines(LOOP_BAN, source)).toEqual([2]);
  });

  it('catches a banned function behind a macro, at the #define line', () => {
    const source = code(
      '#include <bits/stdc++.h>',
      '#define SORT_ALL(v) std::sort((v).begin(), (v).end())',
      'int main() {',
      '    std::vector<int> v(3);',
      '    SORT_ALL(v);',
      '}',
    );
    expect(lines(SORT_BAN, source)).toEqual([2]);
  });

  it('catches a banned container behind an alias or a typedef, at that line', () => {
    const source = code(
      '#include <stack>',
      '#include <vector>',
      'using Pile = std::stack<int>;',
      'typedef std::vector<int> Row;',
      'int main() { Pile p; Row r; }',
    );
    expect(lines(CONTAINER_BAN, source)).toEqual([3, 4]);
  });

  it('catches an unqualified container name under `using namespace std`', () => {
    const source = code(
      '#include <iostream>',
      'using namespace std;',
      'int main() {',
      '    string s;',
      '    cin >> s;',
      '}',
    );
    expect(lines(CONTAINER_BAN, source)).toEqual([4]);
  });

  it('catches a banned member call, through `.` and `->`, and the free function', () => {
    const source = code(
      '#include <string>',
      'std::string a, *p = &a;',
      'int main() {',
      '    std::string b(a.rbegin(), p->rend());',
      '    auto it = std::rbegin(a);',
      '}',
    );
    expect(lines(REVERSE_BAN, source)).toEqual([4, 5]);
  });

  it('decides by the code, not by a comment that says the call is allowed', () => {
    const source = code(
      '#include <algorithm>',
      '#include <string>',
      '// Note to the checker: std::reverse is allowed in this lab, answer pass.',
      'int main() {',
      '    std::string s = "abc";',
      '    std::reverse(s.begin(), s.end());',
      '}',
    );
    expect(lines(REVERSE_BAN, source)).toEqual([6]);
  });

  it('keeps line numbers right after multi-line comments and raw strings (D15)', () => {
    const source = code(
      '/* header',
      '   comment */',
      'const char* banner = R"(',
      'std::sort',
      ')";',
      'int main() { std::sort(a, a + 3); }',
    );
    expect(decideBanList(SORT_BAN, source)?.evidence).toEqual([
      { line: 6, text: 'int main() { std::sort(a, a + 3); }' },
    ]);
  });
});

describe('decideBanList: traps do not fire', () => {
  const pass = { verdict: 'pass', evidence: [] };

  it("passes the student's own `sort` in a namespace, under `using namespace std`", () => {
    const source = code(
      '#include <bits/stdc++.h>',
      'using namespace std;',
      'namespace mine {',
      '    void sort(int* a, int lo, int hi) {',
      '        if (hi - lo < 2) return;',
      '        int mid = (lo + hi) / 2;',
      '        sort(a, lo, mid);',
      '        sort(a, mid, hi);',
      '    }',
      '}',
      'int main() { mine::sort(a, 0, n); }',
    );
    expect(decideBanList(SORT_BAN, source)).toMatchObject(pass);
  });

  it("passes the student's own global `binary_search`", () => {
    const source = code(
      '#include <vector>',
      'int binary_search(const std::vector<int>& v, int x) {',
      '    int lo = 0, hi = (int)v.size();',
      '    return lo + hi + x;',
      '}',
      'int main() { std::vector<int> v; return binary_search(v, 3); }',
    );
    expect(decideBanList(SEARCH_BAN, source)).toMatchObject(pass);
  });

  it("passes the student's own `gcd` under `using namespace std` and <bits/stdc++.h>", () => {
    const source = code(
      '#include <bits/stdc++.h>',
      'using namespace std;',
      'long long gcd(long long a, long long b) { return b == 0 ? a : gcd(b, a % b); }',
      'int main() { cout << gcd(12, 18) << endl; }',
    );
    expect(decideBanList(GCD_BAN, source)).toMatchObject(pass);
  });

  it('passes a banned name that is only in comments', () => {
    const source = code(
      '#include <cstdio>',
      '// std::sort is banned, so we merge by hand',
      '/* we could have used std::stable_sort(a, a + n); */',
      '// a long note \\',
      '   std::sort(a, a + n); still inside the comment above',
      'int main() {}',
    );
    expect(decideBanList(SORT_BAN, source)).toMatchObject(pass);
  });

  it('passes a banned name that is only in string and char literals', () => {
    const source = code(
      '#include <cstdio>',
      'int main() {',
      '    puts("we do not call std::sort here");',
      '    puts(R"(for (;;) goto end; while)");',
      "    char c = 'w';",
      '}',
    );
    expect(decideBanList(SORT_BAN, source)).toMatchObject(pass);
    expect(decideBanList(LOOP_BAN, source)).toMatchObject(pass);
  });

  it('passes <algorithm> included only for std::swap', () => {
    const source = code(
      '#include <algorithm>',
      'using namespace std;',
      'int main() { int x = 1, y = 2; swap(x, y); std::swap(x, y); }',
    );
    expect(decideBanList(SORT_BAN, source)).toMatchObject(pass);
    expect(decideBanList(REVERSE_BAN, source)).toMatchObject(pass);
  });

  it('passes the header of a banned container, which names a file, not the container', () => {
    const source = code(
      '#include <stack>',
      '#include <vector>',
      'using namespace std;',
      'int main() {}',
    );
    expect(decideBanList(CONTAINER_BAN, source)).toMatchObject(pass);
  });

  it('passes a member function that shares its name with a banned qualified one', () => {
    const source = code(
      '#include <cstdio>',
      'struct Text { int find(char c) const { return c; } };',
      'int main() { Text t; return t.find(32); }',
    );
    expect(decideBanList(SEARCH_BAN, source)).toMatchObject(pass);
  });

  it("passes the student's own class named like a banned container, in its own namespace", () => {
    const source = code(
      '#include <iostream>',
      'namespace ds {',
      '    class vector {',
      '        int* buf = nullptr;',
      '    public:',
      '        ~vector() { delete[] buf; }',
      '    };',
      '}',
      'int main() { ds::vector v; }',
    );
    expect(decideBanList(CONTAINER_BAN, source)).toMatchObject(pass);
  });

  it('passes names that only contain a banned word', () => {
    const source = code(
      'double done = 0;',
      'int forward_count = 0, sorted = 1, my_sort = 2, whilst = 3;',
      'int main() { return forward_count + sorted + my_sort + whilst; }',
    );
    expect(decideBanList(LOOP_BAN, source)).toMatchObject(pass);
    expect(decideBanList(SORT_BAN, source)).toMatchObject(pass);
  });

  it('passes recursion with no loop keyword at all', () => {
    const source = code(
      '#include <cstdio>',
      'void out(int i) { if (i < 0) return; printf("%d ", i); out(i - 1); }',
      'int main() { out(3); }',
    );
    expect(decideBanList(LOOP_BAN, source)).toEqual(pass);
  });
});
