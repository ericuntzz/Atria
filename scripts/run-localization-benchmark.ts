import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  JsfeatVerifier,
  imageToGrayscale,
} from "../src/lib/vision/geometric-verify";
import {
  generateEmbeddingFromBuffer,
  getModelVersion,
  hasRealEmbeddingModel,
} from "../src/lib/vision/embeddings";

type ExpectedOutcome = "match" | "reject";

type BenchmarkCategory =
  | "true_match"
  | "same_room_wrong_view"
  | "adjacent_room"
  | "low_texture"
  | "lighting_shift"
  | "reflective";

interface BenchmarkCase {
  id: string;
  label: string;
  category: BenchmarkCategory;
  baseline: string;
  current: string;
  expected: ExpectedOutcome;
  notes?: string;
}

interface BenchmarkManifest {
  pairs: BenchmarkCase[];
}

interface BenchmarkCaseResult {
  id: string;
  label: string;
  category: BenchmarkCategory;
  expected: ExpectedOutcome;
  verified: boolean;
  matchCount: number;
  inlierCount: number;
  inlierRatio: number;
  inlierSpread: number;
  overlapArea: number;
  embeddingSimilarity: number | null;
  rejectionReasons: string[];
  baseline: string;
  current: string;
  notes?: string;
}

interface BenchmarkReport {
  generatedAt: string;
  manifestPath: string;
  modelVersion: string;
  realModelAvailable: boolean;
  totals: {
    pairs: number;
    expectedMatches: number;
    expectedRejects: number;
    falseRejects: number;
    falseAccepts: number;
    far: number | null;
    frr: number | null;
  };
  categories: Record<
    string,
    {
      total: number;
      falseRejects: number;
      falseAccepts: number;
    }
  >;
  results: BenchmarkCaseResult[];
}

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function formatPercent(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return Number.NEGATIVE_INFINITY;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? Number.NEGATIVE_INFINITY : dot / denom;
}

function printUsage() {
  console.log(`Usage:
  npm run benchmark:localization -- --manifest src/lib/vision/__tests__/benchmark/manifest.json

Options:
  --manifest <path>   Path to benchmark manifest JSON
  --out <path>        Optional path for the JSON report
  --help              Show this help

Manifest format:
{
  "pairs": [
    {
      "id": "living-room-match-1",
      "label": "Living room baseline vs matching capture",
      "category": "true_match",
      "baseline": "./fixtures/living-room-baseline.jpg",
      "current": "./fixtures/living-room-current.jpg",
      "expected": "match"
    }
  ]
}`);
}

async function loadManifest(manifestPath: string): Promise<BenchmarkManifest> {
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as BenchmarkManifest;
  if (!Array.isArray(parsed.pairs) || parsed.pairs.length === 0) {
    throw new Error("Manifest must contain a non-empty pairs array.");
  }
  return parsed;
}

async function evaluatePair(
  verifier: JsfeatVerifier,
  manifestDir: string,
  pair: BenchmarkCase,
  canComputeEmbeddings: boolean,
): Promise<BenchmarkCaseResult> {
  const baselinePath = path.resolve(manifestDir, pair.baseline);
  const currentPath = path.resolve(manifestDir, pair.current);
  const [baselineBuffer, currentBuffer] = await Promise.all([
    readFile(baselinePath),
    readFile(currentPath),
  ]);
  const [baselineGray, currentGray] = await Promise.all([
    imageToGrayscale(baselineBuffer),
    imageToGrayscale(currentBuffer),
  ]);

  const verifyResult = await verifier.verify(
    baselineGray.gray,
    currentGray.gray,
    baselineGray.width,
    baselineGray.height,
  );

  let embeddingSimilarity: number | null = null;
  if (canComputeEmbeddings) {
    const [baselineEmbedding, currentEmbedding] = await Promise.all([
      generateEmbeddingFromBuffer(baselineBuffer, {
        allowPlaceholder: process.env.ALLOW_PLACEHOLDER_EMBEDDINGS === "1",
      }),
      generateEmbeddingFromBuffer(currentBuffer, {
        allowPlaceholder: process.env.ALLOW_PLACEHOLDER_EMBEDDINGS === "1",
      }),
    ]);
    embeddingSimilarity = cosineSimilarity(baselineEmbedding, currentEmbedding);
  }

  return {
    id: pair.id,
    label: pair.label,
    category: pair.category,
    expected: pair.expected,
    verified: verifyResult.verified,
    matchCount: verifyResult.matchCount,
    inlierCount: verifyResult.inlierCount,
    inlierRatio: verifyResult.inlierRatio,
    inlierSpread: verifyResult.inlierSpread,
    overlapArea: verifyResult.overlapArea,
    embeddingSimilarity,
    rejectionReasons: verifyResult.rejectionReasons,
    baseline: baselinePath,
    current: currentPath,
    notes: pair.notes,
  };
}

async function main() {
  if (hasFlag("--help")) {
    printUsage();
    return;
  }

  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const manifestPath = path.resolve(
    repoRoot,
    parseArg("--manifest") ||
      "src/lib/vision/__tests__/benchmark/manifest.json",
  );

  let manifest: BenchmarkManifest;
  try {
    manifest = await loadManifest(manifestPath);
  } catch (error) {
    const examplePath = path.join(
      repoRoot,
      "src/lib/vision/__tests__/benchmark/manifest.example.json",
    );
    console.error(
      `[benchmark:localization] ${error instanceof Error ? error.message : "Failed to load manifest."}`,
    );
    console.error(
      `[benchmark:localization] Create a manifest like ${examplePath} and rerun.`,
    );
    process.exitCode = 1;
    return;
  }

  const manifestDir = path.dirname(manifestPath);
  const verifier = new JsfeatVerifier();
  const realModelAvailable = await hasRealEmbeddingModel();
  const canComputeEmbeddings =
    realModelAvailable || process.env.ALLOW_PLACEHOLDER_EMBEDDINGS === "1";

  const results: BenchmarkCaseResult[] = [];
  for (const pair of manifest.pairs) {
    results.push(
      await evaluatePair(verifier, manifestDir, pair, canComputeEmbeddings),
    );
  }

  const expectedMatches = results.filter((result) => result.expected === "match");
  const expectedRejects = results.filter((result) => result.expected === "reject");
  const falseRejects = expectedMatches.filter((result) => !result.verified);
  const falseAccepts = expectedRejects.filter((result) => result.verified);

  const categories = results.reduce<BenchmarkReport["categories"]>((acc, result) => {
    if (!acc[result.category]) {
      acc[result.category] = {
        total: 0,
        falseRejects: 0,
        falseAccepts: 0,
      };
    }
    acc[result.category].total += 1;
    if (result.expected === "match" && !result.verified) {
      acc[result.category].falseRejects += 1;
    }
    if (result.expected === "reject" && result.verified) {
      acc[result.category].falseAccepts += 1;
    }
    return acc;
  }, {});

  const report: BenchmarkReport = {
    generatedAt: new Date().toISOString(),
    manifestPath,
    modelVersion: getModelVersion(),
    realModelAvailable,
    totals: {
      pairs: results.length,
      expectedMatches: expectedMatches.length,
      expectedRejects: expectedRejects.length,
      falseRejects: falseRejects.length,
      falseAccepts: falseAccepts.length,
      far:
        expectedRejects.length > 0
          ? falseAccepts.length / expectedRejects.length
          : null,
      frr:
        expectedMatches.length > 0
          ? falseRejects.length / expectedMatches.length
          : null,
    },
    categories,
    results,
  };

  const outPath = path.resolve(
    repoRoot,
    parseArg("--out") ||
      path.join(
        "reports",
        "localization-benchmark",
        `${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      ),
  );
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(report, null, 2));

  console.log("Localization benchmark complete");
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Report:   ${outPath}`);
  console.log(`Model:    ${report.modelVersion}${realModelAvailable ? "" : " (placeholder or unavailable)"}`);
  console.log(`Pairs:    ${report.totals.pairs}`);
  console.log(`FAR:      ${formatPercent(report.totals.far)}`);
  console.log(`FRR:      ${formatPercent(report.totals.frr)}`);

  if (falseAccepts.length > 0) {
    console.log("\nFalse accepts:");
    for (const result of falseAccepts) {
      console.log(
        `- ${result.id}: verified unexpectedly (${result.rejectionReasons.join(", ") || "accepted"})`,
      );
    }
  }

  if (falseRejects.length > 0) {
    console.log("\nFalse rejects:");
    for (const result of falseRejects) {
      console.log(
        `- ${result.id}: rejected unexpectedly (${result.rejectionReasons.join(", ") || "no reason"})`,
      );
    }
  }
}

void main();
