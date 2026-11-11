import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSubtitleFile, parseSubtitles } from '../site/subtitles.mjs';

test('SRT cues become readable text without timing or duplicate captions', () => {
  const input = '1\n00:00:01,000 --> 00:00:02,000\nHello there.\n\n2\n00:00:01,000 --> 00:00:02,000\nHello there.\n\n3\n00:00:03,000 --> 00:00:04,000\n<i>Good morning.</i>';
  assert.equal(parseSubtitles(input), 'Hello there.\n\nGood morning.');
});

test('WebVTT headers, identifiers and timestamps are removed', () => {
  assert.equal(parseSubtitles('WEBVTT\n\ncue-1\n00:00:01.000 --> 00:00:03.000 align:start\nA new day.\n'), 'A new day.');
  assert.throws(() => parseSubtitles('not a subtitle file'), /字幕/);
});

test('short gaps and overlapping repeated speech are retained; identical cues are merged', () => {
  const input = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello.\n\n00:00:01.000 --> 00:00:02.000\nHello.\n\n00:00:01.900 --> 00:00:02.500\nHello.\n\n00:00:02.500 --> 00:00:03.000\nHello.\n\n00:00:03.100 --> 00:00:04.000\nHello.';
  assert.equal(parseSubtitles(input), 'Hello.\n\nHello.\n\nHello.\n\nHello.');
});

test('subtitle entities and spoken parentheticals survive as plain text', () => {
  const input = 'WEBVTT\r\r00:00:01.000 --> 00:00:03.000\r<v Jane><c.green>(Perhaps) &#89;ou &amp; I [both] know 1 &lt; 2 &mdash; &#x1F30A; &quot;yes&quot;.</c></v>';
  assert.equal(parseSubtitles(input), '(Perhaps) You & I [both] know 1 < 2 — 🌊 "yes".');
  assert.equal(parseSubtitles('1\n00:00:00,000 --> 00:00:02,000\n1 < 2 > 0 &unknown; &#0;'), '1 < 2 > 0 &unknown; �');
  assert.equal(parseSubtitles('1\n00:00:00,000 --> 00:00:02,000\n&lt;img src=x onerror=alert(1)&gt;'), '<img src=x onerror=alert(1)>');
});

test('subtitle files decode UTF-16 and Windows-1252 without corrupting text', () => {
  const text = '1\n00:00:01,000 --> 00:00:03,000\n“That’s right.”';
  const le = Buffer.from(text, 'utf16le');
  const be = Buffer.from(le); be.swap16();
  for (const bytes of [Buffer.concat([Buffer.from([0xff, 0xfe]), le]), Buffer.concat([Buffer.from([0xfe, 0xff]), be]), le, be]) {
    assert.equal(parseSubtitles(decodeSubtitleFile(bytes)), '“That’s right.”');
  }
  const legacy = Buffer.concat([Buffer.from('1\n00:00:01,000 --> 00:00:03,000\n'), Buffer.from([0x93, 0x54, 0x68, 0x61, 0x74, 0x92, 0x73, 0x20, 0x72, 0x69, 0x67, 0x68, 0x74, 0x2e, 0x94])]);
  assert.equal(parseSubtitles(decodeSubtitleFile(legacy)), '“That’s right.”');
  const original = globalThis.TextDecoder;
  try {
    globalThis.TextDecoder = class { constructor() { throw new RangeError('unsupported'); } };
    assert.throws(() => decodeSubtitleFile(le), /不支援.*UTF-8/);
  } finally { globalThis.TextDecoder = original; }
});
