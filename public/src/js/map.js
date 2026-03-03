'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const UCC_CENTER = [51.893, -8.492];
  const NEAR_BARRIER_METERS = 20;
  const GRAPHOPPER_STATUS_REFRESH_MS = 30000;
  const DEFAULT_GRADIENT_SAMPLE_METERS = 5;
  const MIN_GRADIENT_SAMPLE_METERS = 3;
  const MAX_GRADIENT_SAMPLE_METERS = 10;
  const DEFAULT_STEEP_THRESHOLD_PERCENT = 8;
  const DEFAULT_SUSTAINED_MIN_METERS = 15;
  const MAX_GRADIENT_SECTIONS_UI = 5;
  const IS_COARSE_POINTER = window.matchMedia('(pointer: coarse)').matches;
  const VOICE_MOBILE_SILENCE_MS = 3000;
  const GRADIENT_HEAT_COLORS = {
    green: '#2e7d32',
    amber: '#ef6c00',
    red: '#c62828'
  };
  const GRADIENT_HEAT_WEIGHT = IS_COARSE_POINTER ? 8 : 7;
  const ADMIN_TOKEN_STORAGE_KEY = 'accesspath_admin_token';
  const ACCESSIBILITY_TEXT_MODE_STORAGE_KEY = 'accesspath_text_mode';
  const ACCESSIBILITY_CONTRAST_MODE_STORAGE_KEY = 'accesspath_contrast_mode';
  const ACCESSIBILITY_PROFILE_STORAGE_KEY = 'accesspath_profile_v2';
  const APP_INTRO_STORAGE_KEY = 'accesspath_intro_seen_v1';
  const DEFAULT_POINT_LABEL = 'Pinned campus location';
  const LOCATION_RESOLVING_LABEL = 'Locating place...';
  const QUICK_TAG_TEXT = {
    'Broken Lift': 'Lift unavailable',
    'Missing Ramp': 'Ramp inaccessible',
    'Severe Crowding': 'Severe crowding',
    Construction: 'Construction blockage',
    'Uneven Surface': 'Unsafe surface',
    'Unsafe Crossing': 'Unsafe crossing'
  };
  const QUICK_TAG_HINTS = {
    'Broken Lift': 'Tap Lift, then tap map where a lift or elevator is unavailable.',
    'Missing Ramp': 'Tap Ramp, then tap map where a ramp is blocked, missing, or unusable.',
    'Severe Crowding': 'Tap Crowd, then tap map where density or queues block safe access.',
    Construction: 'Tap Works, then tap map where temporary barriers block step-free access.',
    'Uneven Surface': 'Tap Surface, then tap map for uneven, broken, or slippery ground.',
    'Unsafe Crossing': 'Tap Crossing, then tap map for unsafe crossings, kerbs, or tactile paving issues.'
  };
  const QUICK_TAG_SEVERITY = {
    'Broken Lift': 'high',
    'Missing Ramp': 'high',
    'Severe Crowding': 'medium',
    Construction: 'high',
    'Uneven Surface': 'medium',
    'Unsafe Crossing': 'high'
  };
  const VOICE_CATEGORY_KEYWORDS = [
    { keywords: ['lift', 'elevator'], category: 'Broken Lift' },
    { keywords: ['ramp', 'step', 'stairs', 'stair'], category: 'Missing Ramp' },
    { keywords: ['crowd', 'crowded', 'queue', 'busy'], category: 'Severe Crowding' },
    { keywords: ['construction', 'works', 'barrier', 'blocked', 'closed'], category: 'Construction' },
    { keywords: ['surface', 'slippery', 'uneven', 'cobble', 'trip'], category: 'Uneven Surface' },
    { keywords: ['crossing', 'kerb', 'curb', 'tactile', 'crosswalk'], category: 'Unsafe Crossing' }
  ];
  const VOICE_IMPACT_KEYWORDS = [
    { keywords: ['wheelchair'], impact: 'wheelchair' },
    { keywords: ['blind', 'vision', 'visually'], impact: 'visually_impaired' },
    { keywords: ['crutch', 'injury', 'pain'], impact: 'temporary_injury' },
    { keywords: ['mobility', 'physical'], impact: 'physical_impairment' }
  ];
  const HIGH_SEVERITY_VOICE_KEYWORDS = ['urgent', 'emergency', 'danger', 'unsafe', 'blocked', 'cannot pass'];
  const MAP_POINT_ACTION = IS_COARSE_POINTER ? 'Tap map to set' : 'Click map to set';
  const MAP_POINT_VERB = MAP_POINT_ACTION.startsWith('Tap') ? 'Tap' : 'Click';
  const MAP_POINT_ACTION_SENTENCE = IS_COARSE_POINTER
    ? 'Tap map once for start, twice for destination. Tap again to reset start.'
    : 'Click map once for start, twice for destination. Click again to reset start.';

  const els = {
    controlPanel: document.getElementById('controlPanel'),
    panelToggleBtn: document.getElementById('panelToggleBtn'),
    panelSnapBtn: document.getElementById('panelSnapBtn'),
    map: document.getElementById('map'),
    brandLogo: document.getElementById('brandLogo'),
    profileSelect: document.getElementById('profileSelect'),
    startCoords: document.getElementById('startCoords'),
    endCoords: document.getElementById('endCoords'),
    startPoint: document.getElementById('startPoint'),
    endPoint: document.getElementById('endPoint'),
    reportBtn: document.getElementById('reportBtn'),
    voiceReportBtn: document.getElementById('voiceReportBtn'),
    voiceHelp: document.getElementById('voiceHelp'),
    routeBtn: document.getElementById('routeBtn'),
    clearBtn: document.getElementById('clearBtn'),
    statusMessage: document.getElementById('statusMessage'),
    routeInfo: document.getElementById('routeInfo'),
    fastestRouteSummary: document.getElementById('fastestRouteSummary'),
    accessibleRouteSummary: document.getElementById('accessibleRouteSummary'),
    routeDelta: document.getElementById('routeDelta'),
    routeConfidence: document.getElementById('routeConfidence'),
    gradientHeatLegend: document.getElementById('gradientHeatLegend'),
    routeSelectionNote: document.getElementById('routeSelectionNote'),
    routeDetailsPanel: document.getElementById('routeDetailsPanel'),
    detailDistance: document.getElementById('detailDistance'),
    detailAscent: document.getElementById('detailAscent'),
    detailMaxSlope: document.getElementById('detailMaxSlope'),
    detailConfidence: document.getElementById('detailConfidence'),
    routeReasonList: document.getElementById('routeReasonList'),
    communityConfidenceCard: document.getElementById('communityConfidenceCard'),
    communityConfidenceBadge: document.getElementById('communityConfidenceBadge'),
    communityConfidenceScore: document.getElementById('communityConfidenceScore'),
    communityConfidenceBar: document.getElementById('communityConfidenceBar'),
    communityConfidenceReports: document.getElementById('communityConfidenceReports'),
    communityConfidenceRates: document.getElementById('communityConfidenceRates'),
    communityConfidenceMessage: document.getElementById('communityConfidenceMessage'),
    gradientDetailPanel: document.getElementById('gradientDetailPanel'),
    gradientSampleSelect: document.getElementById('gradientSampleSelect'),
    gradientMaxSlope: document.getElementById('gradientMaxSlope'),
    gradientAvgSlope: document.getElementById('gradientAvgSlope'),
    gradientSteepDistance: document.getElementById('gradientSteepDistance'),
    gradientSustainedCount: document.getElementById('gradientSustainedCount'),
    gradientSourceNote: document.getElementById('gradientSourceNote'),
    gradientSectionList: document.getElementById('gradientSectionList'),
    gradientSpotCheckForm: document.getElementById('gradientSpotCheckForm'),
    spotSlopeInput: document.getElementById('spotSlopeInput'),
    spotCheckNotes: document.getElementById('spotCheckNotes'),
    spotCheckSaveBtn: document.getElementById('spotCheckSaveBtn'),
    spotCheckStatus: document.getElementById('spotCheckStatus'),
    postRouteFeedback: document.getElementById('postRouteFeedback'),
    routeFeedbackForm: document.getElementById('routeFeedbackForm'),
    routeFeedbackStatus: document.getElementById('routeFeedbackStatus'),
    temporalModeHint: document.getElementById('temporalModeHint'),
    routingEngineHint: document.getElementById('routingEngineHint'),
    comprehensiveReportModal: document.getElementById('comprehensiveReportModal'),
    closeReportModal: document.getElementById('closeReportModal'),
    reportCoordinateDisplay: document.getElementById('reportCoordinateDisplay'),
    evidenceForm: document.getElementById('evidenceForm'),
    barrierDescription: document.getElementById('barrierDescription'),
    barrierPhoto: document.getElementById('barrierPhoto'),
    submitEvidenceBtn: document.getElementById('submitEvidenceBtn'),
    adminToggleBtn: document.getElementById('adminToggleBtn'),
    adminFloatingBtn: document.getElementById('adminFloatingBtn'),
    adminCloseBtn: document.getElementById('adminCloseBtn'),
    uiBackdrop: document.getElementById('uiBackdrop'),
    adminSidebar: document.getElementById('adminSidebar'),
    toggleTextModeBtn: document.getElementById('toggleTextModeBtn'),
    toggleContrastModeBtn: document.getElementById('toggleContrastModeBtn'),
    adminDataContainer: document.getElementById('adminDataContainer'),
    adminLiveStatus: document.getElementById('adminLiveStatus'),
    quickTagDock: document.getElementById('quickTagDock'),
    quickTagFeedback: document.getElementById('quickTagFeedback'),
    screenReaderNarrative: document.getElementById('screenReaderNarrative'),
    screenReaderAlert: document.getElementById('screenReaderAlert')
  };

  if (!els.map) {
    return;
  }

  const map = L.map('map', { zoomControl: false }).setView(UCC_CENTER, 17);
  map.getContainer().setAttribute('tabindex', '0');
  map.getContainer().setAttribute(
    'aria-label',
    IS_COARSE_POINTER
      ? 'Campus map. Tap once for start, twice for destination, or use report tools to place barriers.'
      : 'Campus map. Click once for start, twice for destination, or use report tools to place barriers.'
  );
  L.control.zoom({ position: 'topright' }).addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  const startIcon = L.divIcon({
    className: 'start-marker',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  const endIcon = L.divIcon({
    className: 'end-marker',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  const layers = {
    barriers: L.layerGroup().addTo(map),
    gradientHeat: L.layerGroup().addTo(map),
    fastestRoute: null,
    accessibleRoute: null
  };

  const state = {
    startPoint: null,
    endPoint: null,
    startLabel: '',
    endLabel: '',
    startMarker: null,
    endMarker: null,
    reportMode: false,
    reportCoordinate: null,
    reportLabel: '',
    barriers: [],
    latestRoute: null,
    latestAccessibilityRoute: null,
    latestGradientProfile: null,
    latestGradientProfileSignature: '',
    gradientSampleMeters: DEFAULT_GRADIENT_SAMPLE_METERS,
    gradientSourceMode: '',
    adminStream: null,
    adminStreamToken: '',
    adminRefreshTimer: null,
    quickTagPendingType: '',
    lastQuickTagTouchAt: 0,
    quickTagFeedbackTimer: null,
    voiceRecognition: null,
    voiceListening: false,
    voiceDraftText: '',
    voiceInterimText: '',
    voiceConfidenceScores: [],
    voiceCapturePoint: null,
    voiceSilenceTimer: null,
    voiceDetectedSpeech: false,
    startLabelRequestId: 0,
    endLabelRequestId: 0,
    reportLabelRequestId: 0,
    locationLabelCache: new Map(),
    voiceCaptureMarker: null,
    graphhopperTimer: null,
    lastFocusedElement: null,
    adminLastFocusedElement: null,
    mobileQuery: null,
    setMobilePanelOpen: null
  };

  function normalizeSeverity(value) {
    const text = String(value || '').toLowerCase();
    if (text === 'high') return 'high';
    if (text === 'low') return 'low';
    return 'medium';
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return '-';
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  }

  function formatDurationFromMs(ms) {
    if (!Number.isFinite(ms)) return '-';
    const minutes = Math.max(1, Math.round(ms / 60000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `${hours}h ${remainder}m`;
  }

  function routeSummaryForNarration(path) {
    if (!path) return 'not available';
    return `${formatDistance(path.distance)} in ${formatDurationFromMs(path.time)}`;
  }

  function toSafePercent(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(100, Math.round(parsed)));
  }

  function getConfidenceTier(score) {
    const safeScore = toSafePercent(score);
    if (safeScore >= 85) return { key: 'strong', label: 'Strong' };
    if (safeScore >= 70) return { key: 'stable', label: 'Stable' };
    return { key: 'emerging', label: 'Emerging' };
  }

  function getConfidenceNarrative(totalReports, tierKey) {
    const reports = Number.isFinite(totalReports) ? Math.max(0, Math.round(totalReports)) : 0;
    if (reports < 5) {
      return 'Early-stage confidence: more route outcomes will quickly improve reliability.';
    }
    if (tierKey === 'strong') {
      return 'High confidence: sustained user confirmations indicate reliable accessibility guidance.';
    }
    if (tierKey === 'stable') {
      return 'Growing confidence: community feedback is steadily strengthening route trustworthiness.';
    }
    return 'Confidence is building. Continue submitting route outcomes to accelerate calibration.';
  }

  function renderCommunityConfidence(summary = {}) {
    if (!els.communityConfidenceCard) return;

    const totalReports = Number(summary.totalReports || 0);
    const usefulRate = toSafePercent(summary.usefulRate);
    const resolvedRate = toSafePercent(summary.resolvedRate);
    const confidence = toSafePercent(summary.communityConfidence);
    const evidenceFactor = Number(summary.evidenceFactor);
    const evidenceText = Number.isFinite(evidenceFactor)
      ? `${Math.round(Math.max(0, Math.min(1, evidenceFactor)) * 100)}% evidence maturity`
      : 'Evidence maturity unavailable';
    const tier = getConfidenceTier(confidence);

    els.communityConfidenceCard.dataset.tier = tier.key;

    if (els.communityConfidenceBadge) {
      els.communityConfidenceBadge.dataset.tier = tier.key;
      els.communityConfidenceBadge.textContent = tier.label;
    }
    if (els.communityConfidenceScore) {
      els.communityConfidenceScore.textContent = String(confidence);
    }
    if (els.communityConfidenceBar) {
      els.communityConfidenceBar.style.width = `${confidence}%`;
    }
    if (els.communityConfidenceReports) {
      const reportLabel = totalReports === 1 ? 'report' : 'reports';
      els.communityConfidenceReports.textContent = `${totalReports} ${reportLabel}`;
    }
    if (els.communityConfidenceRates) {
      els.communityConfidenceRates.textContent = `Useful ${usefulRate}% • Resolved ${resolvedRate}%`;
    }
    if (els.communityConfidenceMessage) {
      const message = getConfidenceNarrative(totalReports, tier.key);
      els.communityConfidenceMessage.textContent = `${message} ${evidenceText}.`;
    }
  }

  async function loadCommunityConfidenceSummary(filters = {}) {
    const params = new URLSearchParams();
    const profileType = String(filters.profileType || '').trim();
    const userGroup = String(filters.userGroup || '').trim();
    if (profileType) params.set('profileType', profileType);
    if (userGroup) params.set('userGroup', userGroup);
    const query = params.toString();

    try {
      const response = await fetch(`/api/route-feedback/summary${query ? `?${query}` : ''}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Confidence summary failed (${response.status}).`);
      }
      renderCommunityConfidence(payload);
    } catch {
      renderCommunityConfidence({
        totalReports: 0,
        usefulRate: 0,
        resolvedRate: 0,
        communityConfidence: 50
      });
    }
  }

  function showStartupGuidance() {
    const intro = `AccessPath maps accessible campus routes and barrier reports. ${MAP_POINT_ACTION_SENTENCE} Voice on mobile auto-saves after 3 seconds of silence.`;
    showStatus(intro, 'loading');
    setNarration(intro);
    setTimeout(() => {
      clearStatus();
    }, 9000);
    try {
      window.localStorage.setItem(APP_INTRO_STORAGE_KEY, '1');
    } catch {}
  }

  const FALLBACK_PROFILE_OPTIONS = [
    { id: 'default-walking', name: 'Default walking' },
    { id: 'manual-wheelchair', name: 'Manual wheelchair' },
    { id: 'powered-wheelchair', name: 'Powered wheelchair' },
    { id: 'mobility-scooter', name: 'Mobility scooter' },
    { id: 'crutches', name: 'Crutches' },
    { id: 'blind-low-vision', name: 'Blind or low vision' },
    { id: 'sensory-sensitive', name: 'Sensory sensitive' }
  ];

  function readStoredProfileId() {
    try {
      return String(window.localStorage.getItem(ACCESSIBILITY_PROFILE_STORAGE_KEY) || '').trim().toLowerCase();
    } catch {
      return '';
    }
  }

  function writeStoredProfileId(profileId) {
    const value = String(profileId || '').trim().toLowerCase();
    if (!value) return;
    try {
      window.localStorage.setItem(ACCESSIBILITY_PROFILE_STORAGE_KEY, value);
    } catch {}
  }

  function setSelectedProfile(profileId) {
    if (!els.profileSelect) return;
    const target = String(profileId || '').trim().toLowerCase();
    if (!target) return;
    const options = Array.from(els.profileSelect.options || []);
    const hasOption = options.some((option) => String(option.value || '').trim().toLowerCase() === target);
    if (!hasOption) return;
    els.profileSelect.value = target;
  }

  function populateProfileSelect(profiles) {
    if (!els.profileSelect) return;
    const options = Array.isArray(profiles) && profiles.length ? profiles : FALLBACK_PROFILE_OPTIONS;

    els.profileSelect.innerHTML = '';
    for (const profile of options) {
      const id = String(profile.id || '').trim().toLowerCase();
      if (!id) continue;
      const option = document.createElement('option');
      option.value = id;
      option.textContent = String(profile.name || id);
      els.profileSelect.appendChild(option);
    }

    const stored = readStoredProfileId();
    if (stored) {
      setSelectedProfile(stored);
      return;
    }
    setSelectedProfile('default-walking');
  }

  async function loadAccessibilityProfiles() {
    try {
      const response = await fetch('/api/accessibility/profiles');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Profile load failed (${response.status}).`);
      const profiles = Array.isArray(payload?.profiles) ? payload.profiles : [];
      populateProfileSelect(profiles);
      return;
    } catch {
      populateProfileSelect(FALLBACK_PROFILE_OPTIONS);
    }
  }

  function setNarration(message, priority = 'polite') {
    const text = String(message || '').trim();
    if (!text) return;
    const target = priority === 'assertive'
      ? (els.screenReaderAlert || els.screenReaderNarrative)
      : els.screenReaderNarrative;
    if (!target) return;
    target.textContent = '';
    setTimeout(() => {
      target.textContent = text;
    }, 24);
  }

  function showStatus(message, type = 'loading') {
    if (!els.statusMessage) return;
    els.statusMessage.textContent = message;
    els.statusMessage.className = `status-message ${type}`;
  }

  function clearStatus() {
    if (!els.statusMessage) return;
    els.statusMessage.textContent = '';
    els.statusMessage.className = 'status-message';
  }

  function resetRouteInfo() {
    if (els.fastestRouteSummary) els.fastestRouteSummary.textContent = '-';
    if (els.accessibleRouteSummary) els.accessibleRouteSummary.textContent = '-';
    if (els.routeDelta) els.routeDelta.textContent = '-';
    if (els.routeConfidence) {
      els.routeConfidence.textContent = '-';
      els.routeConfidence.style.color = '#2196f3';
    }
    if (els.routeSelectionNote) els.routeSelectionNote.textContent = '';
    if (els.routeDetailsPanel) els.routeDetailsPanel.hidden = true;
    if (els.detailDistance) els.detailDistance.textContent = 'Distance: -';
    if (els.detailAscent) els.detailAscent.textContent = 'Ascent: -';
    if (els.detailMaxSlope) els.detailMaxSlope.textContent = 'Max slope: -';
    if (els.detailConfidence) els.detailConfidence.textContent = 'Confidence: -';
    if (els.routeReasonList) els.routeReasonList.innerHTML = '';
    if (els.routeInfo) els.routeInfo.classList.remove('visible');
    if (els.gradientDetailPanel) els.gradientDetailPanel.hidden = true;
    if (els.gradientMaxSlope) els.gradientMaxSlope.textContent = '-';
    if (els.gradientAvgSlope) els.gradientAvgSlope.textContent = '-';
    if (els.gradientSteepDistance) els.gradientSteepDistance.textContent = '-';
    if (els.gradientSustainedCount) els.gradientSustainedCount.textContent = '-';
    if (els.gradientSourceNote) els.gradientSourceNote.textContent = '';
    if (els.gradientSectionList) els.gradientSectionList.innerHTML = '';
    if (els.gradientHeatLegend) els.gradientHeatLegend.hidden = true;
    if (els.spotCheckStatus) {
      els.spotCheckStatus.textContent = '';
      els.spotCheckStatus.style.color = '';
    }
    if (els.postRouteFeedback) els.postRouteFeedback.hidden = true;
    if (els.routeFeedbackStatus) {
      els.routeFeedbackStatus.textContent = '';
      els.routeFeedbackStatus.style.color = '';
    }
    state.latestRoute = null;
    state.latestAccessibilityRoute = null;
    state.latestGradientProfile = null;
    state.latestGradientProfileSignature = '';
  }

  function setRouteInfoVisible() {
    if (els.routeInfo) {
      els.routeInfo.classList.add('visible');
    }
  }

  function setGradientHeatLegendVisible(visible) {
    if (!els.gradientHeatLegend) return;
    els.gradientHeatLegend.hidden = !visible;
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) return '-';
    return `${value.toFixed(1)}%`;
  }

  function formatShortMeters(value) {
    if (!Number.isFinite(value)) return '-';
    if (value >= 1000) return `${(value / 1000).toFixed(2)} km`;
    return `${Math.round(value)} m`;
  }

  function formatSteepSection(section) {
    const start = formatShortMeters(section.startMeters);
    const end = formatShortMeters(section.endMeters);
    const length = formatShortMeters(section.lengthMeters);
    const maxSlope = formatPercent(section.maxSlopePercent);
    const avgSlope = formatPercent(section.averageSlopePercent);
    return `${start} to ${end} • ${length} • max ${maxSlope} • avg ${avgSlope}`;
  }

  function normalizeGradientBand(value, absSlopePercent) {
    const text = String(value || '').trim().toLowerCase();
    if (text === 'green' || text === 'amber' || text === 'red') return text;
    const slope = Number(absSlopePercent);
    if (!Number.isFinite(slope)) return 'green';
    if (slope >= 8) return 'red';
    if (slope >= 5) return 'amber';
    return 'green';
  }

  function renderGradientDetails(profile) {
    if (!els.gradientDetailPanel) return;
    if (!profile) {
      els.gradientDetailPanel.hidden = true;
      return;
    }

    els.gradientDetailPanel.hidden = false;
    if (els.gradientMaxSlope) {
      els.gradientMaxSlope.textContent = profile.hasElevation ? formatPercent(profile.maxSlopePercent) : '-';
    }
    if (els.gradientAvgSlope) {
      els.gradientAvgSlope.textContent = profile.hasElevation ? formatPercent(profile.averageSlopePercent) : '-';
    }
    if (els.gradientSteepDistance) {
      els.gradientSteepDistance.textContent = profile.hasElevation ? formatShortMeters(profile.steepDistanceMeters) : '-';
    }
    if (els.gradientSustainedCount) {
      els.gradientSustainedCount.textContent = String(profile.sustainedSections.length);
    }

    if (els.gradientSourceNote) {
      if (profile.source === 'route-elevation') {
        els.gradientSourceNote.textContent = `Using route elevation data sampled every ${profile.sampleMeters} m. Sustained steep is >=${profile.thresholdPercent}% for >=${Math.round(profile.minSustainedMeters)} m.`;
      } else if (profile.source === 'local-dem') {
        els.gradientSourceNote.textContent = `Using high-resolution local DEM/LiDAR samples every ${profile.sampleMeters} m. Sustained steep is >=${profile.thresholdPercent}% for >=${Math.round(profile.minSustainedMeters)} m.`;
      } else {
        els.gradientSourceNote.textContent = 'No elevation source available for gradient profiling on this route.';
      }
    }

    if (els.gradientSectionList) {
      els.gradientSectionList.innerHTML = '';
      if (!profile.sustainedSections.length) {
        const empty = document.createElement('li');
        empty.textContent = 'No sustained steep sections detected for this route.';
        els.gradientSectionList.appendChild(empty);
      } else {
        profile.sustainedSections.slice(0, MAX_GRADIENT_SECTIONS_UI).forEach((section, index) => {
          const item = document.createElement('li');
          item.textContent = `Section ${index + 1}: ${formatSteepSection(section)}`;
          els.gradientSectionList.appendChild(item);
        });
      }
    }
  }

  function clearRouteLayers() {
    if (layers.fastestRoute) {
      map.removeLayer(layers.fastestRoute);
      layers.fastestRoute = null;
    }
    if (layers.accessibleRoute) {
      map.removeLayer(layers.accessibleRoute);
      layers.accessibleRoute = null;
    }
    if (layers.gradientHeat) {
      layers.gradientHeat.clearLayers();
    }
    setGradientHeatLegendVisible(false);
  }

  function clearVoiceCaptureMarker() {
    if (state.voiceCaptureMarker) {
      map.removeLayer(state.voiceCaptureMarker);
      state.voiceCaptureMarker = null;
    }
  }

  function showVoiceCaptureMarker(latlng, transcript) {
    clearVoiceCaptureMarker();
    const snippet = String(transcript || '').trim();
    const shortSnippet = snippet.length > 120 ? `${snippet.slice(0, 117)}...` : snippet;
    state.voiceCaptureMarker = L.circleMarker([latlng.lat, latlng.lng], {
      radius: 9,
      color: '#0d47a1',
      fillColor: '#1e88e5',
      fillOpacity: 0.85,
      weight: 3
    }).addTo(map);
    state.voiceCaptureMarker.bindPopup(
      `<strong>Voice report captured</strong>${shortSnippet ? `<br>${escapeHtml(shortSnippet)}` : ''}`
    );
    state.voiceCaptureMarker.openPopup();
  }

  function flashQuickTagCaptureMarker(latlng, message, type = 'success') {
    if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return;
    const isError = type === 'error';
    const marker = L.circleMarker([latlng.lat, latlng.lng], {
      radius: 8,
      color: isError ? '#b71c1c' : '#1b5e20',
      fillColor: isError ? '#e53935' : '#43a047',
      fillOpacity: 0.92,
      weight: 3
    }).addTo(map);
    marker.bindPopup(`<strong>${escapeHtml(message)}</strong>`);
    marker.openPopup();
    setTimeout(() => {
      if (map.hasLayer(marker)) {
        map.removeLayer(marker);
      }
    }, isError ? 4200 : 2800);
  }

  function clearQuickTagPlacement() {
    state.quickTagPendingType = '';
    setQuickTagButtonSelection('');
    map.getContainer().style.cursor = '';
  }

  function getQuickTagButtons() {
    return Array.from(document.querySelectorAll('.quick-tag-btn[data-hazard-type]'));
  }

  function setQuickTagButtonSelection(hazardType) {
    const selected = String(hazardType || '').trim();
    for (const button of getQuickTagButtons()) {
      const isSelected = String(button.dataset.hazardType || '') === selected;
      button.classList.toggle('is-selected', isSelected);
      button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    }
  }

  function hideQuickTagFeedback() {
    if (state.quickTagFeedbackTimer) {
      clearTimeout(state.quickTagFeedbackTimer);
      state.quickTagFeedbackTimer = null;
    }
    if (!els.quickTagFeedback) return;
    els.quickTagFeedback.hidden = true;
    els.quickTagFeedback.textContent = '';
    els.quickTagFeedback.className = 'quick-tag-feedback';
  }

  function showQuickTagFeedback(message, type = 'info', timeoutMs = 2800) {
    if (state.quickTagFeedbackTimer) {
      clearTimeout(state.quickTagFeedbackTimer);
      state.quickTagFeedbackTimer = null;
    }
    if (!els.quickTagFeedback) return;
    els.quickTagFeedback.hidden = false;
    els.quickTagFeedback.textContent = String(message || '').trim();
    els.quickTagFeedback.className = `quick-tag-feedback is-visible ${type}`;
    if (timeoutMs > 0) {
      state.quickTagFeedbackTimer = setTimeout(() => {
        hideQuickTagFeedback();
      }, timeoutMs);
    }
  }

  function setUiBackdropVisible(visible) {
    if (!els.uiBackdrop) return;
    const show = Boolean(visible) && document.body.classList.contains('mobile-layout');
    els.uiBackdrop.hidden = !show;
    els.uiBackdrop.setAttribute('aria-hidden', show ? 'false' : 'true');
    document.body.classList.toggle('admin-open', show);
  }

  function updateViewportCssVars() {
    const viewport = window.visualViewport;
    const width = Math.max(320, Number(viewport?.width || window.innerWidth || 320));
    const height = Math.max(320, Number(viewport?.height || window.innerHeight || 320));
    document.documentElement.style.setProperty('--app-vw', `${(width * 0.01).toFixed(4)}px`);
    document.documentElement.style.setProperty('--app-vh', `${(height * 0.01).toFixed(4)}px`);
  }

  function wireViewportMetrics() {
    let resizeTimer = null;
    const refresh = () => {
      updateViewportCssVars();
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }
      resizeTimer = setTimeout(() => {
        map.invalidateSize();
      }, 120);
    };

    refresh();
    window.addEventListener('resize', refresh, { passive: true });
    window.addEventListener('orientationchange', refresh);

    const viewport = window.visualViewport;
    if (viewport) {
      viewport.addEventListener('resize', refresh);
      viewport.addEventListener('scroll', refresh);
    }
  }

  function collapseMobilePanelForMapFocus() {
    if (typeof state.setMobilePanelOpen === 'function') {
      state.setMobilePanelOpen(false, false);
      return;
    }
    if (!els.controlPanel || !els.panelToggleBtn) return;
    if (!document.body.classList.contains('mobile-layout')) return;
    if (!els.controlPanel.classList.contains('mobile-open')) return;

    els.controlPanel.classList.remove('mobile-open');
    document.body.classList.remove('mobile-panel-open');
    els.panelToggleBtn.textContent = 'Controls';
    els.panelToggleBtn.setAttribute('aria-expanded', 'false');
    setTimeout(() => {
      map.invalidateSize();
    }, 260);
  }

  function beginQuickTagPlacement(hazardType) {
    clearQuickTagPlacement();
    state.reportMode = false;
    const hazardLabel = QUICK_TAG_TEXT[hazardType] || hazardType;
    state.quickTagPendingType = hazardType;
    setQuickTagButtonSelection(hazardType);
    map.getContainer().style.cursor = 'crosshair';
    collapseMobilePanelForMapFocus();
    showQuickTagFeedback(`${hazardLabel} selected. ${MAP_POINT_VERB} map to place report.`, 'info', 3400);
    showStatus(`${MAP_POINT_VERB} map to place quick report: ${hazardLabel}.`, 'loading');
    setNarration(`Quick report placement enabled for ${hazardLabel}. ${MAP_POINT_VERB} the map to place this barrier.`);
  }

  function updatePointUI() {
    if (els.startCoords) {
      els.startCoords.textContent = state.startPoint
        ? (state.startLabel || LOCATION_RESOLVING_LABEL)
        : MAP_POINT_ACTION;
    }

    if (els.endCoords) {
      els.endCoords.textContent = state.endPoint
        ? (state.endLabel || LOCATION_RESOLVING_LABEL)
        : MAP_POINT_ACTION;
    }

    if (els.startPoint) {
      els.startPoint.classList.toggle('active', !state.startPoint);
    }

    if (els.endPoint) {
      els.endPoint.classList.toggle('active', !!state.startPoint && !state.endPoint);
    }

    if (els.routeBtn) {
      els.routeBtn.disabled = !(state.startPoint && state.endPoint);
    }
  }

  function ensureMarker(role, latlng) {
    const isStart = role === 'start';
    const markerKey = isStart ? 'startMarker' : 'endMarker';
    const icon = isStart ? startIcon : endIcon;

    if (state[markerKey]) {
      map.removeLayer(state[markerKey]);
    }

    state[markerKey] = L.marker(latlng, { icon }).addTo(map);
    state[markerKey].bindPopup(isStart ? 'Start point' : 'End point');
  }

  function clearPointMarkers() {
    if (state.startMarker) {
      map.removeLayer(state.startMarker);
      state.startMarker = null;
    }
    if (state.endMarker) {
      map.removeLayer(state.endMarker);
      state.endMarker = null;
    }
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function toRadians(value) {
    return value * (Math.PI / 180);
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2))
      * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function toLatLngs(path) {
    const coords = Array.isArray(path?.points?.coordinates) ? path.points.coordinates : [];
    return coords
      .filter((coord) => Array.isArray(coord) && coord.length >= 2)
      .map((coord) => [coord[1], coord[0]]);
  }

  function coordPairClose(left, right, tolerance = 0.00003) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length < 2 || right.length < 2) return false;
    return Math.abs(Number(left[0]) - Number(right[0])) <= tolerance
      && Math.abs(Number(left[1]) - Number(right[1])) <= tolerance;
  }

  function arePathsMostlySame(pathA, pathB) {
    const coordsA = Array.isArray(pathA?.points?.coordinates) ? pathA.points.coordinates : [];
    const coordsB = Array.isArray(pathB?.points?.coordinates) ? pathB.points.coordinates : [];
    if (coordsA.length < 2 || coordsB.length < 2) return false;

    const distanceDelta = Math.abs(Number(pathA?.distance || 0) - Number(pathB?.distance || 0));
    const timeDelta = Math.abs(Number(pathA?.time || 0) - Number(pathB?.time || 0));
    if (distanceDelta > 5 || timeDelta > 3000) return false;

    const firstMatch = coordPairClose(coordsA[0], coordsB[0]);
    const lastMatch = coordPairClose(coordsA[coordsA.length - 1], coordsB[coordsB.length - 1]);
    const midA = coordsA[Math.floor(coordsA.length / 2)];
    const midB = coordsB[Math.floor(coordsB.length / 2)];
    const middleMatch = coordPairClose(midA, midB, 0.00005);
    return firstMatch && lastMatch && middleMatch;
  }

  function normalizeSampleMeters(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_GRADIENT_SAMPLE_METERS;
    return Math.max(MIN_GRADIENT_SAMPLE_METERS, Math.min(MAX_GRADIENT_SAMPLE_METERS, Math.round(parsed)));
  }

  function normalizeThresholdPercent(value, fallback = DEFAULT_STEEP_THRESHOLD_PERCENT) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(30, parsed));
  }

  function normalizeSustainedLengthMeters(value, fallback = DEFAULT_SUSTAINED_MIN_METERS) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(3, Math.min(150, parsed));
  }

  function normalizeRoutePoints(path) {
    const coords = Array.isArray(path?.points?.coordinates) ? path.points.coordinates : [];
    return coords
      .filter((coord) => Array.isArray(coord) && coord.length >= 2)
      .map((coord) => {
        const lng = Number(coord[0]);
        const lat = Number(coord[1]);
        const elevationRaw = Number(coord[2]);
        const elevation = Number.isFinite(elevationRaw) ? elevationRaw : null;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { lat, lng, elevation };
      })
      .filter(Boolean);
  }

  function buildGradientSamples(path, sampleMetersInput) {
    const points = normalizeRoutePoints(path);
    if (points.length < 2) return { samples: [], source: 'none' };

    const sampleMeters = normalizeSampleMeters(sampleMetersInput);
    const hasAnyElevation = points.some((point) => Number.isFinite(point.elevation));
    const samples = [{
      lat: points[0].lat,
      lng: points[0].lng,
      elevation: Number.isFinite(points[0].elevation) ? points[0].elevation : null,
      distanceFromStart: 0
    }];

    let cumulative = 0;
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const next = points[i];
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
      source: hasAnyElevation ? 'route-elevation' : 'none'
    };
  }

  function computeGradientProfile(path, options = {}) {
    const sampleMeters = normalizeSampleMeters(options.sampleMeters || DEFAULT_GRADIENT_SAMPLE_METERS);
    const thresholdPercent = normalizeThresholdPercent(options.thresholdPercent, DEFAULT_STEEP_THRESHOLD_PERCENT);
    const minSustainedMeters = normalizeSustainedLengthMeters(options.minSustainedMeters, DEFAULT_SUSTAINED_MIN_METERS);
    const sampleResult = buildGradientSamples(path, sampleMeters);
    const samples = sampleResult.samples;

    const profile = {
      sampleMeters,
      thresholdPercent,
      minSustainedMeters,
      source: sampleResult.source,
      hasElevation: false,
      maxSlopePercent: 0,
      averageSlopePercent: 0,
      steepDistanceMeters: 0,
      sustainedSections: [],
      segments: [],
      pointCount: samples.length
    };

    if (samples.length < 2) return profile;

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
        band: normalizeGradientBand('', absSlope)
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

  function countNearbyBarriers(path, barriers) {
    const coords = Array.isArray(path?.points?.coordinates) ? path.points.coordinates : [];
    if (!coords.length || !barriers.length) return 0;

    let count = 0;
    for (const barrier of barriers) {
      if (!Number.isFinite(barrier.lat) || !Number.isFinite(barrier.lng)) continue;
      if (String(barrier.status || '').toLowerCase() === 'resolved') continue;

      let near = false;
      for (const coord of coords) {
        const distance = haversineMeters(barrier.lat, barrier.lng, coord[1], coord[0]);
        if (distance <= NEAR_BARRIER_METERS) {
          near = true;
          break;
        }
      }

      if (near) {
        count += 1;
      }
    }

    return count;
  }

  function analyzeRoute(path, source, barriers) {
    const barrierCount = countNearbyBarriers(path, barriers);
    const gradientProfile = computeGradientProfile(path, {
      sampleMeters: DEFAULT_GRADIENT_SAMPLE_METERS,
      thresholdPercent: DEFAULT_STEEP_THRESHOLD_PERCENT,
      minSustainedMeters: DEFAULT_SUSTAINED_MIN_METERS
    });
    const peakSlope = gradientProfile.maxSlopePercent;

    let score = 100;
    const notes = [];

    if (barrierCount > 0) {
      score -= Math.min(45, barrierCount * 11);
      notes.push(`${barrierCount} reported barrier(s) near this route.`);
    } else {
      notes.push('No reported barriers near this route.');
    }

    if (peakSlope >= 10) {
      score -= 20;
      notes.push(`Steepest segment: ${peakSlope.toFixed(1)}%.`);
    } else if (peakSlope >= 7) {
      score -= 10;
      notes.push(`Moderate steep segment: ${peakSlope.toFixed(1)}%.`);
    } else if (peakSlope > 0) {
      notes.push(`Gentle slope profile: max ${peakSlope.toFixed(1)}%.`);
    } else if (!gradientProfile.hasElevation) {
      notes.push('No slope detail available from route elevation data.');
    }

    if (gradientProfile.hasElevation) {
      notes.push(`Slope estimated from elevation samples every ${gradientProfile.sampleMeters} m.`);
      if (gradientProfile.sustainedSections.length) {
        notes.push(`${gradientProfile.sustainedSections.length} sustained steep section(s) above ${gradientProfile.thresholdPercent}% grade.`);
      }
    }

    if (String(source || '').toLowerCase().includes('osrm')) {
      score -= 8;
      notes.push('Secondary routing profile was used for this route.');
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    let level = 'Low';
    let color = '#c62828';
    if (score >= 75) {
      level = 'High';
      color = '#2e7d32';
    } else if (score >= 50) {
      level = 'Medium';
      color = '#ef6c00';
    }

    return {
      score,
      level,
      color,
      notes,
      barrierCount,
      peakSlope,
      gradientProfile
    };
  }

  function getPathList(payload) {
    const paths = Array.isArray(payload?.paths) && payload.paths.length
      ? payload.paths
      : (payload?.path ? [payload.path] : []);

    return paths.filter((path) => Array.isArray(path?.points?.coordinates) && path.points.coordinates.length > 1);
  }

  function coerceGradientSection(item = {}) {
    const startMeters = Number(item.startMeters);
    const endMeters = Number(item.endMeters);
    const lengthMeters = Number(item.lengthMeters);
    const maxSlopePercent = Number(item.maxSlopePercent);
    const averageSlopePercent = Number(item.averageSlopePercent);
    return {
      startMeters: Number.isFinite(startMeters) ? startMeters : 0,
      endMeters: Number.isFinite(endMeters) ? endMeters : 0,
      lengthMeters: Number.isFinite(lengthMeters) ? lengthMeters : 0,
      maxSlopePercent: Number.isFinite(maxSlopePercent) ? maxSlopePercent : 0,
      averageSlopePercent: Number.isFinite(averageSlopePercent) ? averageSlopePercent : 0
    };
  }

  function coerceGradientSegment(item = {}) {
    const startLat = Number(item.startLat);
    const startLng = Number(item.startLng);
    const endLat = Number(item.endLat);
    const endLng = Number(item.endLng);
    const startMeters = Number(item.startMeters);
    const endMeters = Number(item.endMeters);
    const lengthMeters = Number(item.lengthMeters);
    const slopePercent = Number(item.slopePercent);
    const absSlopePercent = Number(item.absSlopePercent);
    const resolvedAbsSlope = Number.isFinite(absSlopePercent)
      ? absSlopePercent
      : (Number.isFinite(slopePercent) ? Math.abs(slopePercent) : 0);
    return {
      startLat,
      startLng,
      endLat,
      endLng,
      startMeters: Number.isFinite(startMeters) ? startMeters : 0,
      endMeters: Number.isFinite(endMeters) ? endMeters : 0,
      lengthMeters: Number.isFinite(lengthMeters) ? lengthMeters : 0,
      slopePercent: Number.isFinite(slopePercent) ? slopePercent : 0,
      absSlopePercent: resolvedAbsSlope,
      band: normalizeGradientBand(item.band, resolvedAbsSlope)
    };
  }

  function normalizeGradientProfile(profile, fallbackPath, sampleMeters) {
    const fallback = computeGradientProfile(fallbackPath, {
      sampleMeters,
      thresholdPercent: DEFAULT_STEEP_THRESHOLD_PERCENT,
      minSustainedMeters: DEFAULT_SUSTAINED_MIN_METERS
    });
    if (!profile || typeof profile !== 'object') return fallback;

    const output = {
      ...fallback,
      sampleMeters: normalizeSampleMeters(profile.sampleMeters ?? sampleMeters),
      thresholdPercent: normalizeThresholdPercent(profile.thresholdPercent, DEFAULT_STEEP_THRESHOLD_PERCENT),
      minSustainedMeters: normalizeSustainedLengthMeters(profile.minSustainedMeters, DEFAULT_SUSTAINED_MIN_METERS),
      source: String(profile.source || fallback.source || 'none'),
      hasElevation: Boolean(profile.hasElevation),
      maxSlopePercent: Number.isFinite(Number(profile.maxSlopePercent)) ? Number(profile.maxSlopePercent) : fallback.maxSlopePercent,
      averageSlopePercent: Number.isFinite(Number(profile.averageSlopePercent)) ? Number(profile.averageSlopePercent) : fallback.averageSlopePercent,
      steepDistanceMeters: Number.isFinite(Number(profile.steepDistanceMeters)) ? Number(profile.steepDistanceMeters) : fallback.steepDistanceMeters,
      sustainedSections: Array.isArray(profile.sustainedSections)
        ? profile.sustainedSections.map(coerceGradientSection).filter((row) => row.lengthMeters > 0)
        : fallback.sustainedSections,
      segments: Array.isArray(profile.segments)
        ? profile.segments
          .map(coerceGradientSegment)
          .filter((segment) => (
            Number.isFinite(segment.startLat)
            && Number.isFinite(segment.startLng)
            && Number.isFinite(segment.endLat)
            && Number.isFinite(segment.endLng)
            && segment.lengthMeters > 0
          ))
        : fallback.segments,
      pointCount: Number.isFinite(Number(profile.pointCount)) ? Number(profile.pointCount) : fallback.pointCount
    };
    return output;
  }

  async function requestGradientAnalysis(path, sampleMeters) {
    const coords = Array.isArray(path?.points?.coordinates) ? path.points.coordinates : [];
    if (coords.length < 2) {
      return computeGradientProfile(path, {
        sampleMeters,
        thresholdPercent: DEFAULT_STEEP_THRESHOLD_PERCENT,
        minSustainedMeters: DEFAULT_SUSTAINED_MIN_METERS
      });
    }

    try {
      const response = await fetch('/api/gradient/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coordinates: coords,
          sampleMeters,
          thresholdPercent: DEFAULT_STEEP_THRESHOLD_PERCENT,
          minSustainedMeters: DEFAULT_SUSTAINED_MIN_METERS
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Gradient analysis failed (${response.status}).`);
      }
      return normalizeGradientProfile(payload, path, sampleMeters);
    } catch {
      return computeGradientProfile(path, {
        sampleMeters,
        thresholdPercent: DEFAULT_STEEP_THRESHOLD_PERCENT,
        minSustainedMeters: DEFAULT_SUSTAINED_MIN_METERS
      });
    }
  }

  function gradientProfileSignature(profile) {
    if (!profile) return '';
    return [
      normalizeSampleMeters(profile.sampleMeters),
      Number(profile.maxSlopePercent || 0).toFixed(2),
      Number(profile.averageSlopePercent || 0).toFixed(2),
      Number(profile.steepDistanceMeters || 0).toFixed(1),
      Array.isArray(profile.sustainedSections) ? profile.sustainedSections.length : 0,
      Array.isArray(profile.segments) ? profile.segments.length : 0
    ].join('|');
  }

  async function persistGradientProfile(profile) {
    if (!state.latestRoute || !state.startPoint || !state.endPoint || !profile) return;
    const signature = gradientProfileSignature(profile);
    if (!signature || signature === state.latestGradientProfileSignature) return;

    try {
      const response = await fetch('/api/gradient/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileType: state.latestRoute.profile,
          routeDistance: state.latestRoute.distance,
          startLat: state.startPoint.lat,
          startLng: state.startPoint.lng,
          endLat: state.endPoint.lat,
          endLng: state.endPoint.lng,
          gradientProfile: profile
        })
      });
      if (response.ok) {
        state.latestGradientProfileSignature = signature;
      }
    } catch {
      // Persist errors are non-blocking for routing UX.
    }
  }

  async function refreshGradientDetails(announce = false) {
    if (!state.latestRoute?.path) return;
    const profile = await requestGradientAnalysis(state.latestRoute.path, state.gradientSampleMeters);
    state.latestGradientProfile = profile;
    renderGradientDetails(profile);
    renderGradientHeatStrip(state.latestRoute.path, profile);
    void persistGradientProfile(profile);
    if (announce) {
      setNarration(`Gradient detail updated. Max slope ${formatPercent(profile.maxSlopePercent)} and ${profile.sustainedSections.length} sustained steep section(s).`);
    }
  }

  function renderGradientHeatStrip(path, profileInput) {
    if (!layers.gradientHeat) return;
    layers.gradientHeat.clearLayers();

    const profile = profileInput && typeof profileInput === 'object'
      ? profileInput
      : computeGradientProfile(path, {
        sampleMeters: DEFAULT_GRADIENT_SAMPLE_METERS,
        thresholdPercent: DEFAULT_STEEP_THRESHOLD_PERCENT,
        minSustainedMeters: DEFAULT_SUSTAINED_MIN_METERS
      });
    const segments = Array.isArray(profile?.segments) ? profile.segments : [];
    if (!profile?.hasElevation || !segments.length) {
      setGradientHeatLegendVisible(false);
      return;
    }

    let drawnCount = 0;
    for (const segment of segments) {
      if (!Number.isFinite(segment.startLat)
        || !Number.isFinite(segment.startLng)
        || !Number.isFinite(segment.endLat)
        || !Number.isFinite(segment.endLng)) {
        continue;
      }
      const band = normalizeGradientBand(segment.band, segment.absSlopePercent);
      const color = GRADIENT_HEAT_COLORS[band] || GRADIENT_HEAT_COLORS.green;
      L.polyline([
        [segment.startLat, segment.startLng],
        [segment.endLat, segment.endLng]
      ], {
        color,
        weight: GRADIENT_HEAT_WEIGHT,
        opacity: 0.94,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false
      }).addTo(layers.gradientHeat);
      drawnCount += 1;
    }

    setGradientHeatLegendVisible(drawnCount > 0);
  }

  function renderAccessibilityRouteDetails(route) {
    if (!els.routeDetailsPanel) return;
    if (!route || typeof route !== 'object') {
      els.routeDetailsPanel.hidden = true;
      if (els.routeReasonList) els.routeReasonList.innerHTML = '';
      return;
    }

    els.routeDetailsPanel.hidden = false;
    if (els.detailDistance) {
      els.detailDistance.textContent = `Distance: ${formatDistance(route.total_length_m)}`;
    }
    if (els.detailAscent) {
      els.detailAscent.textContent = `Ascent: ${formatShortMeters(Number(route.total_ascent_m || 0))}`;
    }
    if (els.detailMaxSlope) {
      els.detailMaxSlope.textContent = `Max slope: ${formatPercent(Number(route.max_slope_pct || 0))}`;
    }
    if (els.detailConfidence) {
      const confidence = Number(route.confidence_score);
      const confidencePct = Number.isFinite(confidence)
        ? Math.round(Math.max(0, Math.min(1, confidence)) * 100)
        : null;
      els.detailConfidence.textContent = confidencePct === null ? 'Confidence: -' : `Confidence: ${confidencePct}/100`;
    }

    if (!els.routeReasonList) return;
    els.routeReasonList.innerHTML = '';
    const reasons = Array.isArray(route?.explanation?.top_reasons) ? route.explanation.top_reasons : [];
    if (!reasons.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No additional route penalties were applied.';
      els.routeReasonList.appendChild(empty);
      return;
    }

    for (const reason of reasons.slice(0, 5)) {
      const item = document.createElement('li');
      const term = String(reason.term || 'unknown').replaceAll('_', ' ');
      const score = Number(reason.total || 0);
      const sign = score >= 0 ? '+' : '';
      item.textContent = `${term}: ${sign}${score.toFixed(2)} cost`;
      els.routeReasonList.appendChild(item);
    }
  }

  function updateRouteMetrics(fastestPath, accessiblePath, analysis, sourceNote, accessibilityRoute) {
    if (els.fastestRouteSummary) {
      els.fastestRouteSummary.textContent = `${formatDistance(fastestPath.distance)} • ${formatDurationFromMs(fastestPath.time)}`;
    }

    if (els.accessibleRouteSummary) {
      els.accessibleRouteSummary.textContent = `${formatDistance(accessiblePath.distance)} • ${formatDurationFromMs(accessiblePath.time)}`;
    }

    const extraDistance = Number(accessiblePath.distance) - Number(fastestPath.distance);
    const extraTimeMinutes = Math.round((Number(accessiblePath.time) - Number(fastestPath.time)) / 60000);

    if (els.routeDelta) {
      const distancePart = Number.isFinite(extraDistance)
        ? `${extraDistance >= 0 ? '+' : '-'}${formatDistance(Math.abs(extraDistance))}`
        : '-';
      const timePart = Number.isFinite(extraTimeMinutes)
        ? `${extraTimeMinutes >= 0 ? '+' : '-'}${Math.abs(extraTimeMinutes)} min`
        : '-';
      els.routeDelta.textContent = `${distancePart} • ${timePart}`;
    }

    if (els.routeConfidence) {
      const confidenceRaw = Number(accessibilityRoute?.confidence_score);
      const confidencePct = Number.isFinite(confidenceRaw)
        ? Math.round(Math.max(0, Math.min(1, confidenceRaw)) * 100)
        : null;
      if (confidencePct === null) {
        els.routeConfidence.textContent = `${analysis.level} (${analysis.score}/100)`;
      } else {
        els.routeConfidence.textContent = `${analysis.level} (${analysis.score}/100) • model ${confidencePct}/100`;
      }
      els.routeConfidence.style.color = analysis.color;
    }

    if (els.routeSelectionNote) {
      const notes = analysis.notes.join(' ');
      const overlapNote = (Math.abs(extraDistance) < 5 && Math.abs(extraTimeMinutes) < 1)
        ? 'Fastest and accessible routes currently overlap.'
        : '';
      const reasonNote = Array.isArray(accessibilityRoute?.explanation?.top_reasons)
        && accessibilityRoute.explanation.top_reasons.length
        ? `Top cost factor: ${String(accessibilityRoute.explanation.top_reasons[0].term || '').replaceAll('_', ' ')}.`
        : '';
      els.routeSelectionNote.textContent = `${sourceNote} ${overlapNote} ${reasonNote} ${notes}`.trim();
    }

    setRouteInfoVisible();
    if (els.postRouteFeedback) {
      els.postRouteFeedback.hidden = false;
    }

    state.latestRoute = {
      profile: els.profileSelect ? els.profileSelect.value : 'default-walking',
      distance: Number(accessiblePath.distance) || null,
      time: Number(accessiblePath.time) || null,
      analysis,
      path: accessiblePath
    };
    state.latestAccessibilityRoute = accessibilityRoute || null;
    state.latestGradientProfile = analysis.gradientProfile || null;
    renderAccessibilityRouteDetails(accessibilityRoute);
    renderGradientDetails(state.latestGradientProfile);
    renderGradientHeatStrip(accessiblePath, state.latestGradientProfile);
    void refreshGradientDetails(false);
  }

  function drawRouteLayers(fastestPath, accessiblePath) {
    clearRouteLayers();

    const fastestLatLngs = toLatLngs(fastestPath);
    const accessibleLatLngs = toLatLngs(accessiblePath);
    const overlappingRoutes = arePathsMostlySame(fastestPath, accessiblePath);

    if (fastestLatLngs.length > 1) {
      layers.fastestRoute = L.polyline(fastestLatLngs, {
        color: '#1e88e5',
        weight: overlappingRoutes ? 7 : 5,
        opacity: 0.85,
        dashArray: overlappingRoutes ? '14 10' : '10 8',
        dashOffset: '0'
      }).addTo(map);
    }

    if (accessibleLatLngs.length > 1) {
      layers.accessibleRoute = L.polyline(accessibleLatLngs, {
        color: '#c62828',
        weight: overlappingRoutes ? 4 : 6,
        opacity: 0.9,
        dashArray: overlappingRoutes ? '14 10' : '12 7',
        dashOffset: overlappingRoutes ? '7' : '0'
      }).addTo(map);
    }

    const fitLayer = layers.accessibleRoute || layers.fastestRoute;
    if (fitLayer) {
      map.fitBounds(fitLayer.getBounds(), { padding: [40, 40] });
    }
  }

  async function requestFastestRoutePayload(start, end) {
    const body = {
      startLat: start.lat,
      startLon: start.lng,
      endLat: end.lat,
      endLon: end.lng,
      profile: 'foot',
      alternatives: 3,
      instructions: true,
      elevation: true
    };

    const response = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Routing failed (${response.status}).`);
    }

    return payload;
  }

  async function requestAccessibilityRoutePayload(start, end, profileId) {
    const body = {
      startLat: start.lat,
      startLon: start.lng,
      endLat: end.lat,
      endLon: end.lng,
      profileId: String(profileId || 'default-walking').trim().toLowerCase(),
      slopeSampleMode: 'precomputed',
      slopeSampleIntervalM: state.gradientSampleMeters,
      context: {
        atTime: new Date().toISOString(),
        timeOfDay: 'day'
      }
    };

    const response = await fetch('/api/accessibility/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Accessibility routing failed (${response.status}).`);
    }
    if (payload.status !== 'ok' || !payload.route) {
      throw new Error(payload.error || 'Accessibility routing returned no route.');
    }
    return payload;
  }

  function toPathFromAccessibilityRoute(route) {
    const coordinates = Array.isArray(route?.geometry?.coordinates) ? route.geometry.coordinates : [];
    if (coordinates.length < 2) return null;
    return {
      distance: Number(route.total_length_m || 0),
      time: Number(route.estimated_time_ms || 0),
      points: {
        type: 'LineString',
        coordinates
      },
      instructions: []
    };
  }

  async function calculateRoutes() {
    if (!state.startPoint || !state.endPoint) {
      return;
    }

    showStatus('Calculating fastest and accessible routes...', 'loading');
    setNarration('Calculating route. Please wait.');

    const selectedProfile = els.profileSelect ? els.profileSelect.value : 'default-walking';

    try {
      const [fastestResult, accessibleResult] = await Promise.allSettled([
        requestFastestRoutePayload(state.startPoint, state.endPoint),
        requestAccessibilityRoutePayload(state.startPoint, state.endPoint, selectedProfile)
      ]);

      if (fastestResult.status !== 'fulfilled') {
        throw fastestResult.reason || new Error('Fastest route request failed.');
      }
      const fastestPayload = fastestResult.value;

      const fastestPaths = getPathList(fastestPayload);
      let accessibilityRoute = null;
      let accessiblePath = null;
      let sourceNote = `Profile route calculated using ${selectedProfile}.`;
      if (accessibleResult.status === 'fulfilled') {
        accessibilityRoute = accessibleResult.value.route;
        accessiblePath = toPathFromAccessibilityRoute(accessibilityRoute);
      } else {
        sourceNote = `Profile route engine unavailable, using fastest route fallback.`;
      }

      if (!fastestPaths.length) {
        throw new Error('Routing engine returned no usable paths.');
      }

      const fastestPath = fastestPaths.reduce((best, path) => {
        if (!best) return path;
        return Number(path.distance || Number.POSITIVE_INFINITY) < Number(best.distance || Number.POSITIVE_INFINITY)
          ? path
          : best;
      }, null);

      if (!accessiblePath) {
        accessiblePath = fastestPath;
      }
      const analysis = analyzeRoute(accessiblePath, 'accessibility-route', state.barriers);

      drawRouteLayers(fastestPath, accessiblePath);
      updateRouteMetrics(fastestPath, accessiblePath, analysis, sourceNote, accessibilityRoute);
      void loadCommunityConfidenceSummary({ profileType: selectedProfile });
      writeStoredProfileId(selectedProfile);
      clearStatus();
      setNarration(
        `Route ready. Fastest route ${routeSummaryForNarration(fastestPath)}. `
        + `Accessible route ${routeSummaryForNarration(accessiblePath)}. `
        + `Accessibility score ${analysis.score} out of 100, ${analysis.level}.`
      );
    } catch (error) {
      showStatus(error.message || 'Routing failed.', 'error');
      setNarration('Route calculation failed. Check start and destination or try again.', 'assertive');
    }
  }

  function openReportModal(latlng) {
    state.lastFocusedElement = document.activeElement;
    state.reportCoordinate = latlng;
    updateReportLocationLabel(latlng);
    if (els.comprehensiveReportModal) {
      els.comprehensiveReportModal.style.display = 'flex';
      if (els.closeReportModal) {
        els.closeReportModal.focus();
      }
    }
    setNarration('Barrier report dialog opened.');
  }

  function closeReportModal() {
    if (els.comprehensiveReportModal) {
      els.comprehensiveReportModal.style.display = 'none';
    }
    state.reportLabel = '';
    if (state.lastFocusedElement && typeof state.lastFocusedElement.focus === 'function') {
      state.lastFocusedElement.focus();
      state.lastFocusedElement = null;
    }
    setNarration('Barrier report dialog closed.');
  }

  function getFocusableElements(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter((el) => !el.disabled && el.offsetParent !== null);
  }

  function trapModalFocus(event) {
    if (event.key !== 'Tab') return;
    if (!els.comprehensiveReportModal || els.comprehensiveReportModal.style.display !== 'flex') return;

    const focusable = getFocusableElements(els.comprehensiveReportModal);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function trapSidebarFocus(event) {
    if (event.key !== 'Tab') return;
    if (!els.adminSidebar || !els.adminSidebar.classList.contains('open')) return;

    const focusable = getFocusableElements(els.adminSidebar);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function getLocationLabel(latlng) {
    if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return '';

    const cacheKey = `${latlng.lat.toFixed(5)},${latlng.lng.toFixed(5)}`;
    const cached = state.locationLabelCache.get(cacheKey);
    if (cached) return cached;

    try {
      const params = new URLSearchParams({
        lat: String(latlng.lat),
        lng: String(latlng.lng)
      });
      const response = await fetch(`/api/reverse-geocode?${params.toString()}`);
      if (!response.ok) return '';
      const payload = await response.json().catch(() => ({}));
      const label = String(payload.label || '').trim();
      if (label) {
        state.locationLabelCache.set(cacheKey, label);
      }
      return label;
    } catch {
      return '';
    }
  }

  function locationFallbackLabel(latlng, roleLabel = 'location') {
    if (latlng && Number.isFinite(latlng.lat) && Number.isFinite(latlng.lng)) {
      const latDiff = Math.abs(latlng.lat - UCC_CENTER[0]);
      const lngDiff = Math.abs(latlng.lng - UCC_CENTER[1]);
      if (latDiff < 0.006 && lngDiff < 0.01) {
        return `${roleLabel} on UCC Campus`;
      }
    }
    return `${roleLabel} near selected map area`;
  }

  async function updatePointLabel(role, latlng) {
    const requestIdKey = role === 'start' ? 'startLabelRequestId' : 'endLabelRequestId';
    const labelKey = role === 'start' ? 'startLabel' : 'endLabel';
    const roleLabel = role === 'start' ? 'Start location' : 'Destination';
    const requestId = state[requestIdKey] + 1;
    state[requestIdKey] = requestId;
    state[labelKey] = LOCATION_RESOLVING_LABEL;
    updatePointUI();

    const resolvedLabel = await getLocationLabel(latlng);
    if (state[requestIdKey] !== requestId) return;

    state[labelKey] = resolvedLabel || locationFallbackLabel(latlng, roleLabel) || DEFAULT_POINT_LABEL;
    updatePointUI();
    setNarration(`${roleLabel} set to ${state[labelKey]}.`);
  }

  async function updateReportLocationLabel(latlng) {
    const requestId = state.reportLabelRequestId + 1;
    state.reportLabelRequestId = requestId;
    state.reportLabel = LOCATION_RESOLVING_LABEL;
    if (els.reportCoordinateDisplay) {
      els.reportCoordinateDisplay.textContent = state.reportLabel;
    }

    const resolvedLabel = await getLocationLabel(latlng);
    if (state.reportLabelRequestId !== requestId) return;

    state.reportLabel = resolvedLabel || locationFallbackLabel(latlng, 'Hazard location');
    if (els.reportCoordinateDisplay) {
      els.reportCoordinateDisplay.textContent = state.reportLabel;
    }
    setNarration(`Report location set to ${state.reportLabel}.`);
  }

  function readCheckedValues(name) {
    return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`))
      .map((input) => String(input.value || '').trim())
      .filter(Boolean);
  }

  async function submitBarrierReport(event) {
    event.preventDefault();

    if (!state.reportCoordinate) {
      showStatus('Choose a map location before submitting a report.', 'error');
      return;
    }

    const categories = readCheckedValues('barrierCategory');
    if (!categories.length) {
      showStatus('Select at least one issue category.', 'error');
      return;
    }

    const impacts = readCheckedValues('impactGroup');
    const severityInput = document.querySelector('input[name="severityLevel"]:checked');
    const severity = normalizeSeverity(severityInput?.value || 'medium');

    const formData = new FormData();
    formData.append('lat', String(state.reportCoordinate.lat));
    formData.append('lng', String(state.reportCoordinate.lng));
    formData.append('type', categories.join(', '));
    formData.append('severity', severity);
    formData.append('impacts', impacts.join(', '));
    formData.append('description', els.barrierDescription ? els.barrierDescription.value.trim() : '');

    const file = els.barrierPhoto && els.barrierPhoto.files && els.barrierPhoto.files[0];
    if (file) {
      formData.append('photo', file);
    }

    if (els.submitEvidenceBtn) {
      els.submitEvidenceBtn.disabled = true;
      els.submitEvidenceBtn.textContent = 'Uploading...';
    }

    try {
      const response = await fetch('/api/barriers', {
        method: 'POST',
        body: formData
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Barrier submission failed (${response.status}).`);
      }

      closeReportModal();
      if (els.evidenceForm) {
        els.evidenceForm.reset();
      }
      showStatus('Barrier report submitted.', 'loading');
      setTimeout(clearStatus, 1800);
      await loadBarriers();
      setNarration('Barrier report submitted and added to the map.');
    } catch (error) {
      showStatus(error.message || 'Could not submit barrier report.', 'error');
      setNarration('Barrier report submission failed.', 'assertive');
    } finally {
      if (els.submitEvidenceBtn) {
        els.submitEvidenceBtn.disabled = false;
        els.submitEvidenceBtn.textContent = 'Upload Record';
      }
    }
  }

  async function submitQuickBarrier(type, latlng) {
    const locationLabel = await getLocationLabel(latlng);
    const hazardLabel = QUICK_TAG_TEXT[type] || type;
    const payload = {
      lat: latlng.lat,
      lng: latlng.lng,
      type,
      severity: QUICK_TAG_SEVERITY[type] || 'medium',
      impacts: '',
      description: locationLabel
        ? `${hazardLabel} reported near ${locationLabel}.`
        : `${hazardLabel} reported from quick tag dock.`
    };

    const response = await fetch('/api/barriers/quick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || `Quick tag failed (${response.status}).`);
    }
    return { locationLabel };
  }

  async function submitVoiceBarrier(transcript, latlng) {
    const details = inferVoiceBarrierDetails(transcript);
    const primaryType = details.categories[0] || 'General Accessibility Issue';
    const impacts = details.impacts.join(', ');
    const locationLabel = await getLocationLabel(latlng);
    const payload = {
      lat: latlng.lat,
      lng: latlng.lng,
      type: primaryType,
      severity: details.severity || 'medium',
      impacts,
      description: locationLabel
        ? `${transcript} (near ${locationLabel})`
        : transcript
    };

    const response = await fetch('/api/barriers/quick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || `Voice report failed (${response.status}).`);
    }

    return {
      category: primaryType,
      impacts: details.impacts,
      locationLabel
    };
  }

  function wireQuickTags() {
    const tagButtons = getQuickTagButtons();
    for (const button of tagButtons) {
      const hazardType = String(button.dataset.hazardType || 'Hazard');
      const hintText = QUICK_TAG_HINTS[hazardType] || 'Tap this symbol, then tap the map to place a quick hazard report.';
      button.setAttribute('aria-pressed', 'false');

      const selectHazard = (event) => {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        beginQuickTagPlacement(hazardType);
      };

      button.addEventListener('touchend', (event) => {
        state.lastQuickTagTouchAt = Date.now();
        selectHazard(event);
      }, { passive: false });

      button.addEventListener('click', (event) => {
        // iOS may fire a synthetic click after touchend.
        if ((Date.now() - state.lastQuickTagTouchAt) < 700) {
          event.preventDefault();
          return;
        }
        selectHazard(event);
      });
      button.addEventListener('keydown', (event) => {
        if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'Enter') {
          event.preventDefault();
          selectHazard(event);
        }
      });
      button.addEventListener('focus', () => {
        showStatus(hintText, 'loading');
      });
      button.addEventListener('blur', () => {
        clearStatus();
      });
    }
  }

  function resetVoiceButtonState() {
    if (!els.voiceReportBtn) return;
    els.voiceReportBtn.textContent = 'Voice Report';
    els.voiceReportBtn.setAttribute('aria-label', 'Start voice hazard report');
    els.voiceReportBtn.classList.remove('is-listening');
  }

  function clearVoiceSilenceTimer() {
    if (state.voiceSilenceTimer) {
      clearTimeout(state.voiceSilenceTimer);
      state.voiceSilenceTimer = null;
    }
  }

  function armVoiceSilenceTimer(recognition) {
    if (!IS_COARSE_POINTER) return;
    if (!state.voiceListening) return;
    if (!state.voiceDetectedSpeech) return;
    clearVoiceSilenceTimer();
    state.voiceSilenceTimer = setTimeout(() => {
      if (!state.voiceListening) return;
      showStatus('3 seconds of silence detected. Saving voice report...', 'loading');
      setNarration('Silence detected. Saving voice report now.');
      try {
        recognition.stop();
      } catch {}
    }, VOICE_MOBILE_SILENCE_MS);
  }

  function inferVoiceBarrierDetails(transcript) {
    const normalized = String(transcript || '').toLowerCase();
    const categories = new Set();
    for (const rule of VOICE_CATEGORY_KEYWORDS) {
      if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
        categories.add(rule.category);
      }
    }
    const impacts = new Set();
    for (const rule of VOICE_IMPACT_KEYWORDS) {
      if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
        impacts.add(rule.impact);
      }
    }
    const severity = HIGH_SEVERITY_VOICE_KEYWORDS.some((keyword) => normalized.includes(keyword))
      ? 'high'
      : 'medium';
    return {
      categories: Array.from(categories),
      impacts: Array.from(impacts),
      severity
    };
  }

  function averageConfidenceScore(scores) {
    if (!Array.isArray(scores) || !scores.length) return null;
    let total = 0;
    let count = 0;
    for (const value of scores) {
      const score = Number(value);
      if (!Number.isFinite(score)) continue;
      total += Math.max(0, Math.min(1, score));
      count += 1;
    }
    if (!count) return null;
    return total / count;
  }

  async function enhanceVoiceTranscript(transcript, confidence) {
    const raw = String(transcript || '').trim();
    if (!raw) return { enhanced: '', changed: false, source: 'none' };

    try {
      const response = await fetch('/api/voice/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: raw,
          confidence: Number.isFinite(confidence) ? confidence : null
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Voice enhancement failed (${response.status}).`);
      }
      const enhanced = String(payload.enhanced || '').trim() || raw;
      return {
        enhanced,
        changed: Boolean(payload.changed) && enhanced !== raw,
        source: String(payload.source || 'heuristic')
      };
    } catch {
      return {
        enhanced: raw,
        changed: false,
        source: 'none'
      };
    }
  }

  function wireVoiceReport() {
    if (!els.voiceReportBtn) return;

    const openManualVoiceFallback = () => {
      clearQuickTagPlacement();
      state.reportMode = false;
      map.getContainer().style.cursor = '';
      const capturePoint = map.getCenter();
      openReportModal(capturePoint);
      showStatus('Voice capture is unavailable on this device. Manual report form opened.', 'error');
      setNarration('Voice capture is unavailable. Manual report form opened at map center.', 'assertive');
    };

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      els.voiceReportBtn.disabled = false;
      els.voiceReportBtn.textContent = 'Voice Fallback';
      els.voiceReportBtn.setAttribute('aria-label', 'Voice unavailable. Open manual report form');
      els.voiceReportBtn.addEventListener('click', openManualVoiceFallback);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IE';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.addEventListener('start', () => {
      state.voiceListening = true;
      state.voiceDraftText = '';
      state.voiceInterimText = '';
      state.voiceConfidenceScores = [];
      state.voiceCapturePoint = map.getCenter();
      state.voiceDetectedSpeech = false;
      clearVoiceSilenceTimer();
      if (els.voiceReportBtn) {
        els.voiceReportBtn.textContent = 'Stop Listening';
        els.voiceReportBtn.setAttribute('aria-label', 'Stop voice hazard report');
        els.voiceReportBtn.classList.add('is-listening');
      }
      showStatus('Listening... describe the barrier, impact, and urgency.', 'loading');
      setNarration('Voice recording started. Describe the barrier, who is affected, and urgency. On mobile, pause for 3 seconds to save automatically, or press Stop Listening.');
    });

    recognition.addEventListener('result', (event) => {
      let sawSpeechInEvent = false;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const current = event.results[i];
        const transcript = String(current?.[0]?.transcript || '').trim();
        if (!transcript) continue;
        sawSpeechInEvent = true;
        const confidence = Number(current?.[0]?.confidence);
        if (Number.isFinite(confidence)) {
          state.voiceConfidenceScores.push(Math.max(0, Math.min(1, confidence)));
        }
        if (current?.isFinal) {
          state.voiceDraftText = state.voiceDraftText
            ? `${state.voiceDraftText} ${transcript}`
            : transcript;
          state.voiceInterimText = '';
        } else {
          state.voiceInterimText = transcript;
        }
      }
      if (sawSpeechInEvent) {
        state.voiceDetectedSpeech = true;
        armVoiceSilenceTimer(recognition);
      }
    });

    recognition.addEventListener('end', async () => {
      state.voiceListening = false;
      clearVoiceSilenceTimer();
      resetVoiceButtonState();

      const transcript = String(state.voiceDraftText || state.voiceInterimText || '').trim();
      if (!transcript || transcript.length < 4) {
        showStatus('No voice note detected. Tap Voice Report and try again.', 'error');
        setNarration('No voice note detected. Start voice recording and try again.', 'assertive');
        return;
      }

      const capturePoint = state.voiceCapturePoint || map.getCenter();
      const confidence = averageConfidenceScore(state.voiceConfidenceScores);
      try {
        showStatus('Improving voice note clarity...', 'loading');
        const enhanced = await enhanceVoiceTranscript(transcript, confidence);
        const finalTranscript = String(enhanced.enhanced || '').trim() || transcript;
        const submitted = await submitVoiceBarrier(finalTranscript, capturePoint);
        await loadBarriers();
        showVoiceCaptureMarker(capturePoint, finalTranscript);
        const locationSuffix = submitted.locationLabel ? ` near ${submitted.locationLabel}` : '';
        const enhancementSuffix = enhanced.changed
          ? (enhanced.source === 'openai' ? ' AI-enhanced transcript applied.' : ' Transcript clarified for readability.')
          : '';
        showStatus(`Voice report captured and posted${locationSuffix}.`, 'loading');
        setTimeout(clearStatus, 1900);
        setNarration(`Voice report saved as ${submitted.category}${locationSuffix}. Marker added at the captured location.${enhancementSuffix}`);
      } catch (error) {
        showStatus(error.message || 'Voice report failed. You can report manually.', 'error');
        setNarration('Voice report failed. You can use Report Barrier instead.', 'assertive');
      }
    });

    recognition.addEventListener('error', (event) => {
      state.voiceListening = false;
      clearVoiceSilenceTimer();
      resetVoiceButtonState();
      const errorCode = String(event?.error || '').trim();
      if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') {
        openManualVoiceFallback();
        return;
      }
      showStatus('Voice recognition failed. You can still report manually.', 'error');
      setNarration('Voice recognition failed. Please try again or use manual reporting.', 'assertive');
    });

    state.voiceRecognition = recognition;

    els.voiceReportBtn.addEventListener('click', () => {
      if (state.voiceListening) {
        clearVoiceSilenceTimer();
        try {
          recognition.stop();
        } catch {}
        setNarration('Voice recording stopped. Processing your report.');
        return;
      }

      clearQuickTagPlacement();
      state.reportMode = false;
      map.getContainer().style.cursor = '';
      try {
        recognition.start();
      } catch {
        showStatus('Voice capture is already active.', 'loading');
        setNarration('Voice capture is already active.');
      }
    });
  }

  async function loadBarriers() {
    layers.barriers.clearLayers();
    try {
      const response = await fetch('/api/barriers');
      if (!response.ok) return;

      const rows = await response.json();
      if (!Array.isArray(rows)) return;
      state.barriers = rows;

      for (const barrier of rows) {
        if (!Number.isFinite(barrier.lat) || !Number.isFinite(barrier.lng)) continue;

        const severity = normalizeSeverity(barrier.severity);
        const color = severity === 'high' ? '#c62828' : severity === 'low' ? '#2e7d32' : '#ef6c00';
        const marker = L.circleMarker([barrier.lat, barrier.lng], {
          radius: 7,
          color,
          fillColor: color,
          fillOpacity: 0.7,
          weight: 2
        }).addTo(layers.barriers);

        const image = barrier.image_path
          ? `<br><img src="${escapeHtml(barrier.image_path)}" alt="Barrier image" style="max-width:160px;margin-top:6px;border-radius:4px;">`
          : '';

        marker.bindPopup(
          `<strong>${escapeHtml(barrier.barrier_type || 'Barrier')}</strong><br>`
          + `Severity: ${escapeHtml(severity)}<br>`
          + `Status: ${escapeHtml(barrier.status || 'pending')}`
          + `${barrier.description ? `<br>${escapeHtml(barrier.description)}` : ''}`
          + image
        );
      }
    } catch {
      // Ignore background fetch errors in passive refresh paths.
    }
  }

  async function updateGraphhopperStatus() {
    if (!els.routingEngineHint) return;

    try {
      const response = await fetch('/api/graphhopper/status');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'GraphHopper status unavailable');
      }

      els.routingEngineHint.textContent = 'Routing service: connected.';
    } catch {
      els.routingEngineHint.textContent = 'Routing service: degraded.';
    }
  }

  async function loadGradientSourceMode() {
    try {
      const response = await fetch('/api/gradient/source');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Gradient source status failed (${response.status})`);
      }
      state.gradientSourceMode = String(payload.mode || '');
    } catch {
      state.gradientSourceMode = '';
    }
  }

  function getStoredAdminToken() {
    try {
      return String(window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '').trim();
    } catch {
      return '';
    }
  }

  function saveAdminToken(token) {
    try {
      if (token) {
        window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
      } else {
        window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
      }
    } catch {}
  }

  function promptForAdminToken() {
    const value = window.prompt('Enter admin token');
    const token = String(value || '').trim();
    if (token) {
      saveAdminToken(token);
    }
    return token;
  }

  function buildAdminHeaders() {
    const token = getStoredAdminToken();
    return token ? { 'x-admin-token': token } : {};
  }

  function scheduleAdminRefresh(delayMs = 700) {
    if (state.adminRefreshTimer) {
      clearTimeout(state.adminRefreshTimer);
    }
    state.adminRefreshTimer = setTimeout(() => {
      state.adminRefreshTimer = null;
      if (els.adminSidebar && els.adminSidebar.classList.contains('open')) {
        loadAdminData();
      }
    }, delayMs);
  }

  async function setBarrierStatus(id, status, feedbackEl) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...buildAdminHeaders()
      };
      const response = await fetch(`/api/barriers/${id}/status`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ status })
      });

      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        const token = promptForAdminToken();
        if (token) {
          ensureAdminStreamConnected(true);
          return setBarrierStatus(id, status, feedbackEl);
        }
      }
      if (!response.ok) {
        throw new Error(payload.error || `Status update failed (${response.status}).`);
      }

      if (feedbackEl) {
        feedbackEl.textContent = 'Status saved.';
        feedbackEl.style.color = '#2e7d32';
      }

      await loadBarriers();
      scheduleAdminRefresh(200);
    } catch (error) {
      if (feedbackEl) {
        feedbackEl.textContent = error.message || 'Update failed.';
        feedbackEl.style.color = '#c62828';
      }
    }
  }

  async function hydrateAdminBarrierLocation(detailEl, barrier) {
    if (!detailEl) return;
    const severity = String(barrier?.severity || 'medium');
    detailEl.textContent = `Severity: ${severity} | Location: Locating place...`;

    const lat = Number(barrier?.lat);
    const lng = Number(barrier?.lng);
    const latlng = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    if (!latlng) {
      detailEl.textContent = `Severity: ${severity} | Location: ${DEFAULT_POINT_LABEL}`;
      return;
    }

    const label = await getLocationLabel(latlng);
    detailEl.textContent = `Severity: ${severity} | Location: ${label || locationFallbackLabel(latlng, 'Reported location')}`;
  }

  function renderAdminData(payload) {
    if (!els.adminDataContainer) return;

    const barriers = Array.isArray(payload?.barriers) ? payload.barriers : [];
    const feedback = Array.isArray(payload?.feedback) ? payload.feedback : [];
    const routeFeedback = Array.isArray(payload?.routeFeedback) ? payload.routeFeedback : [];
    const spotChecks = Array.isArray(payload?.spotChecks) ? payload.spotChecks : [];
    const gradientProfiles = Array.isArray(payload?.gradientProfiles) ? payload.gradientProfiles : [];

    els.adminDataContainer.innerHTML = '';

    const summary = document.createElement('div');
    summary.className = 'data-card';
    summary.innerHTML = `<h4>Overview</h4>
      <p>Barriers: ${barriers.length}</p>
      <p>General feedback: ${feedback.length}</p>
      <p>Route feedback: ${routeFeedback.length}</p>
      <p>Gradient spot checks: ${spotChecks.length}</p>
      <p>Gradient profiles: ${gradientProfiles.length}</p>`;
    els.adminDataContainer.appendChild(summary);

    if (!barriers.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No barrier reports yet.';
      els.adminDataContainer.appendChild(empty);
      return;
    }

    for (const barrier of barriers) {
      const card = document.createElement('div');
      card.className = 'data-card';

      const title = document.createElement('h4');
      title.textContent = barrier.barrier_type || 'Barrier';
      card.appendChild(title);

      const detail = document.createElement('p');
      detail.textContent = `Severity: ${barrier.severity || 'medium'} | Location: ${DEFAULT_POINT_LABEL}`;
      card.appendChild(detail);
      hydrateAdminBarrierLocation(detail, barrier);

      if (barrier.description) {
        const desc = document.createElement('p');
        desc.textContent = barrier.description;
        card.appendChild(desc);
      }

      const row = document.createElement('div');
      row.className = 'admin-card-row';

      const select = document.createElement('select');
      select.className = 'admin-status-select';

      const statuses = [
        { value: 'pending', label: 'Pending' },
        { value: 'in_review', label: 'In Review' },
        { value: 'resolved', label: 'Resolved' }
      ];

      for (const optionData of statuses) {
        const option = document.createElement('option');
        option.value = optionData.value;
        option.textContent = optionData.label;
        if (optionData.value === String(barrier.status || 'pending')) {
          option.selected = true;
        }
        select.appendChild(option);
      }

      const feedbackEl = document.createElement('span');
      feedbackEl.className = 'admin-status-feedback';

      select.addEventListener('change', () => {
        setBarrierStatus(barrier.id, select.value, feedbackEl);
      });

      row.appendChild(select);
      row.appendChild(feedbackEl);
      card.appendChild(row);

      if (barrier.image_path) {
        const img = document.createElement('img');
        img.src = barrier.image_path;
        img.alt = 'Barrier evidence';
        img.loading = 'lazy';
        card.appendChild(img);
      }

      els.adminDataContainer.appendChild(card);
    }

    if (spotChecks.length) {
      const spotHeader = document.createElement('h4');
      spotHeader.textContent = 'Recent Inclinometer Spot Checks';
      els.adminDataContainer.appendChild(spotHeader);

      spotChecks.slice(0, 12).forEach((check) => {
        const card = document.createElement('div');
        card.className = 'data-card';
        const measured = Number(check?.measured_slope_percent);
        const estimated = Number(check?.estimated_max_slope_percent);
        const lat = Number(check?.lat);
        const lng = Number(check?.lng);
        const locationText = (Number.isFinite(lat) && Number.isFinite(lng))
          ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
          : 'Unknown';
        const createdAt = String(check?.created_at || '').replace('T', ' ').slice(0, 19);
        card.innerHTML = `<p><strong>Measured:</strong> ${Number.isFinite(measured) ? `${measured.toFixed(1)}%` : '-'}</p>
          <p><strong>Estimated max:</strong> ${Number.isFinite(estimated) ? `${estimated.toFixed(1)}%` : '-'}</p>
          <p><strong>Profile:</strong> ${escapeHtml(String(check?.profile_type || '-'))}</p>
          <p><strong>Captured:</strong> ${escapeHtml(createdAt || '-')}</p>
          <p><strong>Location:</strong> ${escapeHtml(locationText)}</p>
          ${check?.notes ? `<p>${escapeHtml(String(check.notes))}</p>` : ''}`;
        els.adminDataContainer.appendChild(card);
      });
    }

    if (gradientProfiles.length) {
      const profileHeader = document.createElement('h4');
      profileHeader.textContent = 'Recent Gradient Profiles';
      els.adminDataContainer.appendChild(profileHeader);

      gradientProfiles.slice(0, 12).forEach((profile) => {
        const card = document.createElement('div');
        card.className = 'data-card';
        const maxSlope = Number(profile?.max_slope_percent);
        const avgSlope = Number(profile?.average_slope_percent);
        const steepDistance = Number(profile?.steep_distance_meters);
        const sampleMeters = Number(profile?.sample_meters);
        const createdAt = String(profile?.created_at || '').replace('T', ' ').slice(0, 19);
        card.innerHTML = `<p><strong>Profile:</strong> ${escapeHtml(String(profile?.profile_type || '-'))}</p>
          <p><strong>Sample:</strong> ${Number.isFinite(sampleMeters) ? `${Math.round(sampleMeters)} m` : '-'}</p>
          <p><strong>Max slope:</strong> ${Number.isFinite(maxSlope) ? `${maxSlope.toFixed(1)}%` : '-'}</p>
          <p><strong>Avg slope:</strong> ${Number.isFinite(avgSlope) ? `${avgSlope.toFixed(1)}%` : '-'}</p>
          <p><strong>Steep distance:</strong> ${Number.isFinite(steepDistance) ? `${Math.round(steepDistance)} m` : '-'}</p>
          <p><strong>Captured:</strong> ${escapeHtml(createdAt || '-')}</p>`;
        els.adminDataContainer.appendChild(card);
      });
    }
  }

  async function loadAdminData(allowTokenPrompt = true) {
    if (!els.adminDataContainer) return;

    els.adminDataContainer.innerHTML = '<p>Loading admin data...</p>';
    try {
      const response = await fetch('/api/admin/data', { headers: buildAdminHeaders() });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401 && allowTokenPrompt) {
        const token = promptForAdminToken();
        if (token) {
          ensureAdminStreamConnected(true);
          return loadAdminData(false);
        }
      }
      if (!response.ok) {
        throw new Error(payload.error || `Admin data failed (${response.status}).`);
      }
      renderAdminData(payload);
    } catch (error) {
      els.adminDataContainer.innerHTML = `<p style="color:#c62828;">${escapeHtml(error.message || 'Admin data unavailable.')}</p>`;
    }
  }

  function connectAdminStream() {
    if (!window.EventSource || !els.adminLiveStatus) return;

    const token = getStoredAdminToken();
    const streamUrl = token
      ? `/api/admin/stream?token=${encodeURIComponent(token)}`
      : '/api/admin/stream';
    const source = new EventSource(streamUrl);
    state.adminStream = source;
    state.adminStreamToken = token;
    els.adminLiveStatus.textContent = 'Live sync: connected';

    source.onmessage = () => {
      scheduleAdminRefresh(350);
    };

    source.onerror = () => {
      els.adminLiveStatus.textContent = 'Live sync: reconnecting...';
      if (source.readyState === EventSource.CLOSED) {
        state.adminStream = null;
        state.adminStreamToken = '';
      }
    };
  }

  function ensureAdminStreamConnected(forceReconnect = false) {
    const token = getStoredAdminToken();
    if (state.adminStream && !forceReconnect && state.adminStreamToken === token) return;
    if (state.adminStream) {
      try {
        state.adminStream.close();
      } catch {}
      state.adminStream = null;
      state.adminStreamToken = '';
    }
    connectAdminStream();
  }

  function updateAdminToggleState(open) {
    if (els.adminToggleBtn) {
      els.adminToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (els.adminFloatingBtn) {
      els.adminFloatingBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  }

  function openAdminSidebar() {
    if (!els.adminSidebar) return;
    if (document.body.classList.contains('mobile-layout') && typeof state.setMobilePanelOpen === 'function') {
      state.setMobilePanelOpen(false, false);
    }
    state.adminLastFocusedElement = document.activeElement;
    els.adminSidebar.classList.add('open');
    els.adminSidebar.setAttribute('aria-modal', 'true');
    setUiBackdropVisible(true);
    updateAdminToggleState(true);
    setNarration('Operations Console opened.');
    if (els.adminCloseBtn) {
      els.adminCloseBtn.focus();
    }
    loadAdminData()
      .finally(() => {
        ensureAdminStreamConnected();
      });
  }

  function closeAdminSidebar() {
    if (!els.adminSidebar) return;
    els.adminSidebar.classList.remove('open');
    els.adminSidebar.setAttribute('aria-modal', 'false');
    setUiBackdropVisible(false);
    updateAdminToggleState(false);
    setNarration('Operations Console closed.');
    if (state.adminStream) {
      try {
        state.adminStream.close();
      } catch {}
      state.adminStream = null;
      state.adminStreamToken = '';
    }
    const fallbackFocus = document.body.classList.contains('mobile-layout')
      ? (els.adminFloatingBtn || els.adminToggleBtn)
      : (els.adminToggleBtn || els.adminFloatingBtn);
    const target = state.adminLastFocusedElement && typeof state.adminLastFocusedElement.focus === 'function'
      ? state.adminLastFocusedElement
      : fallbackFocus;
    if (target && typeof target.focus === 'function') {
      target.focus();
    }
    state.adminLastFocusedElement = null;
  }

  function toggleAdminSidebar() {
    if (!els.adminSidebar) return;
    if (els.adminSidebar.classList.contains('open')) {
      closeAdminSidebar();
      return;
    }
    openAdminSidebar();
  }

  async function submitRouteFeedback(event) {
    event.preventDefault();

    if (!els.routeFeedbackForm || !state.latestRoute) {
      if (els.routeFeedbackStatus) {
        els.routeFeedbackStatus.textContent = 'Calculate a route before sending feedback.';
        els.routeFeedbackStatus.style.color = '#c62828';
      }
      return;
    }

    const form = new FormData(els.routeFeedbackForm);
    const wasUseful = String(form.get('wasUseful') || '').trim();
    const issueResolved = String(form.get('issueResolved') || '').trim();
    const userGroup = String(
      form.get('userGroup')
      || form.get('feedbackUserGroup')
      || document.getElementById('feedbackUserGroup')?.value
      || ''
    ).trim();
    const comments = String(form.get('routeFeedbackComment') || '').trim();

    if (!wasUseful || !issueResolved || !userGroup) {
      if (els.routeFeedbackStatus) {
        els.routeFeedbackStatus.textContent = 'Complete all required feedback fields.';
        els.routeFeedbackStatus.style.color = '#c62828';
      }
      return;
    }

    try {
      const response = await fetch('/api/route-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileType: state.latestRoute.profile,
          userGroup,
          wasUseful,
          issueResolved,
          comments,
          routeDistance: state.latestRoute.distance,
          routeTime: state.latestRoute.time
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Feedback failed (${response.status}).`);
      }

      if (els.routeFeedbackStatus) {
        els.routeFeedbackStatus.textContent = 'Thanks, route feedback saved.';
        els.routeFeedbackStatus.style.color = '#2e7d32';
      }
      void loadCommunityConfidenceSummary({
        profileType: state.latestRoute.profile,
        userGroup
      });
      els.routeFeedbackForm.reset();
      setNarration('Route feedback submitted. Community confidence updated.');
    } catch (error) {
      if (els.routeFeedbackStatus) {
        els.routeFeedbackStatus.textContent = error.message || 'Could not save feedback.';
        els.routeFeedbackStatus.style.color = '#c62828';
      }
      setNarration('Route feedback submission failed.', 'assertive');
    }
  }

  async function submitGradientSpotCheck(event) {
    event.preventDefault();
    if (!state.latestRoute || !state.latestGradientProfile) {
      if (els.spotCheckStatus) {
        els.spotCheckStatus.textContent = 'Calculate a route before logging a spot check.';
        els.spotCheckStatus.style.color = '#c62828';
      }
      return;
    }

    const measuredSlopePercent = Number(els.spotSlopeInput?.value);
    if (!Number.isFinite(measuredSlopePercent) || measuredSlopePercent < 0 || measuredSlopePercent > 45) {
      if (els.spotCheckStatus) {
        els.spotCheckStatus.textContent = 'Measured slope must be between 0 and 45.';
        els.spotCheckStatus.style.color = '#c62828';
      }
      return;
    }

    const currentCenter = map.getCenter();
    const notes = String(els.spotCheckNotes?.value || '').trim();

    if (els.spotCheckSaveBtn) {
      els.spotCheckSaveBtn.disabled = true;
      els.spotCheckSaveBtn.textContent = 'Saving...';
    }

    try {
      const response = await fetch('/api/gradient/spot-checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: currentCenter.lat,
          lng: currentCenter.lng,
          measuredSlopePercent,
          estimatedMaxSlopePercent: state.latestGradientProfile.maxSlopePercent,
          estimatedAvgSlopePercent: state.latestGradientProfile.averageSlopePercent,
          sampleMeters: state.latestGradientProfile.sampleMeters,
          profileType: state.latestRoute.profile,
          routeDistance: state.latestRoute.distance,
          notes
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Spot check save failed (${response.status}).`);
      }

      if (els.spotCheckStatus) {
        els.spotCheckStatus.textContent = 'Spot check saved.';
        els.spotCheckStatus.style.color = '#2e7d32';
      }
      if (els.spotCheckNotes) {
        els.spotCheckNotes.value = '';
      }
      setNarration('Inclinometer spot check saved.');
      scheduleAdminRefresh(250);
    } catch (error) {
      if (els.spotCheckStatus) {
        els.spotCheckStatus.textContent = error.message || 'Could not save spot check.';
        els.spotCheckStatus.style.color = '#c62828';
      }
      setNarration('Inclinometer spot check save failed.', 'assertive');
    } finally {
      if (els.spotCheckSaveBtn) {
        els.spotCheckSaveBtn.disabled = false;
        els.spotCheckSaveBtn.textContent = 'Log Spot Check';
      }
    }
  }

  function clearAll() {
    state.startPoint = null;
    state.endPoint = null;
    state.startLabel = '';
    state.endLabel = '';
    state.reportMode = false;
    state.reportCoordinate = null;
    state.reportLabel = '';
    state.voiceDraftText = '';
    state.voiceInterimText = '';
    state.voiceConfidenceScores = [];
    state.voiceCapturePoint = null;
    state.voiceDetectedSpeech = false;
    clearVoiceSilenceTimer();

    clearQuickTagPlacement();
    hideQuickTagFeedback();
    clearVoiceCaptureMarker();
    clearPointMarkers();
    clearRouteLayers();
    resetRouteInfo();
    clearStatus();

    if (els.evidenceForm) {
      els.evidenceForm.reset();
    }
    if (els.gradientSpotCheckForm) {
      els.gradientSpotCheckForm.reset();
    }

    map.setView(UCC_CENTER, 17);
    updatePointUI();
    setNarration('Start point, destination, routes, and temporary markers cleared.');
  }

  async function handleMapClick(event) {
    const latlng = event.latlng;

    if (state.quickTagPendingType) {
      const selectedType = state.quickTagPendingType;
      const hazardLabel = QUICK_TAG_TEXT[selectedType] || selectedType;
      clearQuickTagPlacement();
      showQuickTagFeedback(`Submitting: ${hazardLabel}...`, 'info', 0);
      showStatus(`Submitting quick report: ${hazardLabel}...`, 'loading');
      try {
        const submitResult = await submitQuickBarrier(selectedType, latlng);
        await loadBarriers();
        const locationSuffix = submitResult?.locationLabel ? ` near ${submitResult.locationLabel}` : '';
        showQuickTagFeedback(`Submitted: ${hazardLabel}${locationSuffix}.`, 'success', 3600);
        showStatus(`Quick report submitted: ${hazardLabel}${locationSuffix}.`, 'loading');
        flashQuickTagCaptureMarker(latlng, `${hazardLabel} captured${locationSuffix}.`, 'success');
        setTimeout(clearStatus, 1600);
        setNarration(`Quick report submitted for ${hazardLabel}${locationSuffix}. Marker placed at the captured location.`);
      } catch (error) {
        flashQuickTagCaptureMarker(latlng, `${hazardLabel} report failed.`, 'error');
        showQuickTagFeedback(error.message || 'Quick report failed.', 'error', 3800);
        showStatus(error.message || 'Quick tag failed.', 'error');
        setNarration('Quick report failed. Select a symbol and try again.', 'assertive');
      }
      return;
    }

    if (state.reportMode) {
      state.reportMode = false;
      openReportModal(latlng);
      clearStatus();
      map.getContainer().style.cursor = '';
      setNarration('Report location selected on map.');
      return;
    }

    if (!state.startPoint) {
      state.startPoint = latlng;
      state.startLabel = LOCATION_RESOLVING_LABEL;
      ensureMarker('start', latlng);
      updatePointUI();
      updatePointLabel('start', latlng);
      setNarration('Start point selected. Resolving location name.');
      return;
    }

    if (!state.endPoint) {
      state.endPoint = latlng;
      state.endLabel = LOCATION_RESOLVING_LABEL;
      ensureMarker('end', latlng);
      updatePointUI();
      updatePointLabel('end', latlng);
      setNarration('Destination selected. Resolving location name.');
      return;
    }

    state.startPoint = latlng;
    state.startLabel = LOCATION_RESOLVING_LABEL;
    state.endPoint = null;
    state.endLabel = '';
    ensureMarker('start', latlng);
    if (state.endMarker) {
      map.removeLayer(state.endMarker);
      state.endMarker = null;
    }
    clearRouteLayers();
    resetRouteInfo();
    updatePointUI();
    updatePointLabel('start', latlng);
    setNarration('Start point reset. Choose destination again.');
  }

  function wirePanelToggle() {
    if (!els.controlPanel || !els.panelToggleBtn) return;
    const mobileQuery = window.matchMedia('(max-width: 900px)');
    state.mobileQuery = mobileQuery;
    const isMobile = () => mobileQuery.matches;

    const syncMobileUiState = () => {
      const open = els.controlPanel.classList.contains('mobile-open');
      const mobile = isMobile();
      document.body.classList.toggle('mobile-layout', mobile);
      document.body.classList.toggle('mobile-panel-open', mobile && open);
      if (els.adminSidebar && els.adminSidebar.classList.contains('open')) {
        setUiBackdropVisible(true);
      } else {
        setUiBackdropVisible(false);
      }
    };

    const updateToggleLabel = () => {
      const open = els.controlPanel.classList.contains('mobile-open');
      if (els.panelToggleBtn) {
        els.panelToggleBtn.textContent = open ? 'Hide Controls' : 'Controls';
        els.panelToggleBtn.setAttribute('aria-label', open ? 'Hide controls panel' : 'Show controls panel');
        els.panelToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      if (els.panelSnapBtn) {
        els.panelSnapBtn.textContent = open ? 'Hide Controls' : 'Show Controls';
        els.panelSnapBtn.setAttribute('aria-label', open ? 'Hide controls panel' : 'Show controls panel');
        els.panelSnapBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
    };

    const setMobilePanelOpen = (open, announce = false) => {
      if (!isMobile()) return;
      els.controlPanel.classList.toggle('mobile-open', Boolean(open));
      syncMobileUiState();
      updateToggleLabel();
      setTimeout(() => {
        map.invalidateSize();
      }, 260);
      if (announce) {
        setNarration(open ? 'Controls panel expanded.' : 'Controls panel collapsed.');
      }
    };
    state.setMobilePanelOpen = setMobilePanelOpen;

    els.panelToggleBtn.addEventListener('click', () => {
      if (!isMobile()) return;
      const open = els.controlPanel.classList.contains('mobile-open');
      setMobilePanelOpen(!open, true);
    });

    if (els.panelSnapBtn) {
      els.panelSnapBtn.addEventListener('click', () => {
        if (!isMobile()) return;
        const open = els.controlPanel.classList.contains('mobile-open');
        setMobilePanelOpen(!open, true);
      });
    }

    const applyDefaultPanelState = () => {
      if (isMobile()) {
        // Mobile starts map-first with controls collapsed.
        els.controlPanel.classList.remove('mobile-open');
      } else {
        els.controlPanel.classList.remove('mobile-open');
      }
      syncMobileUiState();
      updateToggleLabel();
      setTimeout(() => {
        map.invalidateSize();
      }, 260);
    };

    if (typeof mobileQuery.addEventListener === 'function') {
      mobileQuery.addEventListener('change', applyDefaultPanelState);
    } else if (typeof mobileQuery.addListener === 'function') {
      mobileQuery.addListener(applyDefaultPanelState);
    }

    applyDefaultPanelState();
  }

  function readStoredFlag(key) {
    try {
      return window.localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  function writeStoredFlag(key, value) {
    try {
      if (value) {
        window.localStorage.setItem(key, '1');
      } else {
        window.localStorage.removeItem(key);
      }
    } catch {}
  }

  function updateAccessibilityButton(button, enabled) {
    if (!button) return;
    button.classList.toggle('active', enabled);
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  }

  function wireAccessibilityToggles() {
    const textModeEnabled = readStoredFlag(ACCESSIBILITY_TEXT_MODE_STORAGE_KEY);
    const contrastModeEnabled = readStoredFlag(ACCESSIBILITY_CONTRAST_MODE_STORAGE_KEY);
    document.body.classList.toggle('accessibility-text-mode', textModeEnabled);
    document.body.classList.toggle('accessibility-contrast-mode', contrastModeEnabled);
    updateAccessibilityButton(els.toggleTextModeBtn, textModeEnabled);
    updateAccessibilityButton(els.toggleContrastModeBtn, contrastModeEnabled);

    if (els.toggleTextModeBtn) {
      els.toggleTextModeBtn.addEventListener('click', () => {
        const enabled = !document.body.classList.contains('accessibility-text-mode');
        document.body.classList.toggle('accessibility-text-mode', enabled);
        writeStoredFlag(ACCESSIBILITY_TEXT_MODE_STORAGE_KEY, enabled);
        updateAccessibilityButton(els.toggleTextModeBtn, enabled);
        setNarration(enabled ? 'Readable Text mode enabled.' : 'Readable Text mode disabled.');
      });
    }

    if (els.toggleContrastModeBtn) {
      els.toggleContrastModeBtn.addEventListener('click', () => {
        const enabled = !document.body.classList.contains('accessibility-contrast-mode');
        document.body.classList.toggle('accessibility-contrast-mode', enabled);
        writeStoredFlag(ACCESSIBILITY_CONTRAST_MODE_STORAGE_KEY, enabled);
        updateAccessibilityButton(els.toggleContrastModeBtn, enabled);
        setNarration(enabled ? 'High Contrast mode enabled.' : 'High Contrast mode disabled.');
      });
    }
  }

  function wireEvents() {
    map.on('click', handleMapClick);

    if (els.routeBtn) {
      els.routeBtn.addEventListener('click', calculateRoutes);
    }

    if (els.profileSelect) {
      els.profileSelect.addEventListener('change', () => {
        writeStoredProfileId(els.profileSelect.value);
        void loadCommunityConfidenceSummary({
          profileType: els.profileSelect.value
        });
      });
    }

    if (els.clearBtn) {
      els.clearBtn.addEventListener('click', clearAll);
    }

    if (els.reportBtn) {
      els.reportBtn.addEventListener('click', () => {
        clearQuickTagPlacement();
        state.reportMode = true;
        map.getContainer().style.cursor = 'crosshair';
        showStatus(`Report mode on: ${MAP_POINT_ACTION.toLowerCase()} hazard location.`, 'loading');
        setNarration(`Manual report mode enabled. ${MAP_POINT_VERB} the map to choose barrier location.`);
      });
    }

    if (els.closeReportModal) {
      els.closeReportModal.addEventListener('click', closeReportModal);
    }

    if (els.comprehensiveReportModal) {
      els.comprehensiveReportModal.addEventListener('click', (event) => {
        if (event.target === els.comprehensiveReportModal) {
          closeReportModal();
        }
      });
    }

    if (els.evidenceForm) {
      els.evidenceForm.addEventListener('submit', submitBarrierReport);
    }

    if (els.routeFeedbackForm) {
      els.routeFeedbackForm.addEventListener('submit', submitRouteFeedback);
    }

    if (els.gradientSampleSelect) {
      els.gradientSampleSelect.addEventListener('change', () => {
        state.gradientSampleMeters = normalizeSampleMeters(els.gradientSampleSelect.value);
        void refreshGradientDetails(true);
      });
    }

    if (els.gradientSpotCheckForm) {
      els.gradientSpotCheckForm.addEventListener('submit', submitGradientSpotCheck);
    }

    if (els.adminToggleBtn) {
      els.adminToggleBtn.addEventListener('click', toggleAdminSidebar);
    }

    if (els.adminFloatingBtn) {
      els.adminFloatingBtn.addEventListener('click', toggleAdminSidebar);
    }

    if (els.adminCloseBtn) {
      els.adminCloseBtn.addEventListener('click', closeAdminSidebar);
    }

    if (els.uiBackdrop) {
      els.uiBackdrop.addEventListener('click', () => {
        if (els.adminSidebar && els.adminSidebar.classList.contains('open')) {
          closeAdminSidebar();
        }
      });
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        trapModalFocus(event);
        trapSidebarFocus(event);
      }
      if (event.key !== 'Escape') return;

      if (state.quickTagPendingType) {
        clearQuickTagPlacement();
        showQuickTagFeedback('Quick report placement cancelled.', 'info', 2200);
        clearStatus();
        setNarration('Quick report placement cancelled.');
        return;
      }

      if (els.comprehensiveReportModal && els.comprehensiveReportModal.style.display === 'flex') {
        closeReportModal();
        return;
      }

      if (els.adminSidebar && els.adminSidebar.classList.contains('open')) {
        closeAdminSidebar();
      }
    });
  }

  function startGraphhopperPolling() {
    updateGraphhopperStatus();
    state.graphhopperTimer = setInterval(updateGraphhopperStatus, GRAPHOPPER_STATUS_REFRESH_MS);
  }

  async function init() {
    if (els.temporalModeHint) {
      els.temporalModeHint.textContent = MAP_POINT_ACTION_SENTENCE;
    }
    if (els.gradientSampleSelect) {
      els.gradientSampleSelect.value = String(state.gradientSampleMeters);
    }

    resetRouteInfo();
    updatePointUI();
    updateAdminToggleState(false);
    setUiBackdropVisible(false);
    wireViewportMetrics();
    wireEvents();
    wirePanelToggle();
    wireAccessibilityToggles();
    wireQuickTags();
    wireVoiceReport();
    await loadAccessibilityProfiles();
    loadGradientSourceMode();
    loadCommunityConfidenceSummary({
      profileType: els.profileSelect ? els.profileSelect.value : ''
    });
    loadBarriers();
    startGraphhopperPolling();
    showStartupGuidance();
  }

  void init();
});
