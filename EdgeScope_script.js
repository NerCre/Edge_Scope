(() => {
  "use strict";

  const STORAGE_KEY = "tradeRecords_v1";

  /** ---------------------------
   *  DOM helpers
   *  --------------------------*/
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const elEntryError = $("#entry-error");
  const elExitError = $("#exit-error");
  const elJudgeOutput = $("#judge-output");
  const elExitSelect = $("#exit-select");
  const elExitDetails = $("#exit-details");
  const elStatsSummary = $("#stats-summary");
  const elStatsTable = $("#stats-table");

  /** ---------------------------
   *  State
   *  --------------------------*/
  let records = [];
  let editingEntryId = null; // when editing entry in-place
  let selectedExitId = null; // current exit edit target

  // Charts
  let chartCumulative = null;
  let chartDirection = null;
  let chartTimeframe = null;

  /** ---------------------------
   *  Utilities
   *  --------------------------*/
  function nowISO() {
    return new Date().toISOString();
  }

  function uuid() {
    try {
      if (crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (_) {}
    // Fallback
    return "id-" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
  }

  function safeNum(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function toJpDir(dir) {
    if (dir === "long") return "ロング";
    if (dir === "short") return "ショート";
    return "ノーポジ";
  }

  function symbolMultiplier(symbol) {
    // user confirmed: mini=100, large=1000. micro=10.
    if (symbol === "nk225mc") return 10;
    if (symbol === "nk225m") return 100;
    if (symbol === "nk225") return 1000;
    return 1;
  }

  function clearMsg() {
    if (elEntryError) elEntryError.textContent = "";
    if (elExitError) elExitError.textContent = "";
  }

  function showError(target, msg) {
    if (!target) return;
    target.textContent = msg;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function parseISODateOnly(isoOrDateLocal) {
    if (!isoOrDateLocal) return null;
    // if already date-only
    if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDateLocal)) return isoOrDateLocal;
    // datetime-local "YYYY-MM-DDTHH:mm"
    const m = String(isoOrDateLocal).match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }

  /** ---------------------------
   *  Storage
   *  --------------------------*/
  function loadRecords() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(migrateRecord);
    } catch (e) {
      console.warn("Failed to load records:", e);
      return [];
    }
  }

  function saveRecords() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function migrateRecord(r) {
    // Ensure required keys exist (backward compatible)
    const out = { ...r };

    out.id = String(out.id || uuid());
    out.createdAt = out.createdAt || nowISO();
    out.updatedAt = out.updatedAt || out.createdAt;

    // Entry
    out.datetimeEntry = out.datetimeEntry ?? null;
    out.symbol = out.symbol || "nk225mc";
    out.timeframe = out.timeframe || "1時間";
    out.tradeType = out.tradeType || "real";
    out.directionPlanned = out.directionPlanned || "long";
    out.entryPrice = out.entryPrice ?? null;
    out.size = out.size ?? null;
    out.feePerUnit = out.feePerUnit ?? null;
    out.plannedStopPrice = out.plannedStopPrice ?? null;
    out.plannedLimitPrice = out.plannedLimitPrice ?? null;
    out.cutLossPrice = out.cutLossPrice ?? null;

    // Indicators
    out.prevWave = out.prevWave || "HH";
    out.trend_5_20_40 = out.trend_5_20_40 || "Stage3";
    out.price_vs_ema200 = out.price_vs_ema200 || "above";
    out.ema_band_color = out.ema_band_color || "neutral";
    out.zone = out.zone || "pivot";
    out.cmf_sign = out.cmf_sign || "near_zero";
    out.cmf_sma_dir = out.cmf_sma_dir || "flat";
    out.macd_state = out.macd_state || "neutral";
    out.roc_sign = out.roc_sign || "near_zero";
    out.roc_sma_dir = out.roc_sma_dir || "flat";
    out.rsi_zone = out.rsi_zone || "around50";

    // Judge thresholds
    out.minWinRate = out.minWinRate ?? 30;

    // Memo
    out.marketMemo = out.marketMemo || "";
    out.notionUrl = out.notionUrl || "";
    // imageData is optional but ignored by CSV; keep if exists
    out.imageData = out.imageData ?? null;

    // Judge result
    out.recommendation = out.recommendation ?? null;
    out.expectedMove = out.expectedMove ?? null;
    out.expectedMoveUnit = out.expectedMoveUnit || "円";
    out.confidence = out.confidence ?? null;
    out.winRate = out.winRate ?? null;
    out.avgProfit = out.avgProfit ?? null;
    out.avgLoss = out.avgLoss ?? null;
    out.pseudoCaseCount = out.pseudoCaseCount ?? null;

    // Exit/result
    out.hasResult = Boolean(out.hasResult);
    out.datetimeExit = out.datetimeExit ?? null;
    out.exitPrice = out.exitPrice ?? null;
    out.directionTaken = out.directionTaken || out.directionPlanned || "long";
    out.highDuringTrade = out.highDuringTrade ?? null;
    out.lowDuringTrade = out.lowDuringTrade ?? null;
    out.profit = out.profit ?? null;
    out.resultMemo = out.resultMemo || "";

    return out;
  }

  /** ---------------------------
   *  Tabs
   *  --------------------------*/
  function initTabs() {
    $$(".tab-button").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".tab-button").forEach((b) => b.classList.remove("active"));
        $$(".tab-content").forEach((sec) => sec.classList.remove("active"));

        btn.classList.add("active");
        const tab = btn.dataset.tab;
        const sec = document.getElementById(`${tab}-tab`);
        if (sec) sec.classList.add("active");
      });
    });
  }

  function gotoTab(tabName) {
    const btn = $(`.tab-button[data-tab="${tabName}"]`);
    if (btn) btn.click();
  }

  /** ---------------------------
   *  Entry form
   *  --------------------------*/
  function getEntryForm() {
    return {
      datetimeEntry: $("#entry-datetime").value || null,
      symbol: $("#entry-symbol").value,
      timeframe: $("#entry-timeframe").value,
      tradeType: $("#entry-tradeType").value,
      directionPlanned: $("#entry-direction").value,

      entryPrice: safeNum($("#entry-price").value),
      size: safeNum($("#entry-size").value),
      feePerUnit: safeNum($("#entry-fee").value),
      plannedStopPrice: safeNum($("#entry-StopPrice").value),
      plannedLimitPrice: safeNum($("#entry-LimitPrice").value),
      cutLossPrice: safeNum($("#entry-LossPrice").value),

      prevWave: $("#ind-prevWave").value,
      trend_5_20_40: $("#ind-trend_5_20_40").value,
      price_vs_ema200: $("#ind-price_vs_ema200").value,
      ema_band_color: $("#ind-ema_band_color").value,
      zone: $("#ind-atr_zone").value,
      cmf_sign: $("#ind-cmf_sign").value,
      cmf_sma_dir: $("#ind-cmf_sma").value,
      macd_state: $("#ind-MACD").value,
      roc_sign: $("#ind-roc_sign").value,
      roc_sma_dir: $("#ind-roc_sma").value,
      rsi_zone: $("#ind-RSI").value,

      minWinRate: safeNum($("#entry-minWinRate").value),

      marketMemo: $("#entry-marketMemo").value || "",
      notionUrl: $("#entry-notionUrl").value || ""
    };
  }

  function validateEntryRequired(entry) {
    if (!entry.datetimeEntry) return "エントリー日時は必須です。";
    if (entry.entryPrice === null) return "エントリー価格は必須です。";
    if (entry.size === null) return "枚数は必須です。";
    if (entry.feePerUnit === null) return "1枚あたりの手数料は必須です。";
    return null;
  }

  function clearEntryForm() {
    editingEntryId = null;
    $("#entry-form").reset();

    // restore defaults
    $("#entry-symbol").value = "nk225mc";
    $("#entry-timeframe").value = "1時間";
    $("#entry-tradeType").value = "real";
    $("#entry-direction").value = "long";
    $("#entry-minWinRate").value = "30";

    // clear optional textareas
    $("#entry-marketMemo").value = "";
    $("#entry-notionUrl").value = "";

    // clear judge UI
    if (elJudgeOutput) {
      elJudgeOutput.innerHTML = `<p class="muted">ここに判定結果が表示されます。</p>`;
    }
    clearMsg();
  }

  function renderJudge(result, symbol) {
    if (!elJudgeOutput) return;

    if (!result || result.pseudoCaseCount === 0) {
      elJudgeOutput.innerHTML = `
        <div class="judge-grid">
          <div><strong>判定銘柄</strong><div>${symbol}</div></div>
          <div><strong>疑似ケース</strong><div>0件</div></div>
        </div>
        <p class="muted">同じ銘柄×同じ時間足の決済済みデータが不足しています。</p>
      `;
      return;
    }

    const bar = (pct) => {
      const p = clamp(Number(pct || 0), 0, 100);
      return `
        <div class="bar">
          <div class="bar-fill" style="width:${p}%"></div>
        </div>
      `;
    };

    const winRate = (result.winRate ?? null);
    const minWin = (result.minWinRate ?? null);

    const isBelow = (winRate !== null && minWin !== null && winRate < minWin);

    const expected = (isBelow || result.expectedMove == null)
      ? "—"
      : `${result.recommendation === "short" ? "-" : "+"}${Math.round(result.expectedMove)}${result.expectedMoveUnit || "円"}`;

    elJudgeOutput.innerHTML = `
      <div class="judge-grid">
        <div><strong>判定銘柄</strong><div>${symbol}</div></div>
        <div><strong>疑似ケース</strong><div>${result.pseudoCaseCount}件</div></div>
        <div><strong>推奨方向</strong><div>${toJpDir(result.recommendation)}</div></div>
        <div><strong>勝率</strong><div>${winRate == null ? "—" : `${Math.round(winRate)}%`}</div></div>

        <div class="full">
          <strong>信頼度</strong>
          <div class="row">
            <div>${result.confidence == null ? "—" : `${Math.round(result.confidence)}%`}</div>
            ${bar(result.confidence)}
          </div>
        </div>

        <div><strong>推定値幅</strong><div>${expected}</div></div>
        <div><strong>平均利益</strong><div>${result.avgProfit == null ? "—" : `${Math.round(result.avgProfit)}円`}</div></div>
        <div><strong>平均損失</strong><div>${result.avgLoss == null ? "—" : `${Math.round(result.avgLoss)}円`}</div></div>
      </div>
      ${isBelow ? `<p class="muted small">※ 勝率しきい値（${minWin}%）未満のため「ノーポジ推奨」扱いです。</p>` : ``}
    `;
  }

  /** ---------------------------
   *  Judge logic
   *  --------------------------*/
  function isSameFeature(r, current) {
    const keys = [
      "prevWave",
      "trend_5_20_40",
      "price_vs_ema200",
      "ema_band_color",
      "zone",
      "cmf_sign",
      "cmf_sma_dir",
      "macd_state",
      "roc_sign",
      "roc_sma_dir",
      "rsi_zone"
    ];
    let match = 0;
    for (const k of keys) {
      if ((r[k] ?? null) === (current[k] ?? null)) match++;
    }
    return match / keys.length;
  }

  function judge(current) {
    const minWinRate = Number.isFinite(current.minWinRate) ? current.minWinRate : 30;

    // 1) same symbol + timeframe, must have results
    const candidates = records.filter((r) =>
      r.hasResult &&
      r.symbol === current.symbol &&
      r.timeframe === current.timeframe &&
      typeof r.profit === "number" &&
      Number.isFinite(r.profit)
    );

    // 2) pseudo cases by similarity score
    const withScore = candidates
      .map((r) => ({ r, score: isSameFeature(r, current) }))
      .sort((a, b) => b.score - a.score);

    // threshold: keep reasonably similar
    const TH = 0.70;
    const pseudo = withScore.filter((x) => x.score >= TH).map((x) => x.r);

    if (pseudo.length === 0) {
      return {
        recommendation: "flat",
        expectedMove: null,
        expectedMoveUnit: "円",
        confidence: 0,
        winRate: null,
        avgProfit: null,
        avgLoss: null,
        pseudoCaseCount: 0,
        minWinRate
      };
    }

    // group by directionTaken
    const dirs = ["long", "short", "flat"];
    const statsByDir = {};
    for (const d of dirs) {
      const group = pseudo.filter((p) => (p.directionTaken || p.directionPlanned) === d);
      const n = group.length;

      const wins = group.filter((p) => p.profit > 0);
      const losses = group.filter((p) => p.profit < 0);

      const winRate = n === 0 ? null : (wins.length / n) * 100;
      const avgProfit = wins.length ? wins.reduce((s, p) => s + p.profit, 0) / wins.length : null;
      const avgLoss = losses.length ? losses.reduce((s, p) => s + p.profit, 0) / losses.length : null;

      // expectedMove: price based, no multiplier
      let expectedMove = null;
      if (d === "long") {
        const moves = group
          .map((p) => (typeof p.highDuringTrade === "number" && typeof p.entryPrice === "number")
            ? Math.max(0, p.highDuringTrade - p.entryPrice)
            : null
          )
          .filter((x) => typeof x === "number" && Number.isFinite(x));
        expectedMove = moves.length ? (moves.reduce((s, x) => s + x, 0) / moves.length) : null;
      } else if (d === "short") {
        const moves = group
          .map((p) => (typeof p.lowDuringTrade === "number" && typeof p.entryPrice === "number")
            ? Math.max(0, p.entryPrice - p.lowDuringTrade)
            : null
          )
          .filter((x) => typeof x === "number" && Number.isFinite(x));
        expectedMove = moves.length ? (moves.reduce((s, x) => s + x, 0) / moves.length) : null;
      }

      // Expected value: wins average + losses average (losses avg is negative)
      const ev = (avgProfit ?? 0) + (avgLoss ?? 0);

      statsByDir[d] = { n, winRate, avgProfit, avgLoss, expectedMove, ev };
    }

    // choose candidate direction based on expected value; tie-break by winRate then count
    const choices = ["long", "short"].filter((d) => statsByDir[d].n > 0);
    let candidate = "flat";
    if (choices.length) {
      candidate = choices.sort((a, b) => {
        const A = statsByDir[a], B = statsByDir[b];
        if ((B.ev ?? -Infinity) !== (A.ev ?? -Infinity)) return (B.ev ?? -Infinity) - (A.ev ?? -Infinity);
        if ((B.winRate ?? -Infinity) !== (A.winRate ?? -Infinity)) return (B.winRate ?? -Infinity) - (A.winRate ?? -Infinity);
        return (B.n ?? 0) - (A.n ?? 0);
      })[0];
    }

    const chosen = statsByDir[candidate] || { n: 0 };
    let recommendation = candidate;
    let winRate = chosen.winRate;

    if (recommendation === "flat") {
      winRate = null;
    } else if (winRate != null && winRate < minWinRate) {
      recommendation = "flat";
    }

    const pseudoCaseCount = pseudo.length;

    // confidence: blend winRate and log(count)
    const baseWR = (winRate == null ? 0 : winRate) / 100; // 0..1
    const countBoost = clamp(Math.log10(pseudoCaseCount + 1) / 1.2, 0, 1); // 0..~1
    const confidence = clamp((baseWR * 0.7 + countBoost * 0.3) * 100, 0, 100);

    return {
      recommendation,
      expectedMove: (recommendation === "flat") ? null : (chosen.expectedMove ?? null),
      expectedMoveUnit: "円",
      confidence,
      winRate: chosen.winRate ?? null,
      avgProfit: chosen.avgProfit ?? null,
      avgLoss: chosen.avgLoss ?? null,
      pseudoCaseCount,
      minWinRate
    };
  }

  /** ---------------------------
   *  Entry handlers
   *  --------------------------*/
  function onJudge(shouldSave) {
    clearMsg();
    const entry = getEntryForm();
    const err = validateEntryRequired(entry);
    if (err) {
      showError(elEntryError, err);
      return;
    }

    const j = judge(entry);
    renderJudge(j, entry.symbol);

    if (!shouldSave) return;

    const base = {
      id: editingEntryId || uuid(),
      createdAt: editingEntryId ? (records.find(r => r.id === editingEntryId)?.createdAt || nowISO()) : nowISO(),
      updatedAt: nowISO(),

      // Entry
      datetimeEntry: entry.datetimeEntry,
      symbol: entry.symbol,
      timeframe: entry.timeframe,
      tradeType: entry.tradeType,
      directionPlanned: entry.directionPlanned,
      entryPrice: entry.entryPrice,
      size: entry.size,
      feePerUnit: entry.feePerUnit,
      plannedStopPrice: entry.plannedStopPrice,
      plannedLimitPrice: entry.plannedLimitPrice,
      cutLossPrice: entry.cutLossPrice,

      // indicators
      prevWave: entry.prevWave,
      trend_5_20_40: entry.trend_5_20_40,
      price_vs_ema200: entry.price_vs_ema200,
      ema_band_color: entry.ema_band_color,
      zone: entry.zone,
      cmf_sign: entry.cmf_sign,
      cmf_sma_dir: entry.cmf_sma_dir,
      macd_state: entry.macd_state,
      roc_sign: entry.roc_sign,
      roc_sma_dir: entry.roc_sma_dir,
      rsi_zone: entry.rsi_zone,

      minWinRate: entry.minWinRate ?? 30,

      marketMemo: entry.marketMemo,
      notionUrl: entry.notionUrl,

      // judge results (snapshot)
      recommendation: j.recommendation,
      expectedMove: j.expectedMove,
      expectedMoveUnit: j.expectedMoveUnit,
      confidence: j.confidence,
      winRate: j.winRate,
      avgProfit: j.avgProfit,
      avgLoss: j.avgLoss,
      pseudoCaseCount: j.pseudoCaseCount,

      // exit placeholders
      hasResult: false,
      datetimeExit: null,
      exitPrice: null,
      directionTaken: entry.directionPlanned,
      highDuringTrade: null,
      lowDuringTrade: null,
      profit: null,
      resultMemo: ""
    };

    // update or insert
    const idx = records.findIndex((r) => r.id === base.id);
    if (idx >= 0) {
      records[idx] = migrateRecord({ ...records[idx], ...base });
    } else {
      records.unshift(migrateRecord(base));
    }

    saveRecords();
    updateExitSelect();
    renderStats();

    editingEntryId = null;
    showError(elEntryError, "保存しました。");
  }

  /** ---------------------------
   *  Exit form
   *  --------------------------*/
  function updateExitSelect() {
    if (!elExitSelect) return;

    // keep selection if possible
    const currentVal = elExitSelect.value || selectedExitId || "";

    // Sort by datetimeEntry desc
    const sorted = [...records].sort((a, b) => String(b.datetimeEntry || "").localeCompare(String(a.datetimeEntry || "")));

    elExitSelect.innerHTML = "";

    for (const r of sorted) {
      const opt = document.createElement("option");
      opt.value = r.id;
      const status = r.hasResult ? "済" : "未";
      const dt = r.datetimeEntry ? r.datetimeEntry.replace("T", " ") : "—";
      opt.textContent = `[${status}] ${dt} / ${r.symbol} / ${r.timeframe} / ${toJpDir(r.directionPlanned)} / id:${r.id.slice(0, 8)}`;
      elExitSelect.appendChild(opt);
    }

    if (currentVal && sorted.some(r => r.id === currentVal)) {
      elExitSelect.value = currentVal;
      selectedExitId = currentVal;
      renderExitDetails(currentVal);
    } else {
      selectedExitId = null;
      elExitDetails.innerHTML = `<p class="muted">左のリストからトレードを選択してください。</p>`;
    }
  }

  function renderExitDetails(id) {
    const r = records.find((x) => x.id === id);
    if (!r) {
      elExitDetails.innerHTML = `<p class="muted">レコードが見つかりません。</p>`;
      return;
    }

    // Build exit form fields (direction/size/fee read-only)
    elExitDetails.innerHTML = `
      <label>決済日時
        <input id="exit-datetime" type="datetime-local" value="${r.datetimeExit ? String(r.datetimeExit) : ""}">
      </label>

      <label>実際の決済価格
        <input id="exit-price" type="number" inputmode="decimal" step="0.1" value="${r.exitPrice ?? ""}">
      </label>

      <label>エントリー方向（表示）
        <input type="text" value="${toJpDir(r.directionTaken || r.directionPlanned)}" readonly>
      </label>

      <label>枚数（表示）
        <input id="exit-size-ro" type="number" value="${r.size ?? ""}" readonly>
      </label>

      <label>1枚あたりの手数料（表示）
        <input id="exit-fee-ro" type="number" value="${r.feePerUnit ?? ""}" readonly>
      </label>

      <label>トレード中の最高値
        <input id="exit-high" type="number" inputmode="decimal" step="0.1" value="${r.highDuringTrade ?? ""}">
      </label>

      <label>トレード中の最安値
        <input id="exit-low" type="number" inputmode="decimal" step="0.1" value="${r.lowDuringTrade ?? ""}">
      </label>

      <label class="full">メモ
        <textarea id="resultMemo" rows="4" placeholder="振り返り">${escapeHtml(r.resultMemo || "")}</textarea>
      </label>

      <div class="full">
        <strong>損益（自動計算）</strong>
        <div id="exitProfitDisp" class="profit-pill">${formatYen(r.profit)}</div>
        <p class="muted small">計算: (±(決済-エントリー)-手数料)×枚数×倍率（銘柄）</p>
      </div>
    `;

    // live update profit when numbers change
    const bind = (idSel) => {
      const el = $(idSel);
      if (!el) return;
      el.addEventListener("input", () => updateExitProfitPreview(r));
    };
    bind("#exit-price");
    bind("#exit-high");
    bind("#exit-low");
    bind("#resultMemo");
    bind("#exit-datetime");

    updateExitProfitPreview(r);
  }

  function computeProfit(symbol, direction, entryPrice, exitPrice, feePerUnit, size) {
    if (![entryPrice, exitPrice, feePerUnit, size].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    const mult = symbolMultiplier(symbol);
    let baseProfit = 0;

    if (direction === "long") {
      baseProfit = (exitPrice - entryPrice - feePerUnit) * size;
    } else if (direction === "short") {
      baseProfit = (entryPrice - exitPrice - feePerUnit) * size;
    } else {
      baseProfit = 0;
    }
    const finalProfit = baseProfit * mult;
    return Number.isFinite(finalProfit) ? finalProfit : null;
  }

  function updateExitProfitPreview(record) {
    const exitPrice = safeNum($("#exit-price")?.value);
    const high = safeNum($("#exit-high")?.value);
    const low = safeNum($("#exit-low")?.value);
    const memo = $("#resultMemo")?.value ?? "";

    const profit = computeProfit(
      record.symbol,
      record.directionTaken || record.directionPlanned,
      record.entryPrice,
      exitPrice,
      record.feePerUnit,
      record.size
    );

    const disp = $("#exitProfitDisp");
    if (disp) disp.textContent = formatYen(profit);

    // keep current edits in memory (not saved yet)
    record._tmp = { exitPrice, highDuringTrade: high, lowDuringTrade: low, resultMemo: memo, profit };
  }

  function clearExitFormOnly() {
    if (!selectedExitId) return;
    const r = records.find((x) => x.id === selectedExitId);
    if (!r) return;

    // just clear the current inputs shown (does NOT modify storage)
    const setVal = (idSel, v) => {
      const el = $(idSel);
      if (el) el.value = v;
    };
    setVal("#exit-datetime", "");
    setVal("#exit-price", "");
    setVal("#exit-high", "");
    setVal("#exit-low", "");
    setVal("#resultMemo", "");

    const disp = $("#exitProfitDisp");
    if (disp) disp.textContent = "—";

    r._tmp = { exitPrice: null, highDuringTrade: null, lowDuringTrade: null, resultMemo: "", profit: null };
    showError(elExitError, "入力欄をクリアしました（保存はしていません）。");
  }

  function saveExit() {
    clearMsg();
    if (!selectedExitId) {
      showError(elExitError, "編集するトレードを選択してください。");
      return;
    }
    const r = records.find((x) => x.id === selectedExitId);
    if (!r) {
      showError(elExitError, "レコードが見つかりません。");
      return;
    }

    const dtExit = $("#exit-datetime")?.value || null;
    const exitPrice = safeNum($("#exit-price")?.value);
    const high = safeNum($("#exit-high")?.value);
    const low = safeNum($("#exit-low")?.value);
    const memo = $("#resultMemo")?.value ?? "";

    const profit = computeProfit(
      r.symbol,
      r.directionTaken || r.directionPlanned,
      r.entryPrice,
      exitPrice,
      r.feePerUnit,
      r.size
    );

    const updated = migrateRecord({
      ...r,
      updatedAt: nowISO(),
      datetimeExit: dtExit,
      exitPrice,
      highDuringTrade: high,
      lowDuringTrade: low,
      resultMemo: memo,
      profit,
      hasResult: Boolean(dtExit && exitPrice !== null)
    });

    const idx = records.findIndex((x) => x.id === r.id);
    records[idx] = updated;

    saveRecords();
    updateExitSelect();
    renderStats();
    showError(elExitError, "保存しました。");
  }

  /** ---------------------------
   *  Stats
   *  --------------------------*/
  function getFilters() {
    return {
      symbol: $("#filter-symbol")?.value || "",
      timeframe: $("#filter-timeframe")?.value || "",
      tradeType: $("#filter-tradeType")?.value || "",
      direction: $("#filter-direction")?.value || "",
      result: $("#filter-result")?.value || "",
      start: $("#filter-start")?.value || "",
      end: $("#filter-end")?.value || ""
    };
  }

  function applyFilters(list, f) {
    return list.filter((r) => {
      if (f.symbol && r.symbol !== f.symbol) return false;
      if (f.timeframe && r.timeframe !== f.timeframe) return false;
      if (f.tradeType && r.tradeType !== f.tradeType) return false;
      if (f.direction && (r.directionTaken || r.directionPlanned) !== f.direction) return false;

      if (f.result === "open" && r.hasResult) return false;
      if (f.result === "closed" && !r.hasResult) return false;

      const entryDate = parseISODateOnly(r.datetimeEntry);
      if (f.start && entryDate && entryDate < f.start) return false;
      if (f.end && entryDate && entryDate > f.end) return false;

      return true;
    });
  }

  function renderStatsSummary(list) {
    const closed = list.filter((r) => r.hasResult && typeof r.profit === "number" && Number.isFinite(r.profit));
    const wins = closed.filter((r) => r.profit > 0);
    const losses = closed.filter((r) => r.profit < 0);

    const total = list.length;
    const closedN = closed.length;
    const winRate = closedN ? (wins.length / closedN) * 100 : null;

    const avgProfit = wins.length ? wins.reduce((s, r) => s + r.profit, 0) / wins.length : null;
    const avgLoss = losses.length ? losses.reduce((s, r) => s + r.profit, 0) / losses.length : null;

    const sum = closedN ? closed.reduce((s, r) => s + r.profit, 0) : 0;

    elStatsSummary.innerHTML = `
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-label">件数</div>
          <div class="stat-value">${total}</div>
        </div>
        <div class="stat">
          <div class="stat-label">決済済み</div>
          <div class="stat-value">${closedN}</div>
        </div>
        <div class="stat">
          <div class="stat-label">勝率</div>
          <div class="stat-value">${winRate == null ? "—" : `${Math.round(winRate)}%`}</div>
        </div>
        <div class="stat">
          <div class="stat-label">累積損益</div>
          <div class="stat-value">${formatYen(sum)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">平均利益（勝ちのみ）</div>
          <div class="stat-value">${avgProfit == null ? "—" : formatYen(avgProfit)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">平均損失（負けのみ）</div>
          <div class="stat-value">${avgLoss == null ? "—" : formatYen(avgLoss)}</div>
        </div>
      </div>
    `;
  }

  function renderStatsTable(list) {
    elStatsTable.innerHTML = "";

    const sorted = [...list].sort((a, b) => String(b.datetimeEntry || "").localeCompare(String(a.datetimeEntry || "")));

    for (const r of sorted) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml((r.datetimeEntry || "").replace("T", " ")) || "—"}</td>
        <td>${escapeHtml(r.symbol)}</td>
        <td>${escapeHtml(r.timeframe)}</td>
        <td>${escapeHtml(r.tradeType)}</td>
        <td>${escapeHtml(toJpDir(r.directionPlanned))}</td>
        <td class="${r.profit > 0 ? "pos" : (r.profit < 0 ? "neg" : "")}">${r.hasResult ? formatYen(r.profit) : "—"}</td>
        <td>${r.hasResult ? "決済済み" : "未決済"}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn-mini" data-act="edit-entry" data-id="${r.id}">エントリー編集</button>
            <button type="button" class="btn-mini" data-act="edit-exit" data-id="${r.id}">結果編集</button>
            <button type="button" class="btn-mini danger" data-act="delete" data-id="${r.id}">削除</button>
          </div>
        </td>
      `;
      elStatsTable.appendChild(tr);
    }

    // bind actions (event delegation)
    elStatsTable.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        if (act === "edit-entry") {
          loadRecordToEntry(id);
          gotoTab("entry");
        } else if (act === "edit-exit") {
          selectedExitId = id;
          updateExitSelect();
          gotoTab("exit");
        } else if (act === "delete") {
          deleteRecord(id);
        }
      });
    });
  }

  function loadRecordToEntry(id) {
    const r = records.find((x) => x.id === id);
    if (!r) return;

    editingEntryId = r.id;

    $("#entry-datetime").value = r.datetimeEntry || "";
    $("#entry-symbol").value = r.symbol || "nk225mc";
    $("#entry-timeframe").value = r.timeframe || "1時間";
    $("#entry-tradeType").value = r.tradeType || "real";
    $("#entry-direction").value = r.directionPlanned || "long";

    $("#entry-price").value = r.entryPrice ?? "";
    $("#entry-size").value = r.size ?? "";
    $("#entry-fee").value = r.feePerUnit ?? "";

    $("#entry-StopPrice").value = r.plannedStopPrice ?? "";
    $("#entry-LimitPrice").value = r.plannedLimitPrice ?? "";
    $("#entry-LossPrice").value = r.cutLossPrice ?? "";

    $("#ind-prevWave").value = r.prevWave || "HH";
    $("#ind-trend_5_20_40").value = r.trend_5_20_40 || "Stage3";
    $("#ind-price_vs_ema200").value = r.price_vs_ema200 || "above";
    $("#ind-ema_band_color").value = r.ema_band_color || "neutral";
    $("#ind-atr_zone").value = r.zone || "pivot";
    $("#ind-cmf_sign").value = r.cmf_sign || "near_zero";
    $("#ind-cmf_sma").value = r.cmf_sma_dir || "flat";
    $("#ind-MACD").value = r.macd_state || "neutral";
    $("#ind-roc_sign").value = r.roc_sign || "near_zero";
    $("#ind-roc_sma").value = r.roc_sma_dir || "flat";
    $("#ind-RSI").value = r.rsi_zone || "around50";

    $("#entry-marketMemo").value = r.marketMemo || "";
    $("#entry-notionUrl").value = r.notionUrl || "";
    $("#entry-minWinRate").value = String(r.minWinRate ?? 30);

    // also render existing judge snapshot
    renderJudge({
      recommendation: r.recommendation ?? "flat",
      expectedMove: r.expectedMove ?? null,
      expectedMoveUnit: r.expectedMoveUnit || "円",
      confidence: r.confidence ?? 0,
      winRate: r.winRate ?? null,
      avgProfit: r.avgProfit ?? null,
      avgLoss: r.avgLoss ?? null,
      pseudoCaseCount: r.pseudoCaseCount ?? 0,
      minWinRate: r.minWinRate ?? 30
    }, r.symbol);

    showError(elEntryError, "編集モード：変更したら「判定してエントリーを保存」で上書き保存します。");
  }

  function deleteRecord(id) {
    const r = records.find((x) => x.id === id);
    if (!r) return;

    const ok = window.confirm("このトレード記録を削除しますか？（元に戻せません）");
    if (!ok) return;

    records = records.filter((x) => x.id !== id);
    saveRecords();

    // If currently editing that record, clear forms
    if (editingEntryId === id) clearEntryForm();
    if (selectedExitId === id) {
      selectedExitId = null;
      updateExitSelect();
    }

    renderStats();
  }

  /** ---------------------------
   *  Charts
   *  --------------------------*/
  function destroyCharts() {
    for (const c of [chartCumulative, chartDirection, chartTimeframe]) {
      if (c) c.destroy();
    }
    chartCumulative = chartDirection = chartTimeframe = null;
  }

  function renderCharts(list) {
    const closed = list.filter((r) => r.hasResult && typeof r.profit === "number" && Number.isFinite(r.profit))
      .sort((a, b) => String(a.datetimeExit || a.datetimeEntry || "").localeCompare(String(b.datetimeExit || b.datetimeEntry || "")));

    // Chart 1: cumulative profit
    const labels1 = [];
    const data1 = [];
    let cum = 0;
    for (const r of closed) {
      const label = (r.datetimeExit || r.datetimeEntry || "").replace("T", " ").slice(0, 16) || "—";
      labels1.push(label);
      cum += r.profit || 0;
      data1.push(cum);
    }

    // Chart 2: direction stats
    const dirs = ["long", "short"];
    const labels2 = dirs.map(toJpDir);
    const winRate2 = [];
    const avgP2 = [];
    const avgL2 = [];

    for (const d of dirs) {
      const group = closed.filter((r) => (r.directionTaken || r.directionPlanned) === d);
      const n = group.length;
      const wins = group.filter((r) => r.profit > 0);
      const losses = group.filter((r) => r.profit < 0);

      winRate2.push(n ? (wins.length / n) * 100 : 0);
      avgP2.push(wins.length ? wins.reduce((s, r) => s + r.profit, 0) / wins.length : 0);
      avgL2.push(losses.length ? losses.reduce((s, r) => s + r.profit, 0) / losses.length : 0);
    }

    // Chart 3: timeframe win rate
    const tfMap = new Map();
    for (const r of closed) {
      const tf = r.timeframe || "—";
      const obj = tfMap.get(tf) || { n: 0, w: 0 };
      obj.n += 1;
      if (r.profit > 0) obj.w += 1;
      tfMap.set(tf, obj);
    }
    const labels3 = Array.from(tfMap.keys());
    const data3 = labels3.map((k) => {
      const v = tfMap.get(k);
      return v.n ? (v.w / v.n) * 100 : 0;
    });

    destroyCharts();

    // If Chart.js missing, skip silently
    if (!window.Chart) return;

    const ctx1 = $("#chartCumulative");
    if (ctx1) {
      chartCumulative = new Chart(ctx1, {
        type: "line",
        data: {
          labels: labels1,
          datasets: [{ label: "累積損益", data: data1 }]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }

    const ctx2 = $("#chartDirection");
    if (ctx2) {
      chartDirection = new Chart(ctx2, {
        type: "bar",
        data: {
          labels: labels2,
          datasets: [
            { label: "勝率(%)", data: winRate2 },
            { label: "平均利益(円)", data: avgP2 },
            { label: "平均損失(円)", data: avgL2 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }

    const ctx3 = $("#chartTimeframe");
    if (ctx3) {
      chartTimeframe = new Chart(ctx3, {
        type: "bar",
        data: {
          labels: labels3,
          datasets: [{ label: "勝率(%)", data: data3 }]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }
  }

  function renderStats() {
    const f = getFilters();
    const filtered = applyFilters(records, f);

    renderStatsSummary(filtered);
    renderStatsTable(filtered);
    renderCharts(filtered);
  }

  /** ---------------------------
   *  Export / Import
   *  --------------------------*/
  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportJSON() {
    const payload = { version: 1, records };
    downloadText(`trades_${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(payload, null, 2), "application/json");
  }

  function importJSONFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) {
          alert("JSON形式が不正です。（version:1 かつ records配列が必要）");
          return;
        }
        const incoming = parsed.records.map(migrateRecord);

        const map = new Map(records.map((r) => [r.id, r]));
        let added = 0;
        let updated = 0;

        for (const inc of incoming) {
          const cur = map.get(inc.id);
          if (!cur) {
            map.set(inc.id, inc);
            added++;
          } else {
            const curTs = Date.parse(cur.updatedAt || cur.createdAt || "");
            const incTs = Date.parse(inc.updatedAt || inc.createdAt || "");
            if (Number.isFinite(incTs) && Number.isFinite(curTs) && incTs > curTs) {
              map.set(inc.id, inc);
              updated++;
            }
          }
        }

        records = Array.from(map.values()).sort((a, b) => String(b.datetimeEntry || "").localeCompare(String(a.datetimeEntry || "")));
        saveRecords();
        updateExitSelect();
        renderStats();

        alert(`インポート完了：追加 ${added} 件 / 更新 ${updated} 件`);
      } catch (e) {
        console.warn(e);
        alert("JSONの読み込みに失敗しました。");
      }
    };
    reader.readAsText(file);
  }

  function exportCSV() {
    // Flatten rows (exclude imageData)
    const cols = [
      "id","createdAt","updatedAt",
      "datetimeEntry","symbol","timeframe","tradeType","directionPlanned",
      "entryPrice","size","feePerUnit","plannedStopPrice","plannedLimitPrice","cutLossPrice",
      "prevWave","trend_5_20_40","price_vs_ema200","ema_band_color","zone",
      "cmf_sign","cmf_sma_dir","macd_state","roc_sign","roc_sma_dir","rsi_zone",
      "minWinRate",
      "recommendation","expectedMove","expectedMoveUnit","confidence","winRate","avgProfit","avgLoss","pseudoCaseCount",
      "hasResult","datetimeExit","exitPrice","highDuringTrade","lowDuringTrade","profit",
      "marketMemo","notionUrl","resultMemo"
    ];

    const esc = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      // escape quotes and wrap if needed
      const needs = /[",\n\r]/.test(s);
      const out = s.replace(/"/g, '""');
      return needs ? `"${out}"` : out;
    };

    const lines = [];
    lines.push(cols.join(","));
    for (const r0 of records) {
      const r = migrateRecord(r0);
      const row = cols.map((c) => esc(r[c]));
      lines.push(row.join(","));
    }

    downloadText(`trades_${new Date().toISOString().slice(0,10)}.csv`, lines.join("\n"), "text/csv");
  }

  /** ---------------------------
   *  Helpers for UI strings
   *  --------------------------*/
  function formatYen(v) {
    if (typeof v !== "number" || !Number.isFinite(v)) return "—";
    return Math.round(v).toLocaleString("ja-JP") + "円";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** ---------------------------
   *  Bindings
   *  --------------------------*/
  function bind() {
    $("#btn-judge")?.addEventListener("click", () => onJudge(false));
    $("#btn-save-entry")?.addEventListener("click", () => onJudge(true));
    $("#btn-clear-entry")?.addEventListener("click", () => clearEntryForm());

    elExitSelect?.addEventListener("change", () => {
      selectedExitId = elExitSelect.value || null;
      if (selectedExitId) renderExitDetails(selectedExitId);
    });
    $("#btn-exit-clear")?.addEventListener("click", () => clearExitFormOnly());
    $("#btn-exit-save")?.addEventListener("click", () => saveExit());

    $("#btn-apply-filter")?.addEventListener("click", () => renderStats());
    $("#btn-clear-filter")?.addEventListener("click", () => {
      $("#filter-symbol").value = "";
      $("#filter-timeframe").value = "";
      $("#filter-tradeType").value = "";
      $("#filter-direction").value = "";
      $("#filter-result").value = "";
      $("#filter-start").value = "";
      $("#filter-end").value = "";
      renderStats();
    });

    $("#btnExportJson")?.addEventListener("click", exportJSON);
    $("#btnImportJson")?.addEventListener("click", () => $("#import-file")?.click());
    $("#import-file")?.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importJSONFile(file);
      e.target.value = "";
    });

    $("#btnExportCsv")?.addEventListener("click", exportCSV);
  }

  /** ---------------------------
   *  Init
   *  --------------------------*/
  function init() {
    initTabs();

    records = loadRecords();
    saveRecords(); // normalize/migrate on load

    bind();
    updateExitSelect();
    renderStats();
    clearEntryForm();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
