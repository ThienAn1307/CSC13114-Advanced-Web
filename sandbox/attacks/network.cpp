#include <ifaddrs.h>
#include <net/if.h>
#include <sys/socket.h>
#include <iostream>

int main() {
  ifaddrs* interfaces = nullptr;
  if (getifaddrs(&interfaces) != 0) return 1;
  bool external = false;
  for (auto* item = interfaces; item; item = item->ifa_next) {
    if (item->ifa_addr && !(item->ifa_flags & IFF_LOOPBACK) &&
        (item->ifa_addr->sa_family == AF_INET || item->ifa_addr->sa_family == AF_INET6)) {
      external = true;
    }
  }
  freeifaddrs(interfaces);
  std::cout << (external ? "network available" : "blocked") << '\n';
}
