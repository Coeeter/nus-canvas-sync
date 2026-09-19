import { join } from "node:path";

export function snapshotDir(dataDir: string, timestamp: string) {
  return join(dataDir, "snapshots", timestamp);
}

export function latestSnapshotLink(dataDir: string) {
  return join(dataDir, "latest");
}

export function baselinePath(dataDir: string, courseCode: string) {
  return join(dataDir, "baselines", `${courseCode}.json`);
}

export function interpretationPath(dataDir: string, courseCode: string) {
  return join(dataDir, "interpretations", `${courseCode}.json`);
}

export function reconciliationPath(dataDir: string, courseCode: string) {
  return join(dataDir, "reconciliation", `${courseCode}.json`);
}

export function runLockPath(dataDir: string) {
  return join(dataDir, "run.lock");
}
