import { $ } from "bun";
import fs from "fs";

// Pinned, so a build uses the SDK the Shiver family is tested against rather than whatever is on
// Sharkord's main branch that day. Move them together with SHARKORD_REF in Shiver's
// scripts/check-sharkord.py (docs/standards.md, "Contracts between the repos").
const repos: [name: string, ref: string, packages: string[]][] = [
  // Sharkord's v0.0.30 release
  ["sharkord", "230a74b4034b6d6d35b28ab28c6678cb37a24d01", ["packages/plugin-sdk", "packages/ui"]],
  // the builder has no releases: the commit last built with
  ["plugin-builder", "01ecf2936298aeffdc0af368b741e39e091149d4", ["."]],
];

const links = [
  "@sharkord/plugin-sdk",
  "@sharkord/ui",
  "@sharkord/plugin-builder",
];

for (const [name, ref, packages] of repos) {
  const dir = `.repos/${name}`;

  if (!fs.existsSync(dir)) {
    console.log(`Cloning ${name}...`);
    await $`git init -q ${dir}`;
    await $`git -C ${dir} remote add origin https://github.com/Sharkord/${name}.git`;
  }

  console.log(`Checking out ${name} at ${ref.slice(0, 12)}...`);
  await $`git -C ${dir} fetch -q --depth 1 origin ${ref}`;
  await $`git -C ${dir} checkout -q --force --detach FETCH_HEAD`;

  // --ignore-scripts: sharkord trusts mediasoup, whose install step compiles a
  // native worker from source on every core. Plugins only need its types.
  await $`bun install --ignore-scripts`.cwd(dir);
  for (const pkg of packages) await $`bun link`.cwd(`${dir}/${pkg}`);
}

await $`bun install`;
await $`bun link ${links}`;

console.log(
  "\nReady. Set SHARKORD_PLUGINS_PATH in .env, then `bun run build`.",
);
