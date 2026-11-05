import { HttpGameClient } from "./data/game-client.ts";
import { ApplicationModel } from "./model/application.ts";
import { ApplicationView } from "./view/application.ts";

import { Tournament } from "../competition/tournament.ts";
import { TournamentView } from "./view/tournament.ts";

const client = new HttpGameClient();
const model = new ApplicationModel(client);
const view = new ApplicationView(model, new TournamentView(new Tournament(client)));
window.addEventListener("pagehide", () => {
  view.dispose();
  void model.dispose();
});
void model.dispatch({ type: "refreshBots", initial: true }).then(() => {
  if (model.state.catalog.length) return view.generateMatch();
});
