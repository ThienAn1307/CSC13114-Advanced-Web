import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { App } from './App.js';

it('offers a labelled sign-in form without exposing privileged controls', () => {
  const markup = renderToStaticMarkup(<App />);
  expect(markup).toContain('Sign in');
  expect(markup).toContain('name="email"');
  expect(markup).toContain('name="password"');
  expect(markup).not.toContain('Create class');
  expect(markup).not.toContain('Submit a solution');
});
