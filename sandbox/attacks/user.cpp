#include <unistd.h>
#include <iostream>

int main() {
  const bool blocked = geteuid() != 0 && setuid(0) != 0;
  std::cout << (blocked ? "non-root" : "root") << '\n';
}
