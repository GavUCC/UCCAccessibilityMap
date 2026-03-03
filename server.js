const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const { execFileSync } = require('child_process');
const { applySqliteMigrations, applyPostgresMigrations } = require('./routing/migrations');
const { createRoutingDataAccess } = require('./routing/data-access');
const { createRoutingService } = require('./routing/service');
const { parseCsv } = require('./routing/csv');

const app = express();
app.disable('x-powered-by');

const GH_PRIMARY_URL = normalizeGhUrl(process.env.GRAPHHOPPER_URL || 'http://127.0.0.1:8989');
const GH_FALLBACK_URLS = String(process.env.GRAPHHOPPER_URL_FALLBACKS || '')
  .split(',')
  .map((value) => normalizeGhUrl(value))
  .filter(Boolean);
const GH_DEFAULT_WSL_DISTRO = String(process.env.GRAPHHOPPER_WSL_DISTRO || 'Ubuntu-24.04').trim();
const GH_PROBE_CACHE_MS = 30000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
let ghLastKnownOnlineUrl = null;
let ghLastProbeAt = 0;
let ghDetectedWslUrl = null;
let ghWslDetectAt = 0;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const CAMPUS_BUILDINGS_PATH = path.join(__dirname, 'public', 'assets', 'buildings.geojson');
const ALLOWED_BARRIER_STATUSES = new Set(['pending', 'in_review', 'resolved']);
const ALLOWED_BARRIER_SEVERITIES = new Set(['low', 'medium', 'high']);
const ALLOWED_ROUTING_PROFILES = new Set(['foot']);
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
]);
const ALLOWED_CSV_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel'
]);
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_CSV_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_BARRIER_TYPE_LENGTH = 160;
const MAX_BARRIER_DESCRIPTION_LENGTH = 1500;
const MAX_BARRIER_IMPACTS_LENGTH = 300;
const MAX_FEEDBACK_NAME_LENGTH = 120;
const MAX_FEEDBACK_COMMENT_LENGTH = 1500;
const MAX_GRADIENT_NOTES_LENGTH = 1000;
const MAX_GRADIENT_COORDINATES = 6000;
const DEFAULT_GRADIENT_SAMPLE_METERS = 5;
const MIN_GRADIENT_SAMPLE_METERS = 3;
const MAX_GRADIENT_SAMPLE_METERS = 10;
const DEFAULT_STEEP_THRESHOLD_PERCENT = 8;
const DEFAULT_SUSTAINED_MIN_METERS = 15;
const MAX_VOICE_TRANSCRIPT_LENGTH = 700;
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
const VOICE_ENHANCE_TIMEOUT_MS = 9000;
const LOCAL_DEM_SAMPLE_URL = String(process.env.LOCAL_DEM_SAMPLE_URL || '').trim();
const LOCAL_DEM_SOURCE_NAME = String(process.env.LOCAL_DEM_SOURCE_NAME || 'Local DEM/LiDAR').trim() || 'Local DEM/LiDAR';
const ALLOW_PRIVATE_NETWORK_ORIGINS = process.env.ALLOW_PRIVATE_NETWORK_ORIGINS === '0'
  ? false
  : !IS_PRODUCTION;
const ADMIN_API_TOKEN = String(process.env.ADMIN_API_TOKEN || '').trim();
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const DEFAULT_ALLOWED_ORIGINS = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];
const adminStreamClients = new Set();
const reverseGeocodeCache = new Map();
const campusBuildingIndex = loadCampusBuildingIndex();
const HOP_BY_HOP_PROXY_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length'
]);
const CORS_ALLOWED_ORIGINS = dedupeStrings([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...(!IS_PRODUCTION ? getLocalDevOrigins() : []),
  ...String(process.env.CORS_ALLOWED_ORIGINS || '').split(',').map((value) => normalizeOrigin(value))
].filter(Boolean));
let pgPool = null;
let routingDataAccess = null;
let routingService = null;
let routingReady = false;

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many requests. Try again shortly.' })
});

const writeApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 80,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many write requests. Try again shortly.' })
});

function dedupeStrings(values = []) {
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

function isPrivateIpv4(hostname) {
  const parts = String(hostname || '').split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((part) => Number(part));
  if (nums.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;

  const [a, b] = nums;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateNetworkOrigin(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    const host = String(url.hostname || '').toLowerCase();
    if (!host) return false;
    if (host === 'localhost' || host === '::1' || host === '[::1]') return true;
    if (isPrivateIpv4(host)) return true;
    if (host.endsWith('.local')) return true;
    return false;
  } catch {
    return false;
  }
}

function getLocalDevOrigins() {
  const origins = [];
  const networkInterfaces = os.networkInterfaces?.() || {};
  for (const values of Object.values(networkInterfaces)) {
    if (!Array.isArray(values)) continue;
    for (const detail of values) {
      const family = detail?.family;
      const isIpv4 = family === 'IPv4' || family === 4;
      if (!isIpv4) continue;
      if (detail.internal) continue;
      const host = String(detail.address || '').trim();
      if (!isPrivateIpv4(host)) continue;
      origins.push(`http://${host}:${PORT}`);
      origins.push(`http://${host}:5173`);
    }
  }
  return dedupeStrings(origins);
}

function originFromReferer(referer) {
  const raw = String(referer || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (CORS_ALLOWED_ORIGINS.includes(normalized)) return true;
  if (ALLOW_PRIVATE_NETWORK_ORIGINS && isPrivateNetworkOrigin(normalized)) return true;
  return false;
}

function corsOriginValidator(origin, callback) {
  if (isAllowedOrigin(origin)) return callback(null, true);
  return callback(new Error('CORS origin denied.'));
}

function requireTrustedOrigin(req, res, next) {
  const origin = String(req.headers.origin || '').trim();
  const refererOrigin = originFromReferer(req.headers.referer);

  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'Untrusted request origin.' });
  }
  if (!origin && refererOrigin && !isAllowedOrigin(refererOrigin)) {
    return res.status(403).json({ error: 'Untrusted request referer.' });
  }
  return next();
}

function secureTokenMatch(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (!left.length || !right.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireAdminToken(req, res, next) {
  if (!ADMIN_API_TOKEN) return next();
  const token = String(req.headers['x-admin-token'] || req.query?.token || '').trim();
  if (!secureTokenMatch(token, ADMIN_API_TOKEN)) {
    return res.status(401).json({ error: 'Admin token required.' });
  }
  return next();
}

function detectImageMimeFromHeader(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    fs.closeSync(fd);
    const chunk = header.subarray(0, bytesRead);

    if (chunk.length >= 3 && chunk[0] === 0xff && chunk[1] === 0xd8 && chunk[2] === 0xff) return 'image/jpeg';
    if (chunk.length >= 8
      && chunk[0] === 0x89
      && chunk[1] === 0x50
      && chunk[2] === 0x4e
      && chunk[3] === 0x47
      && chunk[4] === 0x0d
      && chunk[5] === 0x0a
      && chunk[6] === 0x1a
      && chunk[7] === 0x0a) return 'image/png';
    if (chunk.length >= 6 && chunk.subarray(0, 6).toString('ascii') === 'GIF87a') return 'image/gif';
    if (chunk.length >= 6 && chunk.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
    if (chunk.length >= 12
      && chunk.subarray(0, 4).toString('ascii') === 'RIFF'
      && chunk.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  } catch {}
  return '';
}

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://unpkg.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://www.ucc.ie', 'https://unpkg.com'],
      connectSrc: ["'self'", 'https://router.project-osrm.org', 'https://nominatim.openstreetmap.org'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: corsOriginValidator,
  methods: ['GET', 'POST', 'PUT', 'OPTIONS']
}));
app.use(express.json({ limit: '300kb' }));
app.use(express.urlencoded({ extended: false, limit: '300kb' }));
app.use('/api', apiLimiter);
app.use('/api', (req, res, next) => {
  const method = String(req.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();
  return requireTrustedOrigin(req, res, next);
});
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  return next();
});
app.use('/gh', apiLimiter);

// --- 1. DATABASE INITIALIZATION (SQLite) ---
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Database connection failed:', err.message);
  else console.log('Connected to the SQLite portable database.');
});

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      return resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      return resolve(rows);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      return resolve(row);
    });
  });
}

function routingMigrationDirs() {
  return {
    sqlite: path.join(__dirname, 'db', 'migrations', 'sqlite'),
    postgres: path.join(__dirname, 'db', 'migrations', 'postgres')
  };
}

function ensureRoutingSubsystemReady(req, res, next) {
  if (routingReady && routingDataAccess && routingService) {
    return next();
  }
  return res.status(503).json({ error: 'Routing subsystem not initialized yet.' });
}

async function initializeRoutingSubsystem() {
  const dirs = routingMigrationDirs();

  if (DATABASE_URL) {
    pgPool = new Pool({
      connectionString: DATABASE_URL,
      max: 8,
      idleTimeoutMillis: 10000
    });
    await applyPostgresMigrations(pgPool, dirs.postgres, console);
  } else {
    await applySqliteMigrations(db, dirs.sqlite, console);
  }

  routingDataAccess = createRoutingDataAccess({
    sqliteDb: db,
    pgPool
  });
  await routingDataAccess.ensureSeedData();
  routingService = createRoutingService(routingDataAccess);
  routingReady = true;
}

function ignoreDuplicateColumnError(err) {
  if (!err) return;
  if (!String(err.message || '').includes('duplicate column name')) {
    console.error('Schema migration error:', err.message);
  }
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return null;
}

function cleanText(value, maxLen) {
  const cleaned = String(value || '').trim().replace(/\s+/g, ' ');
  if (!maxLen) return cleaned;
  return cleaned.slice(0, maxLen);
}

function normalizeGradientSampleMeters(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_GRADIENT_SAMPLE_METERS;
  return Math.max(MIN_GRADIENT_SAMPLE_METERS, Math.min(MAX_GRADIENT_SAMPLE_METERS, Math.round(parsed)));
}

function normalizeGradientThresholdPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_STEEP_THRESHOLD_PERCENT;
  return Math.max(1, Math.min(30, parsed));
}

function normalizeGradientMinSustainedMeters(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SUSTAINED_MIN_METERS;
  return Math.max(3, Math.min(150, parsed));
}

function parseGradientCoordinates(rawCoordinates) {
  if (!Array.isArray(rawCoordinates) || rawCoordinates.length < 2) return [];
  const coords = [];
  for (const row of rawCoordinates.slice(0, MAX_GRADIENT_COORDINATES)) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const lng = Number(row[0]);
    const lat = Number(row[1]);
    const elevationRaw = Number(row[2]);
    if (!isValidLatLng(lat, lng)) continue;
    coords.push({
      lat,
      lng,
      elevation: Number.isFinite(elevationRaw) ? elevationRaw : null
    });
  }
  return coords;
}

function buildGradientSamplesFromCoordinates(coords, sampleMeters) {
  if (!Array.isArray(coords) || coords.length < 2) {
    return { samples: [], source: 'none' };
  }

  const hasElevation = coords.some((point) => Number.isFinite(point.elevation));
  const samples = [{
    lat: coords[0].lat,
    lng: coords[0].lng,
    elevation: Number.isFinite(coords[0].elevation) ? coords[0].elevation : null,
    distanceFromStart: 0
  }];

  let cumulative = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const prev = coords[i - 1];
    const next = coords[i];
    const segmentDistance = haversineMeters(prev.lat, prev.lng, next.lat, next.lng);
    if (!Number.isFinite(segmentDistance) || segmentDistance <= 0.3) continue;

    const steps = Math.max(1, Math.ceil(segmentDistance / sampleMeters));
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      const lat = prev.lat + ((next.lat - prev.lat) * ratio);
      const lng = prev.lng + ((next.lng - prev.lng) * ratio);
      let elevation = null;
      if (Number.isFinite(prev.elevation) && Number.isFinite(next.elevation)) {
        elevation = prev.elevation + ((next.elevation - prev.elevation) * ratio);
      } else if (step === steps && Number.isFinite(next.elevation)) {
        elevation = next.elevation;
      } else if (step === 1 && Number.isFinite(prev.elevation)) {
        elevation = prev.elevation;
      }
      cumulative += segmentDistance / steps;
      samples.push({
        lat,
        lng,
        elevation,
        distanceFromStart: cumulative
      });
    }
  }

  return {
    samples,
    source: hasElevation ? 'route-elevation' : 'none'
  };
}

async function fetchLocalDemElevations(samples) {
  if (!LOCAL_DEM_SAMPLE_URL || !Array.isArray(samples) || !samples.length) return null;
  const points = samples.map((sample) => ({ lat: sample.lat, lng: sample.lng }));
  try {
    const attempt = await fetchJsonWithTimeout(LOCAL_DEM_SAMPLE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points })
    }, 12000);

    if (!attempt.response.ok) return null;
    const elevations = Array.isArray(attempt.payload?.elevations) ? attempt.payload.elevations : null;
    if (!elevations || elevations.length !== samples.length) return null;

    const normalized = elevations.map((value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    });
    if (normalized.filter(Number.isFinite).length < 2) return null;
    return normalized;
  } catch {
    return null;
  }
}

function computeGradientProfileFromSamples(samples, options = {}) {
  const sampleMeters = normalizeGradientSampleMeters(options.sampleMeters);
  const thresholdPercent = normalizeGradientThresholdPercent(options.thresholdPercent);
  const minSustainedMeters = normalizeGradientMinSustainedMeters(options.minSustainedMeters);

  const profile = {
    sampleMeters,
    thresholdPercent,
    minSustainedMeters,
    source: String(options.source || 'none'),
    hasElevation: false,
    maxSlopePercent: 0,
    averageSlopePercent: 0,
    steepDistanceMeters: 0,
    sustainedSections: [],
    segments: [],
    pointCount: Array.isArray(samples) ? samples.length : 0
  };
  if (!Array.isArray(samples) || samples.length < 2) return profile;

  let weightedSlopeTotal = 0;
  let weightedDistanceTotal = 0;
  let activeSection = null;

  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const next = samples[i];
    const distance = Number(next.distanceFromStart) - Number(prev.distanceFromStart);
    if (!Number.isFinite(distance) || distance < 0.8) continue;

    if (!Number.isFinite(prev.elevation) || !Number.isFinite(next.elevation)) {
      if (activeSection && activeSection.lengthMeters >= minSustainedMeters) {
        activeSection.averageSlopePercent = activeSection.weightedSlope / activeSection.lengthMeters;
        delete activeSection.weightedSlope;
        profile.sustainedSections.push(activeSection);
      }
      activeSection = null;
      continue;
    }

    profile.hasElevation = true;
    const slopePercent = ((next.elevation - prev.elevation) / distance) * 100;
    const absSlope = Math.abs(slopePercent);
    if (!Number.isFinite(absSlope)) continue;

    const slopeBand = absSlope >= 8 ? 'red' : absSlope >= 5 ? 'amber' : 'green';
    profile.segments.push({
      startLat: prev.lat,
      startLng: prev.lng,
      endLat: next.lat,
      endLng: next.lng,
      startMeters: Number(prev.distanceFromStart),
      endMeters: Number(next.distanceFromStart),
      lengthMeters: distance,
      slopePercent: Number(slopePercent.toFixed(2)),
      absSlopePercent: Number(absSlope.toFixed(2)),
      band: slopeBand
    });

    profile.maxSlopePercent = Math.max(profile.maxSlopePercent, absSlope);
    weightedSlopeTotal += absSlope * distance;
    weightedDistanceTotal += distance;

    if (absSlope >= thresholdPercent) {
      profile.steepDistanceMeters += distance;
      if (!activeSection) {
        activeSection = {
          startMeters: prev.distanceFromStart,
          endMeters: next.distanceFromStart,
          lengthMeters: distance,
          maxSlopePercent: absSlope,
          weightedSlope: absSlope * distance
        };
      } else {
        activeSection.endMeters = next.distanceFromStart;
        activeSection.lengthMeters += distance;
        activeSection.maxSlopePercent = Math.max(activeSection.maxSlopePercent, absSlope);
        activeSection.weightedSlope += absSlope * distance;
      }
    } else if (activeSection) {
      if (activeSection.lengthMeters >= minSustainedMeters) {
        activeSection.averageSlopePercent = activeSection.weightedSlope / activeSection.lengthMeters;
        delete activeSection.weightedSlope;
        profile.sustainedSections.push(activeSection);
      }
      activeSection = null;
    }
  }

  if (activeSection && activeSection.lengthMeters >= minSustainedMeters) {
    activeSection.averageSlopePercent = activeSection.weightedSlope / activeSection.lengthMeters;
    delete activeSection.weightedSlope;
    profile.sustainedSections.push(activeSection);
  }

  profile.averageSlopePercent = weightedDistanceTotal > 0 ? weightedSlopeTotal / weightedDistanceTotal : 0;
  return profile;
}

async function analyzeGradientFromCoordinates(coordinates, options = {}) {
  const sampleMeters = normalizeGradientSampleMeters(options.sampleMeters);
  const thresholdPercent = normalizeGradientThresholdPercent(options.thresholdPercent);
  const minSustainedMeters = normalizeGradientMinSustainedMeters(options.minSustainedMeters);

  const sampleBundle = buildGradientSamplesFromCoordinates(coordinates, sampleMeters);
  const samples = sampleBundle.samples;
  let source = sampleBundle.source;

  const localDemElevations = await fetchLocalDemElevations(samples);
  if (localDemElevations) {
    for (let i = 0; i < samples.length; i += 1) {
      samples[i].elevation = localDemElevations[i];
    }
    source = 'local-dem';
  }

  return computeGradientProfileFromSamples(samples, {
    sampleMeters,
    thresholdPercent,
    minSustainedMeters,
    source
  });
}

function normalizeVoiceConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
}

function cleanVoiceTranscriptHeuristic(value) {
  let text = cleanText(value, MAX_VOICE_TRANSCRIPT_LENGTH);
  if (!text) return '';

  text = text
    .replace(/\b(uh+|um+|erm+|ah+|hmm+)\b/gi, ' ')
    .replace(/\b(you see see|you c c|u c c c)\b/gi, 'UCC')
    .replace(/\b(\w+)(\s+\1\b)+/gi, '$1')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/([,.;!?])(?!\s|$)/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (!/[.!?]$/.test(text)) {
    text = `${text}.`;
  }
  return text;
}

async function enhanceVoiceTranscriptWithOpenAI(transcript, confidence) {
  if (!OPENAI_API_KEY) return '';
  const cleanedTranscript = cleanText(transcript, MAX_VOICE_TRANSCRIPT_LENGTH);
  if (!cleanedTranscript) return '';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VOICE_ENHANCE_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: 'You clean speech-to-text transcripts for accessibility barrier reports. Keep facts unchanged, remove filler words, fix punctuation, and keep plain concise language.'
          },
          {
            role: 'user',
            content: JSON.stringify({
              transcript: cleanedTranscript,
              confidence
            })
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'voice_enhancement',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                enhanced: {
                  type: 'string',
                  maxLength: MAX_VOICE_TRANSCRIPT_LENGTH
                }
              },
              required: ['enhanced']
            }
          }
        }
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (!IS_PRODUCTION) {
        console.warn('OpenAI transcript enhancement failed:', payload?.error?.message || response.statusText);
      }
      return '';
    }

    const content = String(payload?.choices?.[0]?.message?.content || '').trim();
    if (!content) return '';
    const parsed = JSON.parse(content);
    return cleanText(parsed?.enhanced, MAX_VOICE_TRANSCRIPT_LENGTH);
  } catch (error) {
    if (!IS_PRODUCTION && error?.name !== 'AbortError') {
      console.warn('OpenAI transcript enhancement error:', error.message);
    }
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

function isValidLatLng(lat, lng) {
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180;
}

function parseBarrierPayload(body = {}) {
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const type = cleanText(body.type, MAX_BARRIER_TYPE_LENGTH);
  const severity = cleanText(body.severity || 'medium', 20).toLowerCase();
  const description = cleanText(body.description, MAX_BARRIER_DESCRIPTION_LENGTH);
  const impacts = cleanText(body.impacts, MAX_BARRIER_IMPACTS_LENGTH);

  return { lat, lng, type, severity, description, impacts };
}

function validateBarrierPayload(payload) {
  if (!payload.type) return 'Barrier type is required.';
  if (!isValidLatLng(payload.lat, payload.lng)) return 'Valid lat/lng values are required.';
  if (!ALLOWED_BARRIER_SEVERITIES.has(payload.severity)) return 'Severity must be low, medium, or high.';
  return '';
}

function safeRemoveFile(file) {
  if (!file?.path) return;
  fs.unlink(file.path, () => {});
}

function normalizeGhUrl(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return normalized.replace(/\/+$/, '');
}

function parseGraphhopperProfiles(payload) {
  return Array.isArray(payload?.profiles)
    ? payload.profiles.map((p) => p.name || p.profile || p.vehicle).filter(Boolean)
    : [];
}

function dedupeUrls(urls) {
  const unique = [];
  const seen = new Set();
  for (const value of urls) {
    const normalized = normalizeGhUrl(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function detectWslGraphhopperUrl() {
  if (process.platform !== 'win32') return '';
  const cmd = "hostname -I | awk '{print $1}'";
  const attemptArgs = [
    ['-d', GH_DEFAULT_WSL_DISTRO, '--', 'bash', '-lc', cmd],
    ['--', 'bash', '-lc', cmd]
  ];

  for (const args of attemptArgs) {
    try {
      const output = execFileSync('wsl.exe', args, {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const ip = String(output || '').trim().split(/\s+/)[0];
      if (!ip) continue;
      if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) continue;
      return `http://${ip}:8989`;
    } catch {}
  }

  return '';
}

function maybeRefreshWslGraphhopperUrl(force = false) {
  if (process.platform !== 'win32') return '';
  const now = Date.now();
  if (!force && (now - ghWslDetectAt) < 20000) return ghDetectedWslUrl;
  ghWslDetectAt = now;
  ghDetectedWslUrl = detectWslGraphhopperUrl();
  return ghDetectedWslUrl;
}

function getGraphhopperBaseUrls({ refreshWsl = false } = {}) {
  const wslUrl = maybeRefreshWslGraphhopperUrl(refreshWsl);
  return dedupeUrls([
    ghLastKnownOnlineUrl,
    GH_PRIMARY_URL,
    ...GH_FALLBACK_URLS,
    wslUrl
  ]);
}

function recordGraphhopperOnlineUrl(baseUrl) {
  const normalized = normalizeGhUrl(baseUrl);
  if (!normalized) return;
  ghLastKnownOnlineUrl = normalized;
  ghLastProbeAt = Date.now();
}

function formatGraphhopperAttempts(attempts) {
  if (!Array.isArray(attempts) || !attempts.length) return '';
  return attempts
    .map((attempt) => {
      const source = attempt?.source ? `@${attempt.source}` : '@unknown';
      if (attempt?.status) return `${source} HTTP ${attempt.status}${attempt.error ? ` (${attempt.error})` : ''}`;
      if (attempt?.error) return `${source} ${attempt.error}`;
      return source;
    })
    .join(' | ');
}

async function probeGraphhopper(timeoutMs = 6000, forceRefresh = false) {
  const probeTimeout = Math.max(1000, Math.min(timeoutMs, 4000));
  const attempts = [];

  if (!forceRefresh && ghLastKnownOnlineUrl && (Date.now() - ghLastProbeAt) <= GH_PROBE_CACHE_MS) {
    try {
      const cachedAttempt = await fetchJsonWithTimeout(`${ghLastKnownOnlineUrl}/info`, {}, probeTimeout);
      if (cachedAttempt.response.ok) {
        recordGraphhopperOnlineUrl(ghLastKnownOnlineUrl);
        return {
          online: true,
          source: ghLastKnownOnlineUrl,
          version: cachedAttempt.payload.version || null,
          profiles: parseGraphhopperProfiles(cachedAttempt.payload),
          attempts
        };
      }
      attempts.push({
        source: ghLastKnownOnlineUrl,
        status: cachedAttempt.response.status,
        error: cachedAttempt.payload?.message || `GraphHopper returned ${cachedAttempt.response.status}`
      });
    } catch (error) {
      attempts.push({
        source: ghLastKnownOnlineUrl,
        error: error.name === 'AbortError' ? 'timed out' : (error.message || 'fetch failed')
      });
    }
  }

  for (const baseUrl of getGraphhopperBaseUrls({ refreshWsl: true })) {
    if (baseUrl === ghLastKnownOnlineUrl && attempts.some((attempt) => attempt.source === baseUrl)) continue;
    try {
      const probe = await fetchJsonWithTimeout(`${baseUrl}/info`, {}, probeTimeout);
      if (!probe.response.ok) {
        attempts.push({
          source: baseUrl,
          status: probe.response.status,
          error: probe.payload?.message || `GraphHopper returned ${probe.response.status}`
        });
        continue;
      }

      recordGraphhopperOnlineUrl(baseUrl);
      return {
        online: true,
        source: baseUrl,
        version: probe.payload.version || null,
        profiles: parseGraphhopperProfiles(probe.payload),
        attempts
      };
    } catch (error) {
      attempts.push({
        source: baseUrl,
        error: error.name === 'AbortError' ? 'timed out' : (error.message || 'fetch failed')
      });
    }
  }

  return {
    online: false,
    source: ghLastKnownOnlineUrl || GH_PRIMARY_URL,
    error: 'Could not connect to GraphHopper.',
    detail: formatGraphhopperAttempts(attempts),
    attempts
  };
}

function safeSetProxyResponseHeaders(upstreamHeaders, res) {
  for (const [key, value] of upstreamHeaders.entries()) {
    const normalized = String(key || '').toLowerCase();
    if (HOP_BY_HOP_PROXY_HEADERS.has(normalized)) continue;
    if (typeof value === 'string' && value.length) {
      res.setHeader(key, value);
    }
  }
}

function broadcastAdminEvent(type, payload = {}) {
  if (!adminStreamClients.size) return;
  const message = JSON.stringify({
    type,
    at: new Date().toISOString(),
    ...payload
  });

  for (const client of adminStreamClients) {
    try {
      client.write(`data: ${message}\n\n`);
    } catch {}
  }
}

function extractCampusBuildingRings(geometry) {
  const output = [];
  const type = String(geometry?.type || '');
  const coords = geometry?.coordinates;
  if (type === 'Polygon' && Array.isArray(coords)) {
    for (const ring of coords) {
      if (Array.isArray(ring) && ring.length >= 3) output.push(ring);
    }
    return output;
  }
  if (type === 'MultiPolygon' && Array.isArray(coords)) {
    for (const polygon of coords) {
      if (!Array.isArray(polygon)) continue;
      for (const ring of polygon) {
        if (Array.isArray(ring) && ring.length >= 3) output.push(ring);
      }
    }
  }
  return output;
}

function computeRingCenter(ring) {
  if (!Array.isArray(ring) || !ring.length) {
    return { lat: 0, lng: 0 };
  }
  let sumLng = 0;
  let sumLat = 0;
  let count = 0;
  for (const point of ring) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    sumLng += lng;
    sumLat += lat;
    count += 1;
  }
  if (!count) return { lat: 0, lng: 0 };
  return {
    lat: sumLat / count,
    lng: sumLng / count
  };
}

function isPointInRing(lat, lng, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const p1 = ring[i];
    const p2 = ring[j];
    if (!Array.isArray(p1) || !Array.isArray(p2) || p1.length < 2 || p2.length < 2) continue;
    const xi = Number(p1[0]);
    const yi = Number(p1[1]);
    const xj = Number(p2[0]);
    const yj = Number(p2[1]);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;

    const intersects = ((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findCampusBuildingLabel(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !campusBuildingIndex.length) return '';

  for (const building of campusBuildingIndex) {
    if (!Array.isArray(building?.rings) || !building.rings.length) continue;
    for (const ring of building.rings) {
      if (isPointInRing(lat, lng, ring)) {
        return building.name;
      }
    }
  }

  let nearest = null;
  for (const building of campusBuildingIndex) {
    const center = building?.center;
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) continue;
    const distance = haversineMeters(lat, lng, center.lat, center.lng);
    if (!nearest || distance < nearest.distance) {
      nearest = { name: building.name, distance };
    }
  }

  if (!nearest) return '';
  if (nearest.distance <= 120) return `Near ${nearest.name}`;
  if (nearest.distance <= 300) return `${nearest.name} area`;
  return '';
}

function loadCampusBuildingIndex() {
  try {
    const raw = fs.readFileSync(CAMPUS_BUILDINGS_PATH, 'utf8');
    const payload = JSON.parse(raw);
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const output = [];

    for (const feature of features) {
      const name = String(feature?.properties?.name || feature?.properties?.id || '').trim();
      if (!name) continue;
      const rings = extractCampusBuildingRings(feature?.geometry);
      if (!rings.length) continue;
      const center = computeRingCenter(rings[0]);
      output.push({ name, rings, center });
    }

    return output;
  } catch (error) {
    console.warn(`Campus building index load failed: ${error.message}`);
    return [];
  }
}

function normalizePlaceLabel(reversePayload) {
  const name = String(reversePayload?.name || '').trim();
  const displayName = String(reversePayload?.display_name || '').trim();
  const address = reversePayload?.address || {};

  if (name) return name;
  const road = String(address.road || address.pedestrian || address.footway || '').trim();
  const building = String(address.building || address.amenity || address.university || '').trim();
  const suburb = String(address.suburb || address.neighbourhood || address.city_district || '').trim();

  const compact = [building, road, suburb].filter(Boolean).join(', ');
  if (compact) return compact;
  if (displayName) return displayName.split(',').slice(0, 3).join(',').trim();
  return '';
}

// Create tables automatically on startup
const uploadsDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir, {
  index: false,
  etag: true,
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=604800');
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS spatial_barriers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barrier_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    impacts TEXT,
    description TEXT,
    image_path TEXT,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT,
    rating INTEGER NOT NULL,
    comments TEXT,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS route_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_type TEXT NOT NULL,
    user_group TEXT NOT NULL,
    was_useful INTEGER NOT NULL,
    issue_resolved INTEGER NOT NULL,
    route_distance REAL,
    route_time REAL,
    comments TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS route_gradient_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_type TEXT,
    route_distance REAL,
    start_lat REAL,
    start_lng REAL,
    end_lat REAL,
    end_lng REAL,
    sample_meters INTEGER NOT NULL,
    threshold_percent REAL NOT NULL,
    min_sustained_meters REAL NOT NULL,
    source TEXT,
    max_slope_percent REAL,
    average_slope_percent REAL,
    steep_distance_meters REAL,
    sustained_sections_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS gradient_spot_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    measured_slope_percent REAL NOT NULL,
    estimated_max_slope_percent REAL,
    estimated_avg_slope_percent REAL,
    sample_meters INTEGER,
    profile_type TEXT,
    route_distance REAL,
    notes TEXT,
    source TEXT DEFAULT 'inclinometer',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run('ALTER TABLE spatial_barriers ADD COLUMN impacts TEXT', ignoreDuplicateColumnError);
});

// --- 2. IMAGE UPLOAD CONFIGURATION ---
const storageEngine = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(String(file.originalname || '')).toLowerCase();
    const safeExt = ALLOWED_IMAGE_EXTENSIONS.has(ext) ? ext : '.jpg';
    cb(null, `${Date.now()}-${crypto.randomUUID()}${safeExt}`);
  }
});
const uploadManager = multer({
  storage: storageEngine,
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(String(file.mimetype || '').toLowerCase())) {
      return cb(new Error('Only image uploads are allowed.'));
    }
    return cb(null, true);
  }
});

function uploadSinglePhoto(req, res, next) {
  uploadManager.single('photo')(req, res, (err) => {
    if (!err) {
      if (req.file) {
        const detectedMime = detectImageMimeFromHeader(req.file.path);
        if (!detectedMime || !ALLOWED_IMAGE_MIME_TYPES.has(detectedMime)) {
          safeRemoveFile(req.file);
          return res.status(400).json({ error: 'Uploaded photo content is not a supported image format.' });
        }
      }
      return next();
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `Photo is too large. Max ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.` });
      }
      return res.status(400).json({ error: 'Invalid photo upload.' });
    }
    return res.status(400).json({ error: err.message || 'Photo upload failed.' });
  });
}

const csvUploadManager = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_CSV_UPLOAD_BYTES,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    if (!ALLOWED_CSV_MIME_TYPES.has(mime)) {
      return cb(new Error('Only CSV uploads are allowed.'));
    }
    return cb(null, true);
  }
});

function uploadSingleCsv(req, res, next) {
  csvUploadManager.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `CSV is too large. Max ${Math.round(MAX_CSV_UPLOAD_BYTES / (1024 * 1024))}MB.` });
      }
      return res.status(400).json({ error: 'Invalid CSV upload.' });
    }
    return res.status(400).json({ error: err.message || 'CSV upload failed.' });
  });
}

// --- 3. API ROUTES ---

// Submit a new barrier
app.post('/api/barriers', writeApiLimiter, uploadSinglePhoto, async (req, res) => {
  const payload = parseBarrierPayload(req.body);
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;
  const validationError = validateBarrierPayload(payload);
  if (validationError) {
    safeRemoveFile(req.file);
    return res.status(400).json({ error: validationError });
  }

  try {
    const result = await dbRun(
      `INSERT INTO spatial_barriers (barrier_type, severity, impacts, description, image_path, lat, lng)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.type,
        payload.severity,
        payload.impacts,
        payload.description,
        imagePath,
        payload.lat,
        payload.lng
      ]
    );
    broadcastAdminEvent('barrier_created', { id: result.lastID });

    return res.status(201).json({ id: result.lastID, status: 'pending' });
  } catch (error) {
    safeRemoveFile(req.file);
    console.error(error.message);
    return res.status(500).json({ error: 'Failed to save barrier.' });
  }
});

// GraphHopper reverse proxy under same origin, e.g. /gh/info or /gh/route
app.use('/gh', async (req, res) => {
  const upstreamPath = req.url && req.url.startsWith('/') ? req.url : `/${req.url || ''}`;
  const attempts = [];

  const method = String(req.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'POST'].includes(method)) {
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const headers = {
    accept: req.headers.accept || '*/*'
  };
  let body;

  if (!['GET', 'HEAD'].includes(method)) {
    const contentType = String(req.headers['content-type'] || '');
    if (contentType.includes('application/json')) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(req.body || {});
    }
  }

  for (const baseUrl of getGraphhopperBaseUrls({ refreshWsl: true })) {
    const target = `${baseUrl}${upstreamPath}`;
    try {
      const upstream = await fetch(target, {
        method,
        headers,
        body,
        redirect: 'manual'
      });

      recordGraphhopperOnlineUrl(baseUrl);
      safeSetProxyResponseHeaders(upstream.headers, res);
      const buffer = Buffer.from(await upstream.arrayBuffer());
      return res.status(upstream.status).send(buffer);
    } catch (error) {
      attempts.push({
        source: baseUrl,
        target,
        error: error.message || 'fetch failed'
      });
    }
  }

  const payload = { error: 'GraphHopper proxy failed.' };
  if (!IS_PRODUCTION) {
    payload.detail = formatGraphhopperAttempts(attempts);
    payload.attempts = attempts;
  }
  return res.status(502).json(payload);
});

// Fetch barriers for the map
app.get('/api/barriers', async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT id, barrier_type, severity, impacts, description, image_path, lat, lng, status, created_at
       FROM spatial_barriers
       ORDER BY created_at DESC`
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Quick barrier endpoint for offline queue flush (JSON only)
app.post('/api/barriers/quick', writeApiLimiter, async (req, res) => {
  const payload = parseBarrierPayload(req.body);
  const validationError = validateBarrierPayload(payload);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const result = await dbRun(
      `INSERT INTO spatial_barriers (barrier_type, severity, impacts, description, image_path, lat, lng)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.type,
        payload.severity,
        payload.impacts,
        payload.description,
        null,
        payload.lat,
        payload.lng
      ]
    );
    broadcastAdminEvent('barrier_created', { id: result.lastID, quick: true });
    return res.status(201).json({ id: result.lastID, status: 'pending' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/voice/enhance', writeApiLimiter, async (req, res) => {
  const transcript = cleanText(req.body?.transcript, MAX_VOICE_TRANSCRIPT_LENGTH);
  const confidence = normalizeVoiceConfidence(req.body?.confidence);

  if (!transcript || transcript.length < 3) {
    return res.status(400).json({ error: 'Voice transcript is required.' });
  }

  const heuristicText = cleanVoiceTranscriptHeuristic(transcript) || transcript;
  let enhanced = heuristicText;
  let source = 'heuristic';

  const shouldUseAi = Boolean(
    OPENAI_API_KEY
    && (confidence === null || confidence < 0.94 || heuristicText !== transcript)
  );

  if (shouldUseAi) {
    const aiText = await enhanceVoiceTranscriptWithOpenAI(transcript, confidence);
    if (aiText) {
      enhanced = cleanVoiceTranscriptHeuristic(aiText) || aiText;
      source = 'openai';
    }
  }

  return res.json({
    original: transcript,
    enhanced,
    changed: enhanced !== transcript,
    source,
    confidence
  });
});

app.get('/api/gradient/source', (req, res) => {
  const mode = LOCAL_DEM_SAMPLE_URL ? 'local-dem' : 'route-elevation';
  return res.json({
    mode,
    provider: mode === 'local-dem' ? LOCAL_DEM_SOURCE_NAME : 'Route geometry elevation'
  });
});

app.post('/api/gradient/analyze', writeApiLimiter, async (req, res) => {
  const coordinates = parseGradientCoordinates(req.body?.coordinates);
  if (coordinates.length < 2) {
    return res.status(400).json({ error: 'At least two route coordinates are required for gradient analysis.' });
  }

  try {
    const profile = await analyzeGradientFromCoordinates(coordinates, {
      sampleMeters: req.body?.sampleMeters,
      thresholdPercent: req.body?.thresholdPercent,
      minSustainedMeters: req.body?.minSustainedMeters
    });
    return res.json(profile);
  } catch (error) {
    return res.status(500).json({ error: 'Gradient analysis failed.', detail: error.message });
  }
});

app.post('/api/gradient/profiles', writeApiLimiter, async (req, res) => {
  const gradientProfile = req.body?.gradientProfile && typeof req.body.gradientProfile === 'object'
    ? req.body.gradientProfile
    : null;
  if (!gradientProfile) {
    return res.status(400).json({ error: 'gradientProfile payload is required.' });
  }

  const sampleMeters = normalizeGradientSampleMeters(gradientProfile.sampleMeters);
  const thresholdPercent = normalizeGradientThresholdPercent(gradientProfile.thresholdPercent);
  const minSustainedMeters = normalizeGradientMinSustainedMeters(gradientProfile.minSustainedMeters);
  const source = cleanText(gradientProfile.source, 80);
  const maxSlopePercent = Number(gradientProfile.maxSlopePercent);
  const averageSlopePercent = Number(gradientProfile.averageSlopePercent);
  const steepDistanceMeters = Number(gradientProfile.steepDistanceMeters);
  const sustainedSections = Array.isArray(gradientProfile.sustainedSections) ? gradientProfile.sustainedSections : [];

  const startLat = Number(req.body?.startLat);
  const startLng = Number(req.body?.startLng);
  const endLat = Number(req.body?.endLat);
  const endLng = Number(req.body?.endLng);
  const routeDistance = Number(req.body?.routeDistance);
  const profileType = cleanText(req.body?.profileType, 120);

  if (!isValidLatLng(startLat, startLng) || !isValidLatLng(endLat, endLng)) {
    return res.status(400).json({ error: 'Valid route start/end coordinates are required.' });
  }

  let sectionsJson = '[]';
  try {
    sectionsJson = JSON.stringify(sustainedSections.slice(0, 80));
  } catch {
    sectionsJson = '[]';
  }

  try {
    const result = await dbRun(
      `INSERT INTO route_gradient_profiles (
        profile_type, route_distance, start_lat, start_lng, end_lat, end_lng,
        sample_meters, threshold_percent, min_sustained_meters, source,
        max_slope_percent, average_slope_percent, steep_distance_meters, sustained_sections_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        profileType || null,
        Number.isFinite(routeDistance) ? routeDistance : null,
        startLat,
        startLng,
        endLat,
        endLng,
        sampleMeters,
        thresholdPercent,
        minSustainedMeters,
        source || null,
        Number.isFinite(maxSlopePercent) ? maxSlopePercent : null,
        Number.isFinite(averageSlopePercent) ? averageSlopePercent : null,
        Number.isFinite(steepDistanceMeters) ? steepDistanceMeters : null,
        sectionsJson
      ]
    );
    broadcastAdminEvent('gradient_profile_created', { id: result.lastID });
    return res.status(201).json({ id: result.lastID });
  } catch (error) {
    return res.status(500).json({ error: 'Could not save gradient profile.', detail: error.message });
  }
});

app.post('/api/gradient/spot-checks', writeApiLimiter, async (req, res) => {
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const measuredSlopePercent = Number(req.body?.measuredSlopePercent);
  const estimatedMaxSlopePercent = Number(req.body?.estimatedMaxSlopePercent);
  const estimatedAvgSlopePercent = Number(req.body?.estimatedAvgSlopePercent);
  const sampleMeters = Number(req.body?.sampleMeters);
  const profileType = cleanText(req.body?.profileType, 120);
  const routeDistance = Number(req.body?.routeDistance);
  const notes = cleanText(req.body?.notes, MAX_GRADIENT_NOTES_LENGTH);

  if (!isValidLatLng(lat, lng)) {
    return res.status(400).json({ error: 'Valid lat/lng values are required.' });
  }
  if (!Number.isFinite(measuredSlopePercent) || measuredSlopePercent < 0 || measuredSlopePercent > 45) {
    return res.status(400).json({ error: 'measuredSlopePercent must be between 0 and 45.' });
  }

  try {
    const result = await dbRun(
      `INSERT INTO gradient_spot_checks (
        lat, lng, measured_slope_percent, estimated_max_slope_percent, estimated_avg_slope_percent,
        sample_meters, profile_type, route_distance, notes, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lat,
        lng,
        measuredSlopePercent,
        Number.isFinite(estimatedMaxSlopePercent) ? estimatedMaxSlopePercent : null,
        Number.isFinite(estimatedAvgSlopePercent) ? estimatedAvgSlopePercent : null,
        Number.isFinite(sampleMeters) ? Math.round(sampleMeters) : null,
        profileType || null,
        Number.isFinite(routeDistance) ? routeDistance : null,
        notes || null,
        'inclinometer'
      ]
    );
    broadcastAdminEvent('gradient_spot_check_created', { id: result.lastID });
    return res.status(201).json({ id: result.lastID });
  } catch (error) {
    return res.status(500).json({ error: 'Could not save gradient spot check.', detail: error.message });
  }
});

// Update barrier status from admin panel
app.put('/api/barriers/:id/status', writeApiLimiter, requireAdminToken, async (req, res) => {
  const barrierId = Number(req.params.id);
  const nextStatus = String(req.body.status || '').trim();

  if (!Number.isInteger(barrierId) || barrierId <= 0) {
    return res.status(400).json({ error: 'Invalid barrier id.' });
  }

  if (!ALLOWED_BARRIER_STATUSES.has(nextStatus)) {
    return res.status(400).json({ error: 'Invalid status. Use pending, in_review, or resolved.' });
  }

  try {
    const result = await dbRun(
      `UPDATE spatial_barriers SET status = ? WHERE id = ?`,
      [nextStatus, barrierId]
    );

    if (result.changes === 0) return res.status(404).json({ error: 'Barrier not found.' });
    broadcastAdminEvent('barrier_status_updated', { id: barrierId, status: nextStatus });
    return res.json({ id: barrierId, status: nextStatus });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

function almostSameCoord(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return false;
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

function findCoordIndex(coords, target, fromIdx = 0) {
  if (!Array.isArray(coords) || !coords.length || !Array.isArray(target)) return Math.max(0, fromIdx);
  for (let i = Math.max(0, fromIdx); i < coords.length; i += 1) {
    if (almostSameCoord(coords[i], target)) return i;
  }
  return Math.max(0, Math.min(coords.length - 1, fromIdx));
}

function buildOsrmInstructionText(step) {
  const type = String(step?.maneuver?.type || 'continue');
  const modifier = String(step?.maneuver?.modifier || '').trim();
  const road = String(step?.name || '').trim();
  const roadPart = road ? ` on ${road}` : '';

  if (type === 'depart') return `Depart${roadPart}`;
  if (type === 'arrive') return 'Arrive at your destination';
  if (type === 'roundabout') return modifier ? `Enter roundabout and go ${modifier}${roadPart}` : `Enter roundabout${roadPart}`;
  if (type === 'turn' || type === 'end of road' || type === 'fork' || type === 'merge') {
    return modifier ? `Turn ${modifier}${roadPart}` : `Turn${roadPart}`;
  }
  if (type === 'new name' || type === 'continue') return `Continue${roadPart}`;
  return modifier ? `${type} ${modifier}${roadPart}` : `${type}${roadPart}`;
}

function buildOsrmInstructions(route) {
  const fullCoords = Array.isArray(route?.geometry?.coordinates) ? route.geometry.coordinates : [];
  const instructions = [];
  let cursor = 0;

  for (const leg of (route?.legs || [])) {
    for (const step of (leg?.steps || [])) {
      const stepCoords = Array.isArray(step?.geometry?.coordinates) ? step.geometry.coordinates : [];
      if (!stepCoords.length || !fullCoords.length) continue;
      const startIdx = findCoordIndex(fullCoords, stepCoords[0], cursor);
      const endIdx = findCoordIndex(fullCoords, stepCoords[stepCoords.length - 1], startIdx);
      cursor = Math.max(cursor, endIdx);

      instructions.push({
        text: buildOsrmInstructionText(step),
        distance: Number(step.distance) || 0,
        time: Math.round((Number(step.duration) || 0) * 1000),
        interval: [startIdx, endIdx],
        sign: 0
      });
    }
  }

  return instructions;
}

function mapOsrmRouteToPath(route) {
  return {
    distance: Number(route?.distance) || 0,
    time: Math.round((Number(route?.duration) || 0) * 1000),
    points: {
      type: 'LineString',
      coordinates: Array.isArray(route?.geometry?.coordinates) ? route.geometry.coordinates : []
    },
    instructions: buildOsrmInstructions(route)
  };
}

function toRadians(value) {
  return value * Math.PI / 180;
}

function toDegrees(value) {
  return value * 180 / Math.PI;
}

function computeBearingDeg(startLon, startLat, endLon, endLat) {
  const y = Math.sin(toRadians(endLon - startLon)) * Math.cos(toRadians(endLat));
  const x = Math.cos(toRadians(startLat)) * Math.sin(toRadians(endLat))
    - Math.sin(toRadians(startLat)) * Math.cos(toRadians(endLat)) * Math.cos(toRadians(endLon - startLon));
  const bearing = toDegrees(Math.atan2(y, x));
  return ((bearing % 360) + 360) % 360;
}

function offsetLonLat(lat, lon, meters, bearingDeg) {
  const angle = toRadians(bearingDeg);
  const northMeters = Math.cos(angle) * meters;
  const eastMeters = Math.sin(angle) * meters;
  const dLat = northMeters / 111320;
  const cosLat = Math.max(0.2, Math.cos(toRadians(lat)));
  const dLon = eastMeters / (111320 * cosLat);
  return [lon + dLon, lat + dLat];
}

function buildSyntheticViaPoints(routeReq) {
  const midLat = (routeReq.startLat + routeReq.endLat) / 2;
  const midLon = (routeReq.startLon + routeReq.endLon) / 2;
  const heading = computeBearingDeg(routeReq.startLon, routeReq.startLat, routeReq.endLon, routeReq.endLat);
  const headingOptions = [heading + 90, heading - 90, heading + 60, heading - 60];
  const offsetMeters = [35, 70];

  const vias = [];
  for (const meters of offsetMeters) {
    for (const h of headingOptions) {
      vias.push(offsetLonLat(midLat, midLon, meters, h));
    }
  }

  return vias;
}

function buildOsrmRouteUrl(points, withAlternatives) {
  const coords = points.map((p) => `${p[0]},${p[1]}`).join(';');
  const params = new URLSearchParams({
    overview: 'full',
    alternatives: withAlternatives ? 'true' : 'false',
    geometries: 'geojson',
    steps: 'true'
  });
  return `https://router.project-osrm.org/route/v1/foot/${coords}?${params.toString()}`;
}

function routeSignature(route) {
  const coords = Array.isArray(route?.geometry?.coordinates) ? route.geometry.coordinates : [];
  const first = coords[0] || [];
  const mid = coords[Math.floor(coords.length / 2)] || [];
  const last = coords[coords.length - 1] || [];
  const snap = (value, places = 4) => (Number.isFinite(value) ? Number(value.toFixed(places)) : 0);

  const distBucket = Math.round((Number(route?.distance) || 0) / 5) * 5;
  const durationBucket = Math.round((Number(route?.duration) || 0) * 2) / 2;

  return [
    distBucket,
    durationBucket,
    `${snap(first[0])},${snap(first[1])}`,
    `${snap(mid[0])},${snap(mid[1])}`,
    `${snap(last[0])},${snap(last[1])}`
  ].join('|');
}

async function fetchOsrmFallback(routeReq) {
  const basePoints = [
    [routeReq.startLon, routeReq.startLat],
    [routeReq.endLon, routeReq.endLat]
  ];
  const mainAttempt = await fetchJsonWithTimeout(buildOsrmRouteUrl(basePoints, true), {}, 12000);

  if (!mainAttempt.response.ok) {
    throw new Error(`OSRM returned ${mainAttempt.response.status}`);
  }
  if (mainAttempt.payload.code !== 'Ok' || !Array.isArray(mainAttempt.payload.routes) || !mainAttempt.payload.routes.length) {
    throw new Error('OSRM returned no route');
  }

  let rawRoutes = [...mainAttempt.payload.routes];
  const targetCount = Math.max(1, routeReq.alternatives);

  // If OSRM gives only one option, generate extra candidate routes via synthetic midpoint detours.
  if (rawRoutes.length < targetCount) {
    const vias = buildSyntheticViaPoints(routeReq).slice(0, 6);
    const viaAttempts = await Promise.allSettled(
      vias.map((via) => {
        const points = [
          [routeReq.startLon, routeReq.startLat],
          via,
          [routeReq.endLon, routeReq.endLat]
        ];
        return fetchJsonWithTimeout(buildOsrmRouteUrl(points, false), {}, 9000);
      })
    );

    for (const attempt of viaAttempts) {
      if (attempt.status !== 'fulfilled') continue;
      const payload = attempt.value.payload;
      const response = attempt.value.response;
      if (!response.ok || payload?.code !== 'Ok') continue;
      const firstRoute = Array.isArray(payload?.routes) ? payload.routes[0] : null;
      if (firstRoute) rawRoutes.push(firstRoute);
    }
  }

  const uniqueRoutes = [];
  const seen = new Set();
  for (const route of rawRoutes) {
    const sig = routeSignature(route);
    if (seen.has(sig)) continue;
    seen.add(sig);
    uniqueRoutes.push(route);
    if (uniqueRoutes.length >= targetCount) break;
  }

  const shortestDistance = uniqueRoutes.reduce((best, route) => {
    const d = Number(route?.distance);
    if (!Number.isFinite(d) || d <= 0) return best;
    return Math.min(best, d);
  }, Number.POSITIVE_INFINITY);

  const filteredRoutes = uniqueRoutes.filter((route) => {
    const d = Number(route?.distance);
    if (!Number.isFinite(d) || !Number.isFinite(shortestDistance)) return true;
    // Avoid extreme fallback loops that are too long to be useful for campus walking.
    return d <= (shortestDistance * 2.2) && d <= (shortestDistance + 700);
  });

  const paths = (filteredRoutes.length ? filteredRoutes : uniqueRoutes)
    .slice(0, Math.max(1, routeReq.alternatives))
    .map(mapOsrmRouteToPath)
    .filter((p) => Array.isArray(p?.points?.coordinates) && p.points.coordinates.length > 1);

  if (!paths.length) throw new Error('OSRM returned invalid route geometry');

  const plural = paths.length === 1 ? '' : 's';
  return {
    path: paths[0],
    paths,
    hints: { fallback: 'osrm', candidateCount: paths.length },
    source: 'OSRM fallback (GraphHopper offline)',
    warning: `GraphHopper is offline, using fallback walking route${plural} (${paths.length} candidate${plural}).`
  };
}

function parseRouteRequest(req) {
  const src = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const startLat = Number(src.startLat);
  const startLon = Number(src.startLon);
  const endLat = Number(src.endLat);
  const endLon = Number(src.endLon);
  const requestedAlternatives = Number(src.alternatives || 3);
  const profileRaw = cleanText(src.profile, 30).toLowerCase();
  const profile = ALLOWED_ROUTING_PROFILES.has(profileRaw) ? profileRaw : 'foot';
  const alternatives = Number.isFinite(requestedAlternatives)
    ? Math.max(1, Math.min(6, Math.trunc(requestedAlternatives)))
    : 3;
  const instructionsRaw = parseBoolean(src.instructions);
  const elevationRaw = parseBoolean(src.elevation);
  const customModel = src.customModel && typeof src.customModel === 'object'
    ? src.customModel
    : (src.custom_model && typeof src.custom_model === 'object' ? src.custom_model : null);

  return {
    startLat,
    startLon,
    endLat,
    endLon,
    profile,
    alternatives,
    instructions: instructionsRaw === null ? true : instructionsRaw,
    elevation: elevationRaw === null ? true : elevationRaw,
    customModel
  };
}

async function handleRouteRequest(req, res) {
  const routeReq = parseRouteRequest(req);

  if (!isValidLatLng(routeReq.startLat, routeReq.startLon) || !isValidLatLng(routeReq.endLat, routeReq.endLon)) {
    return res.status(400).json({ error: 'Invalid coordinates. Provide startLat/startLon/endLat/endLon.' });
  }

  const buildParams = (withAlternatives) => {
    const params = new URLSearchParams();
    params.append('point', `${routeReq.startLat},${routeReq.startLon}`);
    params.append('point', `${routeReq.endLat},${routeReq.endLon}`);
    params.set('profile', routeReq.profile);
    params.set('points_encoded', 'false');
    params.set('instructions', String(routeReq.instructions));
    params.set('elevation', String(routeReq.elevation));
    params.set('locale', 'en');

    if (withAlternatives) {
      params.set('algorithm', 'alternative_route');
      params.set('alternative_route.max_paths', String(routeReq.alternatives));
    }

    return params;
  };

  const buildPostPayload = (withAlternatives) => {
    const payload = {
      points: [
        [routeReq.startLon, routeReq.startLat],
        [routeReq.endLon, routeReq.endLat]
      ],
      profile: routeReq.profile,
      points_encoded: false,
      instructions: routeReq.instructions,
      elevation: routeReq.elevation,
      locale: 'en'
    };

    if (withAlternatives) {
      payload.algorithm = 'alternative_route';
      payload['alternative_route.max_paths'] = routeReq.alternatives;
    }

    if (routeReq.customModel) {
      payload.custom_model = routeReq.customModel;
    }

    return payload;
  };

  const connectionAttempts = [];
  let graphhopperFailure = null;

  for (const ghBaseUrl of getGraphhopperBaseUrls({ refreshWsl: true })) {
    try {
      let attempt;

      if (req.method === 'POST') {
        const postUrl = routeReq.customModel ? `${ghBaseUrl}/route?ch.disable=true` : `${ghBaseUrl}/route`;
        let body = buildPostPayload(true);
        attempt = await fetchJsonWithTimeout(postUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!attempt.response.ok) {
          body = buildPostPayload(false);
          attempt = await fetchJsonWithTimeout(postUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          if (!attempt.response.ok) {
            graphhopperFailure = {
              source: ghBaseUrl,
              error: attempt.payload?.message || `GraphHopper returned ${attempt.response.status}`,
              status: attempt.response.status
            };
            continue;
          }
        }
      } else {
        attempt = await fetchJsonWithTimeout(`${ghBaseUrl}/route?${buildParams(true).toString()}`);
        if (!attempt.response.ok) {
          attempt = await fetchJsonWithTimeout(`${ghBaseUrl}/route?${buildParams(false).toString()}`);
          if (!attempt.response.ok) {
            graphhopperFailure = {
              source: ghBaseUrl,
              error: attempt.payload?.message || `GraphHopper returned ${attempt.response.status}`,
              status: attempt.response.status
            };
            continue;
          }
        }
      }

      if (!attempt.payload.paths || !attempt.payload.paths.length) {
        graphhopperFailure = {
          source: ghBaseUrl,
          error: 'GraphHopper returned no route.',
          status: 502
        };
        continue;
      }

      recordGraphhopperOnlineUrl(ghBaseUrl);
      return res.json({
        path: attempt.payload.paths[0],
        paths: attempt.payload.paths,
        hints: attempt.payload.hints || {},
        source: ghBaseUrl
      });
    } catch (error) {
      connectionAttempts.push({
        source: ghBaseUrl,
        error: error.name === 'AbortError' ? 'timed out' : (error.message || 'fetch failed')
      });
    }
  }

  try {
    const fallback = await fetchOsrmFallback(routeReq);
    return res.json(fallback);
  } catch {}

  if (graphhopperFailure) {
    const payload = {
      error: graphhopperFailure.error,
      source: graphhopperFailure.source
    };
    if (!IS_PRODUCTION) {
      payload.detail = formatGraphhopperAttempts(connectionAttempts) || undefined;
    }
    return res.status(graphhopperFailure.status === 504 ? 504 : 502).json(payload);
  }

  const allTimedOut = connectionAttempts.length > 0
    && connectionAttempts.every((attempt) => attempt.error === 'timed out');
  const payload = {
    error: allTimedOut ? 'GraphHopper timed out.' : 'Could not connect to GraphHopper.'
  };
  if (!IS_PRODUCTION) {
    payload.detail = formatGraphhopperAttempts(connectionAttempts) || 'No GraphHopper target could be reached.';
    payload.candidates = getGraphhopperBaseUrls({ refreshWsl: false });
  }
  return res.status(allTimedOut ? 504 : 502).json(payload);
}

// Route proxy to local GraphHopper instance
app.get('/api/route', handleRouteRequest);
app.post('/api/route', handleRouteRequest);

app.get('/api/accessibility/profiles', ensureRoutingSubsystemReady, async (req, res) => {
  try {
    const profiles = await routingDataAccess.getProfiles();
    return res.json({
      profiles: profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        description: profile.description
      }))
    });
  } catch (error) {
    return res.status(500).json({ error: 'Could not load accessibility profiles.', detail: error.message });
  }
});

function normalizeEdgeIdsQuery(value) {
  const ids = String(value || '')
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return ids.slice(0, 40);
}

async function handleAccessibilityRoute(req, res) {
  const input = req.method === 'GET'
    ? { ...(req.query || {}) }
    : { ...(req.body || {}) };

  try {
    const result = await routingService.routeWithProfile(input);

    if (result.status === 'ok') {
      return res.json({
        status: 'ok',
        profile: result.profile,
        request: result.request,
        route: result.route
      });
    }

    if (result.status === 'invalid_request') {
      return res.status(400).json({
        status: result.status,
        error: result.error || 'Invalid route request.'
      });
    }

    if (result.status === 'no_path') {
      return res.status(422).json({
        status: result.status,
        error: result.error || 'No viable route for selected profile.'
      });
    }

    return res.status(500).json({
      status: result.status || 'error',
      error: result.error || 'Accessibility route failed.'
    });
  } catch (error) {
    return res.status(500).json({ error: 'Accessibility route failed.', detail: error.message });
  }
}

app.get('/api/accessibility/route', ensureRoutingSubsystemReady, handleAccessibilityRoute);
app.post('/api/accessibility/route', ensureRoutingSubsystemReady, writeApiLimiter, handleAccessibilityRoute);

app.get('/api/accessibility/edges/:edgeId', ensureRoutingSubsystemReady, async (req, res) => {
  const edgeId = String(req.params.edgeId || '').trim();
  if (!edgeId) return res.status(400).json({ error: 'edgeId is required.' });

  try {
    const edge = await routingDataAccess.getEdgeMetadata(edgeId, req.query?.atTime);
    if (!edge) return res.status(404).json({ error: 'Edge not found.' });
    return res.json({ edge });
  } catch (error) {
    return res.status(500).json({ error: 'Could not fetch edge metadata.', detail: error.message });
  }
});

app.get('/api/accessibility/edges', ensureRoutingSubsystemReady, async (req, res) => {
  const ids = normalizeEdgeIdsQuery(req.query?.ids);
  if (!ids.length) {
    return res.status(400).json({ error: 'Provide ids query parameter, e.g. ?ids=e1,e2.' });
  }

  try {
    const rows = await Promise.all(ids.map((edgeId) => routingDataAccess.getEdgeMetadata(edgeId, req.query?.atTime)));
    const found = rows.filter(Boolean);
    const missing = ids.filter((id, index) => !rows[index]);
    return res.json({
      edges: found,
      missing,
      requested: ids.length
    });
  } catch (error) {
    return res.status(500).json({ error: 'Could not fetch edge metadata list.', detail: error.message });
  }
});

app.post(
  '/api/admin/inclinometer-import',
  ensureRoutingSubsystemReady,
  requireAdminToken,
  writeApiLimiter,
  uploadSingleCsv,
  async (req, res) => {
    const csvText = req.file?.buffer
      ? req.file.buffer.toString('utf8')
      : String(req.body?.csv || '');
    if (!csvText.trim()) {
      return res.status(400).json({ error: 'CSV payload is required. Upload a CSV file as form field \"file\".' });
    }

    const rows = parseCsv(csvText);
    if (!rows.length) {
      return res.status(400).json({ error: 'CSV contains no data rows.' });
    }
    if (rows.length > 4000) {
      return res.status(413).json({ error: 'Too many CSV rows. Maximum 4000 per import.' });
    }

    const headerSet = new Set(Object.keys(rows[0] || {}).map((key) => String(key || '').trim().toLowerCase()));
    const requiredHeaders = ['edge_id', 'position_m', 'slope_pct'];
    const missingHeaders = requiredHeaders.filter((header) => !headerSet.has(header));
    if (missingHeaders.length) {
      return res.status(400).json({
        error: `CSV missing required columns: ${missingHeaders.join(', ')}`,
        expectedFormat: 'edge_id,position_m,slope_pct,measured_at_iso,method,notes'
      });
    }

    const normalizedRows = rows.map((row) => ({
      edge_id: row.edge_id,
      position_m: row.position_m,
      slope_pct: row.slope_pct,
      measured_at_iso: row.measured_at_iso || row.measured_at || '',
      method: row.method || 'inclinometer',
      notes: row.notes || ''
    }));

    try {
      const report = await routingDataAccess.importInclinometerSamples(normalizedRows);
      broadcastAdminEvent('inclinometer_import_completed', {
        inserted: report.inserted,
        failed: report.failed
      });
      return res.status(201).json({
        message: 'Inclinometer import completed.',
        ...report
      });
    } catch (error) {
      return res.status(500).json({ error: 'Inclinometer import failed.', detail: error.message });
    }
  }
);

app.get('/api/graphhopper/status', async (req, res) => {
  const refresh = String(req.query.refresh || '').trim().toLowerCase();
  const probe = await probeGraphhopper(6000, refresh === '1' || refresh === 'true' || refresh === 'yes');

  if (probe.online) {
    const payload = {
      online: true,
      source: probe.source,
      version: probe.version || null,
      profiles: probe.profiles || []
    };
    if (!IS_PRODUCTION) {
      payload.candidates = getGraphhopperBaseUrls({ refreshWsl: false });
    }
    return res.json(payload);
  }

  const allTimedOut = probe.attempts?.length
    && probe.attempts.every((attempt) => attempt.error === 'timed out');
  const payload = {
    online: false,
    source: probe.source || GH_PRIMARY_URL,
    error: allTimedOut ? 'GraphHopper status timed out.' : (probe.error || 'Could not connect to GraphHopper.')
  };
  if (!IS_PRODUCTION) {
    payload.detail = probe.detail || formatGraphhopperAttempts(probe.attempts);
    payload.attempts = probe.attempts || [];
    payload.candidates = getGraphhopperBaseUrls({ refreshWsl: false });
  }
  return res.status(allTimedOut ? 504 : 502).json(payload);
});

app.get('/api/admin/stream', requireAdminToken, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify({ type: 'connected', at: new Date().toISOString() })}\n\n`);
  adminStreamClients.add(res);

  const keepAlive = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'ping', at: new Date().toISOString() })}\n\n`);
    } catch {}
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    adminStreamClients.delete(res);
  });
});

app.get('/api/reverse-geocode', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!isValidLatLng(lat, lng)) {
    return res.status(400).json({ error: 'Valid lat and lng are required.' });
  }

  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const campusLabel = findCampusBuildingLabel(lat, lng);
  const cached = reverseGeocodeCache.get(key);
  if (cached && (Date.now() - cached.ts) < 24 * 60 * 60 * 1000) {
    return res.json(cached.value);
  }

  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: String(lat),
      lon: String(lng),
      zoom: '18',
      addressdetails: '1'
    });
    const url = `https://nominatim.openstreetmap.org/reverse?${params.toString()}`;
    const attempt = await fetchJsonWithTimeout(url, {
      headers: {
        'User-Agent': 'UCCAccessPath/1.0 (local dev reverse geocode)',
        'Accept-Language': 'en'
      }
    }, 10000);

    if (!attempt.response.ok) {
      if (campusLabel) {
        const value = {
          label: campusLabel,
          displayName: campusLabel,
          lat,
          lng
        };
        reverseGeocodeCache.set(key, { ts: Date.now(), value });
        return res.json(value);
      }
      return res.status(502).json({ error: `Reverse geocode failed (${attempt.response.status}).` });
    }

    const label = campusLabel || normalizePlaceLabel(attempt.payload) || 'Unknown place';
    const value = {
      label,
      displayName: String(attempt.payload?.display_name || ''),
      lat,
      lng
    };
    reverseGeocodeCache.set(key, { ts: Date.now(), value });
    return res.json(value);
  } catch (error) {
    if (campusLabel) {
      const value = {
        label: campusLabel,
        displayName: campusLabel,
        lat,
        lng
      };
      reverseGeocodeCache.set(key, { ts: Date.now(), value });
      return res.json(value);
    }
    return res.status(502).json({ error: 'Could not resolve location label.', detail: error.message });
  }
});

// Admin data retrieval
app.get('/api/admin/data', requireAdminToken, async (req, res) => {
  try {
    const [barriers, feedback, routeFeedback, spotChecks, gradientProfiles] = await Promise.all([
      dbAll(`SELECT * FROM spatial_barriers ORDER BY created_at DESC`),
      dbAll(`SELECT * FROM user_feedback ORDER BY submitted_at DESC`),
      dbAll(`SELECT * FROM route_feedback ORDER BY created_at DESC LIMIT 200`),
      dbAll(`SELECT * FROM gradient_spot_checks ORDER BY created_at DESC LIMIT 200`),
      dbAll(`SELECT * FROM route_gradient_profiles ORDER BY created_at DESC LIMIT 200`)
    ]);

    return res.json({ barriers, feedback, routeFeedback, spotChecks, gradientProfiles });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Generic user feedback
app.post('/api/feedback', writeApiLimiter, async (req, res) => {
  const name = cleanText(req.body.name, MAX_FEEDBACK_NAME_LENGTH);
  const rating = Number(req.body.rating);
  const comment = cleanText(req.body.comment, MAX_FEEDBACK_COMMENT_LENGTH);

  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
  }

  try {
    await dbRun(
      `INSERT INTO user_feedback (user_name, rating, comments) VALUES (?, ?, ?)`,
      [name || null, rating, comment || null]
    );
    broadcastAdminEvent('feedback_created');

    return res.status(201).json({ message: 'Feedback received.' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Route outcome feedback (used for long-term confidence growth)
app.post('/api/route-feedback', writeApiLimiter, async (req, res) => {
  const profileType = cleanText(req.body.profileType, 120);
  const userGroup = cleanText(req.body.userGroup, 120);
  const wasUseful = parseBoolean(req.body.wasUseful);
  const issueResolved = parseBoolean(req.body.issueResolved);
  const comments = cleanText(req.body.comments, MAX_FEEDBACK_COMMENT_LENGTH);
  const routeDistance = Number(req.body.routeDistance);
  const routeTime = Number(req.body.routeTime);

  if (!profileType) return res.status(400).json({ error: 'profileType is required.' });
  if (!userGroup) return res.status(400).json({ error: 'userGroup is required.' });
  if (wasUseful === null) return res.status(400).json({ error: 'wasUseful must be true/false.' });
  if (issueResolved === null) return res.status(400).json({ error: 'issueResolved must be true/false.' });

  try {
    const result = await dbRun(
      `INSERT INTO route_feedback (
        profile_type, user_group, was_useful, issue_resolved, route_distance, route_time, comments
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        profileType,
        userGroup,
        wasUseful ? 1 : 0,
        issueResolved ? 1 : 0,
        Number.isFinite(routeDistance) ? routeDistance : null,
        Number.isFinite(routeTime) ? routeTime : null,
        comments || null
      ]
    );
    broadcastAdminEvent('route_feedback_created', { id: result.lastID });

    return res.status(201).json({ id: result.lastID, message: 'Route feedback saved.' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Community confidence summary that strengthens as report volume grows
app.get('/api/route-feedback/summary', async (req, res) => {
  const profileType = String(req.query.profileType || '').trim();
  const userGroup = String(req.query.userGroup || '').trim();

  const filters = [];
  const params = [];
  if (profileType) {
    filters.push('profile_type = ?');
    params.push(profileType);
  }
  if (userGroup) {
    filters.push('user_group = ?');
    params.push(userGroup);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  try {
    const aggregate = await dbGet(
      `SELECT
         COUNT(*) AS totalReports,
         AVG(was_useful) AS avgUseful,
         AVG(issue_resolved) AS avgResolved
       FROM route_feedback
       ${whereClause}`,
      params
    );

    const dates = await dbGet(
      `SELECT MIN(created_at) AS firstReportAt, MAX(created_at) AS lastReportAt
       FROM route_feedback
       ${whereClause}`,
      params
    );

    const totalReports = Number(aggregate?.totalReports || 0);
    const usefulRate = Number.isFinite(aggregate?.avgUseful) ? Number(aggregate.avgUseful) : 0;
    const resolvedRate = Number.isFinite(aggregate?.avgResolved) ? Number(aggregate.avgResolved) : 0;

    // Confidence grows as evidence volume grows (log curve prevents runaway confidence).
    const baseScore = (resolvedRate * 0.65 + usefulRate * 0.35) * 100;
    const evidenceFactor = Math.min(1, Math.log10(totalReports + 1) / 2.3);
    const communityConfidence = Math.round(50 + (baseScore - 50) * evidenceFactor);

    return res.json({
      profileType: profileType || null,
      userGroup: userGroup || null,
      totalReports,
      usefulRate: Math.round(usefulRate * 100),
      resolvedRate: Math.round(resolvedRate * 100),
      evidenceFactor: Number(evidenceFactor.toFixed(3)),
      communityConfidence: totalReports > 0 ? communityConfidence : 50,
      firstReportAt: dates?.firstReportAt || null,
      lastReportAt: dates?.lastReportAt || null
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.use((err, req, res, next) => {
  if (!err) return next();
  if (String(err.message || '') === 'CORS origin denied.') {
    return res.status(403).json({ error: 'CORS origin denied.' });
  }
  console.error('Unhandled server error:', err.message || err);
  return res.status(500).json({ error: 'Unexpected server error.' });
});

async function startServer() {
  try {
    await initializeRoutingSubsystem();
  } catch (error) {
    console.error('Routing subsystem initialization failed:', error.message);
    process.exitCode = 1;
    return;
  }

  app.listen(PORT, HOST, () => {
    console.log('\nSUCCESS: UCC AccessPath Backend is running!');
    console.log(`Maps to: http://localhost:${PORT}`);
    const interfaces = os.networkInterfaces();
    const lanIps = [];
    for (const entries of Object.values(interfaces)) {
      for (const entry of (entries || [])) {
        if (entry.family === 'IPv4' && !entry.internal) lanIps.push(entry.address);
      }
    }
    if (lanIps.length) {
      console.log(`LAN URLs: ${lanIps.map((ip) => `http://${ip}:${PORT}`).join(', ')}`);
    }
    console.log('');
    console.log(`GraphHopper proxy candidates: ${getGraphhopperBaseUrls({ refreshWsl: true }).join(', ')}`);
    if (routingReady) {
      console.log(`Accessibility routing backend: ${DATABASE_URL ? 'Postgres' : 'SQLite'} ready`);
    }
  });
}

async function shutdown() {
  if (pgPool) {
    try {
      await pgPool.end();
    } catch {}
  }
}

process.on('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});

void startServer();
