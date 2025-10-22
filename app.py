import os
import re
from io import BytesIO
from flask import Flask, render_template, request
import pandas as pd
from werkzeug.utils import secure_filename

# ---------------- basic config ----------------
ALLOWED_EXTENSIONS = {"xlsx", "xls"}

def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


# ---------------- helpers ----------------
def _sid(x) -> str:
    """Normalize student id (strip .0 etc)."""
    if pd.isna(x):
        return ""
    if isinstance(x, int):
        return str(x)
    if isinstance(x, float):
        return str(int(x)) if x.is_integer() else str(x)
    s = str(x).strip()
    return re.sub(r"\.0+$", "", s)

def _canon_qual(x: str) -> str:
    """Unify qualification names."""
    if x is None or (isinstance(x, float) and pd.isna(x)):
        return "Unknown"
    s = str(x).strip().upper()
    if s in {"BBIS", "BBIS-B"}:
        return "BBIS"
    if s in {"BITW", "BITW-B"}:
        return "BITW"
    if s in {"HCS", "HCS-B"}:
        return "HCS"
    return s if s else "Unknown"

def _counts(series: pd.Series) -> dict:
    out = {}
    for k, v in series.items():
        key = "Unknown" if (pd.isna(k) or k is None) else str(k)
        out[key] = int(v)
    return out

def _sort_weeks_like(weeks) -> list:
    s = pd.Series(list(map(str, weeks)))
    nums = s.str.extract(r"(\d+)", expand=False).fillna("0").astype(int)
    return [w for _, w in sorted(zip(nums, s))]



# ---------------- cleaning ----------------
def _strip_obj_cols(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for c in df.columns:
        if pd.api.types.is_object_dtype(df[c]):
            df[c] = df[c].astype(str).str.strip()
            df[c].replace({"": pd.NA}, inplace=True)
    return df


def clean_dataframe(df: pd.DataFrame):
    # Clean raw Excel into valid records:
    # - Trim column names and string cells
    # - Drop fully-empty rows
    # - Keep rows even if Student Number is missing (for catalogue parity)
    # - No deduplication
    stats = {}
    df0 = df.copy()
    df0.columns = [str(c).strip() for c in df0.columns]
    stats["rows_raw"] = int(len(df0))

    # Strip whitespace in object columns and normalize blanks to NA
    def _strip_obj_cols(df_in: pd.DataFrame) -> pd.DataFrame:
        df_in = df_in.copy()
        for c in df_in.columns:
            if pd.api.types.is_object_dtype(df_in[c]):
                df_in[c] = df_in[c].astype(str).str.strip()
                df_in[c].replace({"": pd.NA}, inplace=True)
        return df_in

    df1 = _strip_obj_cols(df0)
    df1 = df1.dropna(how="all")
    stats["rows_after_drop_all_empty"] = int(len(df1))

    # No dropping based on Student Number
    stats["dropped_missing_student_number"] = 0

    # No deduplication to preserve raw record counts
    stats["dropped_duplicates_full_row"] = 0

    stats["rows_final"] = int(len(df1))
    return df1, stats

# ---------------- core report builder ----------------
def build_report(df: pd.DataFrame) -> dict:
    # Clean first
    df, cleaning_stats = clean_dataframe(df)
    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]

    # likely column names
    col_student = next((c for c in df.columns if c.lower().startswith("student number")), None)
    col_name    = next((c for c in df.columns if c.lower().startswith("student name")), None)
    col_module  = next((c for c in df.columns if c.lower().startswith("module")), None)
    col_week    = next((c for c in df.columns if c.lower() == "week"), None)
    col_reason  = next((c for c in df.columns if "reason" in c.lower()), None)
    col_risk    = next((c for c in df.columns if "risk" in c.lower()), None)
    col_resolved= next((c for c in df.columns if "resolved" in c.lower()), None)
    col_interv = next((c for c in df.columns if "intervention" in c.lower()), None)
    col_qual    = next((c for c in df.columns if ("qual" in c.lower()
                                                  or "program" in c.lower()
                                                  or "programme" in c.lower()
                                                  or "course" in c.lower())), None)

    if col_week:
        df[col_week] = df[col_week].astype(str)
    if col_qual:
        df["_qual"] = df[col_qual].map(_canon_qual)
    else:
        df["_qual"] = "Unknown"

        # Total records: Student Number present OR (Student Name & Module(s) & Week present)
    col_student = next((c for c in df.columns if c.lower().startswith("student number")), None)
    col_name    = next((c for c in df.columns if c.lower().startswith("student name")), None)
    col_module  = next((c for c in df.columns if c.lower().startswith("module")), None)
    col_week    = next((c for c in df.columns if c.lower() == "week"), None)
    def _nonempty(s):
        return s.astype(str).str.strip().replace({"": pd.NA, "nan": pd.NA}).notna()
    has_sn = _nonempty(df[col_student]) if col_student else pd.Series([False]*len(df))
    has_triplet = (
        (_nonempty(df[col_name]) if col_name else False) &
        (_nonempty(df[col_module]) if col_module else False) &
        (_nonempty(df[col_week]) if col_week else False)
    )
        # Total records: SN present OR (Name & Module & Week present)
    col_student = next((c for c in df.columns if c.lower().startswith("student number")), None)
    col_name    = next((c for c in df.columns if c.lower().startswith("student name")), None)
    col_module  = next((c for c in df.columns if c.lower().startswith("module")), None)
    col_week    = next((c for c in df.columns if c.lower() == "week"), None)
    def _nonempty(s):
        return s.astype(str).str.strip().replace({"": pd.NA, "nan": pd.NA}).notna()
    has_sn = _nonempty(df[col_student]) if col_student else pd.Series([False]*len(df))
    has_triplet = (
        (_nonempty(df[col_name]) if col_name else False) &
        (_nonempty(df[col_module]) if col_module else False) &
        (_nonempty(df[col_week]) if col_week else False)
    )
    total_records = int((has_sn | has_triplet).sum())
    unique_students = int(df[col_student].dropna().astype(str).nunique()) if col_student else 0


    unique_students = int(df[col_student].nunique()) if col_student else None

    # non-attendance mask (tolerant)
    att_mask = None
    if col_reason:
        rx = r"(absent|no\s*show|did\s*not\s*attend|not\s*attend|missed\s*class|attendance)"
        att_mask = df[col_reason].astype(str).str.contains(rx, flags=re.I, regex=True, na=False)

    # globals
    risk_counts     = _counts(df[col_risk].value_counts(dropna=False)) if col_risk else {}
    # Resolved status via Intervention non-empty
    if "col_interv" in locals() and col_interv:
        vals = df[col_interv].astype(str).str.strip()
        yes = int(vals.replace({"": pd.NA, "nan": pd.NA}).notna().sum())
        no = int(len(vals) - yes)
        resolved = {"Yes": yes, "No": no}
        resolved_counts = resolved
    else:
        resolved_counts = _counts(df[col_resolved].value_counts(dropna=False)) if col_resolved else {}
    by_reason       = _counts(df[col_reason].value_counts().head(15)) if col_reason else {}

    weeks   = _sort_weeks_like(df[col_week].dropna().unique()) if col_week else []
    modules = sorted(df[col_module].dropna().astype(str).unique()) if col_module else []
    quals   = sorted(pd.unique(df["_qual"]).tolist())

    # module unique students (overall)
    by_module = {}
    if col_module and col_student:
        tmp = df.groupby(col_module)[col_student].nunique().sort_values(ascending=False)
        by_module = {str(k): int(v) for k, v in tmp.items()}

    # non-attendance per module (unique students)
    by_module_att = {}
    if col_module and col_student and att_mask is not None:
        tmp = df[att_mask].groupby(col_module)[col_student].nunique().sort_values(ascending=False)
        by_module_att = {str(k): int(v) for k, v in tmp.items()}

    # non-attendance per week (unique students)
    by_week_att = {}
    if col_week and col_student and att_mask is not None:
        tmp = df[att_mask].groupby(col_week)[col_student].nunique()
        by_week_att = {str(k): int(v) for k, v in tmp.items()}

    # per (week, module) unique students — all and non-attendance
    by_week_module_all = {}
    by_week_module_att = {}
    if col_week and col_module:
        all_g = df.groupby([col_week, col_module])[col_student].nunique()
        for (w, m), v in all_g.items():
            by_week_module_all.setdefault(str(w), {})[str(m)] = int(v)

        if att_mask is not None:
            att_g = df[att_mask].groupby([col_week, col_module])[col_student].nunique()
            for (w, m), v in att_g.items():
                by_week_module_att.setdefault(str(w), {})[str(m)] = int(v)

    # week x risk (for chart)
    week_risk = {}
    if col_week and col_risk:
        pivot = df.pivot_table(index=col_week, columns=col_risk, values=col_student, aggfunc="count", fill_value=0)
        pivot = pivot.reindex(_sort_weeks_like(pivot.index.to_series()))
        week_risk = {
            "weeks": [str(x) for x in list(pivot.index)],
            "series": [{"name": str(c), "data": [int(v) for v in pivot[c].tolist()]} for c in pivot.columns],
        }

    # resolved rate by week (%)
    resolved_rate = {}
    if col_week and (("col_interv" in locals() and col_interv) or col_resolved):
        if ("col_interv" in locals() and col_interv):
            vals = df[col_interv].astype(str).str.strip()
            truthy = vals.replace({"": pd.NA, "nan": pd.NA}).notna()
        else:
            vals = df[col_resolved].astype(str).str.strip().str.lower()
            truthy = vals.isin({"yes", "y", "true", "1", "resolved"})
        grp = df.groupby(col_week)
        totals = grp.size()
        trues = grp.apply(lambda g: int(truthy.loc[g.index].sum()))
        for w in totals.index:
            resolved_rate[str(w)] = round((int(trues.loc[w]) / int(totals.loc[w])) * 100, 1) if int(totals.loc[w]) else 0.0

    # ----- student analytics -----
    student_enabled = bool(col_student)
    student_lookup = []
    ps_modules_att = {}
    ps_weeks_att = {}
    ps_risk_module_max = {}
    ps_week_risk_counts = {}

    # NEW: for heatmap + per-module % (capacity-based)
    ps_week_module_att = {}          # sid -> module -> week -> absence count
    student_module_summary = {}      # sid -> list of {module, total_absences, rate}
    module_week_capacity = {}        # module -> week -> max sessions (derived)

    # build name + qualification maps
    if student_enabled:
        tmp = df[[col_student, col_name, "_qual"]].dropna(subset=[col_student]).copy()
        tmp["_sid"] = tmp[col_student].apply(_sid)

        # names
        if col_name:
            nm = tmp.groupby("_sid")[col_name].agg(
                lambda s: s.dropna().astype(str).mode().iat[0] if not s.dropna().empty else ""
            )
            name_map = nm.to_dict()
        else:
            name_map = {}

        # quals
        ql = tmp.groupby("_sid")["_qual"].agg(
            lambda s: s.dropna().astype(str).mode().iat[0] if not s.dropna().empty else "Unknown"
        )
        qual_map = ql.to_dict()

        # student lookup
        order = pd.unique(df[col_student].dropna().apply(_sid)).tolist()
        for sid in order:
            nm = (name_map.get(sid, "") or "").strip()
            ql = (qual_map.get(sid, "") or "").strip()
            label = f"{sid} — {nm}" if nm else sid
            display = f"{label} — [{ql}]" if ql else label
            student_lookup.append({"id": sid, "label": display, "name": nm, "qual": ql})

        # student non-attendance by module
        if att_mask is not None and col_module:
            g = df[att_mask].groupby([col_student, col_module]).size()
            for (sid_raw, mod), v in g.items():
                sid = _sid(sid_raw)
                ps_modules_att.setdefault(sid, {})[str(mod)] = int(v)

        # student non-attendance by week
        if att_mask is not None and col_week:
            g = df[att_mask].groupby([col_student, col_week]).size()
            for (sid_raw, w), v in g.items():
                sid = _sid(sid_raw)
                ps_weeks_att.setdefault(sid, {})[str(w)] = int(v)

        # risk by module (max)
        if col_risk and col_module:
            # rank risks
            def _rank(s):
                s = str(s).lower()
                if "high" in s or "red" in s: return 3
                if "med" in s or "amber" in s or "yellow" in s: return 2
                if "low" in s or "green" in s: return 1
                return 0
            df["_risk_rank"] = df[col_risk].map(_rank)
            g = df.groupby([col_student, col_module])["_risk_rank"].max()
            for (sid_raw, mod), r in g.items():
                sid = _sid(sid_raw)
                lab = {3:"High",2:"Moderate",1:"Low",0:"Unknown"}[int(r)]
                ps_risk_module_max.setdefault(sid, {})[str(mod)] = lab

        # week x risk per student (counts)
        if col_week and col_risk:
            g = df.groupby([col_student, col_week, col_risk]).size()
            for (sid_raw, w, rk), v in g.items():
                sid = _sid(sid_raw)
                ps_week_risk_counts.setdefault(sid, {}).setdefault(str(w), {})[str(rk)] = int(v)

        # ---------- NEW: capacity + per-student per-module rates ----------
        if att_mask is not None and col_module and col_week and col_student:
            # absences per student per (module, week)
            by_smw = df[att_mask].groupby([col_student, col_module, col_week]).size()

            # module-week capacity = max absences any student recorded in that (module, week)
            max_per_mw = by_smw.groupby([col_module, col_week]).max()
            for (mod, w), v in max_per_mw.items():
                module_week_capacity.setdefault(str(mod), {})[str(w)] = int(v)

            # store per-student week detail (for heatmap)
            for (sid_raw, mod, w), v in by_smw.items():
                sid = _sid(sid_raw)
                ps_week_module_att.setdefault(sid, {}).setdefault(str(mod), {})[str(w)] = int(v)

            # per-student module totals + % using capacity
            for sid in pd.unique(df[col_student].dropna().apply(_sid)):
                rows = []
                # all modules this student has non-attendance in
                mods_for_sid = sorted(ps_week_module_att.get(sid, {}).keys())
                for mod in mods_for_sid:
                    wk_map = ps_week_module_att[sid][mod]     # week -> absent count
                    total_abs = int(sum(wk_map.values()))
                    # denominator: sum of capacity for this module over all known weeks
                    caps = module_week_capacity.get(mod, {})
                    denom = sum(int(caps.get(w, 0)) for w in weeks)  # keep week order consistent
                    rate = round((total_abs / denom) * 100, 1) if denom else 0.0
                    rows.append({"module": mod, "total_absences": total_abs, "rate": rate})
                student_module_summary[sid] = rows

    # ---- build “top students” (absences + per-module rate best) ----
    # For the global list we aggregate absences across all modules and compute
    # a rate weighted by the module capacities.
    global_top_students_att = []
    module_top_students_att = {}  # mod -> [{id,label,count,rate,qual}]
    if student_enabled:
        # convenient maps
        sid_to_label = {s["id"]: s["label"] for s in student_lookup}
        sid_to_qual  = {s["id"]: s["qual"]  for s in student_lookup}

        # global totals
        for sid, mcounts in ps_modules_att.items():
            count = int(sum(mcounts.values()))
            # rate denominator: sum of capacities of all modules this student has records for
            denom = 0
            for mod in mcounts.keys():
                denom += sum(module_week_capacity.get(mod, {}).get(w, 0) for w in weeks)
            rate = round((count / denom) * 100, 1) if denom else 0.0
            global_top_students_att.append({
                "id": sid, "label": sid_to_label.get(sid, sid),
                "count": count, "rate": rate, "qual": sid_to_qual.get(sid, "")
            })
        # sort by absences desc
        global_top_students_att.sort(key=lambda x: (-x["count"], -x["rate"]))

        # per-module lists
        if att_mask is not None and col_module:
            g = df[att_mask].groupby([col_student, col_module]).size()
            # build helper for per-student per-module rate
            for mod in modules:
                rows = []
                caps = module_week_capacity.get(str(mod), {})
                denom_mod = sum(caps.get(w, 0) for w in weeks)
                # students with absences in this module
                sub = g[g.index.get_level_values(1) == mod]
                for (sid_raw, _), cnt in sub.items():
                    sid = _sid(sid_raw)
                    rate = round((int(cnt) / denom_mod) * 100, 1) if denom_mod else 0.0
                    rows.append({
                        "id": sid, "label": sid_to_label.get(sid, sid),
                        "count": int(cnt), "rate": rate, "qual": sid_to_qual.get(sid, "")
                    })
                rows.sort(key=lambda x: (-x["count"], -x["rate"]))
                if rows:
                    module_top_students_att[str(mod)] = rows

    # sample rows
    sample_rows = df.head(50).fillna("").to_dict(orient="records")

    return {
        "cleaning_stats": cleaning_stats,
        "total_records": total_records,
        "unique_students": unique_students,
        "risk_counts": risk_counts,
        "resolved_counts": resolved_counts,
        "by_reason": by_reason,
        "weeks": weeks,
        "modules": modules,
        "qualifications": quals,
        "by_module": by_module,
        "by_module_attendance": by_module_att,
        "by_week_attendance": by_week_att,
        "by_week_module_all": by_week_module_all,
        "by_week_module_attendance": by_week_module_att,
        "week_risk": week_risk,
        "resolved_rate": resolved_rate,

        # student analytics
        "student_enabled": student_enabled,
        "student_lookup": student_lookup,
        "ps_modules_att": ps_modules_att,
        "ps_weeks_att": ps_weeks_att,
        "ps_risk_module_max": ps_risk_module_max,
        "ps_week_risk_counts": ps_week_risk_counts,
        "ps_week_module_att": ps_week_module_att,           # for heatmap
        "student_module_summary": student_module_summary,   # totals + per-module %
        "module_week_capacity": module_week_capacity,       # debugging / future use

        # top lists
        "global_top_students_att": global_top_students_att,
        "module_top_students_att": module_top_students_att,

        "sample_rows": sample_rows,
    }


# ---------------- flask app ----------------
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024  # 64MB

@app.route("/", methods=["GET"])
def index():
    return render_template("index.html", report=None, filename=None, error=None)

@app.route("/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return render_template("index.html", report=None, filename=None, error="No file part")

    f = request.files["file"]
    if f.filename == "":
        return render_template("index.html", report=None, filename=None, error="No selected file")

    if not allowed_file(f.filename):
        return render_template("index.html", report=None, filename=None, error="Please upload an Excel file (.xlsx/.xls).")

    try:
        content = f.read()
        df = pd.read_excel(BytesIO(content))
        report = build_report(df)
        return render_template("index.html", report=report, filename=secure_filename(f.filename), error=None)
    except Exception as e:
        return render_template("index.html", report=None, filename=None, error=f"Failed to read Excel: {e}")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
