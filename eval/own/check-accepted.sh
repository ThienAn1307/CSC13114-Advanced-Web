#!/bin/sh
# Compile every solution with g++ -std=c++17 -O2 and compare its output token by token with every .out.
set -u
cd /data
fail=0
for p in problems/*/; do
  p=$(basename "$p")
  for src in solutions/$p/*.cpp; do
    exe=/tmp/$(basename "$src" .cpp)
    if ! g++ -std=c++17 -O2 -o "$exe" "$src" 2>/tmp/err; then echo "CE $src"; cat /tmp/err; fail=1; continue; fi
    for in in problems/$p/tests/*.in; do
      want=${in%.in}.out
      got=$(timeout 2 "$exe" < "$in" | tr -s ' \t\r\n' '\n' | sed '/^$/d')
      exp=$(tr -s ' \t\r\n' '\n' < "$want" | sed '/^$/d')
      if [ "$got" != "$exp" ]; then echo "WA $src $(basename "$in")"; fail=1; fi
    done
    echo "ok $src"
  done
done
exit $fail
