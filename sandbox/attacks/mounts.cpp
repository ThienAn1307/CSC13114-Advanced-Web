#include <sys/stat.h>
#include <unistd.h>
#include <iostream>

int main() {
  sleep(2);
  struct stat info{};
  std::cout << (stat("/var/run/docker.sock", &info) == 0 ? "socket visible" : "no socket") << '\n';
}
