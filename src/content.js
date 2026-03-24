(function () {
  'use strict';

  // ============================================================
  // TermAlert Content Script
  // Handles widget UI, page extraction, highlighting, and messages
  // ============================================================

  var runtimeId = '';
  try {
    runtimeId = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) ? chrome.runtime.id : '';
  } catch (e) {
    runtimeId = '';
  }
  if (!runtimeId) return;

  var LOADED_KEY = '__termAlertLoaded_' + runtimeId;
  if (window[LOADED_KEY]) return;
  window[LOADED_KEY] = true;

  var destroyed = false;
  var widgetHost = null;
  var shadowRoot = null;
  var highlightNodes = [];

  var widgetState = {
    score: null,
    verdict: 'Not analyzed',
    summary: 'Open TermAlert to analyze this page.',
    riskLevel: 'none'
  };

  var TERMS_HINTS = [
    'terms of service', 'terms of use', 'terms and conditions',
    'privacy policy', 'user agreement', 'legal terms',
    'eula', 'cookie policy'
  ];

  var LINK_HINTS = [
    'terms', 'privacy', 'policy', 'legal', 'eula', 'cookies'
  ];

  function isContextValid() {
    try {
      return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  function safeSendMessage(message, callback) {
    if (!isContextValid()) return;
    try {
      if (typeof callback === 'function') {
        chrome.runtime.sendMessage(message, function (response) {
          if (chrome.runtime.lastError) return;
          callback(response);
        });
        return;
      }
      chrome.runtime.sendMessage(message);
    } catch (err) { void err; }
  }

  function destroyAll() {
    if (destroyed) return;
    destroyed = true;

    removeHighlights();

    try {
      if (widgetHost && widgetHost.parentNode) widgetHost.parentNode.removeChild(widgetHost);
    } catch (e) {
      void e;
    }
    widgetHost = null;
    shadowRoot = null;

    try {
      delete window[LOADED_KEY];
    } catch (e2) {
      void e2;
    }
  }

  function isTermsPage() {
    var url = String(location.href || '').toLowerCase();
    var title = String(document.title || '').toLowerCase();
    var bodyText = '';
    try {
      bodyText = String((document.body && document.body.textContent) || '').toLowerCase().slice(0, 1200);
    } catch (e) {
      bodyText = '';
    }

    for (var i = 0; i < TERMS_HINTS.length; i++) {
      var hint = TERMS_HINTS[i];
      if (url.indexOf(hint) !== -1 || title.indexOf(hint) !== -1 || bodyText.indexOf(hint) !== -1) {
        return true;
      }
    }
    return false;
  }

  function extractText() {
    var MAX = 12000;
    var text = '';
    try {
      text = (document.body && document.body.textContent) || '';
    } catch (e) {
      text = '';
    }
    return text.replace(/\s+/g, ' ').trim().slice(0, MAX);
  }

  function getTermsLinks() {
    var links = document.querySelectorAll('a[href]');
    var result = [];
    var seen = {};

    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = String(a.getAttribute('href') || '');
      var text = String(a.textContent || '').trim();
      var lowHref = href.toLowerCase();
      var lowText = text.toLowerCase();
      var match = false;

      for (var j = 0; j < LINK_HINTS.length; j++) {
        var hint = LINK_HINTS[j];
        if (lowHref.indexOf(hint) !== -1 || lowText.indexOf(hint) !== -1) {
          match = true;
          break;
        }
      }
      if (!match) continue;

      var abs = '';
      try {
        abs = new URL(href, location.href).href;
      } catch (e) {
        abs = href;
      }

      if (!abs || seen[abs]) continue;
      seen[abs] = true;
      result.push({ href: abs, text: text || abs });
      if (result.length >= 12) break;
    }

    return result;
  }

  function ensureWidget() {
    if (destroyed) return;
    if (widgetHost && shadowRoot) return;

    widgetHost = document.createElement('div');
    widgetHost.id = '__termalert-widget-host';
    document.documentElement.appendChild(widgetHost);

    shadowRoot = widgetHost.attachShadow({ mode: 'open' });

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('src/widget.css');
    shadowRoot.appendChild(link);

    var root = document.createElement('div');
    root.id = 'st-root';
    root.className = 'st-risk-none';
    root.innerHTML = '' +
      '<button id="st-pill" class="st-pill" type="button" title="Open TermAlert">' +
      '  <span class="st-pill-icon">&#128737;</span>' +
      '  <span id="st-pill-badge" class="st-pill-badge">?</span>' +
      '</button>' +
      '<section id="st-dashboard" class="st-dashboard" aria-live="polite">' +
      '  <header class="st-dash-header">' +
      '    <span class="st-dash-logo">&#128737;</span>' +
      '    <span class="st-dash-title">TermAlert</span>' +
      '    <button id="st-close" class="st-dash-close" type="button" aria-label="Close">&#10005;</button>' +
      '  </header>' +
      '  <div class="st-dash-score">' +
      '    <div class="st-score-ring"><span id="st-score-number" class="st-score-number">--</span></div>' +
      '    <div class="st-score-info">' +
      '      <div id="st-score-verdict" class="st-score-verdict">NOT ANALYZED</div>' +
      '      <div id="st-score-summary" class="st-score-summary">Open TermAlert to analyze this page.</div>' +
      '    </div>' +
      '  </div>' +
      '  <footer class="st-dash-footer">' +
      '    <button id="st-open" class="st-btn-analyze" type="button">Open Analyzer</button>' +
      '  </footer>' +
      '</section>';

    shadowRoot.appendChild(root);

    var pill = shadowRoot.getElementById('st-pill');
    var dash = shadowRoot.getElementById('st-dashboard');
    var closeBtn = shadowRoot.getElementById('st-close');
    var openBtn = shadowRoot.getElementById('st-open');

    function showDashboard() {
      if (dash) dash.classList.add('st-visible');
      if (pill) pill.classList.add('st-hidden');
    }

    function hideDashboard() {
      if (dash) dash.classList.remove('st-visible');
      if (pill) pill.classList.remove('st-hidden');
    }

    if (pill) pill.addEventListener('click', showDashboard);
    if (closeBtn) closeBtn.addEventListener('click', hideDashboard);
    if (openBtn) {
      openBtn.addEventListener('click', function () {
        safeSendMessage({ action: 'openPopup' });
      });
    }

    renderWidget();
  }

  function renderWidget() {
    if (!shadowRoot) return;
    var root = shadowRoot.getElementById('st-root');
    var badge = shadowRoot.getElementById('st-pill-badge');
    var scoreEl = shadowRoot.getElementById('st-score-number');
    var verdictEl = shadowRoot.getElementById('st-score-verdict');
    var summaryEl = shadowRoot.getElementById('st-score-summary');

    if (!root || !badge || !scoreEl || !verdictEl || !summaryEl) return;

    root.classList.remove('st-risk-low', 'st-risk-medium', 'st-risk-high', 'st-risk-none');

    var risk = widgetState.riskLevel || 'none';
    if (risk !== 'low' && risk !== 'medium' && risk !== 'high') risk = 'none';
    root.classList.add('st-risk-' + risk);

    if (typeof widgetState.score === 'number') {
      scoreEl.textContent = String(widgetState.score);
      badge.textContent = String(widgetState.score);
    } else {
      scoreEl.textContent = '--';
      badge.textContent = '?';
    }

    verdictEl.textContent = String(widgetState.verdict || 'Not analyzed');
    summaryEl.textContent = String(widgetState.summary || 'Open TermAlert to analyze this page.');
  }

  function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function wrapInMark(textNode, phrase, cls) {
    var parent = textNode.parentNode;
    if (!parent || !textNode.nodeValue) return false;

    var source = textNode.nodeValue;
    var re = new RegExp(escapeRegex(phrase), 'i');
    var match = re.exec(source);
    if (!match) return false;

    var before = source.slice(0, match.index);
    var hit = source.slice(match.index, match.index + match[0].length);
    var after = source.slice(match.index + match[0].length);

    var frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));

    var mark = document.createElement('mark');
    mark.textContent = hit;
    mark.className = cls;
    mark.style.background = cls.indexOf('high') !== -1 ? 'rgba(244,63,94,.24)' : cls.indexOf('medium') !== -1 ? 'rgba(245,158,11,.25)' : 'rgba(16,185,129,.24)';
    mark.style.color = 'inherit';
    mark.style.padding = '0 .12em';
    mark.style.borderRadius = '.2em';
    mark.dataset.termalert = '1';

    frag.appendChild(mark);
    if (after) frag.appendChild(document.createTextNode(after));

    parent.replaceChild(frag, textNode);
    highlightNodes.push(mark);
    return true;
  }

  function removeHighlights() {
    for (var i = 0; i < highlightNodes.length; i++) {
      var el = highlightNodes[i];
      if (!el || !el.parentNode) continue;
      var txt = document.createTextNode(el.textContent || '');
      el.parentNode.replaceChild(txt, el);
    }
    highlightNodes = [];
  }

  function highlightRisks(phrases) {
    removeHighlights();

    if (!Array.isArray(phrases) || !phrases.length) {
      return { done: true, count: 0 };
    }

    var normalized = [];
    for (var i = 0; i < phrases.length; i++) {
      var p = phrases[i];
      var phrase = (p && (p.phrase || p.text || p.preview)) || '';
      var sev = (p && p.severity) || 'medium';
      phrase = String(phrase).trim();
      if (!phrase) continue;
      if (phrase.length > 120) phrase = phrase.slice(0, 120);
      if (phrase.length < 3) continue;
      normalized.push({
        phrase: phrase,
        severity: sev === 'high' || sev === 'low' ? sev : 'medium'
      });
      if (normalized.length >= 12) break;
    }

    if (!normalized.length) {
      return { done: true, count: 0 };
    }

    var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node || !node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        var tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA' || tag === 'INPUT') {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest('#__termalert-widget-host')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var nodes = [];
    var n;
    while ((n = walker.nextNode())) {
      nodes.push(n);
      if (nodes.length >= 4000) break;
    }

    var count = 0;
    for (var ni = 0; ni < nodes.length; ni++) {
      var node = nodes[ni];
      for (var pi = 0; pi < normalized.length; pi++) {
        var item = normalized[pi];
        var cls = 'st-risk-' + item.severity;
        if (wrapInMark(node, item.phrase, cls)) {
          count++;
          break;
        }
      }
      if (count >= 150) break;
    }

    return { done: true, count: count };
  }

  function showSneakyToast(message) {
    ensureWidget();
    if (!shadowRoot) return;

    var existing = shadowRoot.getElementById('st-toast');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var toast = document.createElement('div');
    toast.id = 'st-toast';
    toast.className = 'st-toast';
    toast.innerHTML = '' +
      '<span class="st-toast-icon">&#9888;</span>' +
      '<div class="st-toast-body">' +
      '  <div class="st-toast-title">Policy Update Detected</div>' +
      '  <div class="st-toast-msg"></div>' +
      '</div>' +
      '<button class="st-toast-close" type="button" aria-label="Dismiss">&#10005;</button>' +
      '<div class="st-toast-progress"></div>';

    var msg = toast.querySelector('.st-toast-msg');
    if (msg) msg.textContent = message || 'Terms may have changed since your last visit.';

    var closeBtn = toast.querySelector('.st-toast-close');
    var hideTimer = null;
    function closeToast() {
      toast.classList.add('st-toast-exit');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 320);
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    }
    if (closeBtn) closeBtn.addEventListener('click', closeToast);

    shadowRoot.appendChild(toast);
    requestAnimationFrame(function () {
      toast.classList.add('st-toast-visible');
    });

    hideTimer = setTimeout(closeToast, 8000);
  }

  function getPageInfo() {
    var info = {
      domain: location.hostname,
      url: location.href,
      title: document.title || '',
      isTermsPage: isTermsPage(),
      termsLinks: getTermsLinks()
    };
    return info;
  }

  function handleMessage(msg, sender, sendResponse) {
    if (destroyed || !isContextValid() || !msg) return false;

    if (msg.action === '__extensionReloaded') {
      destroyAll();
      return false;
    }

    if (msg.action === 'extractText') {
      sendResponse({
        text: extractText(),
        domain: location.hostname,
        url: location.href,
        isTermsPage: isTermsPage()
      });
      return false;
    }

    if (msg.action === 'getPageInfo') {
      sendResponse(getPageInfo());
      return false;
    }

    if (msg.action === 'highlightRisks') {
      var result = highlightRisks(msg.phrases || []);
      sendResponse(result);
      return false;
    }

    if (msg.action === 'removeHighlights') {
      removeHighlights();
      sendResponse({ done: true });
      return false;
    }

    if (msg.action === 'updateWidget') {
      ensureWidget();
      widgetState.score = typeof msg.score === 'number' ? msg.score : null;
      widgetState.verdict = msg.verdict || 'Not analyzed';
      widgetState.summary = msg.summary || 'Open TermAlert to analyze this page.';
      widgetState.riskLevel = msg.riskLevel || 'none';
      renderWidget();
      sendResponse({ done: true });
      return false;
    }

    if (msg.action === 'sneakyUpdateDetected') {
      ensureWidget();
      showSneakyToast(msg.message || 'Terms may have changed since your last visit.');
      sendResponse({ done: true });
      return false;
    }

    return false;
  }

  try {
    chrome.runtime.onMessage.addListener(handleMessage);
  } catch (err) {
    console.warn('TermAlert listener registration failed:', err);
    destroyAll();
    return;
  }

  window.addEventListener('pagehide', destroyAll, { once: true });
  window.addEventListener('beforeunload', destroyAll, { once: true });

  if (isTermsPage()) {
    ensureWidget();

    var extracted = extractText();
    safeSendMessage({
      action: 'termsPageDetected',
      url: location.href,
      domain: location.hostname,
      text: extracted
    });

    safeSendMessage({
      action: 'checkSneakyUpdate',
      url: location.href,
      domain: location.hostname,
      text: extracted
    });
  }
})();
