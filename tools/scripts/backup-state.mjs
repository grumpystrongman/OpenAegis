#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupsRoot = resolve("backups");
const outputDir = resolve(backupsRoot, timestamp);
const volumesDir = resolve(".volumes");
const demoAssetsDir = resolve("docs", "assets", "demo");

const pathExists = async (target) => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};

const listFiles = async (dir) => {
  if (!(await pathExists(dir))) return [];
  return readdir(dir);
};

const run = async () => {
  await mkdir(outputDir, { recursive: true });
  const volumesTarget = resolve(outputDir, "volumes");
  const demoTarget = resolve(outputDir, "demo");

  if (await pathExists(volumesDir)) {
    await cp(volumesDir, volumesTarget, { recursive: true });
  } else {
    await mkdir(volumesTarget, { recursive: true });
  }

  if (await pathExists(demoAssetsDir)) {
    await cp(demoAssetsDir, demoTarget, { recursive: true });
  } else {
    await mkdir(demoTarget, { recursive: true });
  }

  const gitHead = await readFile(resolve(".git", "HEAD"), "utf8").catch(() => "unknown");

  const manifest = {
    createdAt: new Date().toISOString(),
    backupId: timestamp,
    source: {
      volumesDir,
      demoAssetsDir
    },
    files: {
      volumeFiles: await listFiles(volumesTarget),
      demoFiles: await listFiles(demoTarget)
    },
    gitHead: gitHead.trim()
  };

  await writeFile(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: "PASS", backupDir: outputDir, manifest }, null, 2));
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
