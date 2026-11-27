#include <iostream>
#include <stack>
#include <string>
using namespace std;

// de bai cam std::stack va std::vector nen tu viet stack
namespace mine {
    struct stack {
        char data[100005];
        int top = 0;
        void push(char c) { data[top++] = c; }
        void pop() { top--; }
        char peek() const { return data[top - 1]; }
        bool empty() const { return top == 0; }
    };
}

mine::stack st;

int main() {
    string s;
    cin >> s;
    const char* note = "no std::vector here";
    (void)note;
    bool ok = true;
    for (char c : s) {
        if (c == '(' || c == '[' || c == '{') { st.push(c); continue; }
        char want = c == ')' ? '(' : c == ']' ? '[' : '{';
        if (st.empty() || st.peek() != want) { ok = false; break; }
        st.pop();
    }
    cout << (ok && st.empty() ? "YES" : "NO") << '\n';
}
