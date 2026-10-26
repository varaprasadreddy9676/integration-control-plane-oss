import { describe, expect, it } from 'vitest';
import { issueText } from '../features/stages/components/delivery-tab/stageDraft';

describe('what is wrong with a step, in words', () => {
  it.each([
    ['stages[0].runner.config.url', 'A URL is required', 'URL: A URL is required'],
    ['runner.config.expectStatus', 'Use numbers', 'Expect status: Use numbers'],
    ['stages[2].auth.credentialRef', 'Pick a credential', 'Credential: Pick a credential'],
    ['auth.allowedOrigins', 'Add an address', 'Sent only to: Add an address'],
    ['auth.headers.Authorization', 'Uses a credential field', 'How to send it: Uses a credential field'],
    ['timeoutMs', 'Too long', 'Time limit: Too long'],
    ['onError', 'Not allowed here', 'When it fails: Not allowed here'],
    ['name', 'A name is required', 'Name: A name is required'],
  ])('%s', (path, message, expected) => {
    expect(issueText(path, message)).toBe(expected);
  });

  it('shows the message alone when it does not know the place', () => {
    expect(issueText('something.odd', 'It broke')).toBe('It broke');
  });
});
