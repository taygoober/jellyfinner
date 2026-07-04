export type SubtitleCue = {
  /** Milliseconds. */
  start: number;
  end: number;
  text: string;
};

/** Windows-1252's 0x80–0x9F specials; every other byte maps 1:1 to Unicode. */
const CP1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};

/** Strict UTF-8 decode, or null when the bytes aren't valid UTF-8. */
function tryUtf8(b: Uint8Array): string | null {
  let out = '';
  for (let i = 0; i < b.length; ) {
    const x = b[i];
    let cp: number;
    let extra: number;
    if (x < 0x80) [cp, extra] = [x, 0];
    else if (x >= 0xc2 && x <= 0xdf) [cp, extra] = [x & 0x1f, 1];
    else if (x >= 0xe0 && x <= 0xef) [cp, extra] = [x & 0x0f, 2];
    else if (x >= 0xf0 && x <= 0xf4) [cp, extra] = [x & 0x07, 3];
    else return null;
    for (let j = 1; j <= extra; j++) {
      const c = b[i + j];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    // Reject overlong encodings and surrogate/out-of-range code points.
    if (
      (extra === 1 && cp < 0x80) ||
      (extra === 2 && cp < 0x800) ||
      (extra === 3 && cp < 0x10000) ||
      cp > 0x10ffff ||
      (cp >= 0xd800 && cp <= 0xdfff)
    ) {
      return null;
    }
    out += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return out;
}

function latin1(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i++) out += String.fromCharCode(CP1252[b[i]] ?? b[i]);
  return out;
}

function utf16(b: Uint8Array, littleEndian: boolean): string {
  let out = '';
  for (let i = 0; i + 1 < b.length; i += 2) {
    out += String.fromCharCode(littleEndian ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  }
  return out;
}

/**
 * Decode subtitle file bytes without trusting platform encoding detection —
 * iOS refuses to guess for Windows-1252, which most scene-release SRTs use
 * ("the text encoding of its content can't be determined"). BOM first, then
 * strict UTF-8, then Windows-1252, which accepts any byte sequence.
 */
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const rest = bytes.subarray(3);
    return tryUtf8(rest) ?? latin1(rest);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return utf16(bytes.subarray(2), true);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return utf16(bytes.subarray(2), false);
  // No BOM but full of NULs → UTF-16 from a Windows tool; guess byte order
  // from which side of the pairs the zeros sit on.
  const sample = bytes.subarray(0, 512);
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] !== 0) continue;
    if (i % 2 === 0) evenZeros++;
    else oddZeros++;
  }
  if (evenZeros + oddZeros > sample.length / 4) {
    return utf16(bytes, oddZeros >= evenZeros);
  }
  return tryUtf8(bytes) ?? latin1(bytes);
}

const TIME_RE = /(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function parseTime(raw: string): number | null {
  const m = TIME_RE.exec(raw);
  if (!m) return null;
  const [, h, min, s, ms] = m;
  return (
    (Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s)) * 1000 + Number(ms.padEnd(3, '0'))
  );
}

function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '') // vtt/srt styling tags
    .replace(/\{\\[^}]*\}/g, '') // ASS overrides that leak into srt files ({\an8}, ...)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * One parser for both SRT and WebVTT: every cue is "a block containing a
 * `-->` line"; headers, cue ids, NOTE blocks and cue settings all fall away.
 */
export function parseSubtitles(content: string): SubtitleCue[] {
  const text = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const cues: SubtitleCue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) continue;
    const [startRaw, endRaw = ''] = lines[timingIdx].split('-->');
    const start = parseTime(startRaw);
    const end = parseTime(endRaw);
    if (start == null || end == null || end < start) continue;
    const body = lines
      .slice(timingIdx + 1)
      .map(cleanText)
      .filter(Boolean)
      .join('\n');
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** All cue text visible at `timeMs`, or ''. Linear scan is fine at 4 Hz. */
export function activeCueText(cues: SubtitleCue[], timeMs: number): string {
  let out = '';
  for (const cue of cues) {
    if (cue.start > timeMs) break;
    if (timeMs <= cue.end) out = out ? `${out}\n${cue.text}` : cue.text;
  }
  return out;
}
