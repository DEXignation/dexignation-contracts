import fs from "fs";
import path from "path";

const ARTIFACTS_DIR = path.join(process.cwd(), "artifacts", "contracts");
const LIMIT = 24_576; // EIP-170 limit in bytes

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;

  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);

    if (stat.isDirectory()) {
      out.push(...walk(full));
    } else if (file.endsWith(".json") && !file.endsWith(".dbg.json")) {
      out.push(full);
    }
  }

  return out;
}

const files = walk(ARTIFACTS_DIR);
const rows = [];

for (const file of files) {
  const artifact = JSON.parse(fs.readFileSync(file, "utf8"));
  const bytecode = artifact.deployedBytecode;

  if (!bytecode || bytecode === "0x") continue;

  const size = (bytecode.length - 2) / 2;
  const pct = ((size / LIMIT) * 100).toFixed(2);

  rows.push({
    contract: artifact.contractName,
    size,
    pct,
    file: path.relative(process.cwd(), file),
  });
}

rows.sort((a, b) => b.size - a.size);

console.table(
  rows.map((r) => ({
    Contract: r.contract,
    Bytes: r.size,
    "Limit %": `${r.pct}%`,
    Status: r.size > LIMIT ? "OVER" : "OK",
  })),
);

const over = rows.filter((r) => r.size > LIMIT);

if (over.length > 0) {
  console.error("\n❌ Some contracts exceed the EIP-170 24KB limit.");
  process.exit(1);
}

console.log("\n✅ All contracts are within the EIP-170 24KB deployed bytecode limit.");