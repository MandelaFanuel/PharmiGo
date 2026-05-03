import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve("src");
const allowedConsoleFiles = new Set([path.join(rootDir, "lib", "logger.ts")]);
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const violations = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(entryPath);
      continue;
    }

    if (!sourceExtensions.has(path.extname(entry.name))) {
      continue;
    }

    const content = await readFile(entryPath, "utf8");
    const lines = content.split("\n");

    lines.forEach((line, index) => {
      if (!line.includes("console.")) {
        return;
      }

      if (allowedConsoleFiles.has(entryPath)) {
        return;
      }

      violations.push(`${path.relative(process.cwd(), entryPath)}:${index + 1} disallowed console usage`);
    });
  }
}

await walk(rootDir);

if (violations.length > 0) {
  console.error("Lint failed:");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Lint passed.");
