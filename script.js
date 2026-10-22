// Quick Peer Review Optimizer — validation logic

(function () {
  const $ = (id) => document.getElementById(id);
  const codeEl = $("code"), gutter = $("gutter"), toastEl = $("toast");
  // Image sources accepted as SFMC-hosted (same list as the original tool).
  const IMG_ALLOWED_PREFIXES = ["https://image.e.iqos.com", "https://beacon.krxd.net", "https://click.e.iqos.com", "#PixelHere"];
  // Unsubscribe content block keys and CloudPage IDs accepted (same lists as the original tool).
  const UNSUB_KEYS = ["UnsubscribeOrganic_KG_RU", "unsubscribe_AE_AR", "UnsubscribeOrganic_UK", "unsubscribe_AE_EN", "Organic_link_unsub_region_EM", "RE_Footer_NBW_v1", "RE_Footer_NBW_v", "unsubscribe_v2", "uk_zyn_unsubscribe", "Organic_Unsubscribe_PK_ZYN", "UnsubscribeOrganic_FR"];
  const UNSUB_CLOUDPAGES = ["2632", "2633", "2634"];
  const VALID_ALIAS = /^[A-Za-z0-9_]+$/;
  const STORE = "qpro-draft";
  const LINE_H = 21;
  let view = "checks", lastResult = null, timer = null;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (msg) => { toastEl.textContent = msg; toastEl.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove("show"), 1800); };

  function attr(tag, name) {
    const m = tag.match(new RegExp("\\s" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i"));
    return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
  }

  function analyze(html) {
    const starts = [0];
    for (let i = 0; i < html.length; i++) if (html.charCodeAt(i) === 10) starts.push(i + 1);
    const lineOf = (idx) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; } return lo + 1; };

    // Raw-text scan so links inside <!--[if mso]> blocks count too. VML buttons (v:roundrect) are checked like <a>.
    const links = []; let m; const aRe = /<(?:a|v:roundrect)\b[^>]*>/gi;
    while ((m = aRe.exec(html))) {
      const href = attr(m[0], "href");
      if (href === null) { if (typeof console !== "undefined") console.error("Href attribute is null or undefined for the following node:", m[0]); continue; }
      links.push({ href, alias: attr(m[0], "alias"), line: lineOf(m.index) });
    }
    const imgs = []; const iRe = /<img\b[^>]*>/gi;
    while ((m = iRe.exec(html))) imgs.push({ src: attr(m[0], "src"), line: lineOf(m.index) });

    const checked = links.filter((l) => l.href.trim());
    const missing = checked.filter((l) => !l.alias || !l.alias.trim());
    const invalid = checked.filter((l) => l.alias && l.alias.trim() && !VALID_ALIAS.test(l.alias));
    const seen = new Map(); const dups = [];
    checked.forEach((l) => { if (!l.alias || !l.alias.trim() || !VALID_ALIAS.test(l.alias)) return; if (seen.has(l.alias)) dups.push(l); else seen.set(l.alias, l); });
    const offHost = imgs.filter((i) => {
      const src = (i.src || "").trim();
      if (!src) return true;                       // missing src is flagged, as in the original
      if (/^%%/.test(src)) return false;           // AMPscript-generated source
      return !IMG_ALLOWED_PREFIXES.some((p) => src.startsWith(p));
    });

    const mso = []; let open = null; const mRe = /<!--\[if\s+[^\]]*mso[^\]]*\]>|<!\[endif\](?:--)?>/gi;
    while ((m = mRe.exec(html))) { const ln = lineOf(m.index); if (/^<!--\[if/i.test(m[0])) { if (open) mso.push({ first: open, line: ln }); open = ln; } else open = null; }

    const blocks = []; const cRe = /%%=\s*ContentBlockBy(Key|ID|Name)\s*\(\s*["']?([^"')]+)["']?\s*\)\s*=%%/gi;
    while ((m = cRe.exec(html))) blocks.push({ by: m[1], value: m[2].trim(), line: lineOf(m.index), raw: m[0] });
    const unsubBlocks = blocks.filter((b) => /^key$/i.test(b.by) && UNSUB_KEYS.includes(b.value));
    const cloudPages = []; const cpRe = /%%=\s*RedirectTo\s*\(\s*CloudPagesURL\s*\(\s*(\d+)\s*\)\s*\)\s*=%%/gi;
    while ((m = cpRe.exec(html))) if (UNSUB_CLOUDPAGES.includes(m[1])) cloudPages.push({ id: m[1], line: lineOf(m.index) });

    const customs = []; const tRe = /<custom\b[^>]*>/gi;
    while ((m = tRe.exec(html))) customs.push({ name: (attr(m[0], "name") || "").toLowerCase(), type: (attr(m[0], "type") || "").toLowerCase(), tag: m[0], line: lineOf(m.index) });
    const TRACKING = ["opencounter", "usermatch"];
    const trackFound = customs.filter((c) => c.type === "tracking" && TRACKING.includes(c.name));
    const trackMissing = TRACKING.filter((n) => !trackFound.some((c) => c.name === n));

    const checks = [
      { id: "presence", heading: "Missing alias:", title: "Alias presence",
        issues: missing.map((l) => ({ line: l.line, text: `Missing alias for link with href = "${l.href}"` })) },
      { id: "format", heading: "Invalid alias:", title: "Alias format",
        issues: invalid.map((l) => ({ line: l.line, text: `Invalid alias "${l.alias}" for link with href = "${l.href}"` })) },
      { id: "dup", heading: "Duplicate aliases:", title: "No duplicates",
        issues: dups.map((l) => ({ line: l.line, text: `Duplicate alias "${l.alias}" found for link with href = "${l.href}"` })) },
      { id: "img", heading: "Image hosting:", title: "SFMC images",
        issues: offHost.map((i) => ({ line: i.line, text: `Image is not hosted on SFMC <img> tag: "${i.src ?? "null"}"` })) },
      { id: "mso", heading: "MSO tags:", title: "MSO tags",
        issues: mso.map((e) => ({ line: e.line, text: `Two Consecutive [if mso] open tags detected` })) },
      { id: "unsub", heading: "Unsubscribe content block:", title: "Unsubscribe block",
        issues: unsubBlocks.length || cloudPages.length ? [] : [{ line: null, text: "No Unsubscribe content block or Cloudpage present." }],
        info: unsubBlocks.length
          ? unsubBlocks.map((b) => ({ line: b.line, text: `Unsubscribe Content Block Present: %%=ContentBlockByKey("${b.value}")=%%` }))
          : cloudPages.map((c) => ({ line: c.line, text: `Unsubscribe CloudPagesURL is present: %%=RedirectTo(CloudPagesURL(${c.id}))=%%` })) },
      { id: "tracking", heading: "Tracking code:", title: "KPI tracking",
        issues: trackMissing.map((n) => ({ line: null, text: `Missing tracking code: <custom name="${n}" type="tracking" />` })),
        info: trackFound.map((c) => ({ line: c.line, text: `Tracking code present: <custom name="${c.name}" type="tracking" />` })) },
    ];
    const badLines = new Set(); checks.forEach((c) => c.issues.forEach((i) => i.line && badLines.add(i.line)));
    return { links, imgs, checks, badLines, lineCount: starts.length, total: checks.reduce((s, c) => s + c.issues.length, 0), hasDups: dups.length > 0, dupSet: new Set(dups.map((d) => d.alias)) };
  }

  function syncScroll() { gutter.style.transform = `translateY(${-codeEl.scrollTop}px)`; }
  function renderGutter(r) {
    let out = "";
    for (let i = 1; i <= r.lineCount; i++) out += r.badLines.has(i) ? `<span class="bad">${i}</span>` : `<span>${i}</span>`;
    gutter.innerHTML = out; syncScroll();
  }

  const row = (i, cls) => `<li><button type="button" class="row ${cls}" ${i.line ? `data-line="${i.line}"` : "data-nojump"} ${i.full ? `title="${esc(i.full)}"` : ""}><span class="txt">${esc(i.text)}</span><span class="ln">${i.line ? "L" + i.line : ""}</span></button></li>`;

  function renderChecks(r) {
    const el = $("view-checks");
    const nC = $("n-checks");
    if (!r) { nC.textContent = ""; el.innerHTML = `<div class="empty"><b>Ready when you are</b>${codeEl.value.trim() ? "Press <b style=\"display:inline;color:var(--gold)\">Validate</b> to check this email." : "Paste your email HTML on the left, then press Validate."}</div>`; return; }
    const passedChecks = r.checks.filter((c) => !c.issues.length);
    const ok = r.total === 0;
    nC.textContent = ok ? "✓" : r.total; nC.className = "n" + (ok ? "" : " bad");
    const N = r.checks.length, C = 2 * Math.PI * 36, frac = passedChecks.length / N;
    const score = `<div class="score">
      <div class="ring ${ok ? "ok" : ""}"><svg viewBox="0 0 84 84" aria-hidden="true"><circle class="track" cx="42" cy="42" r="36"></circle><circle class="val" cx="42" cy="42" r="36" stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}"></circle></svg>
        <div class="ring-label"><div><b>${passedChecks.length}/${N}</b><small>PASSED</small></div></div></div>
      <div>
        <h2>${ok ? "Ready for peer review" : `${r.total} issue${r.total > 1 ? "s" : ""} to fix`}</h2>
        <p>${ok ? `All ${N} checks passed for this email.` : "Click a message to jump to that line in the code."}</p>
        <div class="stats"><span><b>${r.links.length}</b> links</span><span><b>${r.imgs.length}</b> images</span><span><b>${r.lineCount}</b> lines</span></div>
      </div></div>`;
    const errors = r.checks.filter((c) => c.issues.length).map((c) =>
      `<section class="group"><div class="group-head"><span class="dot"></span><h3>${esc(c.heading)}</h3><span class="count">${c.issues.length}</span></div><ul class="rows">${c.issues.map((i) => row(i, "err")).join("")}</ul></section>`).join("");
    const info = r.checks.filter((c) => !c.issues.length && c.info && c.info.length).map((c) =>
      `<section class="group ok"><div class="group-head"><span class="dot"></span><h3>${esc(c.heading)}</h3><span class="count">${c.info.length}</span></div><ul class="rows">${c.info.map((i) => row(i, "ok")).join("")}</ul></section>`).join("");
    const noTagErrors = ["presence", "format", "img", "mso"].every((id) => !r.checks.find((c) => c.id === id).issues.length);
    const allGood = noTagErrors ? `<p class="allgood">All aliases are in the correct format.</p>` : "";
    const passed = passedChecks.length ? `<div class="passed"><span class="label">Passed</span>${passedChecks.map((c) => `<span class="chip-ok">${esc(c.title)}</span>`).join("")}</div>` : "";
    const note = r.hasDups ? `<p class="note"><b>Note:</b> Alias inside MSO code are also considered as duplicates. Please ignore them in case an error shows up.</p>` : "";
    el.innerHTML = staleBar() + score + allGood + errors + info + passed + note;
    el.classList.toggle("is-stale", stale);
  }

  function renderLinks(r) {
    const el = $("view-links");
    if (!r) { $("n-links").textContent = ""; el.innerHTML = `<div class="empty"><b>No list yet</b>Press Validate to list every alias and link in this email.</div>`; return; }
    $("n-links").textContent = r.links.length || "";
    el.classList.toggle("is-stale", stale);
    if (!r.links.length) { el.innerHTML = `<div class="empty"><b>No links found</b>Links with an href will be listed here with their aliases.</div>`; return; }
    const rows = r.links.map((l) => {
      const bad = !l.alias || !VALID_ALIAS.test(l.alias) || r.dupSet.has(l.alias);
      const a = l.alias === null || l.alias === "" ? "null" : l.alias;
      return `<li><button type="button" class="row" data-line="${l.line}"><span class="txt"><span class="tok-key">Alias:</span> <span class="tok-alias ${bad ? "bad" : ""}">"${esc(a)}"</span><span class="tok-arrow">-&gt;</span><span class="tok-key">href:</span> <span class="tok-href">"${esc(l.href)}"</span></span><span class="ln">L${l.line}</span></button></li>`;
    }).join("");
    el.innerHTML = staleBar() + `<section class="group neutral"><div class="group-head"><span class="dot"></span><h3>Aliases and Links:</h3><span class="count">${r.links.length}</span>
      <button class="btn" type="button" id="copyCsv">Copy as CSV</button></div><ul class="rows">${rows}</ul></section>`;
  }

  let stale = false;
  const staleBar = () => stale ? `<div class="stale-bar"><span><b>Code changed.</b> These results are from the last validation.</span><button class="btn primary" type="button" data-validate>Validate again</button></div>` : "";
  function setState() {
    const lbl = $("stateLabel");
    lbl.className = "live" + (lastResult ? (stale ? " stale" : " fresh") : "");
    lbl.textContent = !lastResult ? "Not validated yet" : stale ? "Changed since last validation" : "Validated";
  }
  function plainGutter() {
    const n = codeEl.value.split("\n").length; let out = "";
    for (let i = 1; i <= n; i++) out += `<span>${i}</span>`;
    gutter.innerHTML = out; syncScroll();
    $("status").textContent = `${n} lines`;
  }
  // Code edited, pasted, loaded or cleared: no validation, results become out of date.
  function codeChanged() {
    cancelScan();
    plainGutter();
    if (!codeEl.value.trim()) { lastResult = null; stale = false; }
    else if (lastResult) stale = true;
    renderChecks(lastResult); renderLinks(lastResult); renderPreview(); setState();
  }

  // Preview pop-up
  const modal = $("pvModal");
  let lastFocus = null;
  const AUTO_KEY = "qpro-autopreview";
  try { const v = localStorage.getItem(AUTO_KEY); if (v !== null) $("autoPreview").checked = v === "1"; } catch (e) {}
  function renderPreview() {
    if (modal.hidden) return;
    $("frameDesk").srcdoc = codeEl.value;
    $("frameMob").srcdoc = codeEl.value;
  }
  function openPreview() {
    if (!codeEl.value.trim()) { toast("Paste some HTML first"); return; }
    lastFocus = document.activeElement;
    modal.hidden = false; document.body.classList.add("modal-open");
    renderPreview(); $("pvClose").focus();
  }
  function closePreview() {
    modal.hidden = true; document.body.classList.remove("modal-open");
    $("frameDesk").srcdoc = ""; $("frameMob").srcdoc = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function setMode(mode) {
    $("stage").dataset.mode = mode;
    modal.querySelectorAll("[data-mode]").forEach((b) => { if (b.tagName === "BUTTON") b.setAttribute("aria-pressed", String(b.dataset.mode === mode)); });
  }

  const SCAN_STEPS = ["Scanning HTML...", "Checking For Missing aliases & Duplicate aliases...", "Checking for Invalid aliases...", "Checking for Unsubscribe content blocks & Images..."];
  let scanTimer = null;
  function cancelScan() { clearTimeout(scanTimer); scanTimer = null; $("scanBtn").disabled = false; }
  function scan() {
    cancelScan();
    if (!codeEl.value.trim()) { codeChanged(); toast("Paste some HTML first"); return; }
    setView("checks");
    const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = $("view-checks");
    el.innerHTML = `<ul class="scan" aria-live="polite">${SCAN_STEPS.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
    const items = el.querySelectorAll(".scan li");
    $("scanBtn").disabled = true;
    let i = 0;
    const step = () => {
      if (i > 0) { items[i - 1].classList.remove("active"); items[i - 1].classList.add("done"); }
      if (i === items.length) { scanTimer = setTimeout(() => { cancelScan(); run(); if ($("autoPreview").checked) openPreview(); }, reduce ? 0 : 200); return; }
      items[i].classList.add("active"); i++;
      scanTimer = setTimeout(step, reduce ? 0 : 420);
    };
    step();
  }

  function run() {
    const r = analyze(codeEl.value); lastResult = r; stale = false; setState();
    renderGutter(r); renderChecks(r); renderLinks(r); renderPreview();
    $("status").textContent = `${r.lineCount} lines · ${r.links.length} links · ${r.imgs.length} images`;
  }

  function jumpTo(line) {
    const lines = codeEl.value.split("\n");
    let start = 0; for (let i = 0; i < line - 1; i++) start += lines[i].length + 1;
    codeEl.focus(); codeEl.setSelectionRange(start, start + (lines[line - 1] || "").length);
    codeEl.scrollTop = Math.max(0, (line - 1) * LINE_H - codeEl.clientHeight / 3);
    syncScroll();
  }

  function setView(v) {
    view = v;
    document.querySelectorAll('[role="tab"]').forEach((t) => t.setAttribute("aria-selected", String(t.dataset.view === v)));
    ["checks", "links"].forEach((k) => { $("view-" + k).hidden = k !== v; });
  }

  function save() { try { localStorage.setItem(STORE, codeEl.value); } catch (e) {} }
  function setSample(on, name) { $("sampleTag").hidden = !on; $("fileName").textContent = name || (on ? "sample-email.html" : "email.html"); }

  const SAMPLE = ``;

  $("scanBtn").addEventListener("click", scan);
  codeEl.addEventListener("input", () => { setSample(false); clearTimeout(timer); timer = setTimeout(() => { codeChanged(); save(); }, 120); });
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); scan(); } });
  codeEl.addEventListener("scroll", syncScroll);
  codeEl.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); codeEl.setRangeText("  ", codeEl.selectionStart, codeEl.selectionEnd, "end"); codeEl.dispatchEvent(new Event("input")); }
  });
  document.querySelectorAll('[role="tab"]').forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-validate]")) { scan(); return; }
    if (e.target.closest("[data-preview]")) { openPreview(); return; }
    const r = e.target.closest(".row[data-line]");
    if (r) jumpTo(+r.dataset.line);
    if (e.target.id === "copyCsv" && lastResult) {
      const q = (s) => `"${String(s ?? "null").replace(/"/g, '""')}"`;
      const csv = ["line,alias,href", ...lastResult.links.map((l) => [l.line, q(l.alias), q(l.href)].join(","))].join("\n");
      navigator.clipboard.writeText(csv).then(() => toast(`Copied ${lastResult.links.length} links as CSV`), () => toast("Copy was blocked by the browser"));
    }
  });
  $("clearBtn").addEventListener("click", () => { codeEl.value = ""; setSample(false); codeChanged(); save(); codeEl.focus(); });
  $("sampleBtn").addEventListener("click", () => { codeEl.value = SAMPLE; setSample(true); save(); codeChanged(); toast("Sample loaded. Press Validate to check it"); });
  $("previewBtn").addEventListener("click", openPreview);
  $("pvClose").addEventListener("click", closePreview);
  modal.addEventListener("click", (e) => { if (e.target === modal) closePreview(); });
  modal.querySelectorAll("button[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("autoPreview").addEventListener("change", (e) => { try { localStorage.setItem(AUTO_KEY, e.target.checked ? "1" : "0"); } catch (err) {} });
  document.addEventListener("keydown", (e) => {
    if (modal.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); closePreview(); }
    if (e.key === "Tab") { // keep focus inside the pop-up
      const f = [...modal.querySelectorAll("button, input")].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  const ed = $("editor");
  ["dragenter", "dragover"].forEach((ev) => ed.addEventListener(ev, (e) => { e.preventDefault(); ed.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((ev) => ed.addEventListener(ev, (e) => { e.preventDefault(); ed.classList.remove("dragging"); }));
  ed.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files[0]; if (!f) return;
    const rd = new FileReader(); rd.onload = () => { codeEl.value = rd.result; setSample(false, f.name); save(); codeChanged(); toast("Loaded " + f.name + ". Press Validate to check it"); }; rd.readAsText(f);
  });

  let draft = null; try { draft = localStorage.getItem(STORE); } catch (e) {}
  if (draft && draft.trim() && draft !== SAMPLE) { codeEl.value = draft; setSample(false); } else { codeEl.value = SAMPLE; setSample(true); }
  codeChanged();
})();
