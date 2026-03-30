#!/usr/bin/env node
import { cp, readdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

const backupsRoot = resolve("backups");
const targetArg = process.argv[2];

const pathExists = async (target) => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};

const resolveBackupDir = async () => {
  if (targetArg && targetArg !== "latest") {
    const target = resolve(targetArg);
    if (!(await pathExists(target))) throw new Error(`backup_not_found:${target}`);
    return target;
  }

  const entries = await readdir(backupsRoot, { withFileTypes: true }).catch(() => []);
  const candidates = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (candidates.length === 0) {
    throw new Error("no_backups_available");
  }
  return resolve(backupsRoot, candidates[candidates.length - 1]);
};

const run = async () => {
  const backupDir = await resolveBackupDir();
  const sourceVolumes = resolve(backupDir, "volumes");
  const sourceDemo = resolve(backupDir, "demo");

  if (!(await pathExists(sourceVolumes))) throw new Error("backup_missing_volumes");
  if (!(await pathExists(sourceDemo))) throw new Error("backup_missing_demo_assets");

  await rm(resolve(".volumes"), { recursive: true, force: true });
  await rm(resolve("docs", "assets", "demo"), { recursive: true, force: true });

  await cp(sourceVolumes, resolve(".volumes"), { recursive: true });
  await cp(sourceDemo, resolve("docs", "assets", "demo"), { recursive: true });

  console.log(
    JSON.stringify(
      {
        status: "PASS",
        restoredFrom: backupDir,
        restoredTargets: [resolve(".volumes"), resolve("docs", "assets", "demo")]
      },
      null,
      2
    )
  );
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
