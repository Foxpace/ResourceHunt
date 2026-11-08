import { mapCells, manhattanDistance } from "../grid.ts";
import { cellIndex, positionKey, terrainCost, travelCostField } from "../pathfinding.ts";
import { randomFromSeed } from "../random.ts";
import type { GameMap, Position } from "../types.ts";
import type { MapSetup, StartingLayout } from "./generation-models.ts";

interface SiteCandidate extends Position {
  arrivalCosts: number[];
  opportunityShares: number[];
  baseClearance: number;
  nearestArrival: number;
  contestPenalty: number;
  terrainInterest: number;
  tieBreaker: number;
}

interface SitePlacement {
  count: number;
  baseClearance: number;
  siteSeparation: number;
}

/** Chooses a complete layout using terrain travel times from every starting base. */
export class StrategicSitePlanner {
  private candidates: SiteCandidate[];
  private reserved: Set<string>;
  private selectedSites: Position[] = [];
  private mapScale: number;

  constructor(setup: MapSetup, starts: StartingLayout) {
    const { map, config } = setup;
    const random = randomFromSeed(`${config.seed}:sites`);
    const arrivalFields = starts.bases.map((base) => travelCostField(map, base));
    this.reserved = new Set(starts.protectedCells.map(positionKey));
    this.mapScale = Math.min(map.width, map.height);
    this.candidates = [...mapCells(map, 1)]
      .filter((position) => this.isAvailableLand(map, position))
      .map((position) => {
        const cell = cellIndex(map, position);
        const arrivalCosts = arrivalFields.map((field) => field[cell]!);

        return createSiteCandidate({ map, bases: starts.bases, random }, position, arrivalCosts);
      });
  }

  placeOutposts(count: number): Position[] {
    return this.selectLayout({
      count,
      baseClearance: Math.max(4, Math.floor(this.mapScale * 0.2)),
      siteSeparation: Math.max(4, this.mapScale * 0.25),
    });
  }

  placeHotspots(count: number): Position[] {
    return this.selectLayout({
      count,
      baseClearance: Math.max(6, Math.floor(this.mapScale * 0.24)),
      siteSeparation: Math.max(5, this.mapScale * 0.3),
    });
  }

  refreshTravelTimes(map: GameMap, bases: Position[]): void {
    const arrivalFields = bases.map((base) => travelCostField(map, base));

    for (const candidate of this.candidates) {
      const cell = cellIndex(map, candidate);
      candidate.arrivalCosts = arrivalFields.map((field) => field[cell]!);
      candidate.nearestArrival = Math.min(...candidate.arrivalCosts);
      candidate.contestPenalty = calculateContestPenalty(candidate.arrivalCosts);
      candidate.opportunityShares = calculateOpportunityShares(candidate.arrivalCosts);
    }
  }

  private isAvailableLand(map: GameMap, position: Position): boolean {
    const passable = Number.isFinite(terrainCost(map, position));
    const bridge = map.tiles[position.y]![position.x] === "bridge";
    const reserved = this.reserved.has(positionKey(position));

    return passable && !bridge && !reserved;
  }

  private selectLayout(placement: SitePlacement): Position[] {
    if (!placement.count) return [];

    const candidates = this.getCandidatesAwayFromBases(placement);
    const layout = this.findBalancedLayout(candidates, placement);
    const positions = layout.map(({ x, y }) => ({ x, y }));
    for (const position of positions) this.reserved.add(positionKey(position));

    this.selectedSites.push(...positions);

    return positions;
  }

  private findBalancedLayout(
    candidates: SiteCandidate[],
    placement: SitePlacement,
  ): SiteCandidate[] {
    const closestContestedSite = this.findStartingSite(candidates, placement);
    const startingLayouts = [[], [closestContestedSite]];
    const layouts = startingLayouts.map((layout) =>
      this.completeLayout(candidates, layout, placement),
    );

    return layouts.sort(
      (first, second) => this.scoreLayout(first, placement) - this.scoreLayout(second, placement),
    )[0]!;
  }

  private findStartingSite(candidates: SiteCandidate[], placement: SitePlacement): SiteCandidate {
    const separatedCandidates = this.getCandidatesAwayFromSites(candidates, [], placement);
    const contestedCandidates = separatedCandidates.filter(
      (candidate) => candidate.contestPenalty <= 0.2,
    );
    const startingCandidates = contestedCandidates.length
      ? contestedCandidates
      : separatedCandidates;

    return [...startingCandidates].sort(
      (first, second) =>
        first.nearestArrival - second.nearestArrival || first.tieBreaker - second.tieBreaker,
    )[0]!;
  }

  private completeLayout(
    candidates: SiteCandidate[],
    layout: SiteCandidate[],
    placement: SitePlacement,
  ): SiteCandidate[] {
    while (layout.length < placement.count) {
      layout.push(this.chooseBestCandidate(candidates, layout, placement));
    }
    this.balanceLayout(candidates, layout, placement);

    return layout;
  }

  private getCandidatesAwayFromBases(placement: SitePlacement): SiteCandidate[] {
    const available = this.candidates.filter(
      (candidate) => !this.reserved.has(positionKey(candidate)),
    );
    const clearances = available
      .map((candidate) => candidate.baseClearance)
      .sort((first, second) => second - first);
    const feasibleClearance = clearances[placement.count - 1];
    if (feasibleClearance === undefined) throw new Error("Not enough land for competitive sites");

    // Crowded maps relax clearance only as far as needed to fit the requested sites.
    const clearance = Math.min(placement.baseClearance, feasibleClearance);

    return available.filter((candidate) => candidate.baseClearance >= clearance);
  }

  private chooseBestCandidate(
    candidates: SiteCandidate[],
    layout: SiteCandidate[],
    placement: SitePlacement,
  ): SiteCandidate {
    let bestCandidate: SiteCandidate | undefined;
    let bestScore = Infinity;
    const scorer = this.createLayoutScorer(layout, placement);

    for (const candidate of this.getCandidatesAwayFromSites(candidates, layout, placement)) {
      const score = scorer.score(candidate);
      if (score >= bestScore) continue;

      bestCandidate = candidate;
      bestScore = score;
    }
    if (!bestCandidate) throw new Error("Not enough land for competitive sites");

    return bestCandidate;
  }

  private getCandidatesAwayFromSites(
    candidates: SiteCandidate[],
    layout: SiteCandidate[],
    placement: SitePlacement,
  ): SiteCandidate[] {
    const available = candidates.filter((candidate) => !layout.includes(candidate));
    const otherSites = [...this.selectedSites, ...layout];
    const separations = available.map((candidate) =>
      calculateNearestSiteDistance(candidate, otherSites),
    );
    const feasibleSeparation = Math.max(...separations);
    const minimumSeparation = Math.min(4, placement.siteSeparation * 0.6, feasibleSeparation);

    return available.filter((_, index) => separations[index]! >= minimumSeparation);
  }

  private balanceLayout(
    candidates: SiteCandidate[],
    layout: SiteCandidate[],
    placement: SitePlacement,
  ): void {
    for (let pass = 0; pass < 3; pass++) {
      this.improveLayout(candidates, layout, placement);
    }
  }

  private improveLayout(
    candidates: SiteCandidate[],
    layout: SiteCandidate[],
    placement: SitePlacement,
  ): void {
    for (let index = 0; index < layout.length; index++) {
      const currentCandidate = layout[index]!;
      const currentScore = this.scoreLayout(layout, placement);
      const remainingSites = layout.filter((_, siteIndex) => siteIndex !== index);
      layout[index] = this.chooseBestCandidate(candidates, remainingSites, placement);
      const replacementScore = this.scoreLayout(layout, placement);
      if (replacementScore > currentScore) layout[index] = currentCandidate;
    }
  }

  private scoreLayout(layout: SiteCandidate[], placement: SitePlacement): number {
    return this.createLayoutScorer(layout.slice(0, -1), placement).score(layout.at(-1)!);
  }

  private createLayoutScorer(layout: SiteCandidate[], placement: SitePlacement): LayoutScorer {
    return new LayoutScorer(layout, this.selectedSites, {
      mapScale: this.mapScale,
      siteSeparation: placement.siteSeparation,
    });
  }
}

interface LayoutScale {
  mapScale: number;
  siteSeparation: number;
}

/** Reuse the score terms for sites that stay fixed while comparing candidates. */
class LayoutScorer {
  private existingSites: Position[];
  private fixedSpacing: { site: SiteCandidate; distance: number }[];
  private accessCosts: number[];
  private opportunityShares: number[];
  private contestPenalty: number;
  private totalArrival: number;
  private totalQuality: number;

  constructor(
    fixed: SiteCandidate[],
    selected: Position[],
    private scale: LayoutScale,
  ) {
    this.existingSites = [...selected, ...fixed];
    this.fixedSpacing = fixed.map((site) => ({
      site,
      distance: calculateNearestSiteDistance(site, this.existingSites),
    }));
    this.accessCosts =
      fixed[0]?.arrivalCosts.map((_, index) =>
        Math.min(...fixed.map((site) => site.arrivalCosts[index]!)),
      ) ?? [];
    this.opportunityShares =
      fixed[0]?.opportunityShares.map((_, index) =>
        fixed.reduce((sum, site) => sum + site.opportunityShares[index]!, 0),
      ) ?? [];
    this.contestPenalty = Math.max(...fixed.map((site) => site.contestPenalty));
    this.totalArrival = fixed.reduce((sum, site) => sum + site.nearestArrival, 0);
    this.totalQuality = fixed.reduce((sum, site) => sum + calculateSiteQuality(site), 0);
  }

  score(candidate: SiteCandidate): number {
    const count = this.fixedSpacing.length + 1;
    const { averageAccess, accessSpread, opportunitySpread } = this.scorePlayerAccess(candidate);
    const contestPenalty = Math.max(this.contestPenalty, candidate.contestPenalty);
    const averageArrival = (this.totalArrival + candidate.nearestArrival) / count;
    const siteQuality = (this.totalQuality + calculateSiteQuality(candidate)) / count;

    // Fair access and a real contest outweigh scenery and seeded variation.
    return (
      accessSpread * 12 +
      opportunitySpread * 6 +
      contestPenalty * 12 +
      this.calculateSpacingPenalty(candidate) * 3 +
      (averageAccess + averageArrival * 0.5) / this.scale.mapScale +
      siteQuality
    );
  }

  private scorePlayerAccess(candidate: SiteCandidate) {
    let bestAccess = Infinity;
    let worstAccess = -Infinity;
    let totalAccess = 0;
    let leastOpportunity = Infinity;
    let mostOpportunity = -Infinity;
    let totalOpportunity = 0;
    const playerCount = candidate.arrivalCosts.length;

    for (let index = 0; index < playerCount; index++) {
      const access = Math.min(this.accessCosts[index] ?? Infinity, candidate.arrivalCosts[index]!);
      const opportunity =
        (this.opportunityShares[index] ?? 0) + candidate.opportunityShares[index]!;
      bestAccess = Math.min(bestAccess, access);
      worstAccess = Math.max(worstAccess, access);
      totalAccess += access;
      leastOpportunity = Math.min(leastOpportunity, opportunity);
      mostOpportunity = Math.max(mostOpportunity, opportunity);
      totalOpportunity += opportunity;
    }

    const averageAccess = totalAccess / playerCount;
    return {
      averageAccess,
      accessSpread: (worstAccess - bestAccess) / averageAccess,
      opportunitySpread: (mostOpportunity - leastOpportunity) / (totalOpportunity / playerCount),
    };
  }

  private calculateSpacingPenalty(candidate: SiteCandidate): number {
    const { siteSeparation } = this.scale;
    let total = 0;
    for (const { site, distance } of this.fixedSpacing) {
      const nearest = Math.min(distance, manhattanDistance(site, candidate));
      total += Math.max(0, 1 - nearest / siteSeparation);
    }

    const nearest = calculateNearestSiteDistance(candidate, this.existingSites);
    total += Math.max(0, 1 - nearest / siteSeparation);
    return total / (this.fixedSpacing.length + 1);
  }
}

function calculateSiteQuality(candidate: SiteCandidate): number {
  return candidate.tieBreaker * 0.25 - candidate.terrainInterest * 0.03;
}

interface CandidateContext {
  map: GameMap;
  bases: Position[];
  random: () => number;
}

function createSiteCandidate(
  context: CandidateContext,
  position: Position,
  arrivalCosts: number[],
): SiteCandidate {
  const nearestArrival = Math.min(...arrivalCosts);

  return {
    ...position,
    arrivalCosts,
    opportunityShares: calculateOpportunityShares(arrivalCosts),
    nearestArrival,
    baseClearance: Math.min(...context.bases.map((base) => manhattanDistance(position, base))),
    contestPenalty: calculateContestPenalty(arrivalCosts),
    terrainInterest:
      countTerrainTransitions(context.map, position) +
      calculateDistanceFromMapEdge(context.map, position) * 0.3,
    tieBreaker: context.random(),
  };
}

function countTerrainTransitions(map: GameMap, position: Position): number {
  const terrain = map.tiles[position.y]![position.x];
  const neighbors = [
    { x: position.x + 1, y: position.y },
    { x: position.x - 1, y: position.y },
    { x: position.x, y: position.y + 1 },
    { x: position.x, y: position.y - 1 },
  ];

  return neighbors.filter((neighbor) => map.tiles[neighbor.y]?.[neighbor.x] !== terrain).length;
}

function calculateContestPenalty(arrivalCosts: number[]): number {
  const sortedCosts = [...arrivalCosts].sort((first, second) => first - second);
  const nearestArrival = sortedCosts[0]!;
  const rivalArrival = sortedCosts[1] ?? nearestArrival;

  return (rivalArrival - nearestArrival) / Math.max(1, rivalArrival);
}

function calculateDistanceFromMapEdge(map: GameMap, position: Position): number {
  return Math.min(position.x, position.y, map.width - position.x - 1, map.height - position.y - 1);
}

function calculateNearestSiteDistance(position: Position, sites: Position[]): number {
  let nearest = Infinity;
  for (const site of sites) {
    if (site !== position) nearest = Math.min(nearest, manhattanDistance(site, position));
  }

  return nearest;
}

function calculateOpportunityShares(arrivalCosts: number[]): number[] {
  const nearestArrival = Math.min(...arrivalCosts);
  const tolerance = Math.max(3, nearestArrival * 0.5);
  const weights = arrivalCosts.map((cost) => Math.max(0, 1 - (cost - nearestArrival) / tolerance));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  return weights.map((weight) => weight / totalWeight);
}
