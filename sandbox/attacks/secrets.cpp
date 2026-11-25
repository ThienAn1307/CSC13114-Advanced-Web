#include <cstdlib>
#include <sys/stat.h>
#include <iostream>

#if __has_include("/run/secrets/GEMINI_API_KEY")
#define SECRET_INCLUDE_VISIBLE 1
#else
#define SECRET_INCLUDE_VISIBLE 0
#endif

int main() {
  struct stat info{};
  bool present = std::getenv("GEMINI_API_KEY") || std::getenv("GOOGLE_API_KEY") ||
    std::getenv("MODEL_API_KEY") || std::getenv("OPENAI_API_KEY") ||
    std::getenv("LEETKOB_TEST_SENTINEL") || stat("/run/secrets/GEMINI_API_KEY", &info) == 0 ||
    SECRET_INCLUDE_VISIBLE;
  std::cout << (present ? "secret visible" : "no secrets") << '\n';
}
