import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  validateCaptureResumeSession,
  type CaptureResumeManifest,
  type CaptureResumeRequirements,
} from "./captureResume";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const hash = "a".repeat(64);
const commit = "b".repeat(40);

function manifest(): CaptureResumeManifest {
  return {
    schemaVersion: 1,
    sourceCommit: commit,
    scenarioManifestVersion: "task-8-v1:scenario-hash",
    viewports: {
      desktop: { width: 1440, height: 900 },
      mobile: { width: 390, height: 844 },
    },
    evidence: {
      "access-start": {
        route: "/login",
        roleId: "core_staff_only",
        state: "Sign in",
        control: { id: "sign-in", label: "Sign in", instruction: "Sign in." },
        desktop: {
          file: "/knowledge/evidence/task8-access-start-desktop.png",
          sha256: hash,
          width: 1440,
          height: 900,
          controlBounds: { x: 600, y: 400, width: 240, height: 40 },
          hotspot: { x: 0.5, y: 0.4667 },
        },
        mobile: {
          file: "/knowledge/evidence/task8-access-start-mobile.png",
          sha256: hash,
          width: 390,
          height: 844,
          controlBounds: { x: 95, y: 360, width: 200, height: 40 },
          hotspot: { x: 0.5, y: 0.4502 },
        },
      },
    },
  };
}

function requirements(sessionRoot: string): CaptureResumeRequirements {
  return {
    expectedSessionRoot: sessionRoot,
    sourceCommit: commit,
    scenarioManifestVersion: "task-8-v1:scenario-hash",
    viewports: {
      desktop: { width: 1440, height: 900 },
      mobile: { width: 390, height: 844 },
    },
    expectedEvidence: {
      "access-start": {
        route: "/login",
        roleId: "core_staff_only",
        state: "Sign in",
        control: { id: "sign-in", label: "Sign in", instruction: "Sign in." },
        files: {
          desktop: "/knowledge/evidence/task8-access-start-desktop.png",
          mobile: "/knowledge/evidence/task8-access-start-mobile.png",
        },
        hotspots: {
          desktop: { x: 0.5, y: 0.4667 },
          mobile: { x: 0.5, y: 0.4502 },
        },
      },
    },
  };
}

async function session(): Promise<{ root: string; value: CaptureResumeManifest }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-resume-"));
  roots.push(root);
  const value = manifest();
  const png = (width: number, height: number) => {
    const bytes = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(bytes);
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    return bytes;
  };
  const desktop = png(1440, 900);
  const mobile = png(390, 844);
  value.evidence["access-start"]!.desktop.sha256 = createHash("sha256").update(desktop).digest("hex");
  value.evidence["access-start"]!.mobile.sha256 = createHash("sha256").update(mobile).digest("hex");
  await Promise.all([
    writeFile(path.join(root, "task8-access-start-desktop.png"), desktop),
    writeFile(path.join(root, "task8-access-start-mobile.png"), mobile),
  ]);
  return { root, value };
}

describe("validateCaptureResumeSession", () => {
  test("accepts only a fully bound same-session manifest", async () => {
    const { root, value } = await session();
    await expect(validateCaptureResumeSession(root, value, requirements(root))).resolves.toEqual([
      "access-start",
    ]);
  });

  test.each([
    ["source commit", (value: CaptureResumeManifest) => (value.sourceCommit = "c".repeat(40))],
    ["scenario manifest", (value: CaptureResumeManifest) => (value.scenarioManifestVersion = "other")],
    ["viewport", (value: CaptureResumeManifest) => (value.viewports.mobile.width = 391)],
    ["hotspot", (value: CaptureResumeManifest) => (value.evidence["access-start"]!.desktop.hotspot.x = 0.4)],
    ["hash", (value: CaptureResumeManifest) => (value.evidence["access-start"]!.desktop.sha256 = hash)],
  ])("rejects a mismatched %s", async (_label, mutate) => {
    const { root, value } = await session();
    mutate(value);
    await expect(validateCaptureResumeSession(root, value, requirements(root))).rejects.toThrow();
  });

  test("rejects arbitrary files and session directories", async () => {
    const { root, value } = await session();
    await writeFile(path.join(root, "prior-report.json"), "{}");
    await expect(validateCaptureResumeSession(root, value, requirements(root))).rejects.toThrow(
      /unexpected session file/,
    );
    await expect(
      validateCaptureResumeSession(root, value, requirements(path.join(root, "expected"))),
    ).rejects.toThrow(/exact capture session directory/);
  });
});
