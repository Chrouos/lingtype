import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSubtitles } from '../site/subtitles.mjs';

test('SRT cues become readable text without timing or duplicate captions', () => {
  const input = '1\n00:00:01,000 --> 00:00:02,000\nHello there.\n\n2\n00:00:02,000 --> 00:00:03,000\nHello there.\n\n3\n00:00:03,000 --> 00:00:04,000\n<i>Good morning.</i>';
  assert.equal(parseSubtitles(input), 'Hello there.\n\nGood morning.');
});

test('WebVTT headers, identifiers and timestamps are removed', () => {
  assert.equal(parseSubtitles('WEBVTT\n\ncue-1\n00:00:01.000 --> 00:00:03.000 align:start\nA new day.\n'), 'A new day.');
  assert.throws(() => parseSubtitles('not a subtitle file'), /字幕/);
});
