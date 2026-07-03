export type SubtitleCue = {
  /** Milliseconds. */
  start: number;
  end: number;
  text: string;
};

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
