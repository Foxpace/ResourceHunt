import type { Bot, Observation } from "../src/sdk.ts";
import { forage } from "./_strategy.ts";

export default class Courier implements Bot {
  static metadata = {
    id: "courier",
    name: "Courier",
    description: "Banks small loads often to keep round trips short.",
  };
  act(state: Observation) {
    return forage(state, "courier");
  }
}
