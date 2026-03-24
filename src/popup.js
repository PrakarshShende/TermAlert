'use strict';

// ============================================================
// TermAlert Popup - Connected to background.js + content.js
// ============================================================

var PAGE_TITLES = {
  analyze: 'TermAlert',
  summary: 'Plain Summary',
  history: 'Scan History',
  settings: 'Settings'
};

var PROVIDER_LABELS = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini'
};

var PROVIDER_DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  gemini: 'gemini-2.0-flash'
};

var state = {
  aiProvider: 'openai',
  apiKeys: {
    openai: '',
    anthropic: '',
    gemini: ''
  },
  aiModels: {
    openai: PROVIDER_DEFAULT_MODELS.openai,
    anthropic: PROVIDER_DEFAULT_MODELS.anthropic,
    gemini: PROVIDER_DEFAULT_MODELS.gemini
  },
  analyzed: false,
  currentScore: 0,
  currentDomain: '',
  currentFlags: [],
  currentResult: null,
  history: [],
  profileType: 'default',
  customRedLines: []
};

// ---- PROFILE PRESET DEFINITIONS ----
var PROFILE_PRESETS = {
  default: [
    'Flag any mandatory arbitration or class-action waiver',
    'Flag broad data sharing with unnamed third parties',
    'Flag unilateral right to change terms without notice'
  ],
  privacy: [
    'Flag any sale of personal data to third parties',
    'Flag cross-site or cross-device tracking',
    'Flag sharing data with advertisers or data brokers',
    'Flag collection of biometric or location data',
    'Flag indefinite data retention policies'
  ],
  freelancer: [
    'Flag any clause transferring IP ownership to the platform',
    'Flag royalty-free perpetual license on user content',
    'Flag restrictions on removing or exporting your work',
    'Flag non-compete clauses tied to platform usage',
    'Flag clauses allowing platform to sublicense your content'
  ],
  bargain: [
    'Flag hidden fees or charges not shown at checkout',
    'Flag auto-renewal with difficult cancellation process',
    'Flag non-refundable clauses or restocking fees',
    'Flag price increase without explicit user consent',
    'Flag minimum commitment or early termination penalties'
  ]
};

var PROFILE_LABELS = {
  default: 'Default',
  privacy: 'Privacy Purist',
  freelancer: 'Freelancer/Creator',
  bargain: 'Bargain Hunter',
  custom: 'Custom'
};

function getRedLinesArray() {
  var textarea = document.getElementById('redLinesInput');
  if (!textarea) return state.customRedLines || [];
  return textarea.value
    .split('\n')
    .map(function (l) { return l.trim(); })
    .filter(function (l) { return l.length > 0; });
}

function populateRedLines(presetKey) {
  var textarea = document.getElementById('redLinesInput');
  var tag = document.getElementById('presetTag');
  if (!textarea) return;

  if (PROFILE_PRESETS[presetKey]) {
    textarea.value = PROFILE_PRESETS[presetKey].join('\n');
  }

  state.profileType = presetKey;
  state.customRedLines = getRedLinesArray();
  if (tag) tag.textContent = PROFILE_LABELS[presetKey] || presetKey;
}

// ---- UI BINDINGS ----
function bindUI() {
  var logo = document.getElementById('logoMark');
  if (logo) logo.addEventListener('click', function () { switchPage('analyze'); });

  var exportBtn = document.getElementById('exportBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportReport);

  var analyzeBtn = document.getElementById('analyzeBtn');
  if (analyzeBtn) analyzeBtn.addEventListener('click', startAnalysis);

  var clearHistoryBtn = document.getElementById('clearHistoryBtn');
  if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', clearHistory);

  var saveSettingsBtn = document.getElementById('saveSettingsBtn');
  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettings);

  var apiStatus = document.getElementById('apiStatus');
  if (apiStatus) apiStatus.addEventListener('click', function () { switchPage('settings'); });

  var providerSelect = document.getElementById('aiProviderSelect');
  if (providerSelect) {
    providerSelect.addEventListener('change', function () {
      state.aiProvider = providerSelect.value || 'openai';
      getCurrentProviderKey();
      getCurrentProviderModel();
      applyProviderUI();
    });
  }

  document.querySelectorAll('.toggle').forEach(function (toggle) {
    toggle.addEventListener('click', function () { toggleSetting(toggle); });
  });

  document.querySelectorAll('.risk-chip').forEach(function (chip) {
    chip.addEventListener('click', function () { chip.classList.toggle('off'); });
  });

  // --- Profile Presets & Red Lines ---
  var presetSelect = document.getElementById('profilePreset');
  var redLinesInput = document.getElementById('redLinesInput');

  if (presetSelect) {
    presetSelect.addEventListener('change', function () {
      var key = presetSelect.value;
      if (key !== 'custom') {
        populateRedLines(key);
      } else {
        state.profileType = 'custom';
        var tag = document.getElementById('presetTag');
        if (tag) tag.textContent = 'Custom';
      }
    });
  }

  if (redLinesInput) {
    redLinesInput.addEventListener('input', function () {
      // If user edits text and it no longer matches current preset, auto-switch to Custom
      var currentPreset = state.profileType;
      if (currentPreset !== 'custom' && PROFILE_PRESETS[currentPreset]) {
        var presetText = PROFILE_PRESETS[currentPreset].join('\n');
        if (redLinesInput.value !== presetText) {
          state.profileType = 'custom';
          if (presetSelect) presetSelect.value = 'custom';
          var tag = document.getElementById('presetTag');
          if (tag) tag.textContent = 'Custom';
        }
      }
      state.customRedLines = getRedLinesArray();
    });
  }
}

function getCurrentProviderKey() {
  var input = document.getElementById('apiKeyInput');
  if (input) state.apiKeys[state.aiProvider] = input.value.trim();
  return state.apiKeys[state.aiProvider] || '';
}

function getCurrentProviderModel() {
  var input = document.getElementById('aiModelInput');
  if (input) state.aiModels[state.aiProvider] = input.value.trim() || PROVIDER_DEFAULT_MODELS[state.aiProvider];
  return state.aiModels[state.aiProvider] || PROVIDER_DEFAULT_MODELS[state.aiProvider];
}

function applyProviderUI() {
  var provider = state.aiProvider || 'openai';
  var providerSelect = document.getElementById('aiProviderSelect');
  var apiKeyInput = document.getElementById('apiKeyInput');
  var apiKeyLabel = document.getElementById('apiKeyLabel');
  var modelInput = document.getElementById('aiModelInput');

  if (providerSelect) providerSelect.value = provider;
  if (apiKeyLabel) apiKeyLabel.textContent = (PROVIDER_LABELS[provider] || provider) + ' API Key';

  if (apiKeyInput) {
    apiKeyInput.placeholder = provider === 'openai' ? 'sk-...' : provider === 'anthropic' ? 'sk-ant-...' : 'AIza...';
    apiKeyInput.value = state.apiKeys[provider] || '';
  }

  if (modelInput) {
    modelInput.value = state.aiModels[provider] || PROVIDER_DEFAULT_MODELS[provider];
  }

  updateApiStatus();
}

function updateApiStatus() {
  var apiStatus = document.getElementById('apiStatus');
  if (!apiStatus) return;
  var provider = state.aiProvider || 'openai';
  var providerName = PROVIDER_LABELS[provider] || provider;
  var key = state.apiKeys[provider] || '';
  if (key) {
    apiStatus.textContent = providerName + ' key set';
    apiStatus.style.color = 'var(--green)';
  } else {
    apiStatus.textContent = 'No API key';
    apiStatus.style.color = '';
  }
}
// ---- INIT: load settings + page info ----
function init() {
  applyProviderUI();
  // Load settings from storage
  chrome.runtime.sendMessage({ action: 'loadSettings' }, function (resp) {
    if (resp && resp.settings) {
      var savedProvider = resp.settings.aiProvider || 'openai';
      var savedKeys = resp.settings.apiKeys || {};
      var savedModels = resp.settings.aiModels || {};

      state.aiProvider = savedProvider;
      state.apiKeys.openai = savedKeys.openai || resp.settings.apiKey || '';
      state.apiKeys.anthropic = savedKeys.anthropic || '';
      state.apiKeys.gemini = savedKeys.gemini || '';
      state.aiModels.openai = savedModels.openai || PROVIDER_DEFAULT_MODELS.openai;
      state.aiModels.anthropic = savedModels.anthropic || PROVIDER_DEFAULT_MODELS.anthropic;
      state.aiModels.gemini = savedModels.gemini || PROVIDER_DEFAULT_MODELS.gemini;
      applyProviderUI();

      // Apply toggle states
      if (resp.settings.autoDetect === false) toggleOff('toggleAutoDetect');
      if (resp.settings.highRisk === false) toggleOff('toggleHighRisk');
      if (resp.settings.overlay === false) toggleOff('toggleOverlay');
      if (resp.settings.saveHistory === false) toggleOff('toggleSaveHistory');
      if (resp.settings.analytics === true) toggleOn('toggleAnalytics');
      if (resp.settings.policyChange === true) toggleOn('togglePolicyChange');

      // Restore Analysis Preferences
      var savedProfile = resp.settings.profileType || 'default';
      var savedRedLines = resp.settings.customRedLines || [];
      state.profileType = savedProfile;
      state.customRedLines = savedRedLines;

      var presetSelect = document.getElementById('profilePreset');
      var redLinesInput = document.getElementById('redLinesInput');
      var presetTag = document.getElementById('presetTag');

      if (presetSelect) presetSelect.value = savedProfile;
      if (presetTag) presetTag.textContent = PROFILE_LABELS[savedProfile] || savedProfile;

      if (redLinesInput) {
        if (savedRedLines.length > 0) {
          redLinesInput.value = savedRedLines.join('\n');
        } else if (PROFILE_PRESETS[savedProfile]) {
          redLinesInput.value = PROFILE_PRESETS[savedProfile].join('\n');
          state.customRedLines = PROFILE_PRESETS[savedProfile].slice();
        }
      }
    }
  });

  // Get current tab info
  chrome.runtime.sendMessage({ action: 'getActiveTabInfo' }, function (resp) {
    if (!resp) return;
    state.currentDomain = resp.domain || '';
    document.getElementById('sitePill').textContent = state.currentDomain || 'No page';
    document.getElementById('cpcDomain').textContent = state.currentDomain || 'Unknown page';

    if (resp.isTermsPage) {
      document.getElementById('cpcStatus').textContent = 'T&C page detected - ready to scan';
      document.getElementById('cpcIcon').textContent = String.fromCodePoint(128737);
      setStatus('idle', 'T&C page detected');
    } else if (resp.termsLinks && resp.termsLinks.length) {
      document.getElementById('cpcStatus').textContent = resp.termsLinks.length + ' T&C link(s) found on this page';
      setStatus('idle', 'Found T&C links on page');
    } else {
      document.getElementById('cpcStatus').textContent = 'Navigate to a Terms & Conditions page to analyze';
      setStatus('idle', 'Ready to analyze');
    }
  });

  // Load history
  loadHistory();
}

// ---- SIDEBAR NAV ----
document.querySelectorAll('.nav-item').forEach(function (item) {
  item.addEventListener('click', function () {
    switchPage(this.dataset.page);
  });
});

function switchPage(page) {
  document.querySelectorAll('.nav-item').forEach(function (n) {
    n.classList.toggle('active', n.dataset.page === page);
  });
  document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
  var el = document.getElementById('page-' + page);
  if (el) {
    el.classList.add('active');
    el.classList.remove('fade-in');
    void el.offsetWidth;
    el.classList.add('fade-in');
  }
  document.getElementById('headerTitle').textContent = PAGE_TITLES[page] || page;
  if (page === 'history') loadHistory();
}

// ---- ANALYSIS ----
var _analysisCooldownUntil = 0;

function startAnalysis() {
  // Debounce guard: prevent rapid re-clicks and enforce cooldown after rate limit
  var now = Date.now();
  if (now < _analysisCooldownUntil) {
    var waitSec = Math.ceil((_analysisCooldownUntil - now) / 1000);
    showToast('Please wait ' + waitSec + ' more second' + (waitSec === 1 ? '' : 's') + ' before retrying.');
    return;
  }

  var btn = document.getElementById('analyzeBtn');
  btn.disabled = true;
  btn.textContent = 'Scanning...';

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('resultsState').style.display = 'none';
  document.getElementById('analyzingState').style.display = '';

  setStatus('scanning', 'Extracting T&C text...');

  // Step 1: Extract text from page
  var steps = ['step1', 'step2', 'step3', 'step4'];
  var stepIdx = 0;

  function advanceStep() {
    if (stepIdx > 0) markStepDone(steps[stepIdx - 1]);
    if (stepIdx < steps.length) {
      markStepActive(steps[stepIdx]);
      stepIdx++;
    }
  }

  advanceStep(); // step1 active

  chrome.runtime.sendMessage({ action: 'extractPageText' }, function (resp) {
    if (chrome.runtime.lastError || !resp || resp.error) {
      var errMsg = (resp && resp.error) || 'Could not extract page text. Navigate to a T&C page first.';
      showAnalysisError(errMsg);
      return;
    }

    advanceStep(); // step2 active - got text
    setStatus('scanning', 'Analyzing with AI...');

    var textData = resp;

    // Step 2: Send to AI via background
    chrome.runtime.sendMessage({
      action: 'analyzeText',
      provider: state.aiProvider,
      model: getCurrentProviderModel(),
      apiKey: getCurrentProviderKey(),
      text: textData.text,
      domain: textData.domain || state.currentDomain,
      customRedLines: getRedLinesArray()
    }, function (aiResp) {
      advanceStep(); // step3 active

      if (chrome.runtime.lastError || !aiResp) {
        showAnalysisError('Analysis failed. Check your API key in Settings.');
        return;
      }
      if (aiResp.error) {
        if (aiResp.isRateLimit) {
          // Enforce a 30-second cooldown before allowing retry
          _analysisCooldownUntil = Date.now() + 30000;
          showAnalysisError('RATE_LIMIT');
        } else {
          showAnalysisError(aiResp.error);
        }
        return;
      }

      var result = aiResp.result || aiResp;
      state.currentResult = result;
      state.currentFlags = result.flags || [];

      advanceStep(); // step4 active

      setTimeout(function () {
        advanceStep(); // all done
        showResults(result, textData.domain || state.currentDomain, aiResp.demo);
      }, 600);
    });
  });
}

function markStepDone(id) {
  var el = document.getElementById(id);
  if (el) { el.className = 'scan-step done'; }
}
function markStepActive(id) {
  var el = document.getElementById(id);
  if (el) { el.className = 'scan-step active'; }
}

function showAnalysisError(msg) {
  document.getElementById('analyzingState').style.display = 'none';
  document.getElementById('emptyState').style.display = '';
  var btn = document.getElementById('analyzeBtn');
  btn.disabled = false;

  if (msg === 'RATE_LIMIT') {
    btn.textContent = 'Retry in 30s';
    setStatus('idle', 'Rate limit hit — please wait');
    showToast('\u26A0\uFE0F Our AI assistant is a bit overwhelmed right now! Please wait about 30 seconds and try again.');
    // Re-enable the button label after the cooldown
    setTimeout(function () { if (btn.textContent === 'Retry in 30s') btn.textContent = 'Analyze'; }, 30000);
  } else {
    btn.textContent = 'Analyze';
    setStatus('idle', 'Error: ' + msg.slice(0, 60));
    showToast(msg);
  }
}

function showResults(result, domain, isDemo) {
  document.getElementById('analyzingState').style.display = 'none';
  document.getElementById('resultsState').style.display = '';
  state.analyzed = true;
  state.currentScore = result.score || 0;

  var score = result.score || 0;
  var color = score >= 70 ? 'var(--red)' : score >= 40 ? 'var(--amber)' : 'var(--green)';
  var verdict = result.verdict || (score >= 70 ? 'HIGH RISK' : score >= 40 ? 'MODERATE' : 'SAFE');

  // Gauge
  var bar = document.getElementById('gaugeBar');
  bar.style.background = 'linear-gradient(90deg, var(--green), var(--amber), ' + color + ')';
  setTimeout(function () { bar.style.width = score + '%'; }, 80);

  var scoreEl = document.getElementById('gaugeScore');
  scoreEl.style.color = color;
  var cur = 0;
  var tick = setInterval(function () {
    cur = Math.min(cur + 3, score);
    scoreEl.textContent = cur;
    if (cur >= score) clearInterval(tick);
  }, 16);

  var vEl = document.getElementById('gaugeVerdict');
  vEl.textContent = verdict + (isDemo ? ' (Demo)' : '');
  vEl.style.background = score >= 70 ? 'var(--red-dim)' : score >= 40 ? 'var(--amber-dim)' : 'var(--green-dim)';
  vEl.style.color = color;

  // Stats
  var flags = result.flags || [];
  var highCount = flags.filter(function (f) { return f.severity === 'high'; }).length;
  var medCount = flags.filter(function (f) { return f.severity === 'medium'; }).length;
  document.getElementById('statHigh').textContent = highCount;
  document.getElementById('statMed').textContent = medCount;
  document.getElementById('statPages').textContent = result.readTimeMinutes ? Math.ceil(result.readTimeMinutes / 7) : '?';
  document.getElementById('flagCount').textContent = flags.length;

  // Render flag cards
  var list = document.getElementById('flagsList');
  list.innerHTML = '';
  flags.forEach(function (f) {
    var card = document.createElement('div');
    card.className = 'flag-card';
    card.innerHTML =
      '<div class="flag-dot ' + f.severity + '"></div>' +
      '<div class="flag-content">' +
      '<div class="flag-title">' + escHtml(f.title) + '</div>' +
      '<div class="flag-preview">' + escHtml(f.preview) + '</div>' +
      '<div class="flag-detail">' + escHtml(f.detail || '') + '</div>' +
      '</div>' +
      '<span class="flag-severity ' + f.severity + '">' + f.severity.toUpperCase() + '</span>';
    card.addEventListener('click', function () { this.classList.toggle('expanded'); });
    list.appendChild(card);
  });

  // Update Summary page
  updateSummaryPage(result);

  // Badge
  document.getElementById('badgeAnalyze').style.display = score >= 70 ? '' : 'none';

  // Button
  var btn = document.getElementById('analyzeBtn');
  btn.disabled = false;
  btn.textContent = 'Re-scan';

  setStatus('done', 'Score: ' + score + '/100 - ' + verdict);
  showToast('Done! Risk score: ' + score + '/100' + (isDemo ? ' (demo mode - add API key for real analysis)' : ''));

  // Highlight on page if overlay enabled
  if (result.keyPhrases && result.keyPhrases.length) {
    chrome.runtime.sendMessage({ action: 'highlightOnPage', phrases: result.keyPhrases });
  }
}

// ---- SUMMARY PAGE ----
function updateSummaryPage(result) {
  if (!result) return;

  if (result.tldr) {
    document.getElementById('tldrText').textContent = result.tldr;
  }

  if (result.categories) {
    var cats = result.categories;
    var catData = [
      { name: String.fromCodePoint(128274) + ' Data Privacy', key: 'dataPrivacy' },
      { name: String.fromCodePoint(128200) + ' Financial Terms', key: 'financialTerms' },
      { name: String.fromCodePoint(9878) + ' User Rights', key: 'userRights' },
      { name: String.fromCodePoint(128373) + ' IP & Content', key: 'ipContent' },
      { name: String.fromCodePoint(128561) + ' Legal Liability', key: 'legalLiability' }
    ];
    var container = document.getElementById('catBreakdown');
    container.innerHTML = '';
    catData.forEach(function (c) {
      var val = cats[c.key] || 0;
      var color = val >= 70 ? 'var(--red)' : val >= 40 ? 'var(--amber)' : 'var(--green)';
      var row = document.createElement('div');
      row.className = 'cat-row';
      row.innerHTML =
        '<span class="cat-name">' + c.name + '</span>' +
        '<div class="cat-bar-wrap"><div class="cat-bar" style="width:' + val + '%;background:' + color + ';"></div></div>' +
        '<span class="cat-score" style="color:' + color + ';">' + val + '</span>';
      container.appendChild(row);
    });
  }

  // Key takeaways from flags
  var flags = result.flags || [];
  var takeawaysEl = document.getElementById('keyTakeaways');
  takeawaysEl.innerHTML = '';
  flags.slice(0, 4).forEach(function (f) {
    var color = f.severity === 'high' ? 'var(--red)' : f.severity === 'medium' ? 'var(--amber)' : 'var(--green)';
    var dimColor = f.severity === 'high' ? 'var(--red-dim)' : f.severity === 'medium' ? 'var(--amber-dim)' : 'var(--green-dim)';
    var icon = f.severity === 'high' ? '&#10008;' : f.severity === 'medium' ? '&#9888;' : '&#10004;';
    var label = f.severity === 'high' ? 'Watch out' : f.severity === 'medium' ? 'Note' : 'Good';
    var div = document.createElement('div');
    div.style.cssText = 'background:' + dimColor + ';border:1px solid ' + color.replace('var(', 'rgba(').replace(')', ',.25)') + ';border-radius:9px;padding:9px 11px;margin-bottom:6px;font-size:11.5px;color:var(--text2);line-height:1.5;';
    div.innerHTML = '<strong style="color:' + color + ';">' + icon + ' ' + label + ':</strong> ' + escHtml(f.preview);
    takeawaysEl.appendChild(div);
  });
}

// ---- STATUS BAR ----
function setStatus(type, text) {
  var dot = document.getElementById('statusDot');
  document.getElementById('statusText').textContent = text;
  dot.className = 'status-dot ' + (type === 'scanning' ? 'active' : 'idle');
}

// ---- HISTORY ----
function loadHistory() {
  chrome.runtime.sendMessage({ action: 'getHistory' }, function (resp) {
    if (!resp) return;
    state.history = resp.history || [];
    renderHistory();
  });
}

function renderHistory() {
  var list = document.getElementById('historyList');
  document.getElementById('histCount').textContent = state.history.length;

  if (!state.history.length) {
    list.innerHTML = '<div style="text-align:center;padding:30px 20px;color:var(--muted);font-size:12px;">No scans yet. Analyze a page to see history.</div>';
    return;
  }

  list.innerHTML = '';
  state.history.forEach(function (item) {
    var score = item.score || 0;
    var scoreColor = score >= 70 ? 'var(--red)' : score >= 40 ? 'var(--amber)' : 'var(--green)';
    var timeStr = formatTime(item.timestamp);
    var card = document.createElement('div');
    card.className = 'hist-card';
    card.innerHTML =
      '<div class="hist-favicon">' + String.fromCodePoint(127760) + '</div>' +
      '<div class="hist-info">' +
      '<div class="hist-domain">' + escHtml(item.domain) + '</div>' +
      '<div class="hist-date">' + timeStr + ' &middot; ' + (item.flags || 0) + ' flags</div>' +
      '</div>' +
      '<div><div class="hist-score" style="color:' + scoreColor + ';">' + score + '</div>' +
      '<div class="hist-trend">' + (item.verdict || '') + '</div></div>';
    card.addEventListener('click', function () {
      showToast('Loading ' + item.domain + '...');
      switchPage('analyze');
    });
    list.appendChild(card);
  });
}

function formatTime(ts) {
  if (!ts) return 'Unknown';
  var d = new Date(ts);
  var now = new Date();
  var diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

// ---- SETTINGS ----
function toggleSetting(el) { el.classList.toggle('on'); }
function toggleOff(id) { var el = document.getElementById(id); if (el) el.classList.remove('on'); }
function toggleOn(id) { var el = document.getElementById(id); if (el) el.classList.add('on'); }

function saveSettings() {
  getCurrentProviderKey();
  getCurrentProviderModel();
  var settings = {
    aiProvider: state.aiProvider,
    apiKeys: state.apiKeys,
    aiModels: state.aiModels,
    // Keep legacy key for backward compatibility with older versions.
    apiKey: state.apiKeys.openai || '',
    autoDetect: document.getElementById('toggleAutoDetect').classList.contains('on'),
    highRisk: document.getElementById('toggleHighRisk').classList.contains('on'),
    policyChange: document.getElementById('togglePolicyChange').classList.contains('on'),
    overlay: document.getElementById('toggleOverlay').classList.contains('on'),
    saveHistory: document.getElementById('toggleSaveHistory').classList.contains('on'),
    analytics: document.getElementById('toggleAnalytics').classList.contains('on'),
    profileType: state.profileType,
    customRedLines: getRedLinesArray()
  };

  chrome.runtime.sendMessage({ action: 'saveSettings', settings: settings }, function () {
    updateApiStatus();
    showToast('Settings saved!');
  });
}

// ---- EXPORT ----
function exportReport() {
  if (!state.analyzed || !state.currentResult) { showToast('Analyze a page first'); return; }
  var r = state.currentResult;
  var lines = [
    'TermAlert Report',
    '='.repeat(40),
    'Domain: ' + state.currentDomain,
    'Risk Score: ' + r.score + '/100',
    'Verdict: ' + (r.verdict || ''),
    'Generated: ' + new Date().toLocaleString(),
    '',
    'TL;DR',
    '-'.repeat(30),
    r.tldr || '',
    '',
    'Risk Flags (' + (r.flags || []).length + ')',
    '-'.repeat(30)
  ];
  (r.flags || []).forEach(function (f) {
    lines.push('[' + f.severity.toUpperCase() + '] ' + f.title);
    lines.push('  ' + f.preview);
    if (f.detail) lines.push('  Detail: ' + f.detail);
    lines.push('');
  });
  if (r.categories) {
    lines.push('Category Scores', '-'.repeat(30));
    Object.keys(r.categories).forEach(function (k) { lines.push(k + ': ' + r.categories[k] + '/100'); });
  }

  var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'termalert-' + state.currentDomain + '.txt';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Report exported!');
}

// ---- CLEAR HISTORY ----
function clearHistory() {
  chrome.runtime.sendMessage({ action: 'clearHistory' }, function () {
    state.history = [];
    renderHistory();
    showToast('History cleared');
  });
}

// ---- HELPERS ----
function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var toastTimer;
function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2800);
}

// ---- START ----
bindUI();
init();

