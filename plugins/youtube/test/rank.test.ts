import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { channelArtist, expiryOf, isTopic, parseTitle, rank, bestThumbnail, type SearchEntry } from '../server/rank.js';
import { identify } from '../server/index.js';

/**
 * Which YouTube result plays.
 *
 * For a voice request the first result IS the answer, so these pin the choices a person would
 * notice being wrong: a live set, a karaoke track or an hour-long loop playing instead of the
 * song. Fixtures are shaped like yt-dlp's flat search output.
 */

const opts = { limit: 5, minDurationS: 60, maxDurationS: 900 };

const e = (id: string, title: string, channel: string, duration = 122): SearchEntry => ({ id, title, channel, duration });

describe('rank', () => {
  test('a Topic upload beats the official video, which beats everything else', () => {
    const hits = rank(
      [
        e('aaaaaaaaaaa', 'Blur - Song 2 (Official Music Video)', 'Blur'),
        e('bbbbbbbbbbb', 'Song 2 (2012 Remaster)', 'Blur - Topic'),
        e('ccccccccccc', 'Blur Song 2 guitar lesson', 'GuitarPal'),
      ],
      'song 2 blur',
      opts,
    );
    assert.deepEqual(hits.map((h) => h.key), ['bbbbbbbbbbb', 'aaaaaaaaaaa', 'ccccccccccc']);
  });

  test('versions nobody asked for sink', () => {
    const hits = rank(
      [
        e('11111111111', 'Blur - Song 2 (Live at Glastonbury)', 'BBC Music'),
        e('22222222222', 'Song 2 - Blur (Karaoke Version)', 'Sing King'),
        e('33333333333', 'Blur - Song 2 slowed + reverb', 'vibes'),
        e('44444444444', 'Blur - Song 2', 'blurofficial'),
      ],
      'song 2 blur',
      opts,
    );
    assert.equal(hits[0]?.key, '44444444444');
    assert.equal(hits.at(-1)?.key, '22222222222', 'karaoke is the least wanted of all');
  });

  test('but asking for the live version gets it', () => {
    const hits = rank(
      [e('44444444444', 'Blur - Song 2', 'blurofficial'), e('11111111111', 'Blur - Song 2 (Live at Glastonbury)', 'BBC Music')],
      'song 2 blur live',
      opts,
    );
    assert.equal(hits[0]?.key, '44444444444', 'the studio one still ranks by position when both are fine');
    assert.ok(hits.some((h) => h.key === '11111111111'), 'and the live one is not penalised out');
  });

  test('a song whose TITLE contains a penalised word is fine when you asked for it', () => {
    // "Live Forever" is a song, not a live recording.
    const hits = rank([e('55555555555', 'Oasis - Live Forever', 'Oasis - Topic', 276)], 'live forever oasis', opts);
    assert.equal(hits.length, 1);
    assert.ok(hits[0]!.score > 0);
  });

  test('too short or too long is dropped outright, not just ranked low', () => {
    const hits = rank(
      [
        e('66666666666', 'Blur - Song 2 (preview)', 'x', 30),
        e('77777777777', 'Blur - Song 2 1 HOUR LOOP', 'x', 3600),
        e('88888888888', 'Blur - Song 2', 'x', 122),
      ],
      'song 2',
      opts,
    );
    assert.deepEqual(hits.map((h) => h.key), ['88888888888']);
  });

  test('channels and playlists are not songs', () => {
    const hits = rank(
      [
        { id: 'UCRmhB4aHx1A4XqEl0GFOHVw', title: 'Blur', channel: 'Blur', ie_key: 'YoutubeTab' },
        { id: 'PLabcdefghijklmnopqrstuv', title: 'Blur — best of', channel: 'x', ie_key: 'YoutubeTab' },
        { id: 'abcdefghijk', title: 'Blur (channel page)', channel: 'x', ie_key: 'YoutubeTab' },
        e('88888888888', 'Blur - Song 2', 'Blur - Topic'),
      ],
      'blur',
      opts,
    );
    assert.deepEqual(hits.map((h) => h.key), ['88888888888']);
  });

  test('an unknown duration is kept rather than guessed at', () => {
    assert.equal(rank([{ id: '99999999999', title: 'Blur - Song 2', channel: 'x', duration: null }], 'song 2', opts).length, 1);
  });

  test('respects the limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => e(`id${String(i).padStart(9, '0')}`, `Song ${i}`, 'x'));
    assert.equal(rank(many, 'song', opts).length, 5);
  });

  test('a Topic channel names the artist, whatever the title says', () => {
    const [h] = rank([e('bbbbbbbbbbb', 'Song 2', 'Blur - Topic')], 'song 2', opts);
    assert.equal(h?.artist, 'Blur');
    assert.equal(h?.title, 'Song 2');
  });
});

describe('parseTitle', () => {
  test('splits "Artist - Title" and strips the video noise', () => {
    assert.deepEqual(parseTitle('Blur - Song 2 (Official Music Video) [HD]'), { artist: 'Blur', title: 'Song 2' });
  });

  test('keeps brackets that say something about the recording', () => {
    assert.equal(parseTitle('Blur - Song 2 (2012 Remaster)').title, 'Song 2 (2012 Remaster)');
    assert.equal(parseTitle('Artist - Tune (feat. Someone)').title, 'Tune (feat. Someone)');
  });

  test('handles en and em dashes, and a pipe-separated channel tail', () => {
    assert.deepEqual(parseTitle('Blur – Song 2 | Top of the Pops'), { artist: 'Blur', title: 'Song 2' });
    assert.deepEqual(parseTitle('Blur — Song 2'), { artist: 'Blur', title: 'Song 2' });
  });

  test('no dash means no artist, rather than a wrong one', () => {
    assert.deepEqual(parseTitle('Song 2 (Official Audio)'), { artist: null, title: 'Song 2' });
  });
});

describe('channels', () => {
  test('Topic and VEVO channels reduce to the artist', () => {
    assert.equal(channelArtist('Blur - Topic'), 'Blur');
    assert.equal(channelArtist('BlurVEVO'), 'Blur');
    assert.ok(isTopic('Blur - Topic'));
    assert.ok(!isTopic('Blur'));
  });
});

describe('identify — what a kept song is filed as', () => {
  test("YouTube Music's own fields win", () => {
    const h = identify({ id: 'bbbbbbbbbbb', title: 'Song 2', channel: 'Blur - Topic', track: 'Song 2', artist: 'Blur', album: 'Blur', duration: 121.7 });
    assert.deepEqual(h, { key: 'bbbbbbbbbbb', title: 'Song 2', artist: 'Blur', album: 'Blur', durationS: 122 });
  });

  test('otherwise the parsed title, then the channel', () => {
    assert.equal(identify({ id: 'x', title: 'Blur - Song 2 (Official Video)', channel: 'EMI' }).artist, 'Blur');
    assert.equal(identify({ id: 'x', title: 'Song 2', channel: 'BlurVEVO' }).artist, 'Blur');
  });

  test('never an empty title', () => {
    assert.equal(identify({ id: 'x', title: '(Official Video)', channel: 'Blur' }).title, '(Official Video)');
  });
});

describe('helpers', () => {
  test('expiry comes from the expire= parameter', () => {
    assert.equal(expiryOf('https://r1.googlevideo.com/videoplayback?expire=1790000000&x=1'), 1790000000);
    assert.equal(expiryOf('https://example.com/a.m4a'), undefined);
    assert.equal(expiryOf('not a url'), undefined);
  });

  test('the thumbnail is the widest reasonably small one', () => {
    assert.equal(
      bestThumbnail([
        { url: 'a', width: 120 },
        { url: 'b', width: 480 },
        { url: 'c', width: 1280 },
      ]),
      'b',
    );
    assert.equal(bestThumbnail(undefined), undefined);
  });
});
