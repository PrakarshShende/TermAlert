'use strict';

// ============================================================
// TermAlert Background Service Worker
// Handles: AI analysis, badge updates, storage, tab tracking
// ============================================================

var OPENAI_API = 'https://api.openai.com/v1/chat/completions';
var ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// --- Badge helpers ---
function setBadge(tabId, score) {
  if (score === null || score === undefined) {
    chrome.action.setBadgeText({ text: '', tabId: tabId });
    return;
  }
  var text = score >= 70 ? '!' : score >= 40 ? score.toString() : '';
  var color = score >= 70 ? '#f43f5e' : score >= 40 ? '#f59e0b' : '#10b981';
  chrome.action.setBadgeText({ text: text, tabId: tabId });
  chrome.action.setBadgeBackgroundColor({ color: color, tabId: tabId });
}

function clearBadge(tabId) {
  chrome.action.setBadgeText({ text: '', tabId: tabId });
}

// --- SHA-256 text hashing (for sneaky update detection) ---
function hashText(text) {
  var encoder = new TextEncoder();
  var data = encoder.encode(text);
  return crypto.subtle.digest('SHA-256', data).then(function (hashBuffer) {
    var hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  });
}

// --- Domain history helpers (sneaky update detection) ---
function getDomainHistory() {
  return new Promise(function (resolve) {
    chrome.storage.local.get('domainHistory', function (data) {
      resolve(data.domainHistory || {});
    });
  });
}

function saveDomainHistory(domainHistory) {
  return new Promise(function (resolve) {
    chrome.storage.local.set({ domainHistory: domainHistory }, resolve);
  });
}

// --- Detect T&C pages and auto-badge ---
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {

  // Content script detected a T&C page
  if (msg.action === 'termsPageDetected') {
    var tabId = sender.tab && sender.tab.id;
    if (!tabId) return false;

    // Check if we have a cached analysis for this domain
    var domain = msg.domain;
    chrome.storage.local.get('termAlertHistory', function (data) {
      var history = data.termAlertHistory || [];
      var cached = null;
      for (var i = 0; i < history.length; i++) {
        if (history[i].domain === domain) { cached = history[i]; break; }
      }
      if (cached && cached.score !== undefined) {
        setBadge(tabId, cached.score);
      } else {
        // Show a dot badge to indicate this is a T&C page
        chrome.action.setBadgeText({ text: 'TC', tabId: tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#6366f1', tabId: tabId });
      }
    });
    return false;
  }

  // --- Sneaky Update: check hash + risk escalation ---
  if (msg.action === 'checkSneakyUpdate') {
    var suDomain = msg.domain;
    var suText = msg.text;
    var tabId = sender.tab && sender.tab.id;

    hashText(suText).then(function (newHash) {
      return getDomainHistory().then(function (domainHistory) {
        var entry = domainHistory[suDomain];

        if (!entry) {
          // First visit — save hash, no comparison yet
          domainHistory[suDomain] = {
            hash: newHash,
            score: null,
            timestamp: Date.now()
          };
          return saveDomainHistory(domainHistory);
        }

        if (entry.hash === newHash) {
          // Same content — send cached widget data if available
          if (tabId && entry.score !== null) {
            chrome.tabs.sendMessage(tabId, {
              action: 'updateWidget',
              score: entry.score,
              verdict: entry.score >= 70 ? 'HIGH RISK' : entry.score >= 40 ? 'MODERATE' : 'SAFE',
              summary: 'Previously analyzed. Score: ' + entry.score + '/100.',
              riskLevel: entry.score >= 70 ? 'high' : entry.score >= 40 ? 'medium' : 'low'
            }, function () { void chrome.runtime.lastError; });
          }
          return;
        }

        // Hash differs — content has changed!
        var oldScore = entry.score;

        // Update the stored hash immediately
        domainHistory[suDomain].hash = newHash;
        domainHistory[suDomain].timestamp = Date.now();
        domainHistory[suDomain]._hashChanged = true;

        // Check if we have a cached score to compare against
        // We look at the termAlertHistory to get the last known score
        return saveDomainHistory(domainHistory).then(function () {
          if (oldScore !== null && tabId) {
            // We have a previous score — compare with it
            // For now, we trigger the toast warning since content changed
            // The full comparison happens when a new analysis is run
            chrome.tabs.sendMessage(tabId, {
              action: 'sneakyUpdateDetected',
              domain: suDomain,
              oldScore: oldScore,
              newScore: null,
              message: 'Warning: ' + suDomain + "'s Terms of Service have changed since your last visit. Run a new analysis to check for increased restrictions."
            }, function () { void chrome.runtime.lastError; });
          }
        });
      });
    }).catch(function (err) {
      console.error('TermAlert: sneaky update check failed', err);
    });
    return false;
  }

  // --- Open extension popup ---
  if (msg.action === 'openPopup') {
    // chrome.action.openPopup() only works in Chrome 99+ and may not work
    // in all contexts. Fall back gracefully.
    if (chrome.action && chrome.action.openPopup) {
      chrome.action.openPopup().catch(function () {
        // Fallback: send a message back so content script can inform user
        void 0;
      });
    }
    return false;
  }

  // Popup requesting page info
  if (msg.action === 'getActiveTabInfo') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs[0]) { sendResponse({ error: 'No active tab' }); return; }
      var tab = tabs[0];
      chrome.tabs.sendMessage(tab.id, { action: 'getPageInfo' }, function (resp) {
        if (chrome.runtime.lastError) {
          sendResponse({ domain: extractDomain(tab.url), url: tab.url, title: tab.title, isTermsPage: false, termsLinks: [] });
          return;
        }
        sendResponse(resp || { domain: extractDomain(tab.url), url: tab.url, title: tab.title });
      });
    });
    return true;
  }

  // Popup requesting text extraction
  if (msg.action === 'extractPageText') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs[0]) { sendResponse({ error: 'No active tab' }); return; }
      chrome.tabs.sendMessage(tabs[0].id, { action: 'extractText' }, function (resp) {
        if (chrome.runtime.lastError) {
          sendResponse({ error: 'Could not extract text. Make sure you are on a T&C page.' });
          return;
        }
        sendResponse(resp);
      });
    });
    return true;
  }

  // Run AI analysis on extracted text
  if (msg.action === 'analyzeText') {
    var apiKey = msg.apiKey;
    var text = msg.text;
    var domain = msg.domain;
    var provider = msg.provider || 'openai';
    var model = msg.model;
    var customRedLines = msg.customRedLines || [];

    if (!apiKey) {
      // Return demo data when no API key
      var demoResult = getDemoAnalysis(domain);
      sendResponse({ demo: true, result: demoResult });
      // Update widget with demo data
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs && tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'updateWidget',
            score: demoResult.score,
            verdict: demoResult.verdict,
            summary: demoResult.tldr,
            riskLevel: demoResult.score >= 70 ? 'high' : demoResult.score >= 40 ? 'medium' : 'low'
          }, function () { void chrome.runtime.lastError; });
        }
      });
      return false;
    }

    runAIAnalysis(apiKey, text, domain, provider, model, customRedLines)
      .then(function (result) {
        // Save to history
        saveToHistory(domain, result);
        // Update badge on active tab
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          if (tabs && tabs[0]) {
            setBadge(tabs[0].id, result.score);
            // Update the floating widget
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'updateWidget',
              score: result.score,
              verdict: result.verdict || (result.score >= 70 ? 'HIGH RISK' : result.score >= 40 ? 'MODERATE' : 'SAFE'),
              summary: result.tldr || result.summary || '',
              riskLevel: result.score >= 70 ? 'high' : result.score >= 40 ? 'medium' : 'low'
            }, function () { void chrome.runtime.lastError; });
          }
        });

        // Update domain history with new score for sneaky update detection
        getDomainHistory().then(function (domainHistory) {
          if (domainHistory[domain]) {
            var oldScore = domainHistory[domain].score;
            var newScore = result.score;

            // If score increased (more risky) AND hash had changed, notify
            if (oldScore !== null && newScore > oldScore && domainHistory[domain]._hashChanged) {
              chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                if (tabs && tabs[0]) {
                  chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'sneakyUpdateDetected',
                    domain: domain,
                    oldScore: oldScore,
                    newScore: newScore,
                    message: 'Warning: ' + domain + "'s Terms of Service have changed and appear more restrictive. Risk score increased from " + oldScore + ' to ' + newScore + '.'
                  }, function () { void chrome.runtime.lastError; });
                }
              });
            }

            domainHistory[domain].score = newScore;
            domainHistory[domain]._hashChanged = false;
            saveDomainHistory(domainHistory);
          }
        });

        sendResponse({ result: result });
      })
      .catch(function (err) {
        var errMsg = err.message || 'Analysis failed';
        sendResponse({ error: errMsg, isRateLimit: errMsg === 'RATE_LIMIT' });
      });
    return true;
  }

  // Highlight risks on page
  if (msg.action === 'highlightOnPage') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs[0]) { sendResponse({ error: 'No active tab' }); return; }
      chrome.tabs.sendMessage(tabs[0].id, { action: 'highlightRisks', phrases: msg.phrases }, function (resp) {
        if (chrome.runtime.lastError) { sendResponse({ error: chrome.runtime.lastError.message }); return; }
        sendResponse(resp || { done: true });
      });
    });
    return true;
  }

  // Remove highlights
  if (msg.action === 'removeHighlights') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { action: 'removeHighlights' }, function () {
        void chrome.runtime.lastError;
      });
    });
    return false;
  }

  // Get scan history
  if (msg.action === 'getHistory') {
    chrome.storage.local.get('termAlertHistory', function (data) {
      sendResponse({ history: data.termAlertHistory || [] });
    });
    return true;
  }

  // Clear history
  if (msg.action === 'clearHistory') {
    chrome.storage.local.remove('termAlertHistory', function () {
      sendResponse({ done: true });
    });
    return true;
  }

  // Save settings
  if (msg.action === 'saveSettings') {
    chrome.storage.local.set({ termAlertSettings: msg.settings }, function () {
      sendResponse({ done: true });
    });
    return true;
  }

  // Load settings
  if (msg.action === 'loadSettings') {
    chrome.storage.local.get('termAlertSettings', function (data) {
      sendResponse({ settings: data.termAlertSettings || {} });
    });
    return true;
  }

});

function getAnalysisPrompts(domain, text, redLines) {
  var systemPrompt =
    'Role: You are a legal document analyzer specialized in extracting data from Terms of Service and Privacy Policies. ' +
    'Task: Analyze the provided text and return a risk assessment. ' +
    'Constraint - CRITICAL: You must respond ONLY with a valid JSON object. Do not include any introductory text, markdown code blocks (e.g., no ```json), or concluding remarks. If you fail to provide valid JSON, the system will crash. ' +
    'Keep descriptions concise (1-2 sentences each). Return at most 6 flags. ' +
    'Expected Schema: ' +
    '{' +
    '"riskScore": (number 1-100), ' +
    '"summary": "string (max 2 sentences)", ' +
    '"flags": [' +
    '{"severity": "high|medium|low", "description": "string (1 sentence)", "category": "string"}' +
    '] (max 6 items), ' +
    '"detectedType": "Terms of Service" | "Privacy Policy" | "Other"' +
    '}' +
    ' IMPORTANT: You must return ONLY a valid, raw JSON object. Do not include any conversational text before or after. Do not wrap the response in markdown blocks like ```json. Do not use any code fences. Output nothing but the JSON object itself.';

  // Inject user's red lines (dealbreakers) into the system prompt
  if (redLines && Array.isArray(redLines) && redLines.length > 0) {
    var redLinesList = redLines.map(function (rule, i) {
      return (i + 1) + '. ' + rule;
    }).join(' ');
    systemPrompt +=
      ' CRITICAL USER PREFERENCES: The user has defined the following non-negotiable "Red Lines" — specific terms they consider dealbreakers. ' +
      'You MUST prioritize finding and flagging clauses that violate these specific rules. ' +
      'If found, mark them with "severity": "high". ' +
      'Red Lines: ' + redLinesList;
  }

  var userPrompt = 'Domain: ' + domain + '\n\nTerms & Conditions Text:\n' + text.slice(0, 8000);

  return { systemPrompt: systemPrompt, userPrompt: userPrompt };
}

function parseAIJson(content) {
  if (!content) throw new Error('Empty response from AI');

  // Keep original for error logging
  var rawContent = String(content);

  // Step 1: Strip BOM and null characters
  var cleaned = rawContent.replace(/\uFEFF/g, '').replace(/\x00/g, '');

  // Step 2: Strip markdown code fences (any language tag, e.g. ```json, ```javascript, ```)
  cleaned = cleaned.replace(/```[a-zA-Z]*\s*\n?/g, '').replace(/```/g, '');

  // Step 3: Trim whitespace
  cleaned = cleaned.trim();

  // Step 4: If there is conversational text surrounding the JSON, extract just the { ... } portion
  var firstBrace = cleaned.indexOf('{');
  var lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace > 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  function extractFirstJsonObject(text) {
    var start = text.indexOf('{');
    if (start === -1) return null;
    var inString = false;
    var escaped = false;
    var depth = 0;
    var i;

    for (i = start; i < text.length; i++) {
      var ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  // Step 5: Attempt to repair truncated JSON (AI response cut off by token limit)
  function repairTruncatedJson(text) {
    // Start from the first {
    var start = text.indexOf('{');
    if (start === -1) return null;
    text = text.slice(start);

    // Walk through the text tracking state
    var inString = false;
    var escaped = false;
    var stack = []; // track open { and [
    var lastValidPos = -1;
    var i;

    for (i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inString) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = false; }
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{' || ch === '[') { stack.push(ch); continue; }
      if (ch === '}') {
        if (stack.length && stack[stack.length - 1] === '{') stack.pop();
        if (stack.length === 0) { lastValidPos = i; break; }
        continue;
      }
      if (ch === ']') {
        if (stack.length && stack[stack.length - 1] === '[') stack.pop();
        continue;
      }
    }

    // If we found a balanced object, return it
    if (lastValidPos > 0) {
      return text.slice(0, lastValidPos + 1);
    }

    // Otherwise the JSON is truncated mid-way. Try to close it.
    var repaired = text;

    // If we're inside a string, close it (handle dangling escape char)
    if (inString) {
      if (escaped) repaired = repaired.slice(0, -1);
      repaired += '"';
    }

    // Close all open brackets/braces, stripping trailing commas before each
    for (var j = stack.length - 1; j >= 0; j--) {
      repaired = repaired.replace(/,\s*$/, '');
      repaired += (stack[j] === '[') ? ']' : '}';
    }

    // Validate the repaired JSON actually parses
    try {
      JSON.parse(repaired);
      return repaired;
    } catch (e) {
      return null;
    }
  }

  var parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e1) {
    // Fallback 1: extract first complete JSON object
    var candidate = extractFirstJsonObject(cleaned);
    if (candidate) {
      try {
        parsed = JSON.parse(candidate);
      } catch (e2) { }
    }
    // Fallback 2: repair truncated JSON
    if (!parsed) {
      var repaired = repairTruncatedJson(cleaned);
      if (repaired) {
        try {
          parsed = JSON.parse(repaired);
          console.warn('Recovered truncated AI JSON response (output was cut off by token limit).');
        } catch (e3) { }
      }
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    console.error('RAW AI OUTPUT THAT FAILED TO PARSE:', rawContent);
    throw new Error('Failed to parse AI response');
  }

  // Normalize the new schema and keep compatibility with existing UI fields.
  if (typeof parsed.riskScore !== 'number') parsed.riskScore = Number(parsed.riskScore) || Number(parsed.score) || 0;
  if (parsed.riskScore < 1) parsed.riskScore = 1;
  if (parsed.riskScore > 100) parsed.riskScore = 100;
  if (!parsed.summary) parsed.summary = parsed.tldr || 'Analysis completed. Review flagged clauses for details.';
  if (!parsed.detectedType) parsed.detectedType = 'Other';

  if (!Array.isArray(parsed.flags)) parsed.flags = [];
  parsed.flags = parsed.flags.map(function (f) {
    var sev = (f && f.severity) || 'medium';
    if (sev !== 'high' && sev !== 'medium' && sev !== 'low') sev = 'medium';
    var description = (f && (f.description || f.preview || f.detail || f.title)) || 'Potentially relevant clause detected.';
    var category = (f && (f.category || f.title || 'General')) || 'General';
    return {
      severity: sev,
      description: String(description),
      category: String(category),
      // Legacy fields used by popup renderer.
      title: String(category),
      preview: String(description),
      detail: String(description)
    };
  });

  // Legacy aliases used by current popup/history rendering.
  parsed.score = parsed.riskScore;
  parsed.tldr = parsed.summary;
  if (!parsed.verdict) parsed.verdict = parsed.score >= 70 ? 'HIGH RISK' : parsed.score >= 40 ? 'MODERATE' : 'SAFE';
  if (!parsed.categories || typeof parsed.categories !== 'object') {
    parsed.categories = { dataPrivacy: 0, financialTerms: 0, userRights: 0, ipContent: 0, legalLiability: 0 };
  }
  if (!Array.isArray(parsed.keyPhrases)) parsed.keyPhrases = [];
  if (typeof parsed.readTimeMinutes !== 'number') parsed.readTimeMinutes = 0;
  if (typeof parsed.dataTypesCollected !== 'number') parsed.dataTypesCollected = 0;

  return parsed;
}

function parseProviderTextContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(function (part) {
      if (typeof part === 'string') return part;
      if (part && typeof part.text === 'string') return part.text;
      return '';
    }).join('\n');
  }
  return '';
}

function parseFetchError(r) {
  var httpStatus = r.status;
  return r.text().then(function (raw) {
    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) { }

    var errMsg = (parsed && parsed.error && (parsed.error.message || parsed.error.type)) || raw || '';

    // Detect rate-limit / quota errors across all providers
    if (
      httpStatus === 429 ||
      /quota.exceeded/i.test(errMsg) ||
      /rate.limit/i.test(errMsg) ||
      /too.many.requests/i.test(errMsg) ||
      /resource.has.been.exhausted/i.test(errMsg)
    ) {
      console.warn('API Rate Limit Hit! (HTTP ' + httpStatus + ')', errMsg);
      throw new Error('RATE_LIMIT');
    }

    throw new Error(errMsg || ('API error ' + httpStatus));
  });
}

function normalizeProviderFetchError(err, providerName) {
  var raw = (err && err.message) ? String(err.message) : String(err || '');
  if (raw === 'RATE_LIMIT') return err;

  if (
    /failed to fetch/i.test(raw) ||
    /networkerror/i.test(raw) ||
    /load failed/i.test(raw) ||
    /fetch failed/i.test(raw)
  ) {
    return new Error(
      providerName + ' request failed (network/CORS). Check internet connection, API endpoint access, firewall/VPN/proxy, and try again.'
    );
  }

  return err instanceof Error ? err : new Error(raw || 'Unknown API error');
}

function runOpenAIAnalysis(apiKey, model, prompts) {
  return fetch(OPENAI_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      max_tokens: 4096,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompts.systemPrompt },
        { role: 'user', content: prompts.userPrompt }
      ]
    })
  })
    .then(function (r) {
      if (!r.ok) return parseFetchError(r);
      return r.json();
    })
    .then(function (data) {
      var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      return parseAIJson(parseProviderTextContent(content));
    })
    .catch(function (err) {
      throw normalizeProviderFetchError(err, 'OpenAI');
    });
}

function runAnthropicAnalysis(apiKey, model, prompts) {
  return fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model || 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      temperature: 0.2,
      system: prompts.systemPrompt,
      messages: [
        { role: 'user', content: prompts.userPrompt }
      ]
    })
  })
    .then(function (r) {
      if (!r.ok) return parseFetchError(r);
      return r.json();
    })
    .then(function (data) {
      var firstBlock = data.content && data.content[0];
      var content = firstBlock && firstBlock.text;
      return parseAIJson(parseProviderTextContent(content));
    })
    .catch(function (err) {
      throw normalizeProviderFetchError(err, 'Anthropic');
    });
}

function runGeminiAnalysis(apiKey, model, prompts) {
  function normalizeGeminiModelName(name) {
    var raw = String(name || '').trim();
    if (!raw) return '';
    return raw.replace(/^models\//, '');
  }

  function listGeminiModels(key) {
    var listUrl = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key);
    return fetch(listUrl)
      .then(function (r) {
        if (!r.ok) return parseFetchError(r);
        return r.json();
      })
      .then(function (data) {
        return data.models || [];
      })
      .catch(function (err) {
        throw normalizeProviderFetchError(err, 'Gemini');
      });
  }

  function pickGeminiModel(models, requested) {
    var requestedNormalized = normalizeGeminiModelName(requested);
    var available = {};
    var generateModels = [];
    var i;

    for (i = 0; i < models.length; i++) {
      var m = models[i];
      var name = m && m.name ? normalizeGeminiModelName(m.name) : '';
      var methods = (m && m.supportedGenerationMethods) || [];
      if (!name) continue;
      available[name] = true;
      if (methods.indexOf('generateContent') !== -1) generateModels.push(name);
    }

    if (requestedNormalized && available[requestedNormalized] && generateModels.indexOf(requestedNormalized) !== -1) {
      return requestedNormalized;
    }

    var preferred = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    for (i = 0; i < preferred.length; i++) {
      if (generateModels.indexOf(preferred[i]) !== -1) return preferred[i];
    }

    for (i = 0; i < generateModels.length; i++) {
      if (generateModels[i].indexOf('gemini') === 0) return generateModels[i];
    }

    if (generateModels.length) return generateModels[0];
    throw new Error('No Gemini text models available for generateContent on this API key/project.');
  }

  function callGeminiGenerateContent(key, resolvedModel) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(resolvedModel) + ':generateContent?key=' + encodeURIComponent(key);

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompts.systemPrompt + '\n\n' + prompts.userPrompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json'
        }
      })
    })
      .then(function (r) {
        if (!r.ok) return parseFetchError(r);
        return r.json();
      })
      .then(function (data) {
        var candidate = data.candidates && data.candidates[0];
        var content = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;
        return parseAIJson(parseProviderTextContent(content));
      })
      .catch(function (err) {
        throw normalizeProviderFetchError(err, 'Gemini');
      });
  }

  return listGeminiModels(apiKey).then(function (models) {
    var resolved = pickGeminiModel(models, model || 'gemini-2.0-flash');
    return callGeminiGenerateContent(apiKey, resolved);
  }).catch(function (err) {
    throw normalizeProviderFetchError(err, 'Gemini');
  });
}

// --- AI Analysis via selected provider ---
function runAIAnalysis(apiKey, text, domain, provider, model, redLines) {
  var prompts = getAnalysisPrompts(domain, text, redLines);
  if (provider === 'anthropic') return runAnthropicAnalysis(apiKey, model, prompts);
  if (provider === 'gemini') return runGeminiAnalysis(apiKey, model, prompts);
  return runOpenAIAnalysis(apiKey, model, prompts);
}

// --- Demo analysis (no API key) ---
function getDemoAnalysis(domain) {
  return {
    score: 72,
    verdict: 'HIGH RISK',
    tldr: 'This service collects extensive personal data and may share it with third-party advertisers. You waive your right to class-action lawsuits and the company can change terms anytime with minimal notice.',
    readTimeMinutes: 28,
    dataTypesCollected: 14,
    flags: [
      { severity: 'high', title: 'Third-party data sharing', preview: 'Your data may be sold to unspecified third parties for marketing.', detail: 'Section 4.2 allows sharing personal data with "partners and affiliates" without explicit consent for each transfer. This includes advertising partners.' },
      { severity: 'high', title: 'Mandatory arbitration', preview: 'You waive your right to sue or join class-action lawsuits.', detail: 'Section 12.1 requires binding arbitration for all disputes. You cannot participate in class-action lawsuits against this company.' },
      { severity: 'high', title: 'Unilateral term changes', preview: 'Terms can change anytime with only 7-day email notice.', detail: 'The company reserves the right to modify these terms at any time. Continued use after 7-day notice period constitutes acceptance.' },
      { severity: 'medium', title: 'Auto-renewal subscription', preview: 'Auto-renews unless cancelled 30 days before renewal.', detail: 'Subscription renews automatically at full price. Cancellation requires written notice 30 days before renewal date. No prorated refunds.' },
      { severity: 'medium', title: 'Background location tracking', preview: 'Precise GPS location collected even when app is closed.', detail: 'Location data collected continuously in background. Opt-out buried in settings and resets on app updates.' },
      { severity: 'low', title: 'Broad content license', preview: 'They can use, modify and share your posted content.', detail: 'By posting, you grant a worldwide royalty-free license. However, you retain underlying ownership of your content.' }
    ],
    categories: { dataPrivacy: 80, financialTerms: 60, userRights: 75, ipContent: 30, legalLiability: 85 },
    keyPhrases: [
      { phrase: 'third party', severity: 'high', label: 'Data sharing' },
      { phrase: 'arbitration', severity: 'high', label: 'Legal waiver' },
      { phrase: 'auto-renew', severity: 'medium', label: 'Billing' }
    ]
  };
}

// --- Save analysis to history ---
function saveToHistory(domain, result) {
  chrome.storage.local.get('termAlertHistory', function (data) {
    var history = data.termAlertHistory || [];
    // Remove old entry for same domain
    history = history.filter(function (h) { return h.domain !== domain; });
    history.unshift({
      domain: domain,
      score: result.score,
      verdict: result.verdict,
      timestamp: Date.now(),
      flags: (result.flags || []).length
    });
    if (history.length > 50) history = history.slice(0, 50);
    chrome.storage.local.set({ termAlertHistory: history });
  });
}

// --- Extract domain from URL ---
function extractDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch (e) {
    return url || 'unknown';
  }
}

// --- Tab change: update badge from cache ---
chrome.tabs.onActivated.addListener(function (info) {
  chrome.tabs.get(info.tabId, function (tab) {
    if (!tab || !tab.url) return;
    var domain = extractDomain(tab.url);
    chrome.storage.local.get('termAlertHistory', function (data) {
      var history = data.termAlertHistory || [];
      var cached = null;
      for (var i = 0; i < history.length; i++) {
        if (history[i].domain === domain) { cached = history[i]; break; }
      }
      if (cached) setBadge(info.tabId, cached.score);
      else clearBadge(info.tabId);
    });
  });
});

// --- On navigation: clear badge ---
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.status === 'loading') {
    clearBadge(tabId);
  }
});

console.log('TermAlert background worker started');
