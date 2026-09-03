import type { PlayerLine } from "@illini/scoring";
import { COL, num, type PsliceRow } from "./torvik.ts";

/** Season rates for one player, used as the shrinkage prior. */
export interface SeasonRates {
  effectiveFieldGoalPct: number;
  trueShootingPct: number;
  threePointPct: number;
  freeThrowPct: number;
}

export function seasonRatesFrom(row: PsliceRow): SeasonRates {
  return {
    effectiveFieldGoalPct: num(row[COL.effectiveFieldGoalPct]),
    trueShootingPct: num(row[COL.trueShootingPct]),
    threePointPct: num(row[COL.threePct]),
    freeThrowPct: num(row[COL.freeThrowPct]),
  };
}

/** Turn one pslice row into the model's input shape. */
export function toPlayerLine(
  row: PsliceRow,
  roles: Map<string, string>,
  seasonRates?: Map<string, SeasonRates>,
): PlayerLine {
  const pid = String(row[COL.pid] ?? "");
  const rates = seasonRates?.get(pid);
  return {
    playerId: pid,
    name: String(row[COL.name] ?? ""),
    team: String(row[COL.team] ?? ""),
    conference: String(row[COL.conference] ?? ""),
    role: roles.get(pid) ?? null,

    minutes: num(row[COL.minutes]),
    points: num(row[COL.points]),
    rebounds: num(row[COL.rebounds]),
    assists: num(row[COL.assists]),

    effectiveFieldGoalPct: num(row[COL.effectiveFieldGoalPct]),
    trueShootingPct: num(row[COL.trueShootingPct]),
    threePointPct: num(row[COL.threePct]),
    freeThrowPct: num(row[COL.freeThrowPct]),
    usage: num(row[COL.usage]),

    assistPct: num(row[COL.assistPct]),
    turnoverPct: num(row[COL.turnoverPct]),
    stealPct: num(row[COL.stealPct]),
    blockPct: num(row[COL.blockPct]),
    defensiveRating: num(row[COL.defensiveRating]),
    offensiveReboundPct: num(row[COL.offensiveReboundPct]),
    defensiveReboundPct: num(row[COL.defensiveReboundPct]),

    bpm: num(row[COL.bpm]),
    obpm: num(row[COL.obpm]),
    dbpm: num(row[COL.dbpm]),
    porpag: num(row[COL.porpag]),

    attempts: {
      three: num(row[COL.threeAtt]),
      freeThrow: num(row[COL.ftAtt]),
      fieldGoal: num(row[COL.twoAtt]) + num(row[COL.threeAtt]),
    },
    ...(rates ? { seasonRates: rates } : {}),
  };
}
