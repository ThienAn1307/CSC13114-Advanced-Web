#include <sys/types.h>
#include <sys/wait.h>
#include <signal.h>
#include <unistd.h>
#include <iostream>
#include <vector>

int main() {
  std::vector<pid_t> children;
  bool limited = false;
  for (int i = 0; i < 32; ++i) {
    pid_t child = fork();
    if (child < 0) { limited = true; break; }
    if (child == 0) { sleep(10); _exit(0); }
    children.push_back(child);
  }
  for (auto child : children) kill(child, SIGTERM);
  for (auto child : children) waitpid(child, nullptr, 0);
  std::cout << (limited ? "limited" : "unlimited") << '\n';
}
