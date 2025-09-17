// static/heatmap-addon.js
(function () {
  const report = window.__REPORT__ || {};
  if (!report || !report.student_enabled) return;

  // ------- DOM -------
  const studentSearch = document.getElementById("studentSearch");
  const analyzeStudentBtn = document.getElementById("analyzeStudentBtn");
  const studentSelectedNote = document.getElementById("studentSelectedNote");
  const stuModuleForHeatmap = document.getElementById("stuModuleForHeatmap");
  const renderStudentHeatmapBtn = document.getElementById("renderStudentHeatmap");
  const stuHeatmapWrap = document.getElementById("stuHeatmapWrap");
  const stuModSummaryWrap = document.getElementById("stuModSummaryWrap");

  const topModuleSelect = document.getElementById("topModuleSelect");
  const topQualSelect = document.getElementById("topQualSelect");
  const topNStudent = document.getElementById("topNStudent");
  const topBasis = document.getElementById("topBasis");
  const rateBand = document.getElementById("rateBand");
  const renderTopListBtn = document.getElementById("renderTopList");
  const topStudentList = document.getElementById("topStudentList");

  // ------- helpers -------
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

  // ---- heatmap + module options ----
  function fillHeatmapModuleOptions(sid) {
    const modMap = (report.ps_week_module_att && report.ps_week_module_att[sid]) || {};
    const mods = Object.keys(modMap).sort((a, b) => a.localeCompare(b));
    if (!mods.length) {
      if (stuModuleForHeatmap) {
        stuModuleForHeatmap.innerHTML = `<option value="">No module data for this student</option>`;
      }
      return null;
    }
    if (stuModuleForHeatmap) {
      stuModuleForHeatmap.innerHTML =
        `<option value="">Select a module…</option>` +
        mods.map(m => `<option value="${m}">${m}</option>`).join("");
    }
    return mods[0];
  }

  function renderStudentHeatmap(sid, moduleName) {
    if (!stuHeatmapWrap) return;
    const modMap = (report.ps_week_module_att && report.ps_week_module_att[sid]) || {};
    const wkMap = modMap[moduleName] || {};
    const weeks = sortedWeeks(Object.keys(wkMap || {}));

    if (!moduleName) {
      stuHeatmapWrap.innerHTML = `<p class="muted tiny">Pick a module to render the heatmap.</p>`;
      return;
    }
    if (!Object.keys(wkMap).length) {
      stuHeatmapWrap.innerHTML = `<p class="muted tiny">No non-attendance recorded for <strong>${moduleName}</strong> for this student.</p>`;
      return;
    }
    const cells = weeks.map(w => {
      const v = Number(wkMap[w] || 0);
      const cls = `hm-cell hm-${Math.max(0, Math.min(9, v))}`;
      return `<td class="${cls}" title="Week ${w}: ${v}">${v}</td>`;
    }).join("");

    const head = weeks.map(w => {
      const shortW = (w.match(/\d+/) || [""])[0] || w;
      return `<th>W${shortW}</th>`;
    }).join("");

    stuHeatmapWrap.innerHTML = `
      <table>
        <thead><tr><th>Module</th>${head}</tr></thead>
        <tbody><tr><td><strong>${moduleName}</strong></td>${cells}</tr></tbody>
      </table>
    `;
  }

  // ---- student module summary table ----
  function renderStudentModuleSummary(sid) {
    if (!stuModSummaryWrap) return;
    const rows = (report.student_module_summary && report.student_module_summary[sid]) || [];
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

  // ---- top list rendering with qualification / basis / band ----
  function inBand(rate, band) {
    if (!band) return true;
    const r = Number(rate || 0);
    if (band === "low") return r <= 39;
    if (band === "moderate") return r >= 40 && r <= 69;
    if (band === "high") return r >= 70;
    return true;
  }

  function topStudentsData() {
    // Prefer global_top_students_att (already includes count, rate, qual)
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

    // Filter by qualification if chosen (use explicit field or bracket suffix)
    if (qual) {
      const rx = new RegExp(`\\[${qual.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\]`);
      arr = arr.filter(x => (x.qual && x.qual === qual) || rx.test(x.label || ""));
    }

    // Filter by rate band if set
    arr = arr.filter(x => inBand(x.rate, band));

    // Sort by basis
    arr.sort((a, b) => {
      const av = basis === "rate" ? Number(a.rate) : Number(a.count);
      const bv = basis === "rate" ? Number(b.rate) : Number(b.count);
      return bv - av;
    });

    // Top N
    arr = arr.slice(0, n);

    if (!arr.length) {
      topStudentList.innerHTML = "<em>No data for the selection.</em>";
      return;
    }

    topStudentList.innerHTML = arr.map(x => {
      const count = Number(x.count ?? 0);
      const rate = Number(x.rate ?? 0).toFixed(1);
      return `
        <button class="btn btn-outline" data-sid="${x.id}" data-label="${x.label}" style="margin:4px 6px 0 0;">
          ${x.label}
          <span class="pill" style="margin-left:6px;">Absences: ${count}</span>
          <span class="pill">Rate: ${rate}%</span>
        </button>`;
    }).join("");

    // Click handler -> analyze this student
    topStudentList.querySelectorAll("button[data-sid]").forEach(b => {
      b.addEventListener("click", () => {
        if (studentSearch) studentSearch.value = b.dataset.label;
        analyzeStudent(b.dataset.sid, /*autoRenderHeatmap=*/true);
      });
    });
  }

  // ---- analyze one student (charts + summary + heatmap options) ----
  function analyzeStudent(sid, autoRenderHeatmap = true) {
    if (!sid) sid = sidFromInput();
    if (!sid) {
      studentSelectedNote.textContent = "Pick a student.";
      return;
    }

    const picked = (report.student_lookup || []).find(x => x.id === sid);
    if (picked) {
      studentSelectedNote.textContent = `Selected: ${picked.label}`;
    } else {
      studentSelectedNote.textContent = `Selected: ${sid}`;
    }

    // Per-module summary table
    renderStudentModuleSummary(sid);

    // Heatmap module options
    const firstMod = fillHeatmapModuleOptions(sid);
    if (autoRenderHeatmap && firstMod) {
      stuModuleForHeatmap.value = firstMod;
      renderStudentHeatmap(sid, firstMod);
    }
  }

  // ------- behaviors -------
  analyzeStudentBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    analyzeStudent();
  });

  renderStudentHeatmapBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    const sid = sidFromInput();
    if (!sid) {
      studentSelectedNote.textContent = "Pick a student first.";
      return;
    }
    let mod = stuModuleForHeatmap.value || "";
    if (!mod) {
      mod = fillHeatmapModuleOptions(sid);
      if (mod) stuModuleForHeatmap.value = mod;
    }
    renderStudentHeatmap(sid, mod);
  });

  // Top list initial render + refresh on button
  renderTopList();
  renderTopListBtn?.addEventListener("click", (e) => { e.preventDefault(); renderTopList(); });

  // Also refresh automatically when selectors change (nice UX)
  [topModuleSelect, topQualSelect, topNStudent, topBasis, rateBand].forEach(el => {
    el?.addEventListener("change", renderTopList);
  });
})();
