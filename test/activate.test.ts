// Activation contract against a stand-in API: what activate() registers under
// the extension id, that a bag whose gate disagrees with its scales is
// re-derived live, and that deactivate() tears everything down. No React
// render — the component is exercised in the app.

import { afterEach, describe, expect, it } from "vitest";
import { activate, deactivate } from "../src/index";
import { DEFAULT_PARAMS } from "../src/model";
import { KEY, STAGE_ID, deriveAll } from "../src/params";
import type {
  DevelopStoreState,
  PanelContribution,
  ProcessingStageContribution,
  SafelightAPI,
  StoreApi,
} from "../src/safelight";

function fakeStore<T extends object>(init: T): StoreApi<T> {
  let state = init;
  const listeners = new Set<(s: T, prev: T) => void>();
  const set = (partial: Partial<T> | ((s: T) => Partial<T>)) => {
    const prev = state;
    state = { ...state, ...(typeof partial === "function" ? partial(state) : partial) };
    for (const l of listeners) l(state, prev);
  };
  const hook = ((selector?: (s: T) => unknown) => (selector ? selector(state) : state)) as StoreApi<T>;
  hook.getState = () => state;
  hook.setState = set;
  hook.subscribe = (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return hook;
}

interface Registered {
  stages: ProcessingStageContribution[];
  panels: PanelContribution[];
  unregisteredStages: string[];
  patches: Record<string, unknown>[];
  commits: string[];
}

function fakeApi() {
  const registered: Registered = { stages: [], panels: [], unregisteredStages: [], patches: [], commits: [] };
  const develop = fakeStore<DevelopStoreState>({
    photoId: null,
    paramBag: {},
    setDynParams: (patch) => {
      registered.patches.push(patch);
      develop.setState((s) => ({ paramBag: { ...s.paramBag, ...patch } }));
    },
    commitEdit: async (label) => void registered.commits.push(label),
  });
  const api = {
    version: 1,
    extensionId: "pyramid-local-contrast",
    registerProcessingStage: (c: ProcessingStageContribution) => void registered.stages.push(c),
    unregisterProcessingStage: (id: string) => void registered.unregisteredStages.push(id),
    registerPanel: (c: PanelContribution) => void registered.panels.push(c),
    stores: { useDevelopStore: develop },
  } as unknown as SafelightAPI;
  return { api, registered, develop };
}

const EDITED = { scales: [0, 0, 0, 0, 0, 40, 60, 0], halo: 25, noiseFloor: 0.3 };

describe("activate", () => {
  afterEach(() => deactivate());

  it("registers the stage and the panel", () => {
    const { api, registered } = fakeApi();
    activate(api);
    expect(registered.stages.map((s) => s.id)).toEqual([STAGE_ID]);
    expect(registered.panels.map((p) => p.id)).toEqual(["pyramid-local-contrast.panel"]);
    expect(registered.panels[0].title).toBe("Pyramid Local Contrast");
    expect(registered.panels[0].defaultDock).toEqual({ module: "develop", direction: "right", order: 7, width: 268 });
    expect(typeof registered.panels[0].onReset).toBe("function");
  });

  it("resets the photo's scales to zero from the dock header, in one commit", () => {
    const { api, registered, develop } = fakeApi();
    activate(api);
    develop.setState({ paramBag: deriveAll(EDITED) });
    registered.panels[0].onReset?.();
    expect(develop.getState().paramBag).toEqual(deriveAll(DEFAULT_PARAMS));
    expect(registered.commits).toEqual(["Pyramid Local Contrast reset"]);
  });

  it("re-derives the gate when a loaded bag disagrees with its scales", () => {
    const { api, registered, develop } = fakeApi();
    activate(api);
    develop.setState({ paramBag: { ...deriveAll(EDITED), [KEY.on]: 0 } });
    expect(registered.patches).toEqual([deriveAll(EDITED)]);
    develop.setState({ paramBag: deriveAll(EDITED) });
    expect(registered.patches.length).toBe(1);
  });

  it("drops the stage and stops listening on deactivate", () => {
    const { api, registered, develop } = fakeApi();
    activate(api);
    deactivate();
    expect(registered.unregisteredStages).toEqual([STAGE_ID]);
    develop.setState({ paramBag: { ...deriveAll(EDITED), [KEY.on]: 0 } });
    expect(registered.patches.length).toBe(0);
  });
});
