/**
 * League operations.
 *
 *   npm run league -- create 2026 "Illini Fantasy" 10 you@example.com
 *   npm run league -- invite 1 manager@example.com [teamId]
 *   npm run league -- accept <token> manager@example.com "Manager Name"
 *   npm run league -- members 1
 *   npm run league -- passwd <username|email> <password>
 *   npm run league -- account <email> <username> <password> ["Display Name"]
 *   npm run league -- whoami <username>
 *   npm run league -- settings 1
 *   npm run league -- settings 1 bench=6 faabBudget=200 tradeDeadline=2026-03-01
 *   npm run league -- settings 1 starters=G2,F2,B1,FLEX2   |   tradeDeadline=none
 *   npm run league -- draft new 1 [rounds] [clockSeconds] [order…]
 *   npm run league -- draft start 1 | pause 1 | run 1
 *   npm run league -- draft board 1
 *   npm run league -- draft pick 1 <teamId> <playerId>
 *   npm run league -- draft queue 1 <teamId> [+|-]<playerId>…
 *   npm run league -- waivers state 1
 *   npm run league -- waivers drop 1 <teamId> <playerId>
 *   npm run league -- waivers add 1 <teamId> <playerId> [dropPlayerId]
 *   npm run league -- waivers bid 1 <teamId> <playerId> <bid> [dropPlayerId]
 *   npm run league -- waivers claims 1 [teamId]
 *   npm run league -- waivers run 1 [2026-01-08T09:00:00Z]    open the bids due by then
 *   npm run league -- trades list 1 [teamId]
 *   npm run league -- trades offer 1 <fromTeamId> <toTeamId> <give,ids> <get,ids> ["message"]
 *   npm run league -- trades accept 1 <tradeId> <teamId> | reject 1 <tradeId> <teamId>
 *   npm run league -- trades withdraw 1 <tradeId> <teamId>
 *   npm run league -- trades veto 1 <tradeId> ["reason"]
 *   npm run league -- trades run 1 [2026-01-08T09:00:00Z]    execute what the clock has reached
 *   npm run league -- roster 3
 *   npm run league -- lineups 1 20260214    auto-fill tonight, locks respected
 *   npm run league -- lineups 1 20260214 2026-02-14T16:00:00Z    replay as of a time
 *   npm run league -- settle 1 1
 *   npm run league -- standings 1
 *   npm run league -- bracket 1    draws the playoff bracket from the current standings
 *   npm run league -- playoffs 1 [2026-03-14T09:00:00Z]    settle and print the bracket
 *   npm run league -- picture 1    who is clinched, alive, or eliminated
 */
import { connect, insertMany, upsertScoringConfig } from "@illini/db";
import { GAME_CONFIG } from "@illini/scoring";
import {
  BracketExistsError, BracketRefusedError, DEFAULT_SETTINGS, SETTING_FIELDS, STARTER_SLOTS,
  SettingsRefusedError, acceptInvite, accountByUsername, addFreeAgent, advanceExpired, autoDraft,
  autoFillLeague, bracketView, cancelTrade, claimsFor, createBracket, createDraft, dequeue,
  draftQueue, draftRoom, dropPlayer, enqueue, generateSchedule, inviteToLeague, leagueSettings,
  listTrades, makePick, members, pauseDraft, playoffPicture, proposeTrade, registerAccount,
  respondToTrade, rosterOn, setPassword, settingLabel, settingsContext, settleTrades,
  settleWaivers, settleWeek, standings, startDraft, submitClaim, updateSettings, upsertUser,
  vetoTrade, waiverState, type LeagueSettings, type Slot,
} from "@illini/league";
import { loadEnv } from "./env.ts";

loadEnv();

const [command, ...args] = process.argv.slice(2);
const db = connect(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
const iso = (d: string) => (d.includes("-") ? d : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
const today = () => new Date().toISOString().slice(0, 10);
/**
 * The clock the waiver and trade verbs act on.
 *
 * Honours `ILLINI_NOW` for the same reason the app does: both write dated
 * tenures, and against the real clock a drop or a trade in a pinned February
 * season is dated September — which is to say the players never change hands on
 * any night the app can browse. The draft verbs deliberately do not read this.
 */
const clock = () => (process.env.ILLINI_NOW ? new Date(process.env.ILLINI_NOW) : new Date());

try {
  if (command === "create") {
    const [seasonArg, name, teamsArg, emailArg] = args;
    const season = Number(seasonArg);
    const teamCount = Number(teamsArg ?? 10);
    const { id: configId } = await upsertScoringConfig(db, "game", GAME_CONFIG);

    // The commissioner exists as a row before they have a password: `passwd`
    // is what turns the seat into an account somebody can sign in to.
    const owner = await upsertUser(db,
      { email: emailArg ?? "commish@illini.test", displayName: "Commissioner" });
    const { rows: [league] } = await db.query<{ id: string }>(
      `INSERT INTO league (name, season, config_id, settings, commissioner_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [name, season, configId, JSON.stringify(DEFAULT_SETTINGS), owner.id]);
    await db.query(
      `INSERT INTO league_member (league_id, user_id, role) VALUES ($1,$2,'commissioner')
       ON CONFLICT (league_id, user_id) DO UPDATE SET role = 'commissioner'`,
      [league!.id, owner.id]);

    // Teams start unowned. A manager takes one by redeeming an invite, so
    // ownership is something a person did rather than something seeded.
    await insertMany(db, {
      table: "fantasy_team",
      columns: ["league_id", "name"],
      rows: Array.from({ length: teamCount }, (_, i) => [league!.id, `Team ${i + 1}`]),
      conflict: "(league_id, name) DO NOTHING",
    });
    const weeks = await generateSchedule(db, Number(league!.id), `${season - 1}-11-02`, 17);
    console.log(`league ${league!.id} | ${teamCount} teams | ${weeks} matchups scheduled`);

  } else if (command === "invite") {
    const [leagueArg, email, teamArg] = args;
    const { rows: [commish] } = await db.query<{ commissioner_id: string }>(
      "SELECT commissioner_id FROM league WHERE id = $1", [Number(leagueArg)]);
    const invite = await inviteToLeague(db, {
      leagueId: Number(leagueArg),
      email: email!,
      invitedBy: Number(commish!.commissioner_id),
      fantasyTeamId: teamArg ? Number(teamArg) : undefined,
    });
    // Printed once. Only the hash is stored, so this cannot be recovered later.
    console.log(`invite ${invite.id} -> ${invite.email}`);
    console.log(`  token   ${invite.token}`);
    console.log(`  expires ${invite.expiresAt.slice(0, 10)}`);

  } else if (command === "accept") {
    const [token, email, displayName] = args;
    const joined = await acceptInvite(db, { token: token!, email: email!, displayName });
    console.log(`${email} joined league ${joined.leagueId} as ${joined.role}, running ${joined.fantasyTeamName}`);

  } else if (command === "members") {
    for (const m of await members(db, Number(args[0]))) {
      console.log(`${m.role.padEnd(13)}${m.displayName.padEnd(20)}${(m.fantasyTeamName ?? "—").padEnd(12)}${m.email}`);
    }

  } else if (command === "passwd") {
    // The commissioner's reset, and the way a seeded row — `create` makes one,
    // and it has never had a password — becomes an account somebody can use.
    const [who, password] = args;
    const { rows } = await db.query<{ id: string; username: string }>(
      "SELECT id, username FROM app_user WHERE username = $1 OR email = $1",
      [who!.trim().toLowerCase()]);
    const user = rows[0];
    if (!user) throw new Error(`no user matches ${who}`);
    await setPassword(db, { userId: Number(user.id), password: password! });
    console.log(`${user.username} can now sign in`);

  } else if (command === "account") {
    const [email, username, password, displayName] = args;
    const account = await registerAccount(db, {
      email: email!, username: username!, password: password!, displayName });
    console.log(`user ${account.id} | ${account.username} | ${account.email}`);

  } else if (command === "whoami") {
    const account = await accountByUsername(db, args[0]!);
    console.log(account
      ? `user ${account.id} | ${account.username} | ${account.displayName} | ${account.email}`
      : "no such username");

  } else if (command === "settings") {
    // The same module the screen calls, so a commissioner fixing a number by
    // hand cannot produce a league the app could not have produced — including
    // the re-score a games-cap change owes the weeks already settled.
    const [leagueArg, ...pairs] = args;
    const leagueId = Number(leagueArg);

    if (pairs.length === 0) {
      const settings = await leagueSettings(db, leagueId);
      const context = await settingsContext(db, { leagueId, on: today() });
      console.log(`starters         ${settings.starters.map((s) => `${s.slot}${s.count}`).join(" ")}`);
      for (const field of SETTING_FIELDS) {
        console.log(`${field.key.padEnd(17)}${String(settings[field.key]).padStart(4)}  ${field.unit}`);
      }
      console.log(`tradeDeadline    ${settings.tradeDeadline ?? "none"}`);
      console.log(`thirdPlace       ${settings.thirdPlace ? "on" : "off"}`);
      console.log(`consolation      ${settings.consolation ? "on" : "off"}`);
      console.log(`reseed           ${settings.reseed ? "on" : "off"}`);
      console.log(`playoffTiebreak  ${settings.playoffTiebreak}`);
      console.log(`\n${context.settledWeeks} settled week${context.settledWeeks === 1 ? "" : "s"}` +
        ` | largest roster ${context.largestRoster?.size ?? 0}` +
        ` | most spent $${context.mostSpent?.spent ?? 0}`);
    } else {
      // key=value, because a positional CLI for eleven optional settings is a
      // CLI nobody can read back off their own shell history.
      const patch: Partial<LeagueSettings> = {};
      for (const pair of pairs) {
        const [key, ...rest] = pair.split("=");
        const value = rest.join("=");
        if (key === "starters") {
          patch.starters = value.split(",").filter(Boolean).map((token) => {
            const slot = token.replace(/[0-9]+$/, "").toUpperCase() as Slot;
            if (!STARTER_SLOTS.includes(slot as never)) throw new Error(`no slot ${slot}`);
            return { slot: slot as (typeof STARTER_SLOTS)[number], count: Number(token.slice(slot.length)) };
          });
        } else if (key === "tradeDeadline") {
          patch.tradeDeadline = value === "" || value === "none" ? null : iso(value);
        } else if (key === "thirdPlace" || key === "consolation" || key === "reseed") {
          patch[key] = value === "on" || value === "true" || value === "1";
        } else if (key === "playoffTiebreak") {
          if (value !== "seed" && value !== "pointsFor") throw new Error("playoffTiebreak is seed or pointsFor");
          patch.playoffTiebreak = value;
        } else if (SETTING_FIELDS.some((f) => f.key === key)) {
          (patch as Record<string, number>)[key!] = Number(value);
        } else {
          throw new Error(`no setting ${key} — try one of: starters, tradeDeadline, ` +
            "thirdPlace, consolation, reseed, playoffTiebreak, " +
            SETTING_FIELDS.map((f) => f.key).join(", "));
        }
      }

      const { rows: [row] } = await db.query<{ commissioner_id: string }>(
        "SELECT commissioner_id FROM league WHERE id = $1", [leagueId]);
      try {
        const result = await updateSettings(db, {
          leagueId, byUserId: Number(row!.commissioner_id), patch, now: clock() });
        if (result.changed.length === 0) console.log("nothing changed");
        for (const change of result.changed) {
          console.log(`${settingLabel(change.key).padEnd(16)}${change.from} → ${change.to}`);
        }
        for (const note of result.notes) console.log(`  ${note}`);
      } catch (error) {
        // Every reason at once. A CLI that reports one refusal per run is a CLI
        // you run four times.
        if (!(error instanceof SettingsRefusedError)) throw error;
        for (const reason of error.reasons) console.error(`refused: ${reason}`);
        process.exit(1);
      }
    }

  } else if (command === "draft") {
    // Everything the draft room does, from a terminal — the commissioner's
    // fallback when the room is the thing that is broken.
    const [sub, leagueArg, ...rest] = args;
    const leagueId = Number(leagueArg);
    const { rows: [row] } = await db.query<{ commissioner_id: string }>(
      "SELECT commissioner_id FROM league WHERE id = $1", [leagueId]);
    const by = Number(row?.commissioner_id);

    if (sub === "new") {
      const [roundsArg, clockArg, ...orderArgs] = rest;
      const draft = await createDraft(db, {
        leagueId, by,
        rounds: roundsArg ? Number(roundsArg) : undefined,
        pickSeconds: clockArg ? Number(clockArg) : undefined,
        order: orderArgs.length > 0 ? orderArgs.map(Number) : undefined,
      });
      const room = (await draftRoom(db, { leagueId }))!;
      console.log(`draft ${draft.id} | ${draft.rounds} rounds | ${draft.totalPicks} picks | ` +
        `${draft.pickSeconds}s clock | opens ${draft.opensOn}`);
      console.log(`order  ${room.order.map((o) => o.teamName).join(" → ")}`);

    } else if (sub === "start") {
      const draft = await startDraft(db, { leagueId, by });
      console.log(`draft is live | pick ${draft.onTheClock} | deadline ${draft.deadline ?? "none"}`);

    } else if (sub === "pause") {
      const draft = await pauseDraft(db, { leagueId, by });
      console.log(`draft ${draft.status} at pick ${draft.onTheClock}`);

    } else if (sub === "run") {
      const made = await autoDraft(db, { leagueId });
      console.log(`auto-picked ${made} selections`);

    } else if (sub === "pick") {
      const [teamArg, playerArg] = rest;
      const pick = await makePick(db, {
        leagueId, fantasyTeamId: Number(teamArg), playerId: Number(playerArg), byUserId: by });
      console.log(`pick ${pick.overall} (round ${pick.round}.${pick.inRound}) ${pick.playerName}`);

    } else if (sub === "queue") {
      const [teamArg, ...players] = rest;
      const fantasyTeamId = Number(teamArg);
      // A bare id queues; a leading minus removes. The queue is a list a
      // manager edits, not a form they submit.
      for (const token of players) {
        const remove = token.startsWith("-");
        const playerId = Number(token.replace(/^[+-]/, ""));
        await (remove ? dequeue : enqueue)(db, { leagueId, fantasyTeamId, playerId });
      }
      for (const q of await draftQueue(db, { leagueId, fantasyTeamId })) {
        console.log(`${String(q.rank).padStart(3)}  ${q.name.padEnd(24)}` +
          `${(q.role ?? "—").padEnd(11)}${q.averageScore.toFixed(1).padStart(6)}` +
          `  ${q.available ? "" : "TAKEN"}`);
      }

    } else if (sub === "board" || sub === undefined) {
      await advanceExpired(db, { leagueId });
      const room = await draftRoom(db, { leagueId });
      if (!room) { console.log("no draft for that league"); }
      else {
        console.log(`${room.draft.status} | ${room.picksMade}/${room.draft.totalPicks} picks | ` +
          (room.onTheClock
            ? `on the clock: ${room.onTheClock.teamName} (pick ${room.onTheClock.overall})` +
              (room.secondsLeft === null ? "" : ` — ${room.secondsLeft}s left`)
            : "board complete"));
        for (const p of room.board.filter((b) => b.playerId !== null)) {
          console.log(`${String(p.round).padStart(3)}.${String(p.inRound).padEnd(3)}` +
            `${p.teamName.padEnd(12)}${(p.playerName ?? "").padEnd(24)}` +
            `${(p.role ?? "—").padEnd(11)}${p.auto ? "auto" : ""}`);
        }
      }

    } else {
      console.error("usage: league draft <new|start|pause|run|pick|queue|board> <leagueId> …");
      process.exit(1);
    }

  } else if (command === "waivers") {
    // The wire from a terminal. Every verb here takes the same path the app
    // does, so a commissioner fixing something by hand cannot produce a state
    // the app could not have produced.
    const [sub, leagueArg, ...rest] = args;
    const leagueId = Number(leagueArg);

    if (sub === "state" || sub === undefined) {
      // Reading settles first, because nothing else will: there is no worker,
      // and a run that was due last night happens when somebody looks.
      await settleWaivers(db, { leagueId, now: clock() });
      const state = await waiverState(db, { leagueId, now: clock() });
      console.log(`next run ${state.nextRunAt} | budget $${state.budget}`);
      for (const t of state.teams) {
        console.log(`${String(t.priority).padStart(3)}  ${t.teamName.padEnd(20)}` +
          `$${String(t.remaining).padStart(4)} left   $${t.spent} spent`);
      }
      console.log(state.wire.length === 0 ? "\nwire empty" : "\non the wire");
      for (const w of state.wire) {
        console.log(`     ${w.name.padEnd(24)}${(w.droppedByName ?? "—").padEnd(20)}` +
          `clears ${w.clearsAt}  ${w.bids} bid${w.bids === 1 ? "" : "s"}`);
      }

    } else if (sub === "drop") {
      const [teamArg, playerArg] = rest;
      const { clearsAt } = await dropPlayer(db, {
        leagueId, fantasyTeamId: Number(teamArg), playerId: Number(playerArg), now: clock() });
      console.log(`dropped — on waivers until ${clearsAt}`);

    } else if (sub === "add") {
      const [teamArg, playerArg, dropArg] = rest;
      await addFreeAgent(db, {
        leagueId, fantasyTeamId: Number(teamArg), playerId: Number(playerArg),
        dropPlayerId: dropArg ? Number(dropArg) : null, now: clock() });
      console.log("added");

    } else if (sub === "bid") {
      const [teamArg, playerArg, bidArg, dropArg] = rest;
      const claim = await submitClaim(db, {
        leagueId, fantasyTeamId: Number(teamArg), playerId: Number(playerArg),
        bid: Number(bidArg), dropPlayerId: dropArg ? Number(dropArg) : null, now: clock() });
      console.log(`claim ${claim.id} | $${claim.bid} on ${claim.playerName}` +
        `${claim.dropPlayerName ? `, dropping ${claim.dropPlayerName}` : ""} | opens ${claim.runsAt}`);

    } else if (sub === "claims") {
      const [teamArg] = rest;
      for (const c of await claimsFor(db, {
        leagueId, fantasyTeamId: teamArg ? Number(teamArg) : undefined })) {
        console.log(`${String(c.sequence).padStart(3)}  ${c.teamName.padEnd(16)}` +
          `$${String(c.bid).padStart(3)}  ${c.playerName.padEnd(24)}` +
          `${c.status.padEnd(10)}${c.reason ?? ""}`);
      }

    } else if (sub === "run") {
      const [asOf] = rest;
      const runs = await settleWaivers(db, {
        leagueId, now: asOf ? new Date(asOf) : clock() });
      if (runs.length === 0) console.log("nothing due");
      for (const run of runs) {
        console.log(`${run.runsAt} | ${run.outcomes.length} claims | ${run.cleared.length} cleared`);
        for (const o of run.outcomes) {
          console.log(`     ${o.teamName.padEnd(16)}$${String(o.bid).padStart(3)}  ` +
            `${o.playerName.padEnd(24)}${o.status.padEnd(10)}${o.reason ?? ""}`);
        }
      }

    } else {
      console.error("usage: league waivers <state|drop|add|bid|claims|run> <leagueId> …");
      process.exit(1);
    }

  } else if (command === "trades") {
    // The negotiation from a terminal. Same paths the app takes, so a
    // commissioner fixing something by hand cannot produce a state the app
    // could not have produced.
    const [sub, leagueArg, ...rest] = args;
    const leagueId = Number(leagueArg);
    const ids = (list: string | undefined) =>
      (list && list !== "-" ? list.split(",").map(Number) : []);

    if (sub === "list" || sub === undefined) {
      // Reading settles first, for the same reason the wire does: there is no
      // worker, and a window that closed last night closes when somebody looks.
      await settleTrades(db, { leagueId, now: clock() });
      const teamArg = rest[0];
      for (const t of await listTrades(db, {
        leagueId, involving: teamArg ? Number(teamArg) : undefined })) {
        const side = (s: { teamName: string; gives: { name: string }[] }) =>
          `${s.teamName}: ${s.gives.map((p) => p.name).join(", ") || "nothing"}`;
        console.log(`${String(t.id).padStart(4)}  ${t.status.padEnd(10)}` +
          `${side(t.from)}  ⇄  ${side(t.to)}`);
        if (t.reason) console.log(`      ${t.reason}`);
        else if (t.status === "accepted") console.log(`      executes ${t.executesAt}`);
        else if (t.status === "proposed") console.log(`      expires ${t.expiresAt}`);
      }

    } else if (sub === "offer") {
      const [fromArg, toArg, giveArg, getArg, message] = rest;
      const trade = await proposeTrade(db, {
        leagueId, fromTeamId: Number(fromArg), toTeamId: Number(toArg),
        gives: ids(giveArg), gets: ids(getArg), message, now: clock() });
      console.log(`trade ${trade.id} | ${trade.from.teamName} → ` +
        `${trade.from.gives.map((p) => p.name).join(", ") || "nothing"} | ` +
        `${trade.to.teamName} → ${trade.to.gives.map((p) => p.name).join(", ") || "nothing"}`);
      console.log(`  expires ${trade.expiresAt}`);

    } else if (sub === "accept" || sub === "reject") {
      const [tradeArg, teamArg] = rest;
      const trade = await respondToTrade(db, {
        tradeId: Number(tradeArg), fantasyTeamId: Number(teamArg),
        accept: sub === "accept", now: clock() });
      console.log(trade.status === "accepted"
        ? `accepted — executes ${trade.executesAt} unless the commissioner stops it`
        : "rejected");

    } else if (sub === "withdraw") {
      const [tradeArg, teamArg] = rest;
      await cancelTrade(db, {
        tradeId: Number(tradeArg), fantasyTeamId: Number(teamArg), now: clock() });
      console.log("withdrawn");

    } else if (sub === "veto") {
      const [tradeArg, reason] = rest;
      const { rows: [row] } = await db.query<{ commissioner_id: string }>(
        "SELECT commissioner_id FROM league WHERE id = $1", [leagueId]);
      const trade = await vetoTrade(db, {
        tradeId: Number(tradeArg), byUserId: Number(row!.commissioner_id), reason, now: clock() });
      console.log(`vetoed — ${trade.reason}`);

    } else if (sub === "run") {
      const [asOf] = rest;
      const done = await settleTrades(db, { leagueId, now: asOf ? new Date(asOf) : clock() });
      if (done.length === 0) console.log("nothing due");
      for (const d of done) {
        console.log(`${d.at}  trade ${String(d.tradeId).padStart(4)}  ` +
          `${d.status.padEnd(10)}${d.reason ?? ""}`);
      }

    } else {
      console.error("usage: league trades <list|offer|accept|reject|withdraw|veto|run> <leagueId> …");
      process.exit(1);
    }

  } else if (command === "roster") {
    const players = await rosterOn(db, Number(args[0]), args[1] ? iso(args[1]) : today());
    for (const p of players) {
      console.log(`${p.name.padEnd(24)}${(p.role ?? "—").padEnd(12)}${(p.teamName ?? "").padEnd(20)}${p.acquiredVia}`);
    }
    console.log(`${players.length} players`);

  } else if (command === "lineups") {
    const [leagueArg, dateArg, asOfArg] = args;
    const day = iso(dateArg!);
    // The clock is the real one unless a commissioner names another. Replaying
    // a night needs the override, because every game in it has already tipped
    // off and the lock would otherwise, correctly, refuse to move anyone.
    const asOf = asOfArg ? new Date(asOfArg) : new Date();
    const result = await autoFillLeague(db, Number(leagueArg), day, asOf);
    console.log(`${day}: started ${result.started} across ${result.teams} teams` +
      (asOfArg ? `  (as of ${asOf.toISOString()})` : ""));

  } else if (command === "settle") {
    const settled = await settleWeek(db, Number(args[0]), Number(args[1]));
    for (const m of settled) {
      console.log(
        `week ${m.week}  ${m.home.total.toFixed(1).padStart(7)} - ${m.away.total.toFixed(1).padEnd(7)}` +
        `  (${m.home.gamesCounted}/${m.home.gamesPlayed} vs ${m.away.gamesCounted}/${m.away.gamesPlayed} games)  ${m.winner}`);
    }
    if (settled.length === 0) console.log("no matchups that week");

  } else if (command === "standings") {
    const table = await standings(db, Number(args[0]));
    console.log(`${"team".padEnd(10)}${"W".padStart(3)}${"L".padStart(3)}${"T".padStart(3)}${"PF".padStart(9)}${"PA".padStart(9)}`);
    for (const r of table) {
      console.log(r.name.padEnd(10) + String(r.wins).padStart(3) + String(r.losses).padStart(3) +
        String(r.ties).padStart(3) + r.pointsFor.toFixed(1).padStart(9) + r.pointsAgainst.toFixed(1).padStart(9));
    }

  } else if (command === "bracket") {
    // Draws the bracket. Unlike the draft, this reads no clock — a
    // commissioner draws it once, when the regular season the standings come
    // from is actually over.
    const [leagueArg] = args;
    const leagueId = Number(leagueArg);
    const { rows: [row] } = await db.query<{ commissioner_id: string }>(
      "SELECT commissioner_id FROM league WHERE id = $1", [leagueId]);
    try {
      const created = await createBracket(db, { leagueId, by: Number(row!.commissioner_id) });
      console.log(`winners bracket: ${created.winners.rounds.join(" → ")} ` +
        `(${created.winners.matchupIds.length} matches)`);
      if (created.consolation) {
        console.log(`consolation bracket: ${created.consolation.rounds.join(" → ")} ` +
          `(${created.consolation.matchupIds.length} matches)`);
      }
    } catch (error) {
      if (error instanceof BracketExistsError) { console.error(`league ${leagueId} already has a bracket`); process.exit(1); }
      if (error instanceof BracketRefusedError) {
        for (const reason of error.reasons) console.error(`refused: ${reason}`);
        process.exit(1);
      }
      throw error;
    }

  } else if (command === "playoffs") {
    // Settles what the clock has reached and prints the bracket, the same
    // "reading settles first" rule waivers and trades follow — there is no
    // worker, so opening the page (or running this) is what advances a round.
    const [leagueArg, asOf] = args;
    const leagueId = Number(leagueArg);
    const view = await bracketView(db, { leagueId, now: asOf ? new Date(asOf) : clock() });
    if (!view) { console.log("no bracket for that league"); }
    else {
      const printBracket = (bracket: "winners" | "consolation" | "third", label: string) => {
        const matches = view.matches.filter((m) => m.bracket === bracket);
        if (matches.length === 0) return;
        console.log(`\n${label}`);
        for (const m of matches) {
          const side = (s: typeof m.home) =>
            `${(s.name ?? "TBD").padEnd(14)}${s.seed === null ? "" : `(${s.seed})`.padStart(4)}` +
            `${s.points === null ? "" : s.points.toFixed(1).padStart(8)}`;
          console.log(`  wk${String(m.week).padStart(2)} ${m.round.padEnd(4)}${side(m.home)}  vs  ${side(m.away)}` +
            (m.settled ? `  [${m.winner === "home" ? m.home.name : m.away.name} wins]` : ""));
        }
      };
      printBracket("winners", "Winners bracket");
      printBracket("third", "Third place");
      printBracket("consolation", "Consolation bracket");
    }

  } else if (command === "picture") {
    const picture = await playoffPicture(db, Number(args[0]));
    console.log(`cut line: top ${picture.cutLine} | ${picture.remainingWeeks} week` +
      `${picture.remainingWeeks === 1 ? "" : "s"} left in the regular season`);
    for (const t of picture.teams) {
      console.log(`${String(t.rank).padStart(3)}  ${t.name.padEnd(20)}` +
        `${String(t.wins).padStart(2)}-${String(t.losses).padEnd(2)}` +
        `${t.pointsFor.toFixed(1).padStart(9)}  ${t.status}`);
    }

  } else {
    console.error("usage: league <create|invite|accept|members|settings|draft|waivers|trades|" +
      "roster|lineups|settle|standings|bracket|playoffs|picture> …");
    process.exit(1);
  }
} finally {
  await db.end();
}
