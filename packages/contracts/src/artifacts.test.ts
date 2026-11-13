import { describe, expect, it } from "vitest";
import { artifactFilename, collectArtifacts, parseMessageSegments } from "./artifacts";

describe("artifact parsing", () => {
  it("splits a reply into text and artifacts", () => {
    const segments = parseMessageSegments(
      'Here it is:\n\n<artifact id="page" type="html" title="Landing page">\n<h1>Hi</h1>\n</artifact>\n\nWant changes?',
    );
    expect(segments).toEqual([
      { kind: "text", text: "Here it is:\n\n" },
      {
        kind: "artifact",
        identifier: "page",
        type: "html",
        title: "Landing page",
        language: null,
        content: "<h1>Hi</h1>",
        complete: true,
      },
      { kind: "text", text: "\n\nWant changes?" },
    ]);
  });

  it("streams: an unclosed artifact is incomplete, and a half-written tag is held back", () => {
    expect(
      parseMessageSegments('Sure. <artifact id="a" type="react" title="App">\nexport def'),
    ).toEqual([
      { kind: "text", text: "Sure. " },
      expect.objectContaining({ content: "export def", complete: false, type: "react" }),
    ]);
    expect(parseMessageSegments("Sure. <artif")).toEqual([{ kind: "text", text: "Sure. " }]);
    expect(parseMessageSegments('Sure. <artifact id="a" ty')).toEqual([
      { kind: "text", text: "Sure. " },
    ]);
    // A less-than sign in ordinary text stays.
    expect(parseMessageSegments("x < y")).toEqual([{ kind: "text", text: "x < y" }]);
  });

  it("drops a fence around the whole content, and treats unknown types as code", () => {
    const [artifact] = parseMessageSegments(
      '<artifact id="s" type="spreadsheet" title="S" language="python">\n```python\nprint(1)\n```\n</artifact>',
    );
    expect(artifact).toMatchObject({ type: "code", language: "python", content: "print(1)" });
  });

  it("collects every version of each artifact across the chat", () => {
    const artifacts = collectArtifacts([
      {
        id: "m1",
        role: "user",
        content: '<artifact id="x" type="html" title="Not mine"></artifact>',
      },
      {
        id: "m2",
        role: "assistant",
        content: '<artifact id="page" type="html" title="V1">a</artifact>',
      },
      {
        id: "m3",
        role: "assistant",
        content:
          '<artifact id="page" type="html" title="V2">b</artifact><artifact id="chart" type="svg" title="C"><svg/></artifact>',
      },
    ]);
    expect([...artifacts.keys()]).toEqual(["page", "chart"]);
    expect(artifacts.get("page")?.map((v) => [v.messageId, v.version, v.content])).toEqual([
      ["m2", 1, "a"],
      ["m3", 2, "b"],
    ]);
  });

  it("names downloads by id and type", () => {
    expect(artifactFilename({ identifier: "Sales chart!", type: "svg", language: null })).toBe(
      "Sales-chart.svg",
    );
    expect(artifactFilename({ identifier: "etl", type: "code", language: "Python" })).toBe(
      "etl.py",
    );
  });
});
