(function () {
  const report = window.__REPORT__ || {};
  if (!report || !report.student_enabled) return;

  // ------- DOM -------
  const studentSearch = document.getElementById("studentSearch");
  const analyzeStudentBtn = document.getElementById("analyzeStudentBtn");
  const studentSelectedNote = document.getElementById("studentSelectedNote");

  // legacy top heatmap
  const stuModuleForHeatmap = document.getElementById("stuModuleForHeatmap");
  const renderStudentHeatmapBtn = document.getElementById("renderStudentHeatmap");

  // inline multi-module heatmap
  const hmModule = document.getElementById("hmModule"); // MULTI
  const hmFrom = document.getElementById("hmFrom");
  const hmTo = document.getElementById("hmTo");
  const hmRender = document.getElementById("hmRender");

  const stuHeatmapWrap = document.getElementById("stuHeatmapWrap");
  const stuModSummaryWrap = document.getElementById("stuModSummaryWrap");

  // top list filters (kept)
  const topModuleSelect = document.getElementById("topModuleSelect");
  const topQualSelect = document.getElementById("topQualSelect");
  const topNStudent = document.getElementById("topNStudent");
  const topBasis = document.getElementById("topBasis");
  const rateBand = document.getElementById("rateBand");
  const renderTopListBtn = document.getElementById("renderTopList");
  const topStudentList = document.getElementById("topStudentList");

  // ------- helpers -------
  const ALL_WEEKS = sortedWeeks(report.weeks || []);

  function normalizeId(input) {
    if (!input) return "";
    const s = String(input).trim();
    const m = s.match(/^\s*(\d{5,})\b/);
    return m ? m[1] : s;
  }
  function sortedWeeks(weeks) {
    const ws = (weeks || []).map(String);
    const items = ws.map(w => {
      const n = (w.match(/\d+/) || ["0"])[0];
      return { n: parseInt(n, 10), w };
    });
    items.sort((a, b) => a.n - b.n || a.w.localeCompare(b.w));
    return items.map(x => x.w);
  }
  const labelToId = {};
  (report.student_lookup || []).forEach(s => {
    if (s && s.label) labelToId[s.label] = s.id || normalizeId(s.label);
  });
  function sidFromInput() {
    const typed = studentSearch?.value || "";
    return labelToId[typed] || normalizeId(typed);
  }

  // ---- options fill ----
  function fillModuleSelectForStudent(selectEl, sid, multi = false) {
    const modMap = (report.ps_week_module_att && report.ps_week_module_att[sid]) || {};
    const mods = Object.keys(modMap).sort((a, b) => a.localeCompare(b));
    if (!mods.length) {
      selectEl.innerHTML = `<option value="">No module data for this student</option>`;
      return null;
    }
    if (multi) {
      selectEl.innerHTML =
        `<option value="__ALL__">(All modules)</option>` +
        mods.map(m => `<option value="${m}">${m}</option>`).join("");
    } else {
      selectEl.innerHTML =
        `<option value="">Select a module…</option>` +
        mods.map(m => `<option value="${m}">${m}</option>`).join("");
    }
    return mods[0];
  }

  function fillWeeks(selectEl) {
    selectEl.innerHTML = `<option value="">Auto</option>` +
      ALL_WEEKS.map(w => `<option value="${w}">${w}</option>`).join("");
  }

  // ---- heatmap render (multi-row) ----
  function renderStudentHeatmapRows(sid, modules, wStart, wEnd) {
    if (!stuHeatmapWrap) return;
    const modMapAll = (report.ps_week_module_att && report.ps_week_module_att[sid]) || {};

    if (!modules || !modules.length) {
      stuHeatmapWrap.innerHTML = `<p class="muted tiny">Pick at least one module.</p>`;
      return;
    }

    // build columns from overall weeks (to align rows), then apply range
    let weeks = ALL_WEEKS.slice();
    if (wStart || wEnd) {
      const startN = wStart ? parseInt((String(wStart).match(/\d+/) || ["0"])[0], 10) : -Infinity;
      const endN   = wEnd   ? parseInt((String(wEnd).match(/\d+/) || ["0"])[0], 10) : Infinity;
      weeks = weeks.filter(w => {
        const n = parseInt((w.match(/\d+/) || ["0"])[0], 10);
        return n >= startN && n <= endN;
      });
    }
    if (!weeks.length) {
      stuHeatmapWrap.innerHTML = `<p class="muted tiny">No weeks in the selected range.</p>`;
      return;
    }

    const head = weeks.map(w => {
      const shortW = (w.match(/\d+/) || [""])[0] || w;
      return `<th>W${shortW}</th>`;
    }).join("");

    const bodyRows = modules.map(mod => {
      const wkMap = modMapAll[mod] || {};
      const tds = weeks.map(w => {
        const v = Number(wkMap[w] || 0);
        let bucket = 0;
        if (v >= 3) bucket = 4; else if (v === 2) bucket = 2; else if (v === 1) bucket = 1;
        return `<td class="hm-cell hm-${bucket}" title="${mod} — ${w}: ${v}">${v}</td>`;
      }).join("");
      return `<tr><td><strong>${mod}</strong></td>${tds}</tr>`;
    }).join("");

    stuHeatmapWrap.innerHTML = `
      <table>
        <thead><tr><th>Module</th>${head}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    `;
  }

  // ---- student module summary ----
  function computeSummaryLocally(sid) {
    const rows = [];
    const modMap = (report.ps_week_module_att && report.ps_week_module_att[sid]) || {};
    const capacity = report.module_week_capacity || {};
    (Object.keys(modMap)).forEach(mod => {
      const wkMap = modMap[mod] || {};
      const total = Object.values(wkMap).reduce((a, b) => a + Number(b || 0), 0);
      const caps = capacity[mod] || {};
      const denom = (report.weeks || []).reduce((s, w) => s + Number(caps[String(w)] || 0), 0);
      const rate = denom ? Math.round((total / denom) * 1000) / 10 : 0;
      rows.push({ module: mod, total_absences: total, rate });
    });
    return rows;
  }
  function renderStudentModuleSummary(sid) {
    if (!stuModSummaryWrap) return;
    let rows = (report.student_module_summary && report.student_module_summary[sid]) || [];
    if (!rows || !rows.length) rows = computeSummaryLocally(sid);
    if (!rows.length) {
      stuModSummaryWrap.innerHTML = `<p class="muted tiny">No module summary available for this student.</p>`;
      return;
    }
    const html = `
      <table>
        <thead>
          <tr><th>Module</th><th>Total Absences</th><th>Absence Rate (%)</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => `<tr><td>${r.module}</td><td>${r.total_absences}</td><td>${r.rate}</td></tr>`).join("")}
        </tbody>
      </table>
    `;
    stuModSummaryWrap.innerHTML = html;
  }

  // ---- top-list rendering (unchanged logic, shows Absences only on the chip) ----
  function inBand(rate, band) {
    if (!band) return true;
    const r = Number(rate || 0);
    if (band === "low") return r <= 39;
    if (band === "moderate") return r >= 40 && r <= 69;
    if (band === "high") return r >= 70;
    return true;
  }
  function topStudentsData() {
    const base = (report.global_top_students_att || []).slice();
    const mod = topModuleSelect?.value || "";
    if (mod) {
      const arr = ((report.module_top_students_att || {})[mod] || []).map(x => ({
        id: x.id, label: x.label, count: x.count, rate: x.rate, qual: x.qual
      }));
      return arr;
    }
    return base;
  }
  function renderTopList() {
    if (!topStudentList) return;
    const n = parseInt(topNStudent?.value || "10", 10);
    const basis = topBasis?.value || "count";
    const band = rateBand?.value || "";
    const qual = (topQualSelect?.value || "").trim();

    let arr = topStudentsData();
    if (qual) {
      const rx = new RegExp(`\\[${qual.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\]`);
      arr = arr.filter(x => (x.qual && x.qual === qual) || rx.test(x.label || ""));
    }
    arr = arr.filter(x => inBand(x.rate, band));
    arr.sort((a, b) => {
      const av = basis === "rate" ? Number(a.rate) : Number(a.count);
      const bv = basis === "rate" ? Number(b.rate) : Number(b.count);
      return bv - av;
    });
    arr = arr.slice(0, n);

    if (!arr.length) {
      topStudentList.innerHTML = "<em>No data for the selection.</em>";
      return;
    }

    topStudentList.innerHTML = arr.map(x => {
      const count = Number(x.count ?? 0);
      return `
        <button class="btn btn-outline" data-sid="${x.id}" data-label="${x.label}" style="margin:4px 6px 0 0;">
          ${x.label}
          <span class="pill" style="margin-left:6px;">Absences: ${count}</span>
        </button>`;
    }).join("");

    topStudentList.querySelectorAll("button[data-sid]").forEach(b => {
      b.addEventListener("click", () => {
        if (studentSearch) studentSearch.value = b.dataset.label;
        analyzeStudent(b.dataset.sid, true);
      });
    });
  }

  // ---- analyze student ----
  function analyzeStudent(sid, autoRender = true) {
    if (!sid) sid = sidFromInput();
    if (!sid) {
      studentSelectedNote.textContent = "Pick a student.";
      return;
    }
    const picked = (report.student_lookup || []).find(x => x.id === sid);
    studentSelectedNote.textContent = picked ? `Selected: ${picked.label}` : `Selected: ${sid}`;

    renderStudentModuleSummary(sid);

    const firstModTop = fillModuleSelectForStudent(stuModuleForHeatmap, sid, false);
    fillModuleSelectForStudent(hmModule, sid, true);
    fillWeeks(hmFrom);
    fillWeeks(hmTo);

    if (autoRender) {
      // default: if user hasn’t chosen, render first module only
      if (firstModTop) {
        renderStudentHeatmapRows(sid, [firstModTop]);
      }
    }
  }

  // ------- events -------
  renderTopList();
  renderTopListBtn?.addEventListener("click", (e) => { e.preventDefault(); renderTopList(); });
  [topModuleSelect, topQualSelect, topNStudent, topBasis, rateBand].forEach(el => el?.addEventListener("change", renderTopList));

  analyzeStudentBtn?.addEventListener("click", (e) => { e.preventDefault(); analyzeStudent(); });

  // legacy single render
  renderStudentHeatmapBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    const sid = sidFromInput();
    if (!sid) { studentSelectedNote.textContent = "Pick a student first."; return; }
    const mod = stuModuleForHeatmap.value || "";
    if (!mod) { stuHeatmapWrap.innerHTML = `<p class="muted tiny">Pick a module.</p>`; return; }
    renderStudentHeatmapRows(sid, [mod]);
  });

  // inline multi render
  hmRender?.addEventListener("click", (e) => {
    e.preventDefault();
    const sid = sidFromInput();
    if (!sid) { studentSelectedNote.textContent = "Pick a student first."; return; }

    const sel = Array.from(hmModule?.selectedOptions || []).map(o => o.value);
    let modules = sel;

    // "(All modules)"
    if (modules.includes("__ALL__")) {
      const modMap = (report.ps_week_module_att && report.ps_week_module_att[sid]) || {};
      modules = Object.keys(modMap).sort((a,b)=>a.localeCompare(b));
    }

    if (!modules.length) {
      stuHeatmapWrap.innerHTML = `<p class="muted tiny">Pick at least one module.</p>`;
      return;
    }
    if (modules.length > 3) {
      modules = modules.slice(0, 3); // cap to 3 for readability
    }

    const from = hmFrom.value || "";
    const to = hmTo.value || "";
    renderStudentHeatmapRows(sid, modules, from, to);
  });
})();
