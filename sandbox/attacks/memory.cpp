#include <cstddef>
#include <iostream>
#include <new>

int main() {
  constexpr std::size_t size = 1024ULL * 1024 * 1024;
  volatile unsigned char* memory = new (std::nothrow) unsigned char[size];
  if (!memory) return 1;
  for (std::size_t i = 0; i < size; i += 4096) memory[i] = static_cast<unsigned char>(i / 4096);
  unsigned long long sum = 0;
  for (std::size_t i = 0; i < size; i += 4096) sum += memory[i];
  std::cout << sum << '\n';
  delete[] memory;
}
