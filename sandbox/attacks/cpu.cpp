#include <cstdint>

int main() {
  volatile std::uint64_t count = 0;
  for (;;) ++count;
}
