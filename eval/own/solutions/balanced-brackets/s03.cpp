#include <iostream>
#include <stack>
#include <string>

int main() {
    std::string s;
    std::cin >> s;
    std::stack<char> st;
    bool ok = true;
    for (char c : s) {
        if (c == '(' || c == '[' || c == '{') {
            st.push(c);
        } else {
            char want = c == ')' ? '(' : c == ']' ? '[' : '{';
            if (st.empty() || st.top() != want) { ok = false; break; }
            st.pop();
        }
    }
    std::cout << (ok && st.empty() ? "YES" : "NO") << "\n";
}
