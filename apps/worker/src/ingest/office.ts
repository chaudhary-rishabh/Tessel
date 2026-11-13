import type { TextSection } from "@tessel/ai";
import { strFromU8, unzipSync, type Unzipped } from "fflate";

/** Office files are zips of XML; these read just the text out of them. */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (entity, name: string) => {
    if (name.startsWith("#")) {
      const code =
        name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return ENTITIES[name.toLowerCase()] ?? entity;
  });
}

function unzip(bytes: Buffer): Unzipped {
  return unzipSync(new Uint8Array(bytes), {
    // Only the XML parts with text; skip images and media.
    filter: (file) => file.name.endsWith(".xml") || file.name.endsWith(".rels"),
  });
}

const read = (files: Unzipped, path: string) => (files[path] ? strFromU8(files[path]) : "");
const byNumber = (prefix: string) => (a: string, b: string) =>
  Number(a.slice(prefix.length).replace(/\D/g, "")) -
  Number(b.slice(prefix.length).replace(/\D/g, ""));

/** Slides as pages: each slide's text, then its speaker notes. */
export function pptxSections(bytes: Buffer): TextSection[] {
  const files = unzip(bytes);
  const slides = Object.keys(files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort(byNumber("ppt/slides/slide"));
  return slides.map((path, index) => {
    const paragraphs = (xml: string) =>
      [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)]
        .map((p) =>
          [...p[0].matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((t) => decodeXml(t[1]!)).join(""),
        )
        .filter((line) => line.trim());
    const number = path.match(/slide(\d+)\.xml$/)![1]!;
    const notes = paragraphs(read(files, `ppt/notesSlides/notesSlide${number}.xml`)).filter(
      (line) => !/^\d+$/.test(line.trim()),
    );
    const text = [
      ...paragraphs(read(files, path)),
      ...(notes.length ? ["Notes:", ...notes] : []),
    ].join("\n");
    return { text, page: index + 1 };
  });
}

/** Column letters ("AB12") to a zero-based index. */
function columnIndex(reference: string): number {
  const letters = reference.replace(/\d+$/, "");
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** Sheets as sections: "Sheet: name", then each row's cells, tab-separated. */
export function xlsxSections(bytes: Buffer): TextSection[] {
  const files = unzip(bytes);
  const shared = [...read(files, "xl/sharedStrings.xml").matchAll(/<si\b[\s\S]*?<\/si>/g)].map(
    (si) => [...si[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]!)).join(""),
  );
  // Sheet names, in workbook order, mapped to their files through the relationships.
  const workbook = read(files, "xl/workbook.xml");
  const rels = read(files, "xl/_rels/workbook.xml.rels");
  const targets = new Map(
    [...rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map((m) => [
      m[1]!,
      m[2]!.replace(/^\/?xl\//, "").replace(/^\//, ""),
    ]),
  );
  const sheets = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => ({
    name: decodeXml(/\bname="([^"]*)"/.exec(m[1]!)?.[1] ?? "Sheet"),
    path: `xl/${targets.get(/\br:id="([^"]+)"/.exec(m[1]!)?.[1] ?? "") ?? ""}`,
  }));

  return sheets.map((sheet) => {
    const xml = read(files, sheet.path);
    const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
      const cells: string[] = [];
      for (const cell of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cell[1]!;
        const body = cell[2] ?? "";
        const reference = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const type = /\bt="(\w+)"/.exec(attrs)?.[1];
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const inline = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("");
        const value =
          type === "s"
            ? (shared[Number(raw)] ?? "")
            : type === "inlineStr"
              ? decodeXml(inline)
              : decodeXml(raw ?? "");
        const at = reference ? columnIndex(reference) : cells.length;
        while (cells.length < at) cells.push("");
        cells[at] = value;
      }
      return cells.join("\t").replace(/\t+$/, "");
    });
    return { text: [`Sheet: ${sheet.name}`, ...rows.filter((row) => row.trim())].join("\n") };
  });
}
