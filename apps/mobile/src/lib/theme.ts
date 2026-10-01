/**
 * Shared design tokens for the mobile app.
 *
 * Palette inspired by the reference design: clean white surfaces on a soft
 * grey canvas, violet accent, pill-shaped chips and floating cards with
 * gentle shadow.
 */

export const colors = {
  /** Primary action: buttons, active chips, links. */
  accent: '#4B6BFB',
  accentPressed: '#3A56E0',
  /** Soft wash for selected cards and quiet buttons. */
  accentSoft: '#EEF1FF',
  accentBorder: '#C7D0FC',
  accentDisabled: '#C7D0FC',

  /** Canvas and surfaces. */
  bg: '#F5F5F9',
  surface: '#FFFFFF',
  /** Neutral fill for fields sitting on white cards. */
  fill: '#F0F0F6',

  text: '#14142B',
  textSecondary: '#6E7191',
  textFaint: '#A0A3BD',

  border: '#E8E8F0',
  borderStrong: '#D9DAE8',

  /** Amber family: transfer notes, cash tip. */
  amberText: '#92400E',
  amberBg: '#FEF3C7',
  /** Green family: origin pins, demand button. */
  green: '#059669',
  greenPressed: '#047857',
  greenDark: '#065F46',
  greenSoft: '#D1FAE5',
  danger: '#EF4444',

  /** Bottom-tab inactive colour. */
  tabInactive: '#A0A3BD',

  /** Status-bar / header gradient start. */
  gradientStart: '#4B6BFB',
  gradientEnd: '#7C3AED',
};

/** Corner radii scale. */
export const radii = { sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, pill: 999 };

/** Soft elevation for floating cards. */
export const cardShadow = {
  shadowColor: '#14142B',
  shadowOpacity: 0.08,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 4,
};

/** Subtle shadow for chips and small elements. */
export const chipShadow = {
  shadowColor: '#14142B',
  shadowOpacity: 0.05,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
};

/** Distinct colors per leg so taxi changes are visually obvious. */
export const LEG_COLORS = ['#4B6BFB', '#F59E0B', '#059669', '#D946EF'];

/** Map pin colours. */
export const PIN_COLORS = { start: '#059669', end: '#EF4444', transfer: '#F59E0B' };
