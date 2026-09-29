import type { LatLng } from '@hackathon26/shared';

/**
 * PostGIS columns reach the API in whichever serialisation PostgREST uses
 * (GeoJSON objects, WKT text, or EWKB hex, depending on server version and
 * how the column is selected). These readers accept all three so the
 * journey-map endpoints keep working whichever form the shared Supabase
 * project returns.
 */

/** Reads one point geometry; null when the value holds no usable point. */
export function parseGeoPoint(value: unknown): LatLng | null {
  const points = parseGeometry(value);
  return points && points.length === 1 ? points[0]! : null;
}

/** Reads one linestring geometry; null when fewer than two points survive. */
export function parseLineString(value: unknown): LatLng[] | null {
  const points = parseGeometry(value);
  return points && points.length >= 2 ? points : null;
}

function parseGeometry(value: unknown): LatLng[] | null {
  if (typeof value === 'string') {
    return parseWkt(value) ?? parseEwkbHex(value);
  }
  if (value && typeof value === 'object') {
    const geo = value as { type?: unknown; coordinates?: unknown };
    if (Array.isArray(geo.coordinates)) {
      if (geo.type === 'Point') {
        const point = toLatLng(geo.coordinates);
        return point ? [point] : null;
      }
      if (geo.type === 'LineString') {
        const points = geo.coordinates.map(toLatLng);
        return points.every((point): point is LatLng => point !== null) ? points : null;
      }
    }
  }
  return null;
}

/** GeoJSON coordinate order is [lng, lat]; the wire format is { lat, lng }. */
function toLatLng(pair: unknown): LatLng | null {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const lng = Number(pair[0]);
  const lat = Number(pair[1]);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lat, lng } : null;
}

/** "POINT(28.1 -25.7)" / "LINESTRING(28.1 -25.7, 28.2 -25.8)", SRID prefix allowed. */
function parseWkt(value: string): LatLng[] | null {
  const wkt = value.includes(';') ? value.slice(value.indexOf(';') + 1) : value;
  const match = /^\s*(?:POINT|LINESTRING)\s*\(\s*(.+?)\s*\)\s*$/i.exec(wkt);
  const coordinates = match?.[1];
  if (!coordinates) return null;
  const points = coordinates.split(',').map((pair) => toLatLng(pair.trim().split(/\s+/)));
  return points.every((point): point is LatLng => point !== null) ? points : null;
}

/**
 * EWKB hex, e.g. "0101000020E6100000...". Both byte orders supported and Z/M
 * ordinates skipped, so points and linestrings round-trip whatever PostGIS
 * writes.
 */
function parseEwkbHex(value: string): LatLng[] | null {
  const hex = value.startsWith('\\x') ? value.slice(2) : value;
  if (hex.length < 42 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;

  const buffer = Buffer.from(hex, 'hex');
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const littleEndian = view.getUint8(0) === 1;
  const type = view.getUint32(1, littleEndian);
  const offsetToCoordinates = type & 0x20000000 ? 9 : 5; // embedded SRID adds 4 bytes
  const coordinateBytes = type & 0x80000000 ? 24 : 16; // Z (and M) ordinates interleaved

  switch (type & 0x1fffffff) {
    case 1: {
      if (buffer.length < offsetToCoordinates + 16) return null;
      return [readPoint(view, offsetToCoordinates, littleEndian)];
    }
    case 2: {
      if (buffer.length < offsetToCoordinates + 4) return null;
      const count = view.getUint32(offsetToCoordinates, littleEndian);
      let offset = offsetToCoordinates + 4;
      if (count > 100_000 || buffer.length < offset + count * coordinateBytes) return null;
      const points: LatLng[] = [];
      for (let i = 0; i < count; i++) {
        points.push(readPoint(view, offset, littleEndian));
        offset += coordinateBytes;
      }
      return points;
    }
    default:
      return null;
  }
}

function readPoint(view: DataView, offset: number, littleEndian: boolean): LatLng {
  return { lng: view.getFloat64(offset, littleEndian), lat: view.getFloat64(offset + 8, littleEndian) };
}
