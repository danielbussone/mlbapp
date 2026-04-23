/**
 * Detects plain "Compare {A} and {B}" style questions so the host can run
 * compare_players_career before the model's first turn (small models often skip or misuse tools).
 */
export function inferTwoPlayerCompareFromUserMessage(
  msg: string
): { player_a_query: string; player_b_query: string } | null {
  const t = msg.trim();
  if (!t) return null;
  const re = /\bcompare\s+(.+?)\s+and\s+(.+)$/is;
  const m = t.match(re);
  if (!m) return null;
  const stripTrail = (s: string) => s.trim().replace(/[.!?]+$/g, '').trim();
  const player_a_query = stripTrail(m[1]);
  const player_b_query = stripTrail(m[2]);
  if (player_a_query.length < 2 || player_b_query.length < 2) return null;
  return { player_a_query, player_b_query };
}
