import { expect, it } from 'vitest';
import { judge } from '../src/index.js';

it('compiles inside the sandbox and compares each test output', async () => {
  const image = process.env.JUDGE_IMAGE;
  if (!image) throw new Error('JUDGE_IMAGE must name the locally built sandbox image.');
  const result = await judge({
    image,
    source: '#include <iostream>\nint main(){int x; std::cin >> x; std::cout << x + 1 << "\\n";}\n',
    cases: [
      { input: '4\n', expectedOutput: '5\n' },
      { input: '6\n', expectedOutput: 'wrong\n' },
    ],
    cpuSeconds: 1,
    memoryMb: 256,
  });
  expect(result.tests.map((item) => item.status)).toEqual(['AC', 'WA']);
  expect(result.status).toBe('WA');
});
