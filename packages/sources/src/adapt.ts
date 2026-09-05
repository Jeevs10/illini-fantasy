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

/**
 * Counting stats pslice carries but the model input drops. Kept beside
 * `PlayerLine` rather than inside it, so the scorer's input shape — and
 * therefore parity with the reference model — cannot drift.
 */
export interface BoxScore {
  steals: number;
  blocks: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  fieldGoalsMade: number;
  threesMade: number;
  freeThrowsMade: number;
}

export function toBoxScore(row: PsliceRow): BoxScore {
  return {
    steals: num(row[COL.steals]),
    blocks: num(row[COL.blocks]),
    offensiveRebounds: num(row[COL.offensiveRebounds]),
    defensiveRebounds: num(row[COL.defensiveRebounds]),
    fieldGoalsMade: num(row[COL.twoMade]) + num(row[COL.threeMade]),
    threesMade: num(row[COL.threeMade]),
    freeThrowsMade: num(row[COL.ftMade]),
  };
}

/**
 * Bio fields pslice carries alongside the stat line.
 *
 * `COL.recRank` is not included: checked against live pslice data, that
 * column holds a fractional rate stat (0.4-57, with values like 18.6), not an
 * integer recruit rank — `COL`'s indices past 32 were verified for the
 * pslice row shape `toPlayerLine` already reads (points/rebounds/assists/bpm
 * all check out against parity), but getadvstats' CSV inserts two extra
 * columns (hometown, weight) at 33-34 that pslice does not carry, and
 * "recRank" is a leftover label from that CSV shape rather than this one. A
 * real recruit rank exists on CBBD's `recruits()` endpoint instead.
 */
export interface PlayerBio {
  height: string | null;
  jersey: string | null;
  classYear: string | null;
}

export function toBio(row: PsliceRow): PlayerBio {
  const height = row[COL.height];
  const jersey = row[COL.jersey];
  const year = row[COL.year];
  return {
    height: height != null && height !== "" ? String(height) : null,
    jersey: jersey != null && jersey !== "" ? String(jersey) : null,
    classYear: year != null && year !== "" ? String(year) : null,
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
