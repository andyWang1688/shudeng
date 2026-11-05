import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QuestionPresentation, ReaderQuestionRegistry, questionAppearanceFromParams, questionAppearanceParams, resolveQuestionAppearance } from '../session.ts';

test('application routes carry a policy without freezing the current mode', () => {
  const appearance = questionAppearanceFromParams({ appearance: ['application'], theme: 'light' });
  assert.deepEqual(questionAppearanceParams(appearance), { appearance: 'application' });
  assert.equal(resolveQuestionAppearance(appearance, 'dark'), 'dark');
  assert.equal(resolveQuestionAppearance(appearance, 'light'), 'light');
});

test('reader and legacy routes retain valid fixed themes, including unknown policy tokens', () => {
  for (const appearance of [undefined, 'reader', 'future-policy']) {
    const policy = questionAppearanceFromParams({ appearance, theme: ['dark', 'light'] });
    assert.deepEqual(questionAppearanceParams(policy), { appearance: 'reader', theme: 'dark' });
    assert.equal(resolveQuestionAppearance(policy, 'light'), 'dark');
  }
  assert.deepEqual(questionAppearanceFromParams({ appearance: 'future-policy', theme: 'invalid' }), { kind: 'application' });
  assert.deepEqual(questionAppearanceFromParams({ theme: 'invalid' }), { kind: 'application' });
  assert.deepEqual(questionAppearanceFromParams({}), { kind: 'application' });
});

test('old constructor inputs retain a fixed theme and an explicit policy is immutable', () => {
  const old = new QuestionPresentation('p', 'c', 'b', 'Title', 'dark', null, null, undefined, undefined);
  assert.deepEqual(old.appearanceParams(), { appearance: 'reader', theme: 'dark' });
  const policy: { kind: 'reader'; theme: 'light' | 'dark' } = { kind: 'reader', theme: 'dark' };
  const explicit = new QuestionPresentation('p2', 'c2', 'b', 'Title', 'light', null, null, undefined, undefined, policy);
  policy.theme = 'light';
  assert.deepEqual(explicit.appearance, { kind: 'reader', theme: 'dark' });
  assert(Object.isFrozen(explicit.appearance));
});

test('registered owner format decides new policy while history respects its explicit policy', () => {
  let sequence = 0;
  const registry = new ReaderQuestionRegistry(() => String(++sequence), { dismissQuestion: async () => true, presentQuestion() {}, presentReference() {} });
  for (const format of ['pdf', 'epub'] as const) {
    registry.register({ id: format, routeKey: format, bookId: 'book', format }, { navigate: async command => ({ operationId: command.operationId, status: 'arrived' }), flushProgress: async () => true, documentFailed: () => false });
    const presentation = registry.openQuestion(format, { bookId: 'book', origin: null, theme: 'dark', appearance: { kind: 'reader', theme: 'light' } });
    assert.deepEqual(presentation.appearance, format === 'pdf' ? { kind: 'application' } : { kind: 'reader', theme: 'dark' });
  }
  assert.deepEqual(registry.createHistory({ bookId: 'book', theme: 'dark', origin: null }).appearance, { kind: 'reader', theme: 'dark' });
  assert.deepEqual(registry.createHistory({ bookId: 'book', theme: 'dark', origin: null, appearance: { kind: 'application' } }).appearance, { kind: 'application' });
});
