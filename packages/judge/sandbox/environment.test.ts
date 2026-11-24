import { expect, it } from 'vitest';
import { judge } from '../src/index.js';

it('starts the submitted program with an empty environment', async () => {
  const image = process.env.JUDGE_IMAGE;
  if (!image) throw new Error('JUDGE_IMAGE is required.');
  const source =
    '#include <iostream>\nextern char **environ;\nint main(){std::cout << (*environ ? "not empty" : "empty");}\n';
  const result = await judge({
    image,
    source,
    cases: [{ input: '', expectedOutput: 'empty' }],
    cpuSeconds: 1,
    memoryMb: 256,
  });
  expect(result.status).toBe('AC');
});
