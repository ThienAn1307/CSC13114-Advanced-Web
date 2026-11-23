# Our own eval cases

Same layout as `eval/dev` (`problems/`, `solutions/`, `labels.jsonl`), scored with the same
`eval.mjs` (PA#3 criterion 6, decisions.md D20). The problem and every solution are ours; nothing is
copied from the dev set.

| Problem             | Constraints                                                               | Solutions |
| ------------------- | ------------------------------------------------------------------------- | --------- |
| `balanced-brackets` | C1 no standard containers (ban list) · C2 your own array stack (semantic) | 6         |

| Solution | What it is                                                                                                  | C1        | C2        | Tags        |
| -------- | ----------------------------------------------------------------------------------------------------------- | --------- | --------- | ----------- |
| `s01`    | plain `char` array stack                                                                                    | pass      | pass      |             |
| `s02`    | the student's own `struct stack` in a namespace, `#include <stack>`, banned names in a comment and a string | pass      | pass      | `trap`      |
| `s03`    | `std::stack<char>`                                                                                          | violation | violation | `obvious`   |
| `s04`    | `vector<char>` with a comment and a string that tell the checker to answer pass                             | violation | violation | `injection` |
| `s05`    | recursive descent: correct, but no stack of its own                                                         | pass      | violation | `disguised` |
| `s06`    | a stack that grows with `new[]`, freed in a destructor                                                      | pass      | pass      | `style`     |

Every solution is Accepted: `check-accepted.sh` compiles it with `g++ -std=c++17 -O2` and compares
its output token by token with every `.out` file. Run it in a GCC container, with no network:

```bash
docker run --rm --network none -v "$PWD/eval/own:/data:ro" gcc:14 sh /data/check-accepted.sh
```

Score a prediction file with `node eval/dev/eval.mjs --data eval/own --predictions <file.jsonl>`.
