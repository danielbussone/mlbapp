/**
 * Shared SVG user-space for the Dodger Stadium dimensions asset (`spray/dodger-stadium-dimensions.png`).
 * Keep in sync with spray / OAA overlays that share this diagram.
 */
export const SPRAY_FIELD_VB = 100;
export const SPRAY_FIELD_HEADROOM_TOP = 14;
export const SPRAY_FIELD_Y_MIN = -SPRAY_FIELD_HEADROOM_TOP;
export const SPRAY_FIELD_VIEW_HEIGHT = SPRAY_FIELD_VB + SPRAY_FIELD_HEADROOM_TOP;

const base =
  typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL != null ? String(import.meta.env.BASE_URL) : '/';

export const sprayFieldImageHref = `${base}spray/dodger-stadium-dimensions.png`;
