#!/bin/sh
# Compile every solution with g++ -std=c++17 -O2, run it on every .in with the 1 s limit of
# statement.md, and compare its output token by token with the .out.
set -u
cd /data || exit 1
fail=0
tokens() { tr -s ' \t\r\n' '\n' < "$1" | sed '/^$/d'; }
for p in problems/*/; do
  p=$(basename "$p")
  for src in solutions/$p/*.cpp; do
    exe=/tmp/$(basename "$src" .cpp)
    if ! g++ -std=c++17 -O2 -o "$exe" "$src" 2>/tmp/err; then echo "CE $src"; cat /tmp/err; fail=1; continue; fi
    tests=0
    bad=0
    for in in problems/$p/tests/*.in; do
      [ -f "$in" ] || continue # no .in file: the loop gets the pattern itself
      tests=$((tests + 1))
      # Output to a file, not a pipe: $? is then the exit status of the solution.
      timeout 1 "$exe" < "$in" > /tmp/out
      code=$?
      if [ "$code" -eq 124 ]; then echo "TLE $src $(basename "$in")"; bad=1
      elif [ "$code" -ne 0 ]; then echo "RE $src $(basename "$in") (exit status $code)"; bad=1
      elif [ "$(tokens /tmp/out)" != "$(tokens "${in%.in}.out")" ]; then echo "WA $src $(basename "$in")"; bad=1
      fi
    done
    if [ "$tests" -eq 0 ]; then echo "NO TESTS $src"; bad=1; fi
    if [ "$bad" -eq 0 ]; then echo "ok $src"; else fail=1; fi
  done
done
exit $fail
