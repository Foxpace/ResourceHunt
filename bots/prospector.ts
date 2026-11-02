import type { Bot, Observation } from "../src/sdk.ts";
import { forage } from "./_strategy.ts";

export default class Prospector implements Bot {
  static metadata = {
    id: "prospector",
    name: "Prospector",
    description: "Weighs resource value against travel cost. Favors crystals and relics.",
  };
  act(state: Observation) {
    return forage(state, "value");
  }
}
