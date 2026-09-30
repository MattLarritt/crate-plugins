import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nameIt } from '../server/index.js';
import type { PluginContext, SongEvidence, SongIdentity } from '../../../types/contract.js';

/**
 * What a kept YouTube song is filed and tagged as. The AI is crate's (ctx.ai), asked only when
 * the admin allows it and crate has a key; otherwise the plugin's own reading of the video.
 */

const quiet = { info() {}, warn() {}, error() {} };

function ctxWith(opts: { aiCleanup?: boolean; ai?: 'none' | 'off' | ((e: SongEvidence) => SongIdentity | null) }) {
  const asked: SongEvidence[] = [];
  const ctx = {
    log: quiet,
    settings: { get: (k: string) => (k === 'aiCleanup' ? opts.aiCleanup ?? false : undefined) },
    ...(opts.ai === 'none'
      ? {}
      : {
          ai: {
            available: () => opts.ai !== 'off',
            identifySong: async (e: SongEvidence) => {
              asked.push(e);
              return typeof opts.ai === 'function' ? opts.ai(e) : null;
            },
          },
        }),
  } as unknown as PluginContext;
  return { ctx, asked };
}

const meta = {
  id: 'SSbBvKaM6sk',
  title: 'Blur - Song 2 (Official Music Video)',
  channel: 'Blur',
  description: 'Provided to YouTube by Parlophone',
  duration: 121.7,
  genre: 'Music',
};
const who = { key: 'SSbBvKaM6sk', title: 'Song 2', artist: 'Blur' };

describe('nameIt', () => {
  test("off: the plugin's own reading, and the AI is never asked", async () => {
    const { ctx, asked } = ctxWith({ aiCleanup: false, ai: () => ({ artist: 'X', title: 'Y' }) });
    assert.deepEqual(await nameIt(ctx, meta, who), { artist: 'Blur', title: 'Song 2' });
    assert.equal(asked.length, 0);
  });

  test('on: the AI names it, over the plugin’s guess, and sees the guess and the evidence', async () => {
    const { ctx, asked } = ctxWith({
      aiCleanup: true,
      ai: () => ({ artist: 'Blur', title: 'Song 2', album: 'Blur', trackNo: 2, year: 1997, genre: 'Rock' }),
    });
    assert.deepEqual(await nameIt(ctx, meta, who), {
      artist: 'Blur',
      title: 'Song 2',
      album: 'Blur',
      trackNo: 2,
      year: 1997,
      genre: 'Rock',
    });
    assert.equal(asked[0]?.videoTitle, meta.title);
    assert.deepEqual(asked[0]?.guess, { artist: 'Blur', title: 'Song 2' });
  });

  test("on, but the AI isn't sure: the plugin's own reading stands", async () => {
    const { ctx } = ctxWith({ aiCleanup: true, ai: () => null });
    assert.deepEqual(await nameIt(ctx, meta, who), { artist: 'Blur', title: 'Song 2' });
  });

  test('on, but crate has no key, or is too old to offer AI: never asked', async () => {
    for (const ai of ['off', 'none'] as const) {
      const { ctx, asked } = ctxWith({ aiCleanup: true, ai });
      assert.deepEqual(await nameIt(ctx, meta, who), { artist: 'Blur', title: 'Song 2' });
      assert.equal(asked.length, 0, ai);
    }
  });

  test("YouTube's own year and track number are used; its genre 'Music' is not", async () => {
    const { ctx } = ctxWith({});
    const named = await nameIt(ctx, { ...meta, release_year: 1997, track_number: 2, genre: 'Music' }, who);
    assert.deepEqual(named, { artist: 'Blur', title: 'Song 2', trackNo: 2, year: 1997 });
  });
});
