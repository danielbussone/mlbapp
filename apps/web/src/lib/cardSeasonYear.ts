/** Highest season year shown in player-card UI and accepted from URL / chat (data scope). */
export const CARD_SEASON_YEAR_MAX = 2026;

/** Calendar year used as the default “current” season for player cards (no URL / chat year). */
export function getDefaultCardSeasonYear(): number {
  const y = new Date().getFullYear();
  if (y < 1900) return 1900;
  if (y > 2100) return CARD_SEASON_YEAR_MAX;
  return Math.min(CARD_SEASON_YEAR_MAX, y);
}
