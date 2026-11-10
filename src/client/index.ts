import { PluginSlot } from "@sharkord/plugin-sdk";
import type { TPluginComponentsMapBySlotId } from "@sharkord/plugin-sdk/client";
import { PlayerButton } from "./player";

// beside the camera and screen-share buttons, only while connected to voice
const components: TPluginComponentsMapBySlotId = {
  [PluginSlot.VOICE_CONTROLS]: [PlayerButton],
};

export { components };
