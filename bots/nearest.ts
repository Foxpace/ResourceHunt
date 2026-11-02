import type { Bot, Observation } from "../src/sdk.ts";
import { forage } from "./_strategy.ts";

export default class Nearest implements Bot {
  static metadata = {
    id: "nearest",
    name: "Scout",
    description: "Collects the nearest reachable resources and returns with a full bag.",
  };
  act(state: Observation) {
    return forage(state, "nearest");
  }
}
