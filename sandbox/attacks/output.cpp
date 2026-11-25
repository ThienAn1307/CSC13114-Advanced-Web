#include <unistd.h>
#include <cstring>

int main() {
  char output[8192];
  std::memset(output, 'x', sizeof(output));
  for (;;) if (write(STDOUT_FILENO, output, sizeof(output)) < 0) return 1;
}
