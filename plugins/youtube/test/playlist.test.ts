import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { identify, playlistId } from '../server/index.js';

/** "Import playlist from YouTube": which links are playlists, and what their songs are called. */

describe('playlistId', () => {
  const ID = 'RDCLAK5uy_n6xsA4G1s9bHFjUyr2MGPBH4LXdj0orZQ';

  test('YouTube Music and YouTube links, whatever else they carry', () => {
    assert.equal(playlistId(`https://music.youtube.com/playlist?list=${ID}&playnext=1&si=r7CKs98BljQJeAve`), ID);
    assert.equal(playlistId(`https://www.youtube.com/playlist?list=${ID}`), ID);
    assert.equal(playlistId(`https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG`), 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG');
    assert.equal(playlistId(`  https://m.youtube.com/playlist?list=${ID}  `), ID);
  });

  test('not a playlist, or not YouTube: null, so another source may try', () => {
    assert.equal(playlistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
    assert.equal(playlistId(`https://evil.example/playlist?list=${ID}`), null);
    assert.equal(playlistId(`https://music.youtube.com.evil.example/playlist?list=${ID}`), null);
    assert.equal(playlistId('https://www.youtube.com/playlist?list=../../etc'), null);
    assert.equal(playlistId('not a link'), null);
    assert.equal(playlistId(`javascript:alert(1)//?list=${ID}`), null);
  });
});

describe('a playlist entry, named', () => {
  test('artist and title from the video title, its decoration dropped', () => {
    const hit = identify({ id: 'LqZpGYhyvr4', title: 'JOYRYDE & Skrillex - AGEN WIDA [Official Audio]', channel: 'OWSLA', duration: 199 });
    assert.equal(hit.artist, 'JOYRYDE & Skrillex');
    assert.equal(hit.title, 'AGEN WIDA');
    assert.equal(hit.durationS, 199);
  });

  test('no artist in the title: the channel is the artist', () => {
    const hit = identify({ id: '3_Sqn98Z7Ao', title: 'Crave You (Adventure Club Remix)', channel: 'Flight Facilities' });
    assert.equal(hit.artist, 'Flight Facilities');
    assert.equal(hit.title, 'Crave You (Adventure Club Remix)');
  });
});
