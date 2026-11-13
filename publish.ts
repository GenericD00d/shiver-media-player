import { publish } from "@sharkord/plugin-builder";
import { PLUGIN_SDK_VERSION } from "@sharkord/plugin-sdk";

// Creates the GitHub release the server manager installs from:
// shiver-media-player-<version>.tar.gz and <version>.json (see RELEASING.md).
const result = await publish({
  githubToken: process.env.GITHUB_TOKEN,
  repo: "GenericD00d/shiver-media-player",
  // true would also open a listing PR on Sharkord/plugins
  pr: false,
  sdkVersion: PLUGIN_SDK_VERSION,
});

console.log("Plugin published successfully", result.releaseUrl);
