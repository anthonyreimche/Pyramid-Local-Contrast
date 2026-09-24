// Pyramid Local Contrast — Safelight extension (MIT).
//
// Eight detail scales of an edge-aware log-luminance pyramid, one gain each,
// applied as a colour-preserving, exposure-independent multiplier. Registers
// one scene-linear GPU stage (stage.ts) and the Develop panel (Panel.ts).

import { PyramidPanel } from "./Panel";
import { EXT_ID, rederivePatch, resetPatch } from "./params";
import { api, initRuntime } from "./runtime";
import type { DevelopStoreState, SafelightAPI } from "./safelight";
import { allStages } from "./stage";

const PANEL_ID = `${EXT_ID}.panel`;

let unsubscribe: (() => void) | null = null;

function reset(): void {
  const dev = api().stores.useDevelopStore.getState();
  dev.setDynParams(resetPatch());
  void dev.commitEdit("Pyramid Local Contrast reset");
}

export function activate(host: SafelightAPI): void {
  initRuntime(host);

  // Every key is zero at rest, so an untouched photo never runs the prepass
  // and the inline's gate keeps it bit-exact.
  for (const stage of allStages()) host.registerProcessingStage(stage);

  host.registerPanel({
    id: PANEL_ID,
    title: "Pyramid Local Contrast",
    component: PyramidPanel,
    defaultDock: { module: "develop", direction: "right", order: 7, width: 268 },
    onReset: reset,
  });

  // A bag whose gate disagrees with its scales (a preset that carried only
  // some keys, an edit from another release) is re-derived live; the edit
  // itself is rewritten by the next commit, as any other change would be.
  unsubscribe = host.stores.useDevelopStore.subscribe((state: DevelopStoreState, prev: DevelopStoreState) => {
    if (state.paramBag === prev.paramBag) return;
    const patch = rederivePatch(state.paramBag);
    if (patch) state.setDynParams(patch);
  });
}

export function deactivate(): void {
  unsubscribe?.();
  unsubscribe = null;
  // The host sweeps this extension's registrations on disable or uninstall;
  // dropping the stage explicitly keeps a re-enable clean.
  try {
    const host = api();
    for (const stage of allStages()) host.unregisterProcessingStage(stage.id);
  } catch {
    /* activate() never ran — nothing to tear down */
  }
}
