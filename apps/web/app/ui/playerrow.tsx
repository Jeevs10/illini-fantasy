import Link from "next/link";
import { Avatar } from "./identity.tsx";

/**
 * The player row.
 *
 * Every list of people in this app is this shape: an avatar, a name with a
 * line of context under it, and something on the right — a score, a control,
 * an owner. The variants change what goes in those places, never what a row
 * is, which is what stops the pool, the wire, the bench and a trade from
 * being four different ideas of the same thing.
 */
export function PlayerRow({
  playerId, name, meta, right, lead, state, dim, mine, ...rest
}: {
  playerId?: number;
  name: string;
  /** The second line: school, opponent, when — already worded by the caller. */
  meta?: React.ReactNode;
  /** The right-hand end: a score, a button, a tag. */
  right?: React.ReactNode;
  /** Replaces the avatar — a slot chip, a rank, a checkbox. */
  lead?: React.ReactNode;
  state?: "live" | "empty" | "final";
  dim?: boolean;
  mine?: boolean;
} & { children?: never }) {
  return (
    <div className="plr" data-state={state} data-dim={dim || undefined} data-mine={mine || undefined} {...rest}>
      <span className="plr-lead">
        {lead ?? <Avatar name={name} seed={playerId ?? name} size="sm" />}
      </span>
      <span className="plr-id">
        {playerId === undefined ? (
          <span className="plr-name">{name}</span>
        ) : (
          <Link href={`/players/${playerId}`} className="plr-name">{name}</Link>
        )}
        {meta ? <span className="plr-sub">{meta}</span> : null}
      </span>
      <span className="plr-right">{right}</span>
    </div>
  );
}

/** The dot between two facts on a row's second line. */
export function Dot() { return <span className="dot" aria-hidden="true" />; }
