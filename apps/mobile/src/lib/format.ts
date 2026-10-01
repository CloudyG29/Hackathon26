import type { RoutePriority, TransportMode } from '@hackathon26/shared';

/**
 * Display helpers shared by the screens. They live in the app rather than
 * packages/shared until the API needs the same formatting — then they move
 * upstream so both sides render fares identically.
 */

const MODE_LABELS: Record<TransportMode, string> = {
  long_distance_taxi: 'Long-distance taxi',
  mini_bus_taxi: 'Mini-bus taxi',
  local_bus: 'Local bus',
  metro_train: 'Metro train',
  walk: 'Walk',
};

/** Zero-dependency mode icons — swap for real assets if the demo demands polish. */
const MODE_ICONS: Record<TransportMode, string> = {
  long_distance_taxi: '🚕',
  mini_bus_taxi: '🚐',
  local_bus: '🚌',
  metro_train: '🚆',
  walk: '🚶',
};

/** Polyline colours per mode, drawn from the app palette in theme.ts. */
const MODE_COLORS: Record<TransportMode, string> = {
  long_distance_taxi: '#6C4EF6',
  mini_bus_taxi: '#0E9F6E',
  local_bus: '#E8940A',
  metro_train: '#D6409F',
  walk: '#616A75',
};

const TAG_LABELS: Record<RoutePriority, string> = {
  cheapest: 'Cheapest',
  fastest: 'Fastest',
  easiest: 'Easiest',
  safest: 'Safest',
};

export function formatZar(amount: number): string {
  return `R${Math.round(amount)}`;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours} h`;
  return `${hours} h ${mins} min`;
}

export function formatDistance(km?: number): string {
  if (km == null) return '';
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export { MODE_COLORS, MODE_ICONS, MODE_LABELS, TAG_LABELS };
