'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeEdgeCost } = require('../routing/weighting');
const { getProfileConfig } = require('../routing/profiles');

function makeEdge(overrides = {}) {
  return {
    id: 'edge-1',
    length_m: 24,
    ascent_m: 1.0,
    descent_m: 0.5,
    slope_avg_pct: 4.5,
    slope_max_pct: 7.2,
    cross_slope_pct: 2.2,
    width_m: 1.3,
    is_step_free: true,
    is_covered: false,
    lighting_score: 0.4,
    unprotected_crossing: false,
    tactile_paving: false,
    noise_score: 0.2,
    crowd_density_score: 0.2,
    turn_severity: 0.15,
    surface: {
      rolling_resistance_coeff: 1.1,
      slip_risk_wet_coeff: 1.2
    },
    slope_samples: [
      { position_m: 0, slope_pct: 4.2 },
      { position_m: 8, slope_pct: 4.8 },
      { position_m: 16, slope_pct: 4.5 },
      { position_m: 24, slope_pct: 4.1 }
    ],
    ...overrides
  };
}

function reasonByTerm(result, term) {
  return (result.reasons || []).find((reason) => reason.term === term);
}

test('hard constraint rejects edge above hard max slope threshold', () => {
  const manual = getProfileConfig('manual-wheelchair');
  const edge = makeEdge({
    slope_max_pct: manual.maxSlopeHardPct + 1,
    slope_avg_pct: manual.maxSlopeHardPct - 0.5
  });

  const result = computeEdgeCost(edge, manual, {});
  assert.equal(result.hardConstraint, true);
  assert.equal(Number.isFinite(result.cost), false);
  assert.equal(reasonByTerm(result, 'hard_constraint_slope_max')?.hardConstraint, true);
});

test('manual wheelchair cost is higher than default walking on same edge', () => {
  const manual = getProfileConfig('manual-wheelchair');
  const walking = getProfileConfig('default-walking');
  const edge = makeEdge({
    slope_avg_pct: 5.2,
    slope_max_pct: 6.8,
    width_m: 1.4,
    is_step_free: true
  });

  const manualCost = computeEdgeCost(edge, manual, {});
  const walkingCost = computeEdgeCost(edge, walking, {});

  assert.equal(manualCost.hardConstraint, false);
  assert.equal(walkingCost.hardConstraint, false);
  assert.ok(manualCost.cost > walkingCost.cost);
});

test('max slope penalty triggers for short steep burst', () => {
  const walking = getProfileConfig('default-walking');
  const edge = makeEdge({
    length_m: 18,
    slope_avg_pct: 2.4,
    slope_max_pct: 11.5,
    slope_samples: [
      { position_m: 0, slope_pct: 2.0 },
      { position_m: 6, slope_pct: 2.1 },
      { position_m: 8, slope_pct: 11.5 },
      { position_m: 10, slope_pct: 2.2 },
      { position_m: 18, slope_pct: 2.0 }
    ]
  });

  const result = computeEdgeCost(edge, walking, {});
  const maxSlopeReason = reasonByTerm(result, 'slope_max_penalty');
  assert.equal(result.hardConstraint, false);
  assert.ok(maxSlopeReason);
  assert.ok(maxSlopeReason.contribution > 0);
});

test('sustained slope penalty triggers on long moderate incline', () => {
  const manual = getProfileConfig('manual-wheelchair');
  const edge = makeEdge({
    length_m: 42,
    slope_avg_pct: 6.1,
    slope_max_pct: 7.1,
    slope_samples: [
      { position_m: 0, slope_pct: 5.8 },
      { position_m: 7, slope_pct: 6.3 },
      { position_m: 14, slope_pct: 6.1 },
      { position_m: 21, slope_pct: 6.4 },
      { position_m: 28, slope_pct: 5.9 },
      { position_m: 35, slope_pct: 6.2 },
      { position_m: 42, slope_pct: 6.0 }
    ]
  });

  const result = computeEdgeCost(edge, manual, {});
  const sustainedReason = reasonByTerm(result, 'sustained_slope_penalty');
  assert.equal(result.hardConstraint, false);
  assert.ok(sustainedReason);
  assert.ok(sustainedReason.contribution > 0);
});

test('explanation exposes named terms with numeric contributions', () => {
  const profile = getProfileConfig('sensory-sensitive');
  const edge = makeEdge({
    crowd_density_score: 0.9,
    noise_score: 0.85,
    turn_severity: 0.4,
    unprotected_crossing: true,
    tactile_paving: true
  });

  const result = computeEdgeCost(edge, profile, { timeOfDay: 'night' });

  assert.equal(result.hardConstraint, false);
  assert.ok(Array.isArray(result.reasons));
  assert.ok(result.reasons.length >= 4);

  for (const reason of result.reasons) {
    assert.equal(typeof reason.term, 'string');
    assert.equal(typeof reason.contribution, 'number');
    assert.ok(Number.isFinite(reason.contribution));
  }
});
