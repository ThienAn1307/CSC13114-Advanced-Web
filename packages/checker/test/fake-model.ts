import type { Model, ModelResponse } from '../src/model.ts';

type Answer = (prompt: string, signal: AbortSignal) => Promise<string> | string;

/** A model that answers from a function and never touches the network. It keeps every prompt it got. */
export function fakeModel(answer: Answer): Model & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    name: 'fake-model',
    prompts,
    async complete({ prompt, signal }): Promise<ModelResponse> {
      prompts.push(prompt);
      const text = await answer(prompt, signal);
      return {
        text,
        requestId: `fake-${prompts.length}`,
        model: 'fake-model',
        tokensIn: 0,
        tokensOut: 0,
      };
    },
  };
}

/** An answer that never comes: it settles only when the request is aborted. */
export function never(_prompt: string, signal: AbortSignal): Promise<string> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true });
  });
}
