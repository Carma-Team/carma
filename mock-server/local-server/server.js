/**
 * CARMA Local Development Server
 * ────────────────────────────────────────────────────────────────────────────
 * Mirrors Nave's FastAPI server (same routes, same JSON shape) so the app
 * can run without a live backend.  Data lives in db.json and is read/written
 * on every request — no in-memory state, restarts are safe.
 *
 * Start:  npm start          (node server.js)
 * Watch:  npm run dev        (nodemon server.js)
 * Port:   3000
 *
 * Demo credentials
 *   admin@carma.app      / admin123
 *   daniel@carma.app     / password123
 *   arcaffe@carma.app    / business123
 *   superpharm@carma.app / business123
 */

const express = require('express');
const jwt     = require('jsonwebtoken');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const app        = express();
const PORT       = 3000;
const JWT_SECRET = 'carma-local-dev-secret-2024';
const DB_PATH    = path.join(__dirname, 'db.json');
const START_TIME = Date.now();

app.use(cors());
app.use(express.json());

// ─── Request logger ───────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  const time = new Date().toLocaleTimeString('he-IL', { hour12: false });
  console.log(`[${time}]  ${req.method.padEnd(6)} ${req.originalUrl}`);
  next();
});

// ─── DB helpers ───────────────────────────────────────────────────────────────

function readDb() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

// ─── Serializers: snake_case DB → camelCase API ───────────────────────────────

function serializeUser(u) {
  return {
    id:               u.id,
    name:             u.name,
    email:            u.email,
    role:             u.role,
    language:         u.language   ?? 'he',
    age:              u.age        ?? null,
    city:             u.city       ?? null,
    country:          u.country    ?? null,
    licenseYear:      u.license_year ?? null,
    points:           u.points       ?? 0,
    totalPoints:      u.total_points ?? 0,
    totalDistance:    u.total_distance ?? 0,
    level:            u.level         ?? 1,
    driveModeEnabled: u.drive_mode_enabled ?? false,
    businessId:       u.business_id ?? null,
    createdAt:        u.created_at,
  };
}

function serializeTrip(t) {
  return {
    id:                t.id,
    userId:            t.user_id,
    startTime:         t.start_time,
    endTime:           t.end_time,
    distanceKm:        t.distance_km       ?? 0,
    durationSeconds:   t.duration_seconds  ?? 0,
    avgScore:          t.avg_score         ?? 0,
    score:             t.avg_score         ?? 0,
    points:            t.points            ?? 0,
    hardBrakes:        t.hard_brakes       ?? 0,
    aggressiveAccels:  t.aggressive_accels ?? 0,
    sharpTurns:        t.sharp_turns       ?? 0,
    phoneSeconds:      t.phone_seconds     ?? 0,
    riskMultiplier:    t.risk_multiplier   ?? 1.0,
    status:            t.status,
    startLocation:     t.start_location    ?? null,
    endLocation:       t.end_location      ?? null,
  };
}

function serializeReward(r) {
  return {
    id:            r.id,
    businessId:    r.business_id,
    business:      r.business_name,
    titleHe:       r.title,
    titleEn:       r.title_en        ?? null,
    descriptionHe: r.description,
    descriptionEn: r.description_en  ?? null,
    category:      r.category,
    costPoints:    r.cost_points,
    imageIcon:     r.image_icon,
    isActive:      r.is_active,
    stock:         r.stock,
    expiresAt:     r.expiry_date     ?? null,
  };
}

function serializeLevel(l) {
  return {
    level:     l.id,
    name:      l.name,
    nameEn:    l.name_en,
    minPoints: l.min_points,
    maxPoints: l.max_points ?? Infinity,
    color:     l.color,
    icon:      l.icon,
    perks:     l.perks ?? [],
  };
}

function serializeRedemption(red, reward) {
  return {
    id:        red.id,
    userId:    red.user_id,
    rewardId:  red.reward_id,
    code:      red.qr_code,
    qrData:    red.qr_code,
    status:    red.status,
    isUsed:    red.status === 'used',
    expiresAt: red.expires_at,
    createdAt: red.created_at,
    reward:    reward ? serializeReward(reward) : null,
  };
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ detail: 'Not authenticated' });
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    const db   = readDb();
    const user = db.users.find(u => u.id === payload.sub);
    if (!user) return res.status(401).json({ detail: 'User not found' });
    req.currentUser = user;
    next();
  } catch {
    res.status(401).json({ detail: 'Invalid or expired token' });
  }
}

function issueToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.get('/health/live', (_, res) =>
  res.json({ uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000) })
);

// ─── Auth ─────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  const db   = readDb();
  const user = db.users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ detail: 'Invalid credentials' });
  res.json({ token: issueToken(user), user: serializeUser(user) });
});

app.post('/api/auth/register', (req, res) => {
  const db = readDb();
  const { name, email, password, phone, city, age, licenseYear } = req.body ?? {};
  if (!name || !email || !password) {
    return res.status(422).json({ detail: 'name, email and password are required' });
  }
  if (db.users.find(u => u.email === email)) {
    return res.status(400).json({ detail: 'Email already registered' });
  }
  const newUser = {
    id:                   `u-${Date.now()}`,
    name, email, password,
    phone:                phone        ?? null,
    role:                 'driver',
    business_id:          null,
    points:               0,
    total_points:         0,
    total_distance:       0,
    level:                1,
    city:                 city         ?? null,
    age:                  age          ?? null,
    license_year:         licenseYear  ?? null,
    language:             'he',
    drive_mode_enabled:   false,
    bluetooth_device_id:  null,
    bluetooth_device_name:null,
    last_cleared_history: null,
    created_at:           new Date().toISOString(),
    last_logged:          new Date().toISOString(),
  };
  db.users.push(newUser);
  writeDb(db);
  res.status(201).json({ token: issueToken(newUser), user: serializeUser(newUser) });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(serializeUser(req.currentUser));
});

// ─── Users ────────────────────────────────────────────────────────────────────

app.get('/api/users/me', requireAuth, (req, res) => {
  res.json(serializeUser(req.currentUser));
});

app.patch('/api/users/me', requireAuth, (req, res) => {
  const db  = readDb();
  const idx = db.users.findIndex(u => u.id === req.currentUser.id);
  const { name, language, age, city } = req.body ?? {};
  if (name     !== undefined) db.users[idx].name     = name;
  if (language !== undefined) db.users[idx].language = language;
  if (age      !== undefined) db.users[idx].age      = age;
  if (city     !== undefined) db.users[idx].city     = city;
  writeDb(db);
  res.json(serializeUser(db.users[idx]));
});

app.put('/api/users/me/location', requireAuth, (req, res) => {
  const db  = readDb();
  const idx = db.users.findIndex(u => u.id === req.currentUser.id);
  const { lat, lng } = req.body ?? {};
  db.users[idx].last_lat          = lat;
  db.users[idx].last_lng          = lng;
  db.users[idx].last_location_at  = new Date().toISOString();
  writeDb(db);
  res.json(serializeUser(db.users[idx]));
});

app.delete('/api/users/me', requireAuth, (req, res) => {
  const db = readDb();
  db.users = db.users.filter(u => u.id !== req.currentUser.id);
  writeDb(db);
  res.status(204).send();
});

app.get('/api/user/stats', requireAuth, (req, res) => {
  const db     = readDb();
  const userId = req.currentUser.id;
  const trips  = db.trips.filter(t => t.user_id === userId);

  const totalTrips   = trips.length;
  const totalDistance = Math.round(
    trips.reduce((s, t) => s + (t.distance_km || 0), 0) * 10
  ) / 10;
  const totalPoints  = req.currentUser.total_points || 0;
  const avgScore     = totalTrips > 0
    ? Math.round(trips.reduce((s, t) => s + (t.avg_score || 0), 0) / totalTrips)
    : 0;
  const safeTripsCount      = trips.filter(t => (t.avg_score || 0) >= 80).length;
  const totalDurationSeconds = trips.reduce((s, t) => s + (t.duration_seconds || 0), 0);

  const sorted = [...trips].sort(
    (a, b) => new Date(b.start_time) - new Date(a.start_time)
  );
  const recentScores = sorted.slice(0, 7).reverse().map(t => ({
    date:  t.start_time,
    score: t.avg_score,
  }));

  const eventCounts = {
    hardBrakes:       trips.reduce((s, t) => s + (t.hard_brakes       || 0), 0),
    aggressiveAccels: trips.reduce((s, t) => s + (t.aggressive_accels || 0), 0),
    sharpTurns:       trips.reduce((s, t) => s + (t.sharp_turns       || 0), 0),
    phoneSeconds:     trips.reduce((s, t) => s + (t.phone_seconds     || 0), 0),
  };

  res.json({ stats: {
    totalTrips, totalDistance, totalPoints, averageScore: avgScore,
    safeTripsCount, totalDurationSeconds, recentScores, eventCounts,
  }});
});

// ─── Trips ────────────────────────────────────────────────────────────────────

app.get('/api/trips', requireAuth, (req, res) => {
  const db    = readDb();
  const trips = db.trips
    .filter(t => t.user_id === req.currentUser.id)
    .sort((a, b) => new Date(b.start_time) - new Date(a.start_time))
    .map(serializeTrip);
  res.json({ trips });
});

app.post('/api/trips', requireAuth, (req, res) => {
  const db     = readDb();
  const userId = req.currentUser.id;
  const body   = req.body ?? {};

  // Accept both camelCase and snake_case (mirrors FastAPI AliasChoices)
  const distanceKm       = body.distanceKm    ?? body.distance_km ?? body.distance ?? 0;
  const avgScore         = body.avgScore       ?? body.avg_score   ?? body.score    ?? 0;
  const startTime        = body.startTime      ?? body.start_time;
  const endTime          = body.endTime        ?? body.end_time;
  const durationSeconds  = body.durationSeconds ?? body.duration_seconds ?? 0;
  const hardBrakes       = body.hardBrakes      ?? body.hard_brakes       ?? 0;
  const aggressiveAccels = body.aggressiveAccels ?? body.aggressive_accels ?? 0;
  const sharpTurns       = body.sharpTurns       ?? body.sharp_turns       ?? 0;
  const phoneSeconds     = body.phoneSeconds      ?? body.phone_seconds     ?? 0;
  const eventsArray      = body.eventsArray        ?? body.events_array     ?? body.events ?? [];
  const points           = body.points ?? Math.round(avgScore * distanceKm * 0.3);

  const newTrip = {
    id:                 `t-${Date.now()}`,
    user_id:            userId,
    start_time:         startTime,
    end_time:           endTime,
    avg_score:          avgScore,
    distance_km:        distanceKm,
    duration_seconds:   durationSeconds,
    points,
    hard_brakes:        hardBrakes,
    aggressive_accels:  aggressiveAccels,
    sharp_turns:        sharpTurns,
    phone_seconds:      phoneSeconds,
    status:             'completed',
    events_array:       eventsArray,
    start_location:     body.startLocation ?? null,
    end_location:       body.endLocation   ?? null,
  };

  // Update user stats
  const userIdx = db.users.findIndex(u => u.id === userId);
  db.users[userIdx].points         = (db.users[userIdx].points         || 0) + points;
  db.users[userIdx].total_points   = (db.users[userIdx].total_points   || 0) + points;
  db.users[userIdx].total_distance = (db.users[userIdx].total_distance || 0) + distanceKm;

  // Recalculate level based on updated min_points thresholds
  const newTotal   = db.users[userIdx].total_points;
  const levelsDesc = [...db.levels].sort((a, b) => b.min_points - a.min_points);
  const newLevel   = levelsDesc.find(l => newTotal >= l.min_points);
  if (newLevel) db.users[userIdx].level = newLevel.id;

  db.trips.push(newTrip);
  writeDb(db);
  res.json(serializeTrip(newTrip));
});

app.get('/api/trips/:id', requireAuth, (req, res) => {
  const db   = readDb();
  const trip = db.trips.find(
    t => t.id === req.params.id && t.user_id === req.currentUser.id
  );
  if (!trip) return res.status(404).json({ detail: 'Trip not found' });
  const events = (db.events || []).filter(e => e.trip_id === req.params.id);
  res.json({ trip: { ...serializeTrip(trip), events } });
});

// ─── Rewards & Vouchers ───────────────────────────────────────────────────────

app.get('/api/rewards', requireAuth, (req, res) => {
  const db       = readDb();
  const category = req.query.category;
  let rewards    = db.rewards.filter(r => r.is_active);
  if (category) rewards = rewards.filter(r => r.category === category);

  const vouchers = (db.redemptions || [])
    .filter(red => red.user_id === req.currentUser.id)
    .map(red => {
      const reward = db.rewards.find(r => r.id === red.reward_id);
      return serializeRedemption(red, reward);
    });

  res.json({ rewards: rewards.map(serializeReward), vouchers });
});

app.post('/api/rewards/:id/redeem', requireAuth, (req, res) => {
  const db     = readDb();
  const reward = db.rewards.find(r => r.id === req.params.id && r.is_active);
  if (!reward) return res.status(404).json({ detail: 'Reward not found' });

  const userIdx = db.users.findIndex(u => u.id === req.currentUser.id);
  if ((db.users[userIdx].points || 0) < reward.cost_points) {
    return res.status(400).json({ detail: 'Not enough points' });
  }

  const qrCode = `CARMA-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const now    = new Date();
  const newRed = {
    id:         `red-${Date.now()}`,
    user_id:    req.currentUser.id,
    reward_id:  reward.id,
    qr_code:    qrCode,
    status:     'active',
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 5 * 60_000).toISOString(),
  };

  db.users[userIdx].points = (db.users[userIdx].points || 0) - reward.cost_points;
  db.redemptions.push(newRed);
  writeDb(db);
  res.json({ voucher: serializeRedemption(newRed, reward) });
});

app.get('/api/vouchers', requireAuth, (req, res) => {
  const db       = readDb();
  const vouchers = (db.redemptions || [])
    .filter(red => red.user_id === req.currentUser.id)
    .map(red => {
      const reward = db.rewards.find(r => r.id === red.reward_id);
      return serializeRedemption(red, reward);
    });
  res.json({ vouchers });
});

// ─── User search by phone ─────────────────────────────────────────────────────

app.get('/api/users/search', requireAuth, (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ detail: 'phone query param required' });
  const db    = readDb();
  const found = db.users.find(u => u.phone === phone && u.id !== req.currentUser.id);
  if (!found) return res.status(404).json({ detail: 'User not found' });
  res.json({ user: { id: found.id, name: found.name, city: found.city ?? null } });
});

app.post('/api/users/:id/friend-request', requireAuth, (req, res) => {
  const db       = readDb();
  const fromId   = req.currentUser.id;
  const toId     = req.params.id;
  const target   = db.users.find(u => u.id === toId);
  if (!target) return res.status(404).json({ detail: 'User not found' });
  if (fromId === toId) return res.status(400).json({ detail: 'Cannot add yourself' });

  if (!db.friend_requests) db.friend_requests = [];
  // Avoid duplicates
  const existing = db.friend_requests.find(
    r => r.from_user_id === fromId && r.to_user_id === toId && r.status === 'pending'
  );
  if (existing) return res.json({ status: 'pending', id: existing.id });

  const newReq = {
    id:           `fr-${Date.now()}`,
    from_user_id: fromId,
    to_user_id:   toId,
    status:       'pending',
    created_at:   new Date().toISOString(),
  };
  db.friend_requests.push(newReq);
  writeDb(db);
  res.json({ status: 'pending', id: newReq.id });
});

// Cancel a pending friend request sent TO user :id
app.delete('/api/users/:id/friend-request', requireAuth, (req, res) => {
  const db   = readDb();
  const fromId = req.currentUser.id;
  const toId   = req.params.id;
  if (!db.friend_requests) db.friend_requests = [];
  const idx = db.friend_requests.findIndex(
    r => r.from_user_id === fromId && r.to_user_id === toId && r.status === 'pending'
  );
  if (idx < 0) return res.status(404).json({ detail: 'No pending request found' });
  db.friend_requests.splice(idx, 1);
  writeDb(db);
  res.json({ status: 'none' });
});

// ─── Friend Requests ──────────────────────────────────────────────────────────

// Get incoming pending friend requests for the current user
app.get('/api/friend-requests', requireAuth, (req, res) => {
  const db      = readDb();
  const userId  = req.currentUser.id;
  const pending = (db.friend_requests || []).filter(
    r => r.to_user_id === userId && r.status === 'pending'
  );
  const requests = pending.map(r => {
    const sender = db.users.find(u => u.id === r.from_user_id);
    return {
      id:            r.id,
      fromUserId:    r.from_user_id,
      fromUserName:  sender?.name  ?? '—',
      fromUserLevel: sender?.level ?? 1,
      fromUserCity:  sender?.city  ?? null,
      createdAt:     r.created_at,
    };
  });
  res.json({ requests });
});

// Accept a friend request
app.post('/api/friend-requests/:id/accept', requireAuth, (req, res) => {
  const db  = readDb();
  if (!db.friend_requests) db.friend_requests = [];
  const req_ = db.friend_requests.find(
    r => r.id === req.params.id && r.to_user_id === req.currentUser.id
  );
  if (!req_) return res.status(404).json({ detail: 'Request not found' });
  req_.status = 'accepted';
  writeDb(db);
  res.json({ status: 'accepted' });
});

// Reject (or cancel) a friend request by its ID
app.delete('/api/friend-requests/:id', requireAuth, (req, res) => {
  const db = readDb();
  if (!db.friend_requests) db.friend_requests = [];
  const idx = db.friend_requests.findIndex(
    r => r.id === req.params.id &&
         (r.to_user_id === req.currentUser.id || r.from_user_id === req.currentUser.id)
  );
  if (idx < 0) return res.status(404).json({ detail: 'Request not found' });
  db.friend_requests.splice(idx, 1);
  writeDb(db);
  res.status(204).send();
});

// Remove an accepted friendship (both directions). Either party can re-add afterward.
app.delete('/api/friends/:userId', requireAuth, (req, res) => {
  const db        = readDb();
  const currentId = req.currentUser.id;
  const otherId   = req.params.userId;
  if (!db.friend_requests) db.friend_requests = [];

  const before = db.friend_requests.length;
  db.friend_requests = db.friend_requests.filter(r =>
    !(r.status === 'accepted' && (
      (r.from_user_id === currentId && r.to_user_id === otherId) ||
      (r.from_user_id === otherId   && r.to_user_id === currentId)
    ))
  );
  if (db.friend_requests.length === before) {
    return res.status(404).json({ detail: 'Friendship not found' });
  }
  writeDb(db);
  res.status(204).send();
});

// ─── Leaderboard ──────────────────────────────────────────────────────────────

// Returns all unique countries and cities (per country) that exist in the DB
app.get('/api/leaderboard/locations', requireAuth, (req, res) => {
  const db    = readDb();
  const users = db.users.filter(u => u.role === 'driver' || u.role === 'admin');
  const citiesByCountry = {};
  for (const u of users) {
    const country = u.country || 'ישראל';
    if (!citiesByCountry[country]) citiesByCountry[country] = new Set();
    if (u.city) citiesByCountry[country].add(u.city);
  }
  // Convert Sets to sorted arrays
  const result = {};
  for (const [country, cities] of Object.entries(citiesByCountry)) {
    result[country] = [...cities].sort();
  }
  res.json({ citiesByCountry: result, countries: Object.keys(result).sort() });
});

app.get('/api/leaderboard', requireAuth, (req, res) => {
  const db          = readDb();
  const type        = req.query.type || 'national';
  const filterCity    = req.query.city    || null;
  const filterCountry = req.query.country || null;
  const currentUser = req.currentUser;

  let pool = db.users.filter(u => u.role === 'driver' || u.role === 'admin');

  if (type === 'city') {
    const city = filterCity || currentUser.city;
    if (city) pool = pool.filter(u => u.city === city);
  } else if (type === 'national') {
    const country = filterCountry || currentUser.country || 'ישראל';
    pool = pool.filter(u => (u.country || 'ישראל') === country);
  } else if (type === 'friends') {
    const reqs = db.friend_requests || [];
    const friendIds = new Set(
      reqs
        .filter(r => r.status === 'accepted' &&
          (r.from_user_id === currentUser.id || r.to_user_id === currentUser.id))
        .map(r => r.from_user_id === currentUser.id ? r.to_user_id : r.from_user_id)
    );
    pool = pool.filter(u => friendIds.has(u.id));
  }

  const requests = db.friend_requests || [];

  function friendStatusFor(targetId) {
    const sent = requests.find(r => r.from_user_id === currentUser.id && r.to_user_id === targetId);
    if (sent) return sent.status === 'accepted' ? 'accepted' : 'pending';
    const received = requests.find(r => r.from_user_id === targetId && r.to_user_id === currentUser.id && r.status === 'accepted');
    if (received) return 'accepted';
    return 'none';
  }

  const entries = [...pool]
    .sort((a, b) => (b.total_points || 0) - (a.total_points || 0))
    .map((u, i) => ({
      id:           `lb-${u.id}`,
      userId:       u.id,
      rank:         i + 1,
      score:        u.total_points || 0,
      user:         { id: u.id, name: u.name, city: u.city ?? null, level: u.level ?? 1 },
      followStatus: friendStatusFor(u.id),
    }));

  res.json({ entries, currentUserId: currentUser.id });
});

// ─── Levels ───────────────────────────────────────────────────────────────────

app.get('/api/levels', (_, res) => {
  const db = readDb();
  res.json({ levels: db.levels.map(serializeLevel) });
});

// ─── Notifications (stub) ─────────────────────────────────────────────────────

app.get('/api/notifications', requireAuth, (_, res) => res.json([]));

// ─── Business Reward Management ───────────────────────────────────────────────
// נתיבים לניהול פרסים על ידי בעל עסק — קריאה/כתיבה מתוך db.json

app.get('/api/business/rewards', requireAuth, (req, res) => {
  const db         = readDb();
  const businessId = req.currentUser.business_id;
  if (!businessId) return res.status(403).json({ detail: 'Not a business user' });
  const rewards = db.rewards
    .filter(r => r.business_id === businessId)
    .map(serializeReward);
  res.json({ rewards });
});

app.post('/api/business/rewards', requireAuth, (req, res) => {
  const db         = readDb();
  const businessId = req.currentUser.business_id;
  if (!businessId) return res.status(403).json({ detail: 'Not a business user' });
  const bizName  = (db.businesses.find(b => b.id === businessId) || {}).name || '';
  const { titleHe, descriptionHe, costPoints, imageIcon, category, stock, isActive, expiresAt } = req.body || {};
  const newReward = {
    id:            `r-${Date.now()}`,
    business_id:   businessId,
    business_name: bizName,
    title:         titleHe,
    description:   descriptionHe,
    cost_points:   Number(costPoints) || 0,
    image_icon:    imageIcon   || 'gift-outline',
    category:      category    || 'other',
    is_active:     isActive    !== undefined ? isActive : true,
    stock:         Number(stock) || 100,
    expiry_date:   expiresAt   || null,
  };
  db.rewards.push(newReward);
  writeDb(db);
  res.status(201).json({ reward: serializeReward(newReward) });
});

app.patch('/api/business/rewards/:id', requireAuth, (req, res) => {
  const db         = readDb();
  const businessId = req.currentUser.business_id;
  const idx = db.rewards.findIndex(r => r.id === req.params.id && r.business_id === businessId);
  if (idx < 0) return res.status(404).json({ detail: 'Reward not found' });
  const r = db.rewards[idx];
  const { titleHe, descriptionHe, costPoints, imageIcon, category, stock, isActive, expiresAt } = req.body || {};
  if (titleHe       !== undefined) r.title        = titleHe;
  if (descriptionHe !== undefined) r.description  = descriptionHe;
  if (costPoints    !== undefined) r.cost_points  = Number(costPoints);
  if (imageIcon     !== undefined) r.image_icon   = imageIcon;
  if (category      !== undefined) r.category     = category;
  if (stock         !== undefined) r.stock        = Number(stock);
  if (isActive      !== undefined) r.is_active    = isActive;
  if (expiresAt     !== undefined) r.expiry_date  = expiresAt;
  writeDb(db);
  res.json({ reward: serializeReward(r) });
});

app.delete('/api/business/rewards/:id', requireAuth, (req, res) => {
  const db         = readDb();
  const businessId = req.currentUser.business_id;
  const idx = db.rewards.findIndex(r => r.id === req.params.id && r.business_id === businessId);
  if (idx < 0) return res.status(404).json({ detail: 'Reward not found' });
  db.rewards.splice(idx, 1);
  writeDb(db);
  res.status(204).send();
});

// ─── Start ────────────────────────────────────────────────────────────────────

const os = require('os');

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

app.listen(PORT, () => {
  const ip = getLocalIP();
  console.log(`\nCARMA Local Server`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${ip}:${PORT}\n`);
  console.log('Demo credentials:');
  console.log('  admin@carma.app      / admin123      (admin)');
  console.log('  daniel@carma.app     / password123   (driver)');
  console.log('  arcaffe@carma.app    / business123   (business — Arcaffe, b1)');
  console.log('  superpharm@carma.app / business123   (business — Super-Pharm, b2)\n');
});
