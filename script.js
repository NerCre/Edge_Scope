/*
 * EdgeScope - Trade Judge & Note
 *
 * This script implements all interactivity for the EdgeScope single-page
 * application. It handles loading and saving trade records from
 * localStorage, judging trades based on past data, entering new trades,
 * recording exit results, filtering and charting statistics, and
 * exporting/importing data as JSON. All operations are performed on the
 * front-end without any server.
 */

(() => {
  /**
   * In-memory array of all trade records. Each element follows the
   * TradeRecord interface defined in the requirements. Records are loaded
   * from localStorage on startup and persisted after every change.
   * @type {Array}
   */
  let tradeRecords = [];

  /**
   * Identifier of the trade currently being edited in the entry form.
   * Undefined when creating a new record.
   * @type {string|undefined}
   */
  let editingEntryId;

  /**
   * Identifier of the trade currently being edited in the exit form.
   * Undefined when no record is selected.
   * @type {string|undefined}
   */
  let editingExitId;

  /**
   * Charts instances for stats. Stored globally to allow updating and
   * destroying before re-rendering.
   */
  let cumulativeChart, directionChart, timeframeChart;

  /**
   * LocalStorage key used for persisting trade records. Version suffix
   * allows future migrations.
   */
  const STORAGE_KEY = 'tradeRecords_v1';

  /**
   * Initialize the application. Loads data from localStorage, hooks up
   * event listeners and populates initial UI state.
   */
  function init() {
    loadRecords();
    setupTabs();
    setupEntryHandlers();
    setupExitHandlers();
    setupStatsHandlers();
    updateRecordList();
    updateStats();
  }

  /**
   * Load trade records from localStorage into the in-memory array. If the
   * stored data is invalid, an empty array is used and the user is
   * informed via an alert.
   */
  function loadRecords() {
    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) {
      tradeRecords = [];
      return;
    }
    try {
      const data = JSON.parse(json);
      if (Array.isArray(data)) {
        tradeRecords = data;
      } else {
        throw new Error('Invalid data');
      }
    } catch (err) {
      alert('保存データが破損している可能性があります。初期化しました。');
      tradeRecords = [];
      saveRecords();
    }
  }

  /**
   * Persist the in-memory tradeRecords array to localStorage. Always
   * stringify the array.
   */
  function saveRecords() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tradeRecords));
  }

  /**
   * Generate a UUID string. Use crypto.randomUUID when available for
   * maximum uniqueness; otherwise fall back to a simple timestamp-based
   * scheme. Each UUID is used as the primary key for records.
   * @returns {string}
   */
  function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return (
      Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
    );
  }

  /**
   * Setup event listeners for tab switching. Each tab button has a
   * data-tab attribute corresponding to its content ID. When clicked,
   * remove the active class from all buttons and contents, then add it to
   * the selected pair.
   */
  function setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        // Remove active from all
        tabButtons.forEach((b) => b.classList.remove('active'));
        tabContents.forEach((c) => c.classList.remove('active'));
        // Activate selected
        btn.classList.add('active');
        const targetId = 'tab-' + btn.dataset.tab;
        document.getElementById(targetId).classList.add('active');
        // Clear forms when switching
        if (targetId === 'tab-entry') {
          // When switching to entry, ensure result form is reset selection highlight
          document.querySelectorAll('.record-list li').forEach((li) => li.classList.remove('selected'));
        } else if (targetId === 'tab-exit') {
          // When switching to exit, update list
          updateRecordList();
        } else if (targetId === 'tab-stats') {
          updateStats();
        }
      });
    });
  }

  /**
   * Hook up entry form buttons and inputs to handlers. Handles judgement,
   * saving new entries, clearing form, and image preview.
   */
  function setupEntryHandlers() {
    document.getElementById('btn-judge').addEventListener('click', () => {
      const entry = readEntryForm();
      const { result } = judgeTrade(entry);
      renderJudgeResult(result);
    });
    document
      .getElementById('btn-judge-save')
      .addEventListener('click', () => {
        const entry = readEntryForm();
        const { result } = judgeTrade(entry);
        renderJudgeResult(result);
        saveEntry(entry, result);
        clearEntryForm();
        updateRecordList();
        updateStats();
      });
    document
      .getElementById('btn-entry-clear')
      .addEventListener('click', () => {
        clearEntryForm();
        renderJudgeResult(null);
        editingEntryId = undefined;
      });
    // Image input handler
    document.getElementById('imageInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) {
        document.getElementById('imagePreview').innerHTML = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = document.createElement('img');
        img.src = reader.result;
        img.alt = 'Preview';
        const preview = document.getElementById('imagePreview');
        preview.innerHTML = '';
        preview.appendChild(img);
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Hook up exit form handlers: selecting records, saving result, clearing
   * result. Also updates profit display when exitPrice changes.
   */
  function setupExitHandlers() {
    document.getElementById('filter-unresolved').addEventListener('change', () => {
      updateRecordList();
    });
    document
      .getElementById('btn-save-result')
      .addEventListener('click', () => {
        if (!editingExitId) {
          alert('記録を選択してください。');
          return;
        }
        updateResult();
        updateRecordList();
        updateStats();
      });
    document
      .getElementById('btn-exit-clear')
      .addEventListener('click', () => {
        clearResultForm();
        editingExitId = undefined;
        // Remove selection from list
        document.querySelectorAll('.record-list li').forEach((li) => li.classList.remove('selected'));
      });
    document.getElementById('exitPrice').addEventListener('input', () => {
      updateExitProfitDisplay();
    });
    document.getElementById('highDuringTrade').addEventListener('input', () => {
      updateExitProfitDisplay();
    });
    document.getElementById('lowDuringTrade').addEventListener('input', () => {
      updateExitProfitDisplay();
    });
  }

  /**
   * Hook up stats handlers: filter application, export and import buttons.
   */
  function setupStatsHandlers() {
    document.getElementById('btn-apply-filter').addEventListener('click', () => {
      updateStats();
    });
    document.getElementById('btn-export').addEventListener('click', () => {
      exportRecords();
    });
    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          importRecords(data);
        } catch (err) {
          alert('JSONの読み込みに失敗しました。');
        }
      };
      reader.readAsText(file);
      // reset file input for next import
      e.target.value = '';
    });
  }

  /**
   * Read all values from the entry form and return an object representing
   * the user input. Fields that are not filled will be returned as null.
   * @returns {Object}
   */
  function readEntryForm() {
    const getValue = (id) => document.getElementById(id).value;
    const getNumber = (id) => {
      const v = document.getElementById(id).value;
      return v === '' ? null : parseFloat(v);
    };
    return {
      id: editingEntryId || generateUUID(),
      createdAt: null, // to be set on save
      updatedAt: null,
      datetimeEntry: getValue('datetimeEntry') || null,
      symbol: getValue('symbol') || 'nk225mc',
      timeframe: getValue('timeframe') || '',
      tradeType: getValue('tradeType') || 'real',
      directionPlanned: getValue('directionPlanned') || 'long',
      entryPrice: getNumber('entryPrice'),
      size: getNumber('size'),
      feePerUnit: getNumber('feePerUnit'),
      plannedStopPrice: getNumber('plannedStopPrice'),
      plannedLimitPrice: getNumber('plannedLimitPrice'),
      cutLossPrice: getNumber('cutLossPrice'),
      prevWave: getValue('prevWave'),
      trend_5_20_40: getValue('trend_5_20_40'),
      price_vs_ema200: getValue('price_vs_ema200'),
      ema_band_color: getValue('ema_band_color'),
      zone: getValue('zone'),
      cmf_sign: getValue('cmf_sign'),
      cmf_sma_dir: getValue('cmf_sma_dir'),
      macd_state: getValue('macd_state'),
      roc_sign: getValue('roc_sign'),
      roc_sma_dir: getValue('roc_sma_dir'),
      rsi_zone: getValue('rsi_zone'),
      minWinRate: getNumber('minWinRate'),
      marketMemo: document.getElementById('marketMemo').value || '',
      notionUrl: document.getElementById('notionUrl').value || '',
      imageData: getCurrentImageData(),
      recommendation: null,
      expectedMove: null,
      expectedMoveUnit: null,
      confidence: null,
      reason: '',
      avgProfit: null,
      avgLoss: null,
      winRate: null,
      hasResult: false,
      datetimeExit: null,
      exitPrice: null,
      directionTaken: null,
      highDuringTrade: null,
      lowDuringTrade: null,
      profit: null,
      resultMemo: ''
    };
  }

  /**
   * Retrieve the current image data from the preview element. If an image
   * is displayed, its src is returned. Otherwise null.
   * @returns {string|null}
   */
  function getCurrentImageData() {
    const preview = document.getElementById('imagePreview');
    const img = preview.querySelector('img');
    return img ? img.src : null;
  }

  /**
   * Write values from a trade record into the entry form for editing. This
   * function is called when editing an existing entry from the stats
   * table. Also sets editingEntryId so the save function updates the
   * existing record instead of creating a new one.
   * @param {Object} record
   */
  function populateEntryForm(record) {
    editingEntryId = record.id;
    document.getElementById('datetimeEntry').value = record.datetimeEntry || '';
    document.getElementById('symbol').value = record.symbol;
    document.getElementById('timeframe').value = record.timeframe;
    document.getElementById('tradeType').value = record.tradeType;
    document.getElementById('directionPlanned').value = record.directionPlanned;
    setNumberInput('entryPrice', record.entryPrice);
    setNumberInput('size', record.size);
    setNumberInput('feePerUnit', record.feePerUnit);
    setNumberInput('plannedStopPrice', record.plannedStopPrice);
    setNumberInput('plannedLimitPrice', record.plannedLimitPrice);
    setNumberInput('cutLossPrice', record.cutLossPrice);
    document.getElementById('prevWave').value = record.prevWave;
    document.getElementById('trend_5_20_40').value = record.trend_5_20_40;
    document.getElementById('price_vs_ema200').value = record.price_vs_ema200;
    document.getElementById('ema_band_color').value = record.ema_band_color;
    document.getElementById('zone').value = record.zone;
    document.getElementById('cmf_sign').value = record.cmf_sign;
    document.getElementById('cmf_sma_dir').value = record.cmf_sma_dir;
    document.getElementById('macd_state').value = record.macd_state;
    document.getElementById('roc_sign').value = record.roc_sign;
    document.getElementById('roc_sma_dir').value = record.roc_sma_dir;
    document.getElementById('rsi_zone').value = record.rsi_zone;
    setNumberInput('minWinRate', record.minWinRate);
    document.getElementById('marketMemo').value = record.marketMemo;
    document.getElementById('notionUrl').value = record.notionUrl;
    // Load image preview
    if (record.imageData) {
      const img = document.createElement('img');
      img.src = record.imageData;
      img.alt = 'Preview';
      const preview = document.getElementById('imagePreview');
      preview.innerHTML = '';
      preview.appendChild(img);
    } else {
      document.getElementById('imagePreview').innerHTML = '';
    }
    // Switch to entry tab
    document.querySelector('.tab-button[data-tab="entry"]').click();
    // Show recommendation if available
    renderJudgeResult(
      record.recommendation
        ? {
            recommendation: record.recommendation,
            expectedMove: record.expectedMove,
            expectedMoveUnit: record.expectedMoveUnit,
            confidence: record.confidence,
            avgProfit: record.avgProfit,
            avgLoss: record.avgLoss,
            winRate: record.winRate,
            reason: record.reason
          }
        : null
    );
  }

  /**
   * Helper to set number inputs, converting null/undefined to ''.
   */
  function setNumberInput(id, value) {
    const el = document.getElementById(id);
    if (value === null || value === undefined) {
      el.value = '';
    } else {
      el.value = value;
    }
  }

  /**
   * Save a new entry or update an existing one. When editing an existing
   * entry, the record with matching ID is updated; otherwise a new
   * record is appended. The recommendation result from the judge is
   * stored along with user input. directionTaken is set to
   * directionPlanned when creating a new entry or when updating.
   * @param {Object} entry
   * @param {Object} result
   */
  function saveEntry(entry, result) {
    const now = new Date().toISOString();
    // Copy directionPlanned into directionTaken (for later evaluation)
    entry.directionTaken = entry.directionPlanned;
    entry.recommendation = result ? result.recommendation : null;
    entry.expectedMove = result ? result.expectedMove : null;
    entry.expectedMoveUnit = result ? result.expectedMoveUnit : null;
    entry.confidence = result ? result.confidence : null;
    entry.avgProfit = result ? result.avgProfit : null;
    entry.avgLoss = result ? result.avgLoss : null;
    entry.winRate = result ? result.winRate : null;
    entry.reason = result ? result.reason : '';
    if (editingEntryId) {
      // Update existing record
      const idx = tradeRecords.findIndex((r) => r.id === editingEntryId);
      if (idx !== -1) {
        entry.createdAt = tradeRecords[idx].createdAt;
        entry.hasResult = tradeRecords[idx].hasResult;
        entry.datetimeExit = tradeRecords[idx].datetimeExit;
        entry.exitPrice = tradeRecords[idx].exitPrice;
        entry.highDuringTrade = tradeRecords[idx].highDuringTrade;
        entry.lowDuringTrade = tradeRecords[idx].lowDuringTrade;
        entry.profit = tradeRecords[idx].profit;
        entry.resultMemo = tradeRecords[idx].resultMemo;
        entry.updatedAt = now;
        tradeRecords[idx] = entry;
      }
    } else {
      // New record
      entry.createdAt = now;
      entry.updatedAt = now;
      entry.hasResult = false;
      tradeRecords.push(entry);
    }
    saveRecords();
    editingEntryId = undefined;
  }

  /**
   * Clear the entry form inputs to their default values. Does not
   * persist anything.
   */
  function clearEntryForm() {
    document.getElementById('datetimeEntry').value = '';
    document.getElementById('symbol').value = 'nk225mc';
    document.getElementById('timeframe').value = '1分';
    document.getElementById('tradeType').value = 'real';
    document.getElementById('directionPlanned').value = 'long';
    setNumberInput('entryPrice', null);
    setNumberInput('size', null);
    setNumberInput('feePerUnit', null);
    setNumberInput('plannedStopPrice', null);
    setNumberInput('plannedLimitPrice', null);
    setNumberInput('cutLossPrice', null);
    document.getElementById('prevWave').value = 'HH';
    document.getElementById('trend_5_20_40').value = 'Stage1';
    document.getElementById('price_vs_ema200').value = 'above';
    document.getElementById('ema_band_color').value = 'dark_green';
    document.getElementById('zone').value = 'pivot';
    document.getElementById('cmf_sign').value = 'positive';
    document.getElementById('cmf_sma_dir').value = 'gc';
    document.getElementById('macd_state').value = 'post_gc';
    document.getElementById('roc_sign').value = 'positive';
    document.getElementById('roc_sma_dir').value = 'up';
    document.getElementById('rsi_zone').value = 'over70';
    setNumberInput('minWinRate', null);
    document.getElementById('marketMemo').value = '';
    document.getElementById('notionUrl').value = '';
    document.getElementById('imageInput').value = '';
    document.getElementById('imagePreview').innerHTML = '';
    editingEntryId = undefined;
  }

  /**
   * Compute a recommendation and associated statistics for the given entry.
   * It compares the entry's indicator features to historical records with
   * results and aggregates statistics for similar cases. If no similar
   * records are found, or the win rate does not meet the user's
   * threshold, a flat recommendation is returned.
   * @param {Object} entry
   * @returns {Object} An object containing the result and similar records
   */
  function judgeTrade(entry) {
    // Extract features from entry
    const features = [
      'prevWave',
      'trend_5_20_40',
      'price_vs_ema200',
      'ema_band_color',
      'zone',
      'cmf_sign',
      'cmf_sma_dir',
      'macd_state',
      'roc_sign',
      'roc_sma_dir',
      'rsi_zone'
    ];
    // Filter records that have results
    const completed = tradeRecords.filter((r) => r.hasResult);
    // Compute similarity for each record
    const similarRecords = [];
    completed.forEach((rec) => {
      let matches = 0;
      features.forEach((f) => {
        if (entry[f] !== null && entry[f] !== undefined && entry[f] === rec[f]) matches++;
      });
      const similarity = matches / features.length;
      if (similarity >= 0.4) {
        similarRecords.push({ rec, similarity });
      }
    });
    // If no similar records, return flat recommendation
    if (similarRecords.length === 0) {
      return {
        result: {
          recommendation: 'flat',
          expectedMove: null,
          expectedMoveUnit: null,
          confidence: 0,
          avgProfit: null,
          avgLoss: null,
          winRate: null,
          reason: '類似ケースがありません。ノーポジ推奨。'
        },
        similarRecords: []
      };
    }
    // Group similar records by direction
    const statsByDirection = {
      long: [],
      short: [],
      flat: []
    };
    similarRecords.forEach(({ rec }) => {
      if (rec.directionTaken) {
        statsByDirection[rec.directionTaken] = statsByDirection[rec.directionTaken] || [];
        statsByDirection[rec.directionTaken].push(rec);
      }
    });
    // Compute statistics per direction
    function computeStats(records) {
      if (!records || records.length === 0) {
        return {
          winRate: null,
          avgProfit: null,
          avgLoss: null,
          expectedMove: null
        };
      }
      let wins = 0;
      let profits = [];
      let losses = [];
      let moves = [];
      records.forEach((r) => {
        const profit = r.profit;
        if (profit > 0) {
          wins++;
          profits.push(profit);
        } else if (profit < 0) {
          losses.push(profit);
        }
        // Expected move: convert profit back to price difference
        const multiplier = getMultiplier(r.symbol);
        if (r.size && r.size !== 0 && r.profit !== null && r.profit !== undefined) {
          const baseProfit = r.profit / multiplier;
          const move = baseProfit / r.size;
          if (move > 0) {
            moves.push(move);
          }
        }
      });
      const total = records.length;
      const winRate = total > 0 ? (wins / total) * 100 : null;
      const avgProfit = profits.length > 0 ? avg(profits) : null;
      const avgLoss = losses.length > 0 ? avg(losses) : null;
      const expectedMove = moves.length > 0 ? avg(moves) : null;
      return { winRate, avgProfit, avgLoss, expectedMove };
    }
    const longStats = computeStats(statsByDirection.long);
    const shortStats = computeStats(statsByDirection.short);
    const flatStats = computeStats(statsByDirection.flat);
    // Determine recommended direction by highest win rate
    const candidates = [];
    if (longStats.winRate !== null) candidates.push({ dir: 'long', stats: longStats });
    if (shortStats.winRate !== null) candidates.push({ dir: 'short', stats: shortStats });
    if (flatStats.winRate !== null) candidates.push({ dir: 'flat', stats: flatStats });
    // Choose best candidate
    let best = null;
    candidates.forEach((c) => {
      if (!best || (c.stats.winRate !== null && c.stats.winRate > best.stats.winRate)) {
        best = c;
      }
    });
    // Fallback
    if (!best) {
      best = { dir: 'flat', stats: flatStats };
    }
    // Apply user-defined minimum win rate threshold
    const threshold = typeof entry.minWinRate === 'number' ? entry.minWinRate : 0;
    let recommendation = best.dir;
    if (best.stats.winRate === null || best.stats.winRate < threshold) {
      recommendation = 'flat';
    }
    // Compute confidence score based on number of similar records and best win rate
    const simCount = similarRecords.length;
    const conf = Math.min(100, Math.floor((simCount / 10) * 50 + ((best.stats.winRate || 0) / 2)));
    // Build reason string
    const reasonParts = [];
    const recordCount = similarRecords.length;
    const winCount = statsByDirection.long.concat(statsByDirection.short).concat(statsByDirection.flat).filter((r) => r.profit > 0).length;
    const overallWinRate = recordCount > 0 ? Math.round((winCount / recordCount) * 100) : 0;
    reasonParts.push(`類似ケース${recordCount}件中${winCount}件勝ち（勝率${overallWinRate}%）`);
    if (best.stats.avgProfit !== null) {
      reasonParts.push(`平均利益 +${Math.round(best.stats.avgProfit).toLocaleString()}円`);
    }
    if (best.stats.avgLoss !== null) {
      reasonParts.push(`平均損失 ${Math.round(best.stats.avgLoss).toLocaleString()}円`);
    }
    reasonParts.push(`直前の波: ${entry.prevWave} / EMA Band: ${entry.ema_band_color} / CMF方向: ${entry.cmf_sma_dir}`);
    const reason = reasonParts.join('、');
    return {
      result: {
        recommendation,
        expectedMove: recommendation === 'flat' ? null : best.stats.expectedMove,
        expectedMoveUnit: recommendation === 'flat' ? null : '価格差',
        confidence: conf,
        avgProfit: best.stats.avgProfit,
        avgLoss: best.stats.avgLoss,
        winRate: best.stats.winRate,
        reason
      },
      similarRecords
    };
  }

  /**
   * Render the judge result into the judge-output element. When result is
   * null, clear the display. Otherwise construct badges and metrics.
   * @param {Object|null} result
   */
  function renderJudgeResult(result) {
    const output = document.getElementById('judge-output');
    output.innerHTML = '';
    if (!result) {
      return;
    }
    // Recommendation badge
    let badgeClass = 'badge-flat';
    let badgeText = 'ノーポジ推奨';
    if (result.recommendation === 'long') {
      badgeClass = 'badge-long';
      badgeText = 'ロング推奨';
    } else if (result.recommendation === 'short') {
      badgeClass = 'badge-short';
      badgeText = 'ショート推奨';
    }
    const badge = document.createElement('span');
    badge.className = `badge ${badgeClass}`;
    badge.textContent = badgeText;
    output.appendChild(badge);
    // Win rate and confidence
    const info = document.createElement('div');
    info.innerHTML = `勝率: ${result.winRate !== null ? result.winRate.toFixed(1) + '%' : '—'}<br>`;
    info.innerHTML += `信頼度: ${result.confidence !== null ? result.confidence + '%' : '—'}<br>`;
    info.innerHTML += `推定値幅: ${result.expectedMove !== null ? result.expectedMove.toFixed(2) + ' ' + result.expectedMoveUnit : '—'}<br>`;
    info.innerHTML += `平均利益: ${result.avgProfit !== null ? Math.round(result.avgProfit).toLocaleString() + '円' : '—'}<br>`;
    info.innerHTML += `平均損失: ${result.avgLoss !== null ? Math.round(result.avgLoss).toLocaleString() + '円' : '—'}<br>`;
    info.innerHTML += `<span>${result.reason}</span>`;
    output.appendChild(info);
  }

  /**
   * Update the record list in the exit tab. Each item displays basic
   * information and can be selected to populate the exit form. Filters
   * unresolved trades if the checkbox is checked.
   */
  function updateRecordList() {
    const list = document.getElementById('record-list');
    list.innerHTML = '';
    const unresolvedOnly = document.getElementById('filter-unresolved').checked;
    tradeRecords.forEach((rec) => {
      if (unresolvedOnly && rec.hasResult) return;
      const li = document.createElement('li');
      li.textContent = `${rec.datetimeEntry || ''} / ${rec.symbol} / ${rec.directionPlanned}`;
      li.dataset.id = rec.id;
      if (editingExitId && rec.id === editingExitId) {
        li.classList.add('selected');
      }
      li.addEventListener('click', () => {
        // Remove existing selection
        document.querySelectorAll('.record-list li').forEach((el) => el.classList.remove('selected'));
        li.classList.add('selected');
        editingExitId = rec.id;
        populateExitForm(rec);
      });
      list.appendChild(li);
    });
  }

  /**
   * Populate the exit form with information from a selected record. Displays
   * read-only values and sets input values for editing. Also updates
   * profit display.
   * @param {Object} rec
   */
  function populateExitForm(rec) {
    document.getElementById('datetimeExit').value = rec.datetimeExit || '';
    setNumberInput('exitPrice', rec.exitPrice);
    setNumberInput('highDuringTrade', rec.highDuringTrade);
    setNumberInput('lowDuringTrade', rec.lowDuringTrade);
    document.getElementById('resultMemo').value = rec.resultMemo || '';
    // Display static fields
    document.getElementById('displayDirection').textContent = rec.directionTaken === 'long' ? 'ロング' : rec.directionTaken === 'short' ? 'ショート' : 'ノーポジ';
    document.getElementById('displaySize').textContent = rec.size !== null && rec.size !== undefined ? rec.size : '';
    document.getElementById('displayFee').textContent = rec.feePerUnit !== null && rec.feePerUnit !== undefined ? rec.feePerUnit : '';
    // profit display
    updateExitProfitDisplay();
    // Switch to exit tab
    document.querySelector('.tab-button[data-tab="exit"]').click();
  }

  /**
   * Update the profit display in the exit form. Calculates profit using
   * current exit price and stored entry details. Does not save the
   * profit until saveResult is called.
   */
  function updateExitProfitDisplay() {
    if (!editingExitId) {
      document.getElementById('displayProfit').textContent = '';
      return;
    }
    const rec = tradeRecords.find((r) => r.id === editingExitId);
    if (!rec) return;
    const exitPrice = parseFloat(document.getElementById('exitPrice').value);
    if (!exitPrice || !rec.entryPrice || !rec.size || !rec.feePerUnit) {
      document.getElementById('displayProfit').textContent = '';
      return;
    }
    // base profit in price points
    let baseProfit = 0;
    if (rec.directionTaken === 'long') {
      baseProfit = (exitPrice - rec.entryPrice - rec.feePerUnit) * rec.size;
    } else if (rec.directionTaken === 'short') {
      baseProfit = (rec.entryPrice - exitPrice - rec.feePerUnit) * rec.size;
    } else {
      baseProfit = 0;
    }
    // multiply by symbol multiplier
    const profit = baseProfit * getMultiplier(rec.symbol);
    document.getElementById('displayProfit').textContent = Math.round(profit).toLocaleString() + '円';
  }

  /**
   * Save the exit result for the selected record. Updates fields
   * datetimeExit, exitPrice, highDuringTrade, lowDuringTrade, resultMemo,
   * profit and marks hasResult true. Updates updatedAt.
   */
  function updateResult() {
    const idx = tradeRecords.findIndex((r) => r.id === editingExitId);
    if (idx === -1) return;
    const rec = tradeRecords[idx];
    rec.datetimeExit = document.getElementById('datetimeExit').value || null;
    const exitPriceValue = document.getElementById('exitPrice').value;
    rec.exitPrice = exitPriceValue !== '' ? parseFloat(exitPriceValue) : null;
    const high = document.getElementById('highDuringTrade').value;
    rec.highDuringTrade = high !== '' ? parseFloat(high) : null;
    const low = document.getElementById('lowDuringTrade').value;
    rec.lowDuringTrade = low !== '' ? parseFloat(low) : null;
    rec.resultMemo = document.getElementById('resultMemo').value || '';
    rec.hasResult = true;
    // Compute profit
    if (
      rec.exitPrice !== null &&
      rec.entryPrice !== null &&
      rec.size !== null &&
      rec.feePerUnit !== null
    ) {
      let baseProfit = 0;
      if (rec.directionTaken === 'long') {
        baseProfit = (rec.exitPrice - rec.entryPrice - rec.feePerUnit) * rec.size;
      } else if (rec.directionTaken === 'short') {
        baseProfit = (rec.entryPrice - rec.exitPrice - rec.feePerUnit) * rec.size;
      } else {
        baseProfit = 0;
      }
      rec.profit = baseProfit * getMultiplier(rec.symbol);
    } else {
      rec.profit = null;
    }
    rec.updatedAt = new Date().toISOString();
    tradeRecords[idx] = rec;
    saveRecords();
    // update profit display
    document.getElementById('displayProfit').textContent = rec.profit !== null ? Math.round(rec.profit).toLocaleString() + '円' : '';
  }

  /**
   * Remove all values from the exit form without modifying any stored
   * record. Resets editingExitId.
   */
  function clearResultForm() {
    document.getElementById('datetimeExit').value = '';
    setNumberInput('exitPrice', null);
    setNumberInput('highDuringTrade', null);
    setNumberInput('lowDuringTrade', null);
    document.getElementById('resultMemo').value = '';
    document.getElementById('displayDirection').textContent = '';
    document.getElementById('displaySize').textContent = '';
    document.getElementById('displayFee').textContent = '';
    document.getElementById('displayProfit').textContent = '';
  }

  /**
   * Calculate the multiplier for a given symbol. nk225mc:10, nk225m:100,
   * nk225:1000, default:1.
   * @param {string} symbol
   * @returns {number}
   */
  function getMultiplier(symbol) {
    if (symbol === 'nk225mc') return 10;
    if (symbol === 'nk225m') return 100;
    if (symbol === 'nk225') return 1000;
    return 1;
  }

  /**
   * Compute average of numeric values in an array. Returns null for
   * empty arrays.
   * @param {number[]} arr
   * @returns {number|null}
   */
  function avg(arr) {
    if (!arr || arr.length === 0) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /**
   * Update statistics view: applies filters, populates the table, and
   * redraws charts.
   */
  function updateStats() {
    // Apply filters
    const symbolFilter = document.getElementById('filterSymbol').value;
    const typeFilter = document.getElementById('filterTradeType').value;
    const dirFilter = document.getElementById('filterDirection').value;
    const startDate = document.getElementById('filterStartDate').value;
    const endDate = document.getElementById('filterEndDate').value;
    let filtered = tradeRecords;
    if (symbolFilter !== 'all') {
      filtered = filtered.filter((r) => r.symbol === symbolFilter);
    }
    if (typeFilter !== 'all') {
      filtered = filtered.filter((r) => r.tradeType === typeFilter);
    }
    if (dirFilter !== 'all') {
      filtered = filtered.filter((r) => r.directionTaken === dirFilter);
    }
    if (startDate) {
      filtered = filtered.filter((r) => {
        const dt = r.datetimeEntry ? r.datetimeEntry.substr(0, 10) : '';
        return dt >= startDate;
      });
    }
    if (endDate) {
      filtered = filtered.filter((r) => {
        const dt = r.datetimeEntry ? r.datetimeEntry.substr(0, 10) : '';
        return dt <= endDate;
      });
    }
    // Populate table
    const tbody = document.getElementById('stats-table-body');
    tbody.innerHTML = '';
    filtered.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.datetimeEntry ? r.datetimeEntry.replace('T', ' ') : ''}</td>
        <td>${r.symbol}</td>
        <td>${r.timeframe}</td>
        <td>${labelTradeType(r.tradeType)}</td>
        <td>${labelDirection(r.directionPlanned)}</td>
        <td>${labelDirection(r.directionTaken)}</td>
        <td>${r.profit !== null && r.profit !== undefined ? Math.round(r.profit).toLocaleString() : ''}</td>
        <td>${labelDirection(r.recommendation)}</td>
        <td>${r.hasResult ? '済' : '未'}</td>
        <td class="actions"></td>
      `;
      // action buttons
      const actionsTd = tr.querySelector('.actions');
      // Edit entry
      const editEntryBtn = document.createElement('button');
      editEntryBtn.textContent = 'エントリー編集';
      editEntryBtn.className = 'secondary';
      editEntryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        populateEntryForm(r);
      });
      actionsTd.appendChild(editEntryBtn);
      // Edit result
      const editResultBtn = document.createElement('button');
      editResultBtn.textContent = '結果編集';
      editResultBtn.className = 'secondary';
      editResultBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        editingExitId = r.id;
        populateExitForm(r);
      });
      actionsTd.appendChild(editResultBtn);
      // Delete
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '削除';
      deleteBtn.className = 'secondary';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.confirm('このトレード記録を削除しますか？（元に戻せません）')) {
          deleteRecordById(r.id);
          updateRecordList();
          updateStats();
        }
      });
      actionsTd.appendChild(deleteBtn);
      tbody.appendChild(tr);
    });
    // Draw charts
    drawCharts(filtered);
  }

  /**
   * Delete a record from tradeRecords by ID and persist changes. Also
   * clears forms if currently editing the deleted record.
   * @param {string} id
   */
  function deleteRecordById(id) {
    const index = tradeRecords.findIndex((r) => r.id === id);
    if (index !== -1) {
      const deleted = tradeRecords.splice(index, 1)[0];
      // Clear forms if currently editing this record
      if (editingEntryId === id) {
        clearEntryForm();
        renderJudgeResult(null);
        editingEntryId = undefined;
      }
      if (editingExitId === id) {
        clearResultForm();
        editingExitId = undefined;
      }
      saveRecords();
    }
  }

  /**
   * Convert trade type code to human-readable label.
   * @param {string} type
   * @returns {string}
   */
  function labelTradeType(type) {
    switch (type) {
      case 'real':
        return 'リアル';
      case 'virtual':
        return 'バーチャル';
      case 'practice':
        return 'プラクティス';
    }
    return type;
  }

  /**
   * Convert direction code to human-readable label.
   * @param {string|null} dir
   * @returns {string}
   */
  function labelDirection(dir) {
    switch (dir) {
      case 'long':
        return 'ロング';
      case 'short':
        return 'ショート';
      case 'flat':
        return 'ノーポジ';
    }
    return '';
  }

  /**
   * Draw charts using Chart.js. Called each time stats are updated.
   * Destroys previous chart instances before creating new ones.
   * @param {Array} records Filtered trade records
   */
  function drawCharts(records) {
    // Destroy existing charts if any
    if (cumulativeChart) cumulativeChart.destroy();
    if (directionChart) directionChart.destroy();
    if (timeframeChart) timeframeChart.destroy();
    // Prepare data for cumulative profit line chart
    const sorted = records
      .filter((r) => r.datetimeEntry)
      .sort((a, b) => (a.datetimeEntry > b.datetimeEntry ? 1 : -1));
    const labels = [];
    const cumulative = [];
    let sum = 0;
    sorted.forEach((r) => {
      labels.push(r.datetimeEntry.replace('T', ' '));
      if (typeof r.profit === 'number') {
        sum += r.profit;
      }
      cumulative.push(sum);
    });
    const ctx1 = document.getElementById('chart-cumulative').getContext('2d');
    cumulativeChart = new Chart(ctx1, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '累積損益',
            data: cumulative,
            borderColor: '#00ffc8',
            backgroundColor: 'rgba(0, 255, 200, 0.2)',
            tension: 0.3
          }
        ]
      },
      options: {
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            ticks: { color: '#e4e9f0', maxRotation: 90, minRotation: 45 },
            grid: { color: '#252c38' }
          },
          y: {
            ticks: { color: '#e4e9f0' },
            grid: { color: '#252c38' }
          }
        }
      }
    });
    // Data for direction bar chart
    const directions = ['long', 'short'];
    const winRates = [];
    const avgProfits = [];
    const avgLosses = [];
    directions.forEach((dir) => {
      const recs = records.filter((r) => r.directionTaken === dir && r.hasResult);
      let wins = 0;
      let profits = [];
      let losses = [];
      recs.forEach((r) => {
        if (r.profit > 0) {
          wins++;
          profits.push(r.profit);
        } else if (r.profit < 0) {
          losses.push(r.profit);
        }
      });
      const total = recs.length;
      const winRate = total > 0 ? (wins / total) * 100 : 0;
      const avgProfit = profits.length > 0 ? avg(profits) : 0;
      const avgLoss = losses.length > 0 ? avg(losses) : 0;
      winRates.push(winRate);
      avgProfits.push(avgProfit);
      avgLosses.push(avgLoss);
    });
    const ctx2 = document.getElementById('chart-direction').getContext('2d');
    directionChart = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: ['ロング', 'ショート'],
        datasets: [
          {
            label: '勝率 (%)',
            data: winRates,
            backgroundColor: ['#00ffc8', '#ff7f50'],
            yAxisID: 'y1'
          },
          {
            label: '平均利益 (円)',
            data: avgProfits,
            backgroundColor: ['rgba(0,255,200,0.4)', 'rgba(255,127,80,0.4)'],
            yAxisID: 'y2'
          },
          {
            label: '平均損失 (円)',
            data: avgLosses,
            backgroundColor: ['rgba(0,255,200,0.2)', 'rgba(255,127,80,0.2)'],
            yAxisID: 'y2'
          }
        ]
      },
      options: {
        scales: {
          x: { ticks: { color: '#e4e9f0' }, grid: { color: '#252c38' } },
          y1: {
            type: 'linear',
            position: 'left',
            ticks: { color: '#e4e9f0' },
            grid: { color: '#252c38' }
          },
          y2: {
            type: 'linear',
            position: 'right',
            ticks: { color: '#e4e9f0' },
            grid: { drawOnChartArea: false }
          }
        },
        plugins: {
          legend: { labels: { color: '#e4e9f0' } }
        }
      }
    });
    // Data for timeframe bar chart
    // Collect by timeframe
    const tfMap = {};
    records.forEach((r) => {
      if (!r.hasResult) return;
      const tf = r.timeframe || '不明';
      if (!tfMap[tf]) tfMap[tf] = { wins: 0, total: 0 };
      if (r.profit > 0) tfMap[tf].wins++;
      tfMap[tf].total++;
    });
    const tfs = Object.keys(tfMap);
    const tfWinRates = tfs.map((tf) => {
      const { wins, total } = tfMap[tf];
      return total > 0 ? (wins / total) * 100 : 0;
    });
    const ctx3 = document.getElementById('chart-timeframe').getContext('2d');
    timeframeChart = new Chart(ctx3, {
      type: 'bar',
      data: {
        labels: tfs,
        datasets: [
          {
            label: '勝率 (%)',
            data: tfWinRates,
            backgroundColor: '#00ffc8'
          }
        ]
      },
      options: {
        scales: {
          x: { ticks: { color: '#e4e9f0' }, grid: { color: '#252c38' } },
          y: { ticks: { color: '#e4e9f0' }, grid: { color: '#252c38' }, beginAtZero: true }
        },
        plugins: {
          legend: { labels: { color: '#e4e9f0' } }
        }
      }
    });
  }

  /**
   * Export current trade records to a JSON file. The file has a
   * top-level version and records field. A download link is generated
   * programmatically and triggered.
   */
  function exportRecords() {
    const data = {
      version: 1,
      records: tradeRecords
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tradeRecords.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Import records from a parsed JSON object. Performs version check and
   * merges new records. For records with matching IDs, the one with the
   * newer updatedAt timestamp is kept. After merging, updates UI.
   * @param {Object} data
   */
  function importRecords(data) {
    if (!data || typeof data !== 'object' || data.version !== 1 || !Array.isArray(data.records)) {
      alert('インポートファイルの形式が不正です。');
      return;
    }
    let added = 0;
    let updated = 0;
    data.records.forEach((rec) => {
      const existingIndex = tradeRecords.findIndex((r) => r.id === rec.id);
      if (existingIndex === -1) {
        tradeRecords.push(rec);
        added++;
      } else {
        const existing = tradeRecords[existingIndex];
        if (existing.updatedAt < rec.updatedAt) {
          tradeRecords[existingIndex] = rec;
          updated++;
        }
      }
    });
    saveRecords();
    alert(`インポート完了: 追加 ${added}件, 更新 ${updated}件`);
    updateRecordList();
    updateStats();
  }

  // Initialize after DOM is ready
  document.addEventListener('DOMContentLoaded', init);
})();