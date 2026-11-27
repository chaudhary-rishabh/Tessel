import { appendFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { baselinePath, readBaseline, writeBaseline } from "./baseline";
import { openContext } from "./context";
import { consoleLine, runMarkdown } from "./report";
import { runSuite } from "./runner";
import { EVAL_MODES, type AnySuite, type EvalMode, type SuiteResult } from "./types";

const USAGE = `Usage: pnpm evals [options]

  --mode <mock|replay|live>  Where model calls go (default: mock)
  --suite <names>            Only these suites (comma-separated)
  --filter <text>            Only cases whose ID or tags contain this
  --trials <n>               Run each case n times
  --record                   With --mode live: save responses for replay
  --update-baseline          Save this run's metrics as the suites' baselines
  --judge <model>            The grading model (default: the registry's chat model)
  --out <dir>                Where reports go (default: .evals)
  --list                     List the suites and exit

Live mode needs AI_GATEWAY_API_KEY (and AI_GATEWAY_URL for a non-default gateway).
Suites are *.eval.ts files in packages/evals/suites and in any apps/*/evals folder.`;

interface DiscoveredSuite {
  suite: AnySuite;
  file: string;
  directory: string;
}

const ROOT = resolve(import.meta.dirname, "../../..");

const out = (text: unknown) => process.stdout.write(`${String(text)}\n`);
const err = (text: unknown) =>
  process.stderr.write(`${text instanceof Error ? (text.stack ?? text.message) : String(text)}\n`);

/** Suite folders: this package's own (for the shared packages it can depend on) and each app's. */
async function suiteDirectories(): Promise<string[]> {
  const directories = [join(ROOT, "packages", "evals", "suites")];
  for (const group of ["packages", "apps"]) {
    const projects = await readdir(join(ROOT, group), { withFileTypes: true }).catch(() => []);
    for (const project of projects) {
      if (project.isDirectory()) directories.push(join(ROOT, group, project.name, "evals"));
    }
  }
  return directories;
}

async function discover(): Promise<DiscoveredSuite[]> {
  const found: DiscoveredSuite[] = [];
  for (const directory of await suiteDirectories()) {
    const files = await readdir(directory).catch(() => [] as string[]);
    for (const name of files.filter((file) => file.endsWith(".eval.ts")).sort()) {
      const file = join(directory, name);
      const module = (await import(pathToFileURL(file).href)) as {
        default?: AnySuite;
        suites?: AnySuite[];
      };
      for (const suite of module.suites ?? (module.default ? [module.default] : [])) {
        found.push({ suite, file, directory });
      }
    }
  }
  const names = new Set<string>();
  for (const { suite, file } of found) {
    if (names.has(suite.name)) throw new Error(`Two suites are named "${suite.name}" (${file})`);
    names.add(suite.name);
  }
  return found;
}

async function hasRecordings(directory: string): Promise<boolean> {
  const files = await readdir(directory).catch(() => [] as string[]);
  return files.some((file) => file.endsWith(".json"));
}

function notRun(suite: AnySuite, mode: EvalMode, reason: string, passed: boolean): SuiteResult {
  return {
    suite: suite.name,
    description: suite.description,
    mode,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    trials: 0,
    metrics: [],
    cases: [],
    errors: 0,
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 },
    passed,
    skipped: reason,
  };
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      mode: { type: "string", default: "mock" },
      suite: { type: "string" },
      filter: { type: "string" },
      trials: { type: "string" },
      record: { type: "boolean", default: false },
      "update-baseline": { type: "boolean", default: false },
      judge: { type: "string" },
      out: { type: "string", default: ".evals" },
      list: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    out(USAGE);
    return 0;
  }
  const mode = values.mode as EvalMode;
  if (!EVAL_MODES.includes(mode)) {
    err(`Unknown mode "${values.mode}".\n\n${USAGE}`);
    return 2;
  }
  if (values.record && mode !== "live") {
    err("--record only works with --mode live");
    return 2;
  }

  const wanted = values.suite
    ?.split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const all = await discover();
  if (values.list) {
    for (const { suite, file } of all) {
      out(`${suite.name.padEnd(28)} ${suite.modes.join(",").padEnd(18)} ${relative(ROOT, file)}`);
    }
    return 0;
  }
  const unknown = wanted?.filter((name) => !all.some(({ suite }) => suite.name === name)) ?? [];
  if (unknown.length) {
    err(`No suite named ${unknown.join(", ")}. Run with --list to see them.`);
    return 2;
  }
  const selected = all.filter(({ suite }) => !wanted || wanted.includes(suite.name));
  const trials = values.trials ? Number(values.trials) : undefined;

  const results: SuiteResult[] = [];
  for (const { suite, directory } of selected) {
    const cassetteDir = join(directory, "cassettes", suite.name);
    const baselineFile = baselinePath(directory, suite.name, mode);
    const baseline = values["update-baseline"] ? undefined : await readBaseline(baselineFile);
    let opened: Awaited<ReturnType<typeof openContext>> | undefined;
    let result: SuiteResult;
    if (
      mode === "replay" &&
      suite.modes.includes("replay") &&
      !(await hasRecordings(cassetteDir))
    ) {
      result = notRun(
        suite,
        mode,
        "No recordings yet; record them with --mode live --record",
        true,
      );
      results.push(result);
      out(consoleLine(result));
      continue;
    }
    try {
      opened = await openContext({
        mode,
        record: values.record,
        cassetteDir,
        ...(process.env.AI_GATEWAY_URL ? { gatewayUrl: process.env.AI_GATEWAY_URL } : {}),
        ...(process.env.AI_GATEWAY_API_KEY ? { gatewayKey: process.env.AI_GATEWAY_API_KEY } : {}),
        ...(values.judge ? { judgeModel: values.judge } : {}),
      });
      process.stdout.write(`… ${suite.name} (${mode})\n`);
      result = await runSuite(suite, opened.context, {
        ...(trials ? { trials } : {}),
        ...(values.filter ? { filter: values.filter } : {}),
        ...(baseline ? { baseline: baseline.metrics } : {}),
        onCase: (item) => {
          if (item.error) process.stdout.write(`  ✗ ${item.id}: ${item.error}\n`);
        },
      });
      if (opened.cassette?.misses.length) {
        process.stdout.write(
          `  ${opened.cassette.misses.length} requests weren't in the cassette; re-record with --mode live --record\n`,
        );
      }
    } catch (error) {
      result = notRun(suite, mode, error instanceof Error ? error.message : String(error), false);
    } finally {
      await opened?.close();
    }
    results.push(result);
    out(consoleLine(result));
    if (values["update-baseline"] && !result.skipped && result.errors === 0) {
      await writeBaseline(baselineFile, result);
      out(`  baseline saved to ${relative(ROOT, baselineFile)}`);
    }
  }

  const outDir = resolve(ROOT, values.out!, mode);
  await mkdir(outDir, { recursive: true });
  const markdown = runMarkdown(results);
  await writeFile(join(outDir, "report.md"), markdown);
  for (const result of results) {
    await writeFile(join(outDir, `${result.suite}.json`), `${JSON.stringify(result, null, 2)}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  out(`\nReport: ${relative(ROOT, join(outDir, "report.md"))}`);

  const failed = results.filter((result) => !result.passed);
  if (failed.length)
    err(
      `${failed.length} suite${failed.length === 1 ? "" : "s"} failed: ${failed.map((r) => r.suite).join(", ")}`,
    );
  return failed.length ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    err(error);
    process.exitCode = 1;
  },
);
