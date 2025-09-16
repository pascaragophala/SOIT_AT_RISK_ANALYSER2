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

  // Guard for pages without these elements
  if (!studentSearch || !analyzeStudentBtn || !stuModuleForHeatmap || !renderStudentHeatmapBtn || !stuHeatmapWrap) return;

  // ------- helpers -------
  function normalizeId(input) {
    if (!input) return "";
    const s = String(input).trim();
    // Accept either plain ID or "ID — Name …" style labels from your datalist
    const m = s.match(/^\s*(\d{5,})\b/); // your IDs look numeric (e.g., 25302238)
    return m ? m[1] : s;
  }

  // Weeks sort like W1, W2, … W12
  function sortedWeeks(weeks) {
    const ws = (weeks || []).map(String);
    const items = ws.map(w => {
      const n = (w.match(/\d+/) || ["0"])[0];
      return { n: parseInt(n, 10), w };
    });
    items.sort((a, b) => a.n - b.n || a.w.localeCompare(b.w));
    return items.map(x => x.w);
  }

  // label -> id map (as sent by backend)
  const labelToId = {};
  (report.student_lookup || []).forEach(s => {
    if (s && s.label) labelToId[s.label] = s.id || normalizeId(s.label);
  });

  function sidFromInput() {
    const typed = studentSearch.value || "";
    // Try exact label first, then fall back to parsing the leading digits
    return labelToId[typed] || normalizeId(typed);
  }

  function fillHeatmapModuleOptions(sid) {
    const modMap = (report.ps_week_module_att && report.ps_week_module_att[sid]) || {};
    const mods = Object.keys(modMap).sort((a, b) => a.localeCompare(b));
    if (!mods.length) {
      stuModuleForHeatmap.innerHTML = `<option value="">No module data for this student</option>`;
      return null;
    }
    stuModuleForHeatmap.innerHTML =
      `<option value="">Select a module…</option>` +
      mods.map(m => `<option value="${m}">${m}</option>`).join("");
    return mods[0]; // first module for auto-select
  }

  function renderStudentHeatmap(sid, moduleName) {
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
      // clamp to 0..9 scale for the background class
      const cls = `hm-cell hm-${Math.max(0, Math.min(9, v))}`;
      const shortW = (w.match(/\d+/) || [""])[0] || w;
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

  // ------- behaviors -------
  analyzeStudentBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const sid = sidFromInput();
    if (!sid) {
      studentSelectedNote.textContent = "Pick a student first.";
      stuModuleForHeatmap.innerHTML = `<option value="">Pick after selecting a student…</option>`;
      stuHeatmapWrap.innerHTML = "";
      return;
    }

    // Fill module options for this student
    const firstMod = fillHeatmapModuleOptions(sid);

    // Set note for clarity (and show qual if available)
    const picked = (report.student_lookup || []).find(x => x.id === sid);
    if (picked) {
      const n = picked.name ? ` — ${picked.name}` : "";
      const q = picked.qual ? ` • Qualification: ${picked.qual}` : "";
      studentSelectedNote.textContent = `Selected: ${sid}${n}${q}`;
    } else {
      studentSelectedNote.textContent = `Selected: ${sid}`;
    }

    // Auto-select the first module and auto-render
    if (firstMod) {
      stuModuleForHeatmap.value = firstMod;
      renderStudentHeatmap(sid, firstMod);
    } else {
      // no modules for this student
      stuHeatmapWrap.innerHTML = `<p class="muted tiny">No non-attendance modules found for this student.</p>`;
    }
  });

  renderStudentHeatmapBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const sid = sidFromInput();
    if (!sid) {
      studentSelectedNote.textContent = "Pick a student first.";
      return;
    }
    let mod = stuModuleForHeatmap.value || "";
    if (!mod) {
      // If user didn’t pick a module, try to pick the first available one
      mod = fillHeatmapModuleOptions(sid);
      if (mod) stuModuleForHeatmap.value = mod;
    }
    renderStudentHeatmap(sid, mod);
  });
})();
