import { describe, expect, it } from 'vitest';
import { isToolModeMismatch, modelNeedsToolshim, recommendedToolshim } from './toolMode';

describe('toolMode coupling', () => {
  it('auto:code is native (no toolshim)', () => {
    expect(modelNeedsToolshim('auto:code')).toBe(false);
    expect(recommendedToolshim('auto:code')).toBe(false);
  });

  it('auto:chat needs the toolshim (compatible)', () => {
    expect(modelNeedsToolshim('auto:chat')).toBe(true);
    expect(recommendedToolshim('auto:chat')).toBe(true);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(modelNeedsToolshim('  Auto:Chat  ')).toBe(true);
    expect(modelNeedsToolshim('AUTO:CODE')).toBe(false);
  });

  it('unknown/custom models default to native', () => {
    expect(recommendedToolshim('qwen3-coder')).toBe(false);
    expect(recommendedToolshim(null)).toBe(false);
    expect(recommendedToolshim(undefined)).toBe(false);
    expect(recommendedToolshim('')).toBe(false);
  });

  it('flags the known-broken auto:code + Kompatibel combo', () => {
    // auto:code with toolshim ON -> mismatch (the exact bug the user hit).
    expect(isToolModeMismatch('auto:code', true)).toBe(true);
    // auto:code with toolshim OFF -> fine.
    expect(isToolModeMismatch('auto:code', false)).toBe(false);
    // auto:chat with toolshim OFF -> mismatch (mistral-small cannot do a tool role).
    expect(isToolModeMismatch('auto:chat', false)).toBe(true);
    // auto:chat with toolshim ON -> fine.
    expect(isToolModeMismatch('auto:chat', true)).toBe(false);
  });
});
