import { basename } from "node:path";
import { MAX_IMAGE_BYTES, MAX_TEXT_FILE_BYTES } from "@tessel/contracts";
import { AppError } from "../../lib/errors";

export interface ClassifiedFile {
  kind: "image" | "text";
  mediaType: string;
  filename: string;
}

/** Image types every vision model accepts, identified by their first bytes. */
const IMAGE_SIGNATURES: { mediaType: string; matches: (bytes: Buffer) => boolean }[] = [
  {
    mediaType: "image/png",
    matches: (b) => b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  },
  { mediaType: "image/jpeg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mediaType: "image/gif", matches: (b) => b.subarray(0, 4).toString("ascii") === "GIF8" },
  {
    mediaType: "image/webp",
    matches: (b) =>
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

const TEXT_EXTENSIONS = new Set(
  (
    "txt md markdown csv tsv json jsonl yaml yml xml html htm css js jsx ts tsx mjs cjs py rb go rs java kt " +
    "swift c h cpp hpp cs php sh bash zsh sql toml ini env log tex rst"
  ).split(" "),
);

function cleanFilename(name: string): string {
  // Drop control characters, which have no place in a file name.
  const printable = [...name.replaceAll("\\", "/")]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");
  const base = basename(printable).trim();
  return (base || "file").slice(0, 200);
}

/**
 * Decides whether an upload is an image or a text file, from its contents
 * rather than the type the browser claimed. Anything else is rejected;
 * PDFs and office documents arrive with document ingestion in step 7.
 */
export function classifyUpload(originalName: string, bytes: Buffer): ClassifiedFile {
  const filename = cleanFilename(originalName);
  const image = IMAGE_SIGNATURES.find((signature) => signature.matches(bytes));
  if (image) {
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new AppError(413, "file_too_large", "Images can be up to 5 MB");
    }
    return { kind: "image", mediaType: image.mediaType, filename };
  }

  const extension = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  const looksLikeText = TEXT_EXTENSIONS.has(extension) && !bytes.includes(0);
  if (looksLikeText) {
    if (bytes.length > MAX_TEXT_FILE_BYTES) {
      throw new AppError(413, "file_too_large", "Text files can be up to 1 MB");
    }
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new AppError(415, "unsupported_file_type", "Text files must be UTF-8");
    }
    return { kind: "text", mediaType: "text/plain", filename };
  }

  throw new AppError(
    415,
    "unsupported_file_type",
    "Attach images (PNG, JPEG, GIF, WebP) or text files. Documents like PDFs are coming soon",
  );
}
