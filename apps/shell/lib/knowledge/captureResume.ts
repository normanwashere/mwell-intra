import { createHash } from "node:crypto";
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { KnowledgeCaptureReportEntry } from "./types";

export const CAPTURE_RESUME_MANIFEST = "capture-resume-v1.json";

type ViewportName = "desktop" | "mobile";
type Viewport = { width: number; height: number };

export interface CaptureResumeManifest {
  schemaVersion: 1;
  sourceCommit: string;
  scenarioManifestVersion: string;
  viewports: Record<ViewportName, Viewport>;
  evidence: Record<string, KnowledgeCaptureReportEntry>;
}

interface ExpectedEvidence {
  route: string;
  roleId: string;
  state: string;
  control: KnowledgeCaptureReportEntry["control"];
  files: Record<ViewportName, string>;
  hotspots: Record<ViewportName, { x: number; y: number }>;
}

export interface CaptureResumeRequirements {
  expectedSessionRoot: string;
  sourceCommit: string;
  scenarioManifestVersion: string;
  viewports: Record<ViewportName, Viewport>;
  expectedEvidence: Record<string, ExpectedEvidence>;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pngDimensions(bytes: Buffer): Viewport {
  const signature = "89504e470d0a1a0a";
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== signature)
    throw new Error("artifact is not a PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function assertArtifactBounds(
  id: string,
  viewportName: ViewportName,
  entry: KnowledgeCaptureReportEntry,
  expected: ExpectedEvidence,
  viewport: Viewport,
): void {
  const artifact = entry[viewportName];
  const expectedHotspot = expected.hotspots[viewportName];
  if (!equal(artifact.hotspot, expectedHotspot))
    throw new Error(`${id} ${viewportName} hotspot does not match the scenario manifest`);
  const { x, y, width, height } = artifact.controlBounds;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > viewport.width || y + height > viewport.height)
    throw new Error(`${id} ${viewportName} control bounds are outside the viewport`);
  const pixelX = artifact.hotspot.x * viewport.width;
  const pixelY = artifact.hotspot.y * viewport.height;
  if (pixelX < x || pixelX > x + width || pixelY < y || pixelY > y + height)
    throw new Error(`${id} ${viewportName} hotspot is outside its actionable control`);
}

export async function validateCaptureResumeSession(
  sessionRoot: string,
  manifest: CaptureResumeManifest,
  requirements: CaptureResumeRequirements,
): Promise<string[]> {
  if (path.resolve(sessionRoot) !== path.resolve(requirements.expectedSessionRoot))
    throw new Error("resume must use the exact capture session directory");
  if (manifest.schemaVersion !== 1) throw new Error("resume manifest schema version mismatch");
  if (manifest.sourceCommit !== requirements.sourceCommit) throw new Error("resume source commit mismatch");
  if (manifest.scenarioManifestVersion !== requirements.scenarioManifestVersion)
    throw new Error("resume scenario manifest version mismatch");
  if (!equal(manifest.viewports, requirements.viewports)) throw new Error("resume viewport mismatch");

  const allowedFiles = new Set([CAPTURE_RESUME_MANIFEST]);
  for (const [id, entry] of Object.entries(manifest.evidence)) {
    const expected = requirements.expectedEvidence[id];
    if (!expected) throw new Error(`resume has unknown evidence ${id}`);
    if (
      entry.route !== expected.route ||
      entry.roleId !== expected.roleId ||
      entry.state !== expected.state ||
      !equal(entry.control, expected.control)
    )
      throw new Error(`${id} resume report semantics mismatch`);

    for (const viewportName of ["desktop", "mobile"] as const) {
      const artifact = entry[viewportName];
      const expectedFile = expected.files[viewportName];
      if (artifact.file !== expectedFile) throw new Error(`${id} ${viewportName} capture file mismatch`);
      const fileName = path.basename(expectedFile);
      allowedFiles.add(fileName);
      const bytes = await readFile(path.join(sessionRoot, fileName));
      const dimensions = pngDimensions(bytes);
      if (!equal(dimensions, requirements.viewports[viewportName]) || artifact.width !== dimensions.width || artifact.height !== dimensions.height)
        throw new Error(`${id} ${viewportName} capture dimensions mismatch`);
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      if (actualHash !== artifact.sha256) throw new Error(`${id} ${viewportName} capture hash mismatch`);
      assertArtifactBounds(id, viewportName, entry, expected, requirements.viewports[viewportName]);
    }
  }

  for (const fileName of await readdir(sessionRoot))
    if (!allowedFiles.has(fileName)) throw new Error(`unexpected session file ${fileName}`);
  return Object.keys(manifest.evidence).sort();
}

export async function readCaptureResumeManifest(sessionRoot: string): Promise<CaptureResumeManifest> {
  return JSON.parse(await readFile(path.join(sessionRoot, CAPTURE_RESUME_MANIFEST), "utf8")) as CaptureResumeManifest;
}

export async function writeCaptureResumeManifest(
  sessionRoot: string,
  manifest: CaptureResumeManifest,
): Promise<void> {
  const output = path.join(sessionRoot, CAPTURE_RESUME_MANIFEST);
  const temporary = `${output}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporary, output);
}
