#include <cstdio>

char s[100005];
char st[100005];

int main() {
    if (scanf("%100004s", s) != 1) return 0;
    int top = 0;
    bool ok = true;
    for (int i = 0; s[i] && ok; i++) {
        char c = s[i];
        if (c == '(' || c == '[' || c == '{') {
            st[top++] = c;
        } else {
            char want = c == ')' ? '(' : c == ']' ? '[' : '{';
            if (top == 0 || st[top - 1] != want) ok = false;
            else top--;
        }
    }
    puts(ok && top == 0 ? "YES" : "NO");
    return 0;
}
