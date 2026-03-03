'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const seedGraph = require('../fixtures/seed-routing-graph.json');
const { findAccessibleRoute } = require('../routing/routing');
const { getProfileConfig } = require('../routing/profiles');

test('default profile returns viable route with explanation', () => {
  const profile = getProfileConfig('default-walking');
  const result = findAccessibleRoute({
    graph: seedGraph,
    profile,
    obstacles: [],
    context: {
      atTime: new Date().toISOString(),
      timeOfDay: 'day',
      weather: 'dry'
    },
    originNodeId: 'n1',
    destNodeId: 'n3'
  });

  assert.equal(result.status, 'ok');
  assert.ok(result.route);
  assert.ok(result.route.edges.length > 0);
  assert.ok(result.route.total_length_m > 0);
  assert.ok(Array.isArray(result.route.explanation.top_reasons));
  assert.ok(result.route.explanation.top_reasons.length > 0);
});

test('manual wheelchair can return no_path when all alternatives violate hard constraints', () => {
  const profile = getProfileConfig('manual-wheelchair');
  const result = findAccessibleRoute({
    graph: seedGraph,
    profile,
    obstacles: [],
    context: {
      atTime: new Date().toISOString(),
      timeOfDay: 'day',
      weather: 'dry'
    },
    originNodeId: 'n1',
    destNodeId: 'n3'
  });

  assert.equal(result.status, 'no_path');
  assert.ok(String(result.error || '').includes('No viable route'));
});
