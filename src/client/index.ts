import { PluginSlot } from "@sharkord/plugin-sdk";
import type { TPluginComponentsMapBySlotId } from "@sharkord/plugin-sdk/client";
import { PlayerButton, TopbarPlayerButton } from "./player";

const components: TPluginComponentsMapBySlotId = {
  // beside the camera and screen-share buttons, only while connected to voice
  [PluginSlot.VOICE_CONTROLS]: [PlayerButton],
  // beside the call buttons in the top bar, while viewing the call
  [PluginSlot.TOPBAR_RIGHT]: [TopbarPlayerButton],
};

export { components };
