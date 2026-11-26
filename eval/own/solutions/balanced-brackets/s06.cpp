#include <iostream>
#include <string>

struct CharStack {
    char* buf = nullptr;
    int top = 0, cap = 0;
    ~CharStack() { delete[] buf; }
    void push(char c) {
        if (top == cap) {
            int ncap = cap ? cap * 2 : 16;
            char* nb = new char[ncap];
            for (int i = 0; i < top; i++) nb[i] = buf[i];
            delete[] buf;
            buf = nb;
            cap = ncap;
        }
        buf[top++] = c;
    }
};

int main() {
    std::string s;
    std::cin >> s;
    CharStack st;
    for (char c : s) {
        if (c == '(' || c == '[' || c == '{') { st.push(c); continue; }
        char want = c == ')' ? '(' : c == ']' ? '[' : '{';
        if (st.top == 0 || st.buf[st.top - 1] != want) { std::cout << "NO\n"; return 0; }
        st.top--;
    }
    std::cout << (st.top == 0 ? "YES" : "NO") << "\n";
}
