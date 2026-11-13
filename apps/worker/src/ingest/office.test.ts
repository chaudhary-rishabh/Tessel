import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { pptxSections, xlsxSections } from "./office";
import { parseDocument } from "./parse";

const zip = (files: Record<string, string>) =>
  Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function workbook() {
  return zip({
    "xl/workbook.xml":
      '<workbook xmlns:r="r"><sheets><sheet name="Budget &amp; plan" sheetId="1" r:id="rId1"/><sheet name="Team" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    "xl/sharedStrings.xml":
      "<sst><si><t>Item</t></si><si><t>Cost</t></si><si><r><t>Zephyr</t></r><r><t>ine kit</t></r></si></sst>",
    "xl/worksheets/sheet1.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>42.5</v></c></row></sheetData></worksheet>',
    "xl/worksheets/sheet2.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Priya</t></is></c></row></sheetData></worksheet>',
  });
}

function deck() {
  const slide = (lines: string[]) =>
    `<p:sld><p:txBody>${lines.map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sld>`;
  return zip({
    "ppt/slides/slide2.xml": slide(["Roadmap", "Launch on May 14th"]),
    "ppt/slides/slide1.xml": slide(["Quarterly review", "Revenue &amp; growth"]),
    "ppt/slides/slide10.xml": slide(["Questions"]),
    "ppt/notesSlides/notesSlide2.xml": slide(["Mention the beta first", "2"]),
  });
}

describe("spreadsheets", () => {
  it("reads every sheet, with rows of tab-separated cells", () => {
    expect(xlsxSections(workbook())).toEqual([
      { text: "Sheet: Budget & plan\nItem\tCost\nZephyrine kit\t\t42.5" },
      { text: "Sheet: Team\nPriya" },
    ]);
  });

  it("parses through the document parser", async () => {
    const parsed = await parseDocument(workbook(), XLSX);
    expect(parsed.sections).toHaveLength(2);
    await expect(parseDocument(Buffer.from("not a zip"), XLSX)).rejects.toMatchObject({
      code: "unreadable_file",
    });
  });
});

describe("presentations", () => {
  it("reads slides in order as pages, with their speaker notes", () => {
    expect(pptxSections(deck())).toEqual([
      { text: "Quarterly review\nRevenue & growth", page: 1 },
      { text: "Roadmap\nLaunch on May 14th\nNotes:\nMention the beta first", page: 2 },
      { text: "Questions", page: 3 },
    ]);
  });

  it("parses through the document parser with a page count", async () => {
    const parsed = await parseDocument(deck(), PPTX);
    expect(parsed.pageCount).toBe(3);
  });
});
