import { describe, expect, it } from 'vitest';
import { RequestError } from '@agentclientprotocol/sdk';
import {
  formatAcpError,
  parseAcpActiveRunConflict,
  parseAcpCreditsExhaustedError,
} from '../errors';

describe('parseAcpActiveRunConflict', () => {
  it('extracts the run id from a backtick-quoted active-run error', () => {
    expect(
      parseAcpActiveRunConflict(
        new Error(
          'session already has active run `run_2eb2ff36-c616-49ad-8fd9-a96e3d253315`; use _goose/unstable/session/steer'
        )
      )
    ).toBe('run_2eb2ff36-c616-49ad-8fd9-a96e3d253315');
  });

  it('extracts the run id from a JSON-RPC-shaped error', () => {
    expect(
      parseAcpActiveRunConflict({
        message: 'session already has active run `run_abc`; use steer',
        data: {},
      })
    ).toBe('run_abc');
  });

  it('returns null for unrelated errors', () => {
    expect(parseAcpActiveRunConflict(new Error('something else failed'))).toBeNull();
    expect(parseAcpActiveRunConflict(null)).toBeNull();
  });
});

describe('formatAcpError', () => {
  it('explains how to recover from an authentication error', () => {
    expect(formatAcpError(RequestError.authRequired())).toBe(
      'Sign in to your provider, then try again.'
    );
  });
});

describe('parseAcpCreditsExhaustedError', () => {
  it('parses structured ACP credits exhausted errors', () => {
    expect(
      parseAcpCreditsExhaustedError({
        code: -32603,
        message: 'Please add credits to your account, then resend your message to continue.',
        data: {
          reason: 'credits_exhausted',
          url: 'https://router.tetrate.ai/billing',
        },
      })
    ).toEqual({
      message: 'Please add credits to your account, then resend your message to continue.',
      url: 'https://router.tetrate.ai/billing',
    });
  });

  it('parses wrapped JSON-RPC errors', () => {
    expect(
      parseAcpCreditsExhaustedError({
        error: {
          code: -32603,
          message: 'Add credits to continue.',
          data: {
            reason: 'credits_exhausted',
          },
        },
      })
    ).toEqual({
      message: 'Add credits to continue.',
    });
  });

  it('ignores non-credits-exhausted errors', () => {
    expect(
      parseAcpCreditsExhaustedError({
        code: -32603,
        message: 'Something failed.',
        data: {
          reason: 'provider_error',
        },
      })
    ).toBeNull();
  });
});
