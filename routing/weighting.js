'use strict';

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSamples(edge) {
  const list = Array.isArray(edge?.slope_samples) ? edge.slope_samples : [];
  return list
    .map((sample) => ({
      position_m: safeNumber(sample.position_m, NaN),
      slope_pct: safeNumber(sample.slope_pct, NaN),
      elevation_m: Number.isFinite(Number(sample.elevation_m)) ? Number(sample.elevation_m) : null
    }))
    .filter((sample) => Number.isFinite(sample.position_m) && Number.isFinite(sample.slope_pct))
    .sort((a, b) => a.position_m - b.position_m);
}

function sustainedSlopeStats(edge, softThresholdPct) {
  const edgeLength = Math.max(0, safeNumber(edge?.length_m));
  const threshold = Math.max(0, safeNumber(softThresholdPct));
  const samples = normalizeSamples(edge);

  if (samples.length < 2) {
    const avgSlope = Math.abs(safeNumber(edge?.slope_avg_pct));
    if (edgeLength > 0 && avgSlope >= threshold) {
      return {
        totalSustainedMeters: edgeLength,
        longestSustainedMeters: edgeLength,
        dominantSlopePct: avgSlope
      };
    }
    return {
      totalSustainedMeters: 0,
      longestSustainedMeters: 0,
      dominantSlopePct: 0
    };
  }

  let total = 0;
  let longest = 0;
  let streak = 0;
  let dominantSlope = 0;

  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const next = samples[i];
    const span = Math.max(0, next.position_m - prev.position_m);
    if (span <= 0) continue;

    const absPrev = Math.abs(prev.slope_pct);
    const absNext = Math.abs(next.slope_pct);
    const meanAbs = (absPrev + absNext) / 2;

    if (absPrev >= threshold && absNext >= threshold) {
      total += span;
      streak += span;
      dominantSlope = Math.max(dominantSlope, meanAbs);
      if (streak > longest) longest = streak;
    } else {
      streak = 0;
    }
  }

  return {
    totalSustainedMeters: total,
    longestSustainedMeters: longest,
    dominantSlopePct: dominantSlope
  };
}

function edgeStatusFromContext(context) {
  if (!context) return { status: 'open', penaltyMultiplier: 1, reasons: [] };
  if (context.edgeStatus && typeof context.edgeStatus === 'object') {
    return {
      status: context.edgeStatus.status || 'open',
      penaltyMultiplier: safeNumber(context.edgeStatus.penaltyMultiplier, 1),
      reasons: Array.isArray(context.edgeStatus.reasons) ? context.edgeStatus.reasons : []
    };
  }
  return { status: 'open', penaltyMultiplier: 1, reasons: [] };
}

function normalizeSurface(surface) {
  if (!surface || typeof surface !== 'object') {
    return {
      rolling_resistance_coeff: 1,
      slip_risk_wet_coeff: 1
    };
  }
  return {
    rolling_resistance_coeff: Math.max(0.5, safeNumber(surface.rolling_resistance_coeff, 1)),
    slip_risk_wet_coeff: Math.max(0.5, safeNumber(surface.slip_risk_wet_coeff, 1))
  };
}

function makeReason(term, contribution, detail, hardConstraint = false) {
  return {
    term,
    contribution: Number(contribution.toFixed(4)),
    detail: String(detail || ''),
    hardConstraint
  };
}

function computeEdgeCost(edge, profile, context = {}) {
  const reasons = [];
  const p = profile || {};
  const length = Math.max(0.1, safeNumber(edge.length_m, 1));
  const slopeAvg = Math.abs(safeNumber(edge.slope_avg_pct));
  const slopeMax = Math.abs(safeNumber(edge.slope_max_pct));
  const crossSlope = Math.abs(safeNumber(edge.cross_slope_pct, 0));
  const width = Number.isFinite(Number(edge.width_m)) ? Number(edge.width_m) : null;
  const isStepFree = Boolean(edge.is_step_free);
  const reversed = Boolean(context.reversed);

  const edgeStatus = edgeStatusFromContext(context);
  if (edgeStatus.status === 'blocked_hard') {
    return {
      cost: Number.POSITIVE_INFINITY,
      hardConstraint: true,
      reasons: [makeReason('hard_constraint_obstacle', Number.POSITIVE_INFINITY, edgeStatus.reasons.join('; ') || 'Edge hard-blocked by active obstacle.', true)]
    };
  }

  if (Boolean(p.stepFreeRequired) && !isStepFree) {
    return {
      cost: Number.POSITIVE_INFINITY,
      hardConstraint: true,
      reasons: [makeReason('hard_constraint_step_free', Number.POSITIVE_INFINITY, 'Profile requires step-free edge.', true)]
    };
  }

  if (slopeMax > safeNumber(p.maxSlopeHardPct, Number.POSITIVE_INFINITY)) {
    return {
      cost: Number.POSITIVE_INFINITY,
      hardConstraint: true,
      reasons: [makeReason('hard_constraint_slope_max', Number.POSITIVE_INFINITY, `Edge max slope ${slopeMax.toFixed(2)}% exceeds hard threshold ${safeNumber(p.maxSlopeHardPct, 0).toFixed(2)}%.`, true)]
    };
  }

  if (width !== null && width < safeNumber(p.widthMinM, 0)) {
    return {
      cost: Number.POSITIVE_INFINITY,
      hardConstraint: true,
      reasons: [makeReason('hard_constraint_width', Number.POSITIVE_INFINITY, `Edge width ${width.toFixed(2)}m below required minimum ${safeNumber(p.widthMinM, 0).toFixed(2)}m.`, true)]
    };
  }

  let cost = 0;

  const baseDistance = length;
  cost += baseDistance;
  reasons.push(makeReason('base_distance', baseDistance, `${length.toFixed(1)}m base traversal distance.`));

  const slopeSoft = safeNumber(p.maxSlopeSoftPct, 0);
  const slopeExcess = Math.max(0, slopeAvg - slopeSoft);
  const slopePenalty = slopeExcess * safeNumber(p.slopeWeight, 0) * (length / 10);
  if (slopePenalty > 0) {
    cost += slopePenalty;
    reasons.push(makeReason('slope_avg_penalty', slopePenalty, `Average slope ${slopeAvg.toFixed(2)}% exceeds soft threshold ${slopeSoft.toFixed(2)}%.`));
  }

  const maxSlopeExcess = Math.max(0, slopeMax - slopeSoft);
  const maxSlopePenalty = maxSlopeExcess * safeNumber(p.maxSlopeWeight, 0) * (length / 12);
  if (maxSlopePenalty > 0) {
    cost += maxSlopePenalty;
    reasons.push(makeReason('slope_max_penalty', maxSlopePenalty, `Max slope ${slopeMax.toFixed(2)}% contributes acute effort penalty.`));
  }

  const sustained = sustainedSlopeStats(edge, slopeSoft);
  const sustainedRatio = length > 0 ? sustained.totalSustainedMeters / length : 0;
  const sustainedPenalty = safeNumber(p.sustainedSlopeWeight, 0)
    * sustainedRatio
    * Math.max(0, sustained.dominantSlopePct - slopeSoft)
    * (length / 8);
  if (sustainedPenalty > 0) {
    cost += sustainedPenalty;
    reasons.push(makeReason(
      'sustained_slope_penalty',
      sustainedPenalty,
      `Sustained slope across ${sustained.totalSustainedMeters.toFixed(1)}m (longest ${sustained.longestSustainedMeters.toFixed(1)}m).`
    ));
  }

  const crossSlopePenalty = Math.max(0, crossSlope - 1.5) * safeNumber(p.crossSlopeWeight, 0) * (length / 20);
  if (crossSlopePenalty > 0) {
    cost += crossSlopePenalty;
    reasons.push(makeReason('cross_slope_penalty', crossSlopePenalty, `Cross slope ${crossSlope.toFixed(2)}% affects stability.`));
  }

  const surface = normalizeSurface(edge.surface || {});
  const rollingPenalty = Math.max(0, surface.rolling_resistance_coeff - 1)
    * safeNumber(p.rollingResistanceWeight, 0)
    * length;
  if (rollingPenalty > 0) {
    cost += rollingPenalty;
    reasons.push(makeReason('surface_rolling_penalty', rollingPenalty, `Surface rolling coefficient ${surface.rolling_resistance_coeff.toFixed(2)}.`));
  }

  const weatherWet = String(context?.weather || '').toLowerCase() === 'wet' || context?.isWet === true;
  const slipCoeff = weatherWet ? surface.slip_risk_wet_coeff : 1;
  const slipPenalty = Math.max(0, slipCoeff - 1) * safeNumber(p.slipRiskWeight, 0) * length;
  if (slipPenalty > 0) {
    cost += slipPenalty;
    reasons.push(makeReason('slip_risk_penalty', slipPenalty, weatherWet ? 'Wet-condition slip risk penalty.' : 'Surface slip coefficient penalty.'));
  }

  if (width !== null && width < safeNumber(p.widthMinM, 0) + 0.35) {
    const deficit = Math.max(0, safeNumber(p.widthMinM, 0) - width);
    const widthPenalty = safeNumber(p.widthPenaltyWeight, 0) * Math.max(0.1, deficit + (deficit === 0 ? 0.15 : 0)) * length;
    if (widthPenalty > 0) {
      cost += widthPenalty;
      reasons.push(makeReason('width_penalty', widthPenalty, `Edge width ${width.toFixed(2)}m near/below preferred width.`));
    }
  }

  const isNight = String(context?.timeOfDay || '').toLowerCase() === 'night';
  const lighting = safeNumber(edge.lighting_score, 0.5);
  if (isNight && lighting < safeNumber(p.lightingMinScore, 0)) {
    const lightPenalty = (safeNumber(p.lightingMinScore, 0) - lighting)
      * safeNumber(p.lightingPenaltyWeight, 0)
      * length;
    if (lightPenalty > 0) {
      cost += lightPenalty;
      reasons.push(makeReason('lighting_penalty', lightPenalty, `Night routing with low lighting score ${lighting.toFixed(2)}.`));
    }
  }

  if (!Boolean(edge.is_covered)) {
    const exposurePenalty = safeNumber(p.exposurePenaltyWeight, 0) * (length / 10);
    if (exposurePenalty > 0) {
      cost += exposurePenalty;
      reasons.push(makeReason('exposure_penalty', exposurePenalty, 'Open exposure segment.'));
    }
  }

  if (Boolean(edge.unprotected_crossing)) {
    const crossingPenalty = safeNumber(p.crossingPenaltyWeight, 0) * 10;
    if (crossingPenalty > 0) {
      cost += crossingPenalty;
      reasons.push(makeReason('crossing_penalty', crossingPenalty, 'Unprotected crossing risk.'));
    }
  }

  if (Boolean(edge.tactile_paving)) {
    const tactileBonus = safeNumber(p.tactileBonusWeight, 0) * 4;
    if (tactileBonus > 0) {
      const applied = Math.min(cost * 0.2, tactileBonus);
      cost -= applied;
      reasons.push(makeReason('tactile_bonus', -applied, 'Tactile paving support bonus.'));
    }
  }

  const crowdPenalty = safeNumber(edge.crowd_density_score, 0) * safeNumber(p.crowdPenaltyWeight, 0) * 5;
  if (crowdPenalty > 0) {
    cost += crowdPenalty;
    reasons.push(makeReason('crowd_penalty', crowdPenalty, `Crowd score ${safeNumber(edge.crowd_density_score, 0).toFixed(2)}.`));
  }

  const noisePenalty = safeNumber(edge.noise_score, 0) * safeNumber(p.noisePenaltyWeight, 0) * 5;
  if (noisePenalty > 0) {
    cost += noisePenalty;
    reasons.push(makeReason('noise_penalty', noisePenalty, `Noise score ${safeNumber(edge.noise_score, 0).toFixed(2)}.`));
  }

  const turnPenalty = safeNumber(edge.turn_severity, 0) * safeNumber(p.turnPenaltyWeight, 0) * 8;
  if (turnPenalty > 0) {
    cost += turnPenalty;
    reasons.push(makeReason('turn_penalty', turnPenalty, `Turn severity ${safeNumber(edge.turn_severity, 0).toFixed(2)}.`));
  }

  const descentWeight = safeNumber(p.descentWeight, 0);
  if (descentWeight > 0) {
    const traversalDescent = reversed ? safeNumber(edge.ascent_m, 0) : safeNumber(edge.descent_m, 0);
    const descentPenalty = traversalDescent * descentWeight;
    if (descentPenalty > 0) {
      cost += descentPenalty;
      reasons.push(makeReason('descent_penalty', descentPenalty, `Descent ${traversalDescent.toFixed(2)}m affects profile.`));
    }
  }

  if (edgeStatus.status === 'open_with_penalty' && edgeStatus.penaltyMultiplier > 1) {
    const obstaclePenalty = cost * (edgeStatus.penaltyMultiplier - 1);
    cost += obstaclePenalty;
    reasons.push(makeReason(
      'obstacle_soft_penalty',
      obstaclePenalty,
      edgeStatus.reasons.join('; ') || `Soft obstacle multiplier x${edgeStatus.penaltyMultiplier.toFixed(2)}.`
    ));
  }

  return {
    cost: clamp(cost, 0, Number.MAX_SAFE_INTEGER),
    hardConstraint: false,
    reasons
  };
}

module.exports = {
  computeEdgeCost,
  sustainedSlopeStats
};
