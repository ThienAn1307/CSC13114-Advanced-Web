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

const MAX_BAN = 'Do not use `max`.';

describe('decideBanList: line splices do not hide a banned name', () => {
  it('catches a qualified name split by a splice, at the line of its first character', () => {
    const source = code(
      '#include <algorithm>',
      '#include <vector>',
      'int main() {',
      '    std::vector<int> v(3);',
      '    std::so\\',
      'rt(v.begin(), v.end());',
      '    std:\\',
      ':stable_sort(v.begin(), v.end());',
      '}',
    );
    expect(decideBanList(SORT_BAN, source)?.evidence).toEqual([
      { line: 5, text: '    std::so\\' },
      { line: 8, text: ':stable_sort(v.begin(), v.end());' },
    ]);
  });

  it('catches a banned keyword split by a splice', () => {
    expect(lines(LOOP_BAN, code('int main() {', '    fo\\', 'r (;;) {}', '}'))).toEqual([2]);
  });

  it('catches a call after a string continued by a splice, with LF and with CRLF', () => {
    const source = code(
      '#include <algorithm>',
      '#include <cstdio>',
      'int a[3];',
      'int main() {',
      '    puts("one \\',
      'two"); std::sort(a, a + 3); puts("x");',
      '}',
    );
    expect(lines(SORT_BAN, source)).toEqual([6]);
    expect(lines(SORT_BAN, source.replaceAll('\n', '\r\n'))).toEqual([6]);
  });

  it('passes a banned name in a comment whose opener is split by a splice', () => {
    const source = code(
      '/\\',
      '/ std::sort(a, b)',
      '/\\',
      '* std::sort(a, b) *\\',
      '/',
      'int main() {}',
    );
    expect(decideBanList(SORT_BAN, source)).toEqual({ verdict: 'pass', evidence: [] });
  });
});

const STD = ['#include <bits/stdc++.h>', 'using namespace std;'];

describe('decideBanList: a declaration hides a library name only where it is visible', () => {
  // [what, ban list, code after the two STD lines, lines of the violations]
  const cases: [string, string, string[], number[]][] = [
    [
      'a data member called `sort` in a struct',
      SORT_BAN,
      ['struct S { int sort; };', 'int main() { vector<int> v; sort(v.begin(), v.end()); }'],
      [4],
    ],
    [
      'a parameter or a local of another function',
      MAX_BAN,
      [
        'int f(int max) { return max; }',
        'int g(int a, int b) { int min = a, max = b; return min + max; }',
        'int main() { return max(f(1), g(1, 2)); }',
      ],
      [5],
    ],
    [
      'a local of an inner block, or one declared after the use',
      MAX_BAN,
      [
        'int main() {',
        '    int a = 1, b = 2;',
        '    { int max = a; b += max; }',
        '    int c = max(a, b);',
        '    int max = c;',
        '    return max;',
        '}',
      ],
      [6],
    ],
    [
      '`>` before a call',
      MAX_BAN,
      [
        'int main() { int a = 1, b = 2;',
        '    bool x = a > max(a, b);',
        '    int y = max(a, b);',
        '    return x + y; }',
      ],
      [4, 5],
    ],
    [
      '`<` and `>` around a call, in a condition, a return, an argument list and an index',
      MAX_BAN,
      [
        'bool f(bool p, bool q) { return p && q; }',
        'bool g(int x, int y, int z, int w) { return x < y && z > max(y, w); }',
        'int main() { int x = 1, y = 2, z = 3, t[2] = {1, 2};',
        '    if (x < y && z > max(x, y)) x = 1;',
        '    bool p = f(x < y, z > max(x, y));',
        '    while (x < y || z > max(x, y)) x = y = 9;',
        '    int q = t[x < y, z > max(x, y)];',
        '    for (; x < y, z > max(x, y);) z = 0;',
        '    return p + q; }',
      ],
      [4, 6, 7, 8, 9, 10],
    ],
    [
      '`>>` before a call',
      MAX_BAN,
      [
        'int main() { int a = 1, b = 2;',
        '    int x = 64 >> max(a, b), y = a >> max(a, b);',
        '    return max(x, y); }',
      ],
      [4, 5],
    ],
    [
      '`*`, `&` and `&&` before a call, which are operators there',
      MAX_BAN,
      [
        'int f(int, int w) { return w; }',
        'int main() { int a = 1, b = 2;',
        '    int x = a * max(a, b);',
        '    int y = a ? b : a & max(a, b);',
        '    if (a && max(a, b)) x = f(a, b * max(a, b));',
        '    return (int)a * max(x, y); }',
      ],
      [5, 6, 7, 8],
    ],
    [
      'the body of a macro',
      MAX_BAN,
      ['#define BEST max(a, b)', 'int main() { int a = 1, b = 2; return BEST; }'],
      [3],
    ],
  ];
  it.each(cases)('catches the use next to %s', (_what, ban, body, expected) => {
    expect(lines(ban, code(...STD, ...body))).toEqual(expected);
  });
});

describe("decideBanList: the student's own names pass where they are visible", () => {
  // [what, ban list, code after the two STD lines]
  const cases: [string, string, string[]][] = [
    [
      'a free function declared by a prototype and defined after its use',
      SORT_BAN,
      [
        'void sort(int* a, int n);',
        'int main() { int a[3] = {3, 2, 1}; sort(a, 3); }',
        'void sort(int* a, int n) { if (n > 1) sort(a, n - 1); }',
      ],
    ],
    [
      'a prototype inside a function',
      SORT_BAN,
      [
        'int main() { void sort(int* a, int n); int a[3] = {3, 2, 1}; sort(a, 3); }',
        'void sort(int* a, int n) { a[0] = n; }',
      ],
    ],
    [
      'member functions, called before their definition in the class and in out-of-line definitions',
      SORT_BAN,
      [
        'struct S {',
        '    int a[3];',
        '    S();',
        '    void go() { sort(0, 2); }',
        '    void twice();',
        '    void sort(int lo, int hi) { if (lo < hi) sort(lo + 1, hi); }',
        '};',
        'S::S() : a{1, 2, 3} { sort(0, 2); }',
        'void S::twice() { for (int i = 0; i < 2; i++) { sort(0, 2); } }',
        'int main() { S s; s.go(); s.twice(); }',
      ],
    ],
    [
      'a member function of a class template, defined out of line with a trailing return type',
      SORT_BAN,
      [
        'template <class T> struct S { T a[3]; void sort(int n); auto go(int n) -> vector<T>; };',
        'template <class T> void S<T>::sort(int n) { if (n > 1) sort(n - 1); }',
        'template <class T> auto S<T>::go(int n) -> vector<T> { sort(n); return {}; }',
        'int main() { S<int> s; s.go(3); }',
      ],
    ],
    [
      'a member function of a base class, used in a derived class',
      SORT_BAN,
      [
        'struct B { void sort(int n) { if (n > 1) sort(n - 1); } };',
        'struct D : public B { void go() { sort(3); } void later(); };',
        'void D::later() { sort(3); }',
        'struct E : D { void run() { auto f = [&] { sort(1); }; f(); } };',
        'int main() { D d; d.go(); d.later(); E().run(); }',
      ],
    ],
    [
      'static members and a nested class',
      'Do not use `max` or `std::min`.',
      [
        'struct S {',
        '    static int max(int a) { return a; }',
        '    static int top;',
        '    struct In { int f() { return max(3); } int g(); };',
        '    union { int min; int hi; };',
        '    int h() const { return min; }',
        '};',
        'int S::top = max(3);',
        'int S::In::g() { return max(3); }',
        'int main() { return S::top + S::In().g(); }',
      ],
    ],
    [
      'a function in a namespace, used inside it, reopened, and through a using-directive',
      SORT_BAN,
      [
        'namespace mine { void sort(int* a, int n) { if (n > 1) sort(a, n - 1); } void go(int*); }',
        'namespace mine { void twice(int* a) { sort(a, 3); } }',
        'void mine::go(int* a) { sort(a, 3); }',
        'using namespace mine;',
        'int main() { int a[3] = {3, 2, 1}; sort(a, 3); }',
      ],
    ],
    [
      'a using-declaration of a function in a namespace',
      SORT_BAN,
      [
        'namespace mine { void sort(int* a, int n) { if (n > 1) sort(a, n - 1); } }',
        'void f(int* a) { using mine::sort; sort(a, 3); }',
        'int main() { int a[3] = {3, 2, 1}; f(a); }',
      ],
    ],
    [
      'functions in an unnamed namespace, an inline namespace and an extern "C" block',
      'Do not use `std::find`, `std::binary_search` or `std::count`.',
      [
        'namespace { int find(int* a, int x) { return a[x]; } }',
        'inline namespace v1 { int binary_search(int* a, int x) { return a[x]; } }',
        'extern "C" { int count(int* a) { return find(a, 1); } }',
        'int main() { int a[3] = {3, 2, 1}; return find(a, 1) + binary_search(a, 1) + count(a); }',
      ],
    ],
    [
      'a friend function defined in its class',
      SORT_BAN,
      [
        'struct Row { int n; friend void sort(Row& r) { r.n = 1; } };',
        'int main() { Row r; sort(r); }',
      ],
    ],
    [
      'function templates, and `>` that ends a return type',
      SORT_BAN,
      [
        'template <class T> vector<T> sort(vector<T> v, int n) { return n ? sort(v, n - 1) : v; }',
        'template <class T> map<T, vector<T>> stable_sort(T a) { return {{a, {a}}}; }',
        'template <class T, class U = vector<T>> T* qsort(T* a, U u) { u.push_back(*a); return a; }',
        'int main() { vector<int> v; int x = 1; sort(v, 1); stable_sort(1); qsort(&x, v); }',
      ],
    ],
    [
      'a function template called max',
      MAX_BAN,
      [
        'template<class T> T max(T a, T b, int n) { return n ? max(a, b, n - 1) : b; }',
        'int main() { return max(1, 2, 3); }',
      ],
    ],
    [
      'return types: auto, pointers, qualified names, attributes',
      SORT_BAN,
      [
        'struct Row { int n; };',
        'Row all;',
        'auto sort(int n) { return n; }',
        'Row* stable_sort(int n) { all.n = n; return &all; }',
        '[[maybe_unused]] std::vector<int>::iterator qsort(vector<int>& v) { return v.begin(); }',
        'int main() { vector<int> v(3); sort(1); stable_sort(2); qsort(v); }',
      ],
    ],
    [
      'return types: static, references, const, after an access specifier',
      SORT_BAN,
      [
        'static vector<int>& sort(vector<int>& v) { return v; }',
        'vector<int> const& stable_sort(vector<int>& v) { return v; }',
        'struct S {',
        '    vector<int> a;',
        'public:',
        '    vector<int>* qsort() { return n ? qsort() : &a; }',
        '    int n = 0;',
        '};',
        'int main() { vector<int> v(3); sort(v); stable_sort(v); S().qsort(); }',
      ],
    ],
    [
      'parameters, in the body, in a constructor initializer and of a template',
      MAX_BAN,
      [
        'int f(int max, int n) { if (n > max) { return max; } return n; }',
        'int g(const vector<int>& max) { return max[0]; }',
        'struct S { int a, b; S(int max, int) : a{max}, b(max) { a += max; } };',
        'int apply(int max(int), int x) { return max(x); }',
        'template <int max> int lim() { return max; }',
        'template <class... Ts> int cnt(Ts... max) { return sizeof...(max); }',
        'int h(int (*max)(int, int)) { return max(1, 2); }',
        'int k(int max) try { return max; } catch (...) { return max; }',
        'int main() { vector<int> v(3); return f(1, 2) + g(v) + S(1, 2).a; }',
      ],
    ],
    [
      'locals: comma lists, loop variables, pointers, arrays, structured bindings',
      MAX_BAN,
      [
        'int main() {',
        '    vector<int> v(3);',
        '    { int min = 0, max = v[0]; min = max; }',
        '    { int a[2] = {1, 2}, *max = a; *max = 3; }',
        '    { int max[3] = {1, 2, 3}; max[0] = 1; }',
        '    { for (int i = 0, max = 3; i < max; i++) v[0] += max; }',
        '    { for (int max : v) v[0] += max; }',
        '    { for (auto& max : v) max = 1; }',
        '    { auto [min, max] = minmax({1, 2}); v[0] = min + max; }',
        '    { if (int max = v[0]) v[0] = max; }',
        '    { vector<int> max(3); max[0] = 1; }',
        '    { vector<int> a(3), max(3); max[0] = a[0]; }',
        '    { int (*max)(int) = nullptr; if (max) max(1); }',
        '    { switch (v[0]) { case 1: vector<int>* max = &v; max->clear(); } }',
        '}',
      ],
    ],
    [
      'lambdas: their name, parameters, init captures and recursion',
      MAX_BAN,
      [
        'auto pick = [](int max) { return max; };',
        'int f() {',
        '    function<int(int)> max = [&](int n) { return n ? max(n - 1) : 0; };',
        '    auto g = [&max](int n) { return max(n); };',
        '    return g(pick(3));',
        '}',
        'int main() {',
        '    auto g = [max = 3](int n) { return n + max; };',
        '    auto h = [](auto max, int n) -> int { return max + n; };',
        '    return f() + g(1) + h(1, 2);',
        '}',
      ],
    ],
    [
      'constructors, parameters with an attribute, and a comma list after a lambda',
      'Do not use `std::max` or `std::min`.',
      [
        'struct S { int max, min; S(int max) : max(max), min{1} {} S(int a, int b); };',
        'S::S(int a, int b) : max(a), min{b} { max += min; }',
        'int f([[maybe_unused]] vector<int>& max) { return max[0]; }',
        'int main() { auto g = [] { return 1; }, max = g; return max() + S(1).max; }',
      ],
    ],
    [
      'a macro of that name',
      MAX_BAN,
      ['#define max(a, b) ((a) > (b) ? (a) : (b))', 'int main() { return max(1, 2); }'],
    ],
    [
      'a macro whose body uses an own name',
      SORT_BAN,
      [
        '#define GO sort(0, 3)',
        'struct S { void sort(int lo, int hi) { if (lo < hi) GO; } };',
        'int main() { S().sort(1, 2); }',
      ],
    ],
    [
      'code whose braces depend on the preprocessor, where scopes cannot be read',
      MAX_BAN,
      [
        'int f(int n) {',
        '    int max = n;',
        '#ifdef FAST',
        '    if (n > 1) { n = 2; }',
        '    }',
        'int g(int max) {',
        '#else',
        '    if (n > 2) { n = 3; }',
        '#endif',
        '    return max;',
        '}',
        'int main() { return f(3); }',
      ],
    ],
  ];
  it.each(cases)('passes %s', (_what, ban, body) => {
    expect(decideBanList(ban, code(...STD, ...body))).toEqual({ verdict: 'pass', evidence: [] });
  });
});
