#include <cstdio>
#include <cstring>

char s[100005];
int n, pos;

// Reads balanced groups from pos on; false at the first mismatch.
bool group() {
    while (pos < n && (s[pos] == '(' || s[pos] == '[' || s[pos] == '{')) {
        char open = s[pos++];
        if (!group()) return false;
        char want = open == '(' ? ')' : open == '[' ? ']' : '}';
        if (pos >= n || s[pos] != want) return false;
        pos++;
    }
    return true;
}

int main() {
    if (scanf("%100004s", s) != 1) return 0;
    n = strlen(s);
    pos = 0;
    bool ok = group() && pos == n;
    puts(ok ? "YES" : "NO");
    return 0;
}
