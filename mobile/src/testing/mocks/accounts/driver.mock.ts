/**
 * Mock "driver with a lot of points" account — for manually testing the
 * rewards store (redeeming, vouchers) and the trip screens without touching
 * the real server or grinding real points. Login with mock-driver@carma.dev / mock.
 * __DEV__-only, see ../registerMockNetwork.
 */
import type { AppUser, DrivingStats, Reward, Trip, TripDetail, TripEvent, Voucher } from '@/types';
import type { MockAccount } from '../types';

const EMAIL = 'mock-driver@carma.dev';
const TOKEN = 'MOCK::driver';

const user: AppUser = {
  id: 'mock-driver-user',
  name: 'Mock Driver',
  email: EMAIL,
  role: 'DRIVER',
  language: 'HE',
  points: 999999,
  totalPoints: 999999,
  availablePoints: 999999,
  reservedPoints: 0,
  totalDistance: 12345,
  level: 10,
  isPrivate: false,
  driveModeEnabled: false,
  createdAt: new Date().toISOString(),
};

const rewards: Reward[] = [
  {
    id: 'mock-catalog-1', businessId: 'mock-business-id', business: 'Mock Business', businessHe: 'עסק לדוגמה',
    titleHe: 'שובר דלק 50 ש"ח', titleEn: '50₪ Fuel Voucher', descriptionHe: 'שובר לתדלוק', descriptionEn: 'A fuel voucher',
    category: 'fuel', costPoints: 500, imageIcon: 'car-outline', isActive: true, archivedAt: null,
    stock: null, available: null, expiresAt: null,
  },
  {
    id: 'mock-catalog-2', businessId: 'mock-business-id', business: 'Mock Business', businessHe: 'עסק לדוגמה',
    titleHe: 'כרטיס קולנוע', titleEn: 'Movie Ticket', descriptionHe: 'כרטיס לסרט', descriptionEn: 'One movie ticket',
    category: 'entertainment', costPoints: 800, imageIcon: 'film-outline', isActive: true, archivedAt: null,
    stock: 20, available: 20, expiresAt: null,
  },
];

let vouchers: Voucher[] = [];

// ─── Trips ────────────────────────────────────────────────────────────────────
// Four of them on purpose, so the trip-detail screen can be exercised end to end:
// stepping between trips needs more than one, and the map has states worth seeing —
// a long route carrying one marker of every kind, a short one, a clean one, and no
// route at all.
//
// The coordinates trace the right corridors and behave correctly on the map, but
// they were written by hand rather than taken from a routing service: zoomed in far
// enough, the line cuts corners instead of sitting on the asphalt.

const MINUTE = 60 * 1000;

type Waypoint = NonNullable<Trip['routeWaypoints']>[number];

/** [lat, lng, speedKmh] per point, spaced evenly in time. `ts` is an offset here. */
const withCadence = (stepMs: number, points: [number, number, number][]): Waypoint[] =>
  points.map(([lat, lng, speedKmh], i) => ({ lat, lng, ts: i * stepMs, speedKmh }));

/** Azrieli, Tel Aviv → Herzliya Pituach: Ayalon northbound, then Route 2. ~11 km. */
const HIGHWAY_RUN = withCadence(20_000, [
  [32.0740, 34.7925,  5], [32.0768, 34.7940, 25], [32.0800, 34.7952, 55],
  [32.0835, 34.7962, 78], [32.0870, 34.7972, 92], [32.0905, 34.7982, 96],
  [32.0940, 34.7992, 98], [32.0975, 34.8000, 95], [32.1010, 34.8008, 97],
  [32.1045, 34.8014, 99], [32.1080, 34.8018, 96], [32.1115, 34.8018, 93],
  [32.1150, 34.8012, 95], [32.1185, 34.8000, 97], [32.1220, 34.7985, 94],
  [32.1255, 34.7968, 96], [32.1290, 34.7950, 92], [32.1325, 34.7932, 61],
  [32.1360, 34.7915, 74], [32.1395, 34.7900, 88], [32.1430, 34.7888, 91],
  [32.1465, 34.7880, 47], [32.1498, 34.7885, 52], [32.1525, 34.7905, 58],
  [32.1548, 34.7935, 55], [32.1565, 34.7970, 48], [32.1578, 34.8005, 44],
  [32.1588, 34.8040, 38], [32.1595, 34.8072, 24], [32.1600, 34.8100,  6],
]);

/** ~2 km north through central Tel Aviv — a short city drive. */
const CITY_HOP = withCadence(20_000, [
  [32.0800, 34.7800, 14], [32.0815, 34.7808, 38], [32.0830, 34.7815, 51],
  [32.0845, 34.7822, 47], [32.0860, 34.7830, 55], [32.0875, 34.7841, 44],
  [32.0890, 34.7850, 29], [32.0905, 34.7860,  8],
]);

const routeFrom = (route: Waypoint[], startMs: number) =>
  route.map(w => ({ ...w, ts: startMs + w.ts }));

/**
 * Events are pinned to a waypoint rather than given their own coordinates, so a
 * marker can never end up off the line it is supposed to have happened on.
 * Server shape: `type` arrives lower-cased and the coordinates arrive flat.
 */
const eventsOn = (
  route: Waypoint[],
  startMs: number,
  specs: { at: number; type: string; severity: number }[],
): TripEvent[] =>
  specs.map((spec, i) => {
    const w = route[spec.at];
    return {
      id: `mock-ev-${i + 1}`,
      type: spec.type,
      severity: spec.severity,
      timestamp: new Date(startMs + w.ts).toISOString(),
      lat: w.lat,
      lng: w.lng,
    };
  });

function mockTrip(
  id: string,
  startedMinutesAgo: number,
  extra: Partial<TripDetail>,
): TripDetail {
  const startMs = Date.now() - startedMinutesAgo * MINUTE;
  return {
    id,
    userId: user.id,
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(startMs + 150_000).toISOString(),
    distanceKm: 2.1,
    durationSeconds: 150,
    avgScore: 88,
    points: 42,
    hardBrakes: 0,
    aggressiveAccels: 0,
    sharpTurns: 0,
    touchEpochs: 0,
    screenInteractionSeconds: 0,
    riskMultiplier: 1,
    effectiveRiskMultiplier: 1,
    startLocation: 'Tel Aviv',
    endLocation: 'Tel Aviv',
    aiInsight: null,
    status: 'scored',
    pointsCapped: false,
    userLevel: user.level,
    ...extra,
  };
}

const trips: TripDetail[] = ((): TripDetail[] => {
  const t1 = Date.now() - 30 * MINUTE;
  const t2 = Date.now() - 26 * 60 * MINUTE;
  const t3 = Date.now() - 50 * 60 * MINUTE;

  return [
    // The one to look at: one marker of every kind the map can draw, each on the
    // stretch where it would plausibly have happened — hard acceleration joining
    // the highway, phone handling on the long straight, a brake before the exit
    // slowdown, and the turn at the interchange itself.
    mockTrip('mock-trip-1', 30, {
      distanceKm: 11.4, durationSeconds: 580,
      avgScore: 74, points: 61,
      hardBrakes: 1, aggressiveAccels: 1, sharpTurns: 1,
      touchEpochs: 1, screenInteractionSeconds: 12,
      riskMultiplier: 1.2, effectiveRiskMultiplier: 1.2,
      startLocation: 'Tel Aviv', endLocation: 'Herzliya',
      routeWaypoints: routeFrom(HIGHWAY_RUN, t1),
      events: eventsOn(HIGHWAY_RUN, t1, [
        { at: 2,  type: 'aggressive_accel', severity: 2 },
        { at: 11, type: 'phone_usage',      severity: 3 },
        { at: 17, type: 'hard_brake',       severity: 2 },
        { at: 21, type: 'sharp_turn',       severity: 1 },
      ]),
    }),
    mockTrip('mock-trip-2', 26 * 60, {
      avgScore: 96, points: 55,
      routeWaypoints: routeFrom(CITY_HOP, t2),
      events: [],
    }),
    mockTrip('mock-trip-3', 50 * 60, {
      avgScore: 83, points: 37, hardBrakes: 1,
      routeWaypoints: routeFrom(CITY_HOP, t3),
      events: eventsOn(CITY_HOP, t3, [{ at: 4, type: 'hard_brake', severity: 3 }]),
    }),
    // No waypoints — kept so the map-unavailable card stays reachable at all.
    mockTrip('mock-trip-4', 4 * 24 * 60, {
      avgScore: 71, points: 18, hardBrakes: 2, distanceKm: 5.4, durationSeconds: 640,
      events: [],
    }),
  ];
})();

/** The list endpoint never returns the route or the timeline — only GET /:id does. */
const tripRow = ({ routeWaypoints, events, ...row }: TripDetail): Trip => row;

const sum = (pick: (t: TripDetail) => number) => trips.reduce((acc, t) => acc + pick(t), 0);

/**
 * Derived from the trips above rather than written out, so the dashboard can never
 * disagree with the list underneath it. The streaks are the only invented numbers —
 * nothing in a fixture can imply days in a row.
 */
const stats: DrivingStats = {
  totalTrips: trips.length,
  totalDistance: Math.round(sum(t => t.distanceKm) * 10) / 10,
  totalPoints: user.totalPoints,
  averageScore: Math.round(sum(t => t.avgScore) / trips.length),
  // "Safe" here means the trip logged nothing, which is self-evident from the
  // fixture. Any score threshold would be a scoring rule, and that is the server's.
  safeTripsCount: trips.filter(t => !t.events?.length).length,
  totalDurationSeconds: sum(t => t.durationSeconds),
  currentStreak: 3,
  bestStreak: 7,
  recentScores: [...trips]
    .reverse()
    .map(t => ({ date: t.startTime.slice(0, 10), score: t.avgScore })),
  eventCounts: {
    hardBrakes:       sum(t => t.hardBrakes),
    aggressiveAccels: sum(t => t.aggressiveAccels),
    sharpTurns:       sum(t => t.sharpTurns),
    touchEpochs:      sum(t => t.touchEpochs),
  },
};

function handleRequest(method: string, path: string, _body: unknown): { status: number; data: unknown } | null {
  const cleanPath = path.split('?')[0];

  // Checked before the bare /api/trips below, which would otherwise swallow it.
  const tripMatch = cleanPath.match(/\/api\/trips\/([^/]+)$/);
  if (method === 'GET' && tripMatch) {
    const trip = trips.find(x => x.id === tripMatch[1]);
    return trip
      ? { status: 200, data: { trip } }
      : { status: 404, data: { detail: 'Trip not found (mock)' } };
  }

  if (method === 'GET' && cleanPath.endsWith('/api/trips')) {
    return { status: 200, data: { trips: trips.map(tripRow) } };
  }

  if (method === 'GET' && cleanPath.endsWith('/api/user/stats')) {
    return { status: 200, data: { stats } };
  }

  if (method === 'GET' && cleanPath.endsWith('/api/rewards')) {
    return { status: 200, data: { rewards, vouchers } };
  }

  const redeemMatch = cleanPath.match(/\/api\/rewards\/([^/]+)\/redeem$/);
  if (method === 'POST' && redeemMatch) {
    const reward = rewards.find(r => r.id === redeemMatch[1]);
    if (!reward) return { status: 404, data: { detail: 'Reward not found (mock)' } };
    const voucher: Voucher = {
      id: `mock-voucher-${Date.now()}`,
      userId: user.id,
      rewardId: reward.id,
      code: Math.random().toString(36).slice(2, 8).toUpperCase(),
      qrData: `mock:${reward.id}`,
      status: 'pending',
      isUsed: false,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      redeemedAt: null,
      createdAt: new Date().toISOString(),
      pointsCost: reward.costPoints,
      reward,
    };
    vouchers = [voucher, ...vouchers];
    return { status: 200, data: { voucher } };
  }

  if (method === 'GET' && cleanPath.endsWith('/api/vouchers')) {
    return { status: 200, data: { vouchers } };
  }

  return null;
}

export const driverMockAccount: MockAccount = {
  email: EMAIL,
  password: 'mock',
  token: TOKEN,
  user,
  handleRequest,
};
