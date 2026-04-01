#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  composeDown,
  composePs,
  composeUp,
  dockerVersion,
  formatError,
  loadSandboxCatalog,
  parseArgs,
  selectSandboxes,
  validateCompose
} from "./sandbox-lib.mjs";

const printUsage = () => {
  console.log("Usage: node tools/scripts/sandbox-compose.mjs <list|config|up|down|ps> [--pack <id>|--all]");
};

const run = async () => {
  const args = parseArgs(process.argv);
  const sandboxes = await loadSandboxCatalog();

  if (args.command === "list") {
    for (const sandbox of sandboxes) {
      console.log(`${sandbox.id}\t${sandbox.packId}\t${sandbox.composeFile}`);
    }
    return;
  }

  if (!["config", "up", "down", "ps"].includes(args.command)) {
    printUsage();
    throw new Error(`unsupported_command:${args.command}`);
  }

  const selected = selectSandboxes(sandboxes, args);
  const needsDaemon = args.command === "up" || args.command === "down" || args.command === "ps";
  if (needsDaemon) {
    const docker = await dockerVersion();
    if (!docker.daemonAvailable) {
      throw new Error(`docker_daemon_unavailable:${docker.error ?? "unable_to_contact_docker_server"}`);
    }
  }

  for (const sandbox of selected) {
    let result;
    if (args.command === "config") result = await validateCompose(sandbox);
    if (args.command === "up") result = await composeUp(sandbox);
    if (args.command === "down") result = await composeDown(sandbox);
    if (args.command === "ps") result = await composePs(sandbox);

    console.log(`# ${sandbox.id}`);
    console.log(JSON.stringify(result, null, 2));

    if (!result?.ok) {
      throw new Error(`${args.command}_failed:${sandbox.id}`);
    }
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
