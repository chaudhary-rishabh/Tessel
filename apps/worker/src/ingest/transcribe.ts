import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { TextSection, Transcript } from "@tessel/ai";

const run = promisify(execFile);

/** "1:05" or "1:02:05". */
export function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** A transcript block covers about this much time, so citations point near the moment. */
const BLOCK_SECONDS = 60;
const BLOCK_CHARACTERS = 1_200;

/**
 * A transcript as text for search: paragraphs of about a minute, each
 * starting with its time, like "[1:05] …", so a cited passage says where
 * in the recording it is.
 */
export function transcriptText(transcript: Transcript): string {
  if (transcript.segments.length === 0) return transcript.text.trim();
  const blocks: string[] = [];
  let start = transcript.segments[0]!.startSecond;
  let parts: string[] = [];
  const flush = () => {
    const text = parts.join(" ").replace(/\s+/g, " ").trim();
    if (text) blocks.push(`[${formatTimestamp(start)}] ${text}`);
    parts = [];
  };
  for (const segment of transcript.segments) {
    const length = parts.reduce((total, part) => total + part.length, 0);
    if (
      parts.length > 0 &&
      (segment.startSecond - start >= BLOCK_SECONDS || length >= BLOCK_CHARACTERS)
    ) {
      flush();
      start = segment.startSecond;
    }
    parts.push(segment.text);
  }
  flush();
  return blocks.join("\n\n");
}

export function transcriptSections(transcript: Transcript): TextSection[] {
  return [{ text: transcriptText(transcript) }];
}

/**
 * The recording's speech as small mono MP3 (16 kHz, 32 kbps: about 15 MB an
 * hour), so even a long video is a small request. Without ffmpeg, or if it
 * can't read the file, the original goes as it is.
 */
export async function speechAudio(bytes: Buffer): Promise<{ audio: Buffer; converted: boolean }> {
  const dir = await mkdtemp(join(tmpdir(), "tessel-audio-"));
  try {
    const input = join(dir, "input");
    const output = join(dir, "speech.mp3");
    await writeFile(input, bytes);
    await run(
      "ffmpeg",
      [
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-i",
        input,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "32k",
        output,
      ],
      { timeout: 10 * 60_000 },
    );
    return { audio: await readFile(output), converted: true };
  } catch {
    return { audio: bytes, converted: false };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
