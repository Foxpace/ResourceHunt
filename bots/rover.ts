import type { Bot, BotContext, Observation } from "../src/sdk.ts";
import { forage } from "./_strategy.ts";

export default class Rover implements Bot {
  static metadata = {
    id: "rover",
    name: "Rover",
    description: "Uses seeded randomness to vary its resource targets.",
  };
  constructor(private context: BotContext) {}
  act(state: Observation) {
    return forage(state, "wander", this.context.random);
  }
}
