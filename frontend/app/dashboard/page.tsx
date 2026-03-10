"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";

const API = "http://localhost:8000";

interface CaseRecord {
  case_id: string;
  admission_diagnosis: string;
  specialty: string;
  difficulty: string;
  score: number | null;
  timestamp: number;
  stages_completed: number;
  debrief?: any;
}

interface LearnerProfile {
  cases_completed: CaseRecord[];
  total_sessions: number;
}

function getProfile(): LearnerProfile {
  if (typeof window === "undefined") return { cases_completed: [], total_sessions: 0 };
  const raw = localStorage.getItem("clinical_tutor_profile");
  if (raw) {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }
  return { cases_completed: [], total_sessions: 0 };
}

// Map specialties to organ systems
const SYSTEM_MAP: Record<string, string> = {
  "Cardiology": "Cardiovascular",
  "Pulmonology": "Respiratory",
  "Gastroenterology": "GI / Hepatobiliary",
  "Infectious Disease": "Infectious Disease",
  "Endocrinology": "Endocrine / Metabolic",
  "Psychiatry": "Psychiatry / Neurology",
  "General": "General / Multi-system",
  "Nephrology": "Renal",
  "Hematology": "Hematology / Oncology",
};

function getSystem(specialty: string): string {
  return SYSTEM_MAP[specialty] || "General / Multi-system";
}

export default function DashboardPage() {
  const [profile, setProfile] = useState<LearnerProfile>({ cases_completed: [], total_sessions: 0 });
  const [recommended, setRecommended] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCase, setExpandedCase] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"history" | "mistakes" | "pearls" | "conditions" | "gaps" | "review">("history");

  useEffect(() => {
    const p = getProfile();
    setProfile(p);

    fetch(`${API}/api/cases?page=1&per_page=100`)
      .then((r) => r.json())
      .then((data) => {
        const completedIds = new Set(p.cases_completed.map((c) => c.case_id));
        const notDone = data.cases.filter((c: any) => !completedIds.has(c.case_id));
        const specScores: Record<string, number[]> = {};
        p.cases_completed.forEach((c) => {
          if (c.score !== null) {
            if (!specScores[c.specialty]) specScores[c.specialty] = [];
            specScores[c.specialty].push(c.score);
          }
        });
        const weakSpecs = Object.entries(specScores)
          .map(([spec, scores]) => ({ spec, avg: scores.reduce((a, b) => a + b, 0) / scores.length }))
          .sort((a, b) => a.avg - b.avg)
          .map((s) => s.spec);
        const diffOrder: Record<string, number> = { "Clerkship": 0, "Intern": 1, "Resident": 2, "ICU / Fellow": 3 };
        notDone.sort((a: any, b: any) => {
          const aWeak = weakSpecs.indexOf(a.specialty);
          const bWeak = weakSpecs.indexOf(b.specialty);
          if (aWeak >= 0 && bWeak < 0) return -1;
          if (bWeak >= 0 && aWeak < 0) return 1;
          return (diffOrder[a.difficulty] || 0) - (diffOrder[b.difficulty] || 0);
        });
        setRecommended(notDone.slice(0, 6));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const completed = profile.cases_completed;
  const scored = completed.filter((c) => c.score !== null);
  const avgScore = scored.length > 0 ? scored.reduce((a, c) => a + (c.score || 0), 0) / scored.length : 0;

  // --- Aggregate debrief insights ---
  const insights = useMemo(() => {
    const allRedFlags: { flag: string; case_id: string; diagnosis: string }[] = [];
    const allUnnecessary: { action: string; case_id: string; diagnosis: string }[] = [];
    const allTakeaways: { takeaway: string; case_id: string; diagnosis: string; specialty: string }[] = [];
    const allExpertPaths: { case_id: string; diagnosis: string; specialty: string; path: any }[] = [];

    completed.forEach((c) => {
      if (!c.debrief) return;
      c.debrief.missed_red_flags?.forEach((f: string) =>
        allRedFlags.push({ flag: f, case_id: c.case_id, diagnosis: c.admission_diagnosis })
      );
      c.debrief.unnecessary_actions?.forEach((a: string) =>
        allUnnecessary.push({ action: a, case_id: c.case_id, diagnosis: c.admission_diagnosis })
      );
      c.debrief.takeaways?.forEach((t: string) =>
        allTakeaways.push({ takeaway: t, case_id: c.case_id, diagnosis: c.admission_diagnosis, specialty: c.specialty })
      );
      if (c.debrief.expert_path) {
        allExpertPaths.push({ case_id: c.case_id, diagnosis: c.admission_diagnosis, specialty: c.specialty, path: c.debrief.expert_path });
      }
    });

    return { allRedFlags, allUnnecessary, allTakeaways, allExpertPaths };
  }, [completed]);

  // --- Conditions by system ---
  const conditionsBySystem = useMemo(() => {
    const map: Record<string, { case_id: string; diagnosis: string; specialty: string; score: number | null; difficulty: string }[]> = {};
    completed.forEach((c) => {
      const sys = getSystem(c.specialty);
      if (!map[sys]) map[sys] = [];
      map[sys].push({ case_id: c.case_id, diagnosis: c.admission_diagnosis, specialty: c.specialty, score: c.score, difficulty: c.difficulty });
    });
    return map;
  }, [completed]);

  // --- Knowledge gaps: aggregate red flags by theme ---
  const knowledgeGaps = useMemo(() => {
    // Group red flags by keywords to find patterns
    const gapMap: Record<string, { flags: string[]; cases: string[]; count: number }> = {};

    // Simple keyword extraction for grouping
    const extractTheme = (flag: string): string => {
      const lower = flag.toLowerCase();
      const themes = [
        { keywords: ["lab", "creatinine", "potassium", "sodium", "glucose", "lactate", "troponin", "hemoglobin", "wbc", "platelet", "abg", "ph"], theme: "Lab Interpretation" },
        { keywords: ["drug", "medication", "dose", "prescri", "polypharmacy", "interaction", "contraindic"], theme: "Pharmacology" },
        { keywords: ["airway", "respiratory", "ventilat", "intubat", "oxygen", "copd", "pneumo"], theme: "Airway / Respiratory" },
        { keywords: ["sepsis", "infection", "antibio", "fever", "culture", "resist"], theme: "Infectious Disease" },
        { keywords: ["cardiac", "heart", "ecg", "ekg", "arrhythm", "coronar", "mi", "acs", "aortic"], theme: "Cardiovascular" },
        { keywords: ["renal", "kidney", "dialysis", "gfr", "aki", "ckd", "esrd"], theme: "Renal" },
        { keywords: ["gi", "abdom", "liver", "hepat", "bleed", "gi bleed", "pancrea"], theme: "GI / Hepatobiliary" },
        { keywords: ["neuro", "mental", "conscious", "stroke", "seizure", "delirium"], theme: "Neurology" },
        { keywords: ["fluid", "electrolyte", "dehydrat", "volume"], theme: "Fluid / Electrolytes" },
        { keywords: ["timing", "delay", "urgent", "emergenc", "critical", "escalat", "acuity"], theme: "Clinical Urgency / Triage" },
      ];
      for (const t of themes) {
        if (t.keywords.some((k) => lower.includes(k))) return t.theme;
      }
      return "Clinical Reasoning";
    };

    insights.allRedFlags.forEach((rf) => {
      const theme = extractTheme(rf.flag);
      if (!gapMap[theme]) gapMap[theme] = { flags: [], cases: [], count: 0 };
      gapMap[theme].flags.push(rf.flag);
      if (!gapMap[theme].cases.includes(rf.case_id)) gapMap[theme].cases.push(rf.case_id);
      gapMap[theme].count += 1;
    });

    // Also count unnecessary actions as gaps
    insights.allUnnecessary.forEach((ua) => {
      const theme = extractTheme(ua.action);
      if (!gapMap[theme]) gapMap[theme] = { flags: [], cases: [], count: 0 };
      gapMap[theme].flags.push(`[Unnecessary] ${ua.action}`);
      if (!gapMap[theme].cases.includes(ua.case_id)) gapMap[theme].cases.push(ua.case_id);
      gapMap[theme].count += 1;
    });

    return Object.entries(gapMap)
      .map(([theme, data]) => ({ theme, ...data }))
      .sort((a, b) => b.count - a.count);
  }, [insights]);

  // All systems for coverage display
  const allSystems = ["Cardiovascular", "Respiratory", "GI / Hepatobiliary", "Infectious Disease", "Endocrine / Metabolic", "Renal", "Psychiatry / Neurology", "Hematology / Oncology", "General / Multi-system"];

  const tabs = [
    { key: "history" as const, label: "Case History", icon: "history" },
    { key: "conditions" as const, label: "Conditions", icon: "cardiology", count: completed.length },
    { key: "mistakes" as const, label: "Mistakes", icon: "error_outline", count: insights.allRedFlags.length + insights.allUnnecessary.length },
    { key: "gaps" as const, label: "Knowledge Gaps", icon: "psychology_alt", count: knowledgeGaps.length },
    { key: "pearls" as const, label: "Clinical Pearls", icon: "lightbulb", count: insights.allTakeaways.length },
    { key: "review" as const, label: "Quick Review", icon: "quiz", count: insights.allExpertPaths.length },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#f6f7f8]">
      <header className="bg-white border-b border-[#2c5281]/10 px-4 py-5 md:px-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="p-2 hover:bg-[#2c5281]/10 rounded-full transition-colors">
              <span className="material-symbols-outlined text-[#2c5281]">arrow_back</span>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-[#2c5281]">Learning Dashboard</h1>
              <p className="text-slate-500 text-sm">Your clinical reasoning notebook</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-grow px-4 py-6 md:px-8 max-w-6xl mx-auto w-full space-y-6">
        {/* Compact Summary */}
        <div className="flex items-center gap-6 bg-white rounded-xl border border-[#2c5281]/10 p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#2c5281]">school</span>
            <span className="text-sm text-slate-600"><strong className="text-slate-900">{completed.length}</strong> cases</span>
          </div>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#2c5281]">analytics</span>
            <span className="text-sm text-slate-600">Avg <strong className="text-slate-900">{avgScore > 0 ? `${avgScore.toFixed(1)}/10` : "\u2014"}</strong></span>
          </div>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-red-500">flag</span>
            <span className="text-sm text-slate-600"><strong className="text-slate-900">{insights.allRedFlags.length}</strong> red flags missed</span>
          </div>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-500">lightbulb</span>
            <span className="text-sm text-slate-600"><strong className="text-slate-900">{insights.allTakeaways.length}</strong> pearls collected</span>
          </div>
          <div className="flex-1" />
          {/* System coverage mini badges */}
          <div className="hidden md:flex items-center gap-1">
            {allSystems.slice(0, 6).map((sys) => (
              <span key={sys} className={`w-2.5 h-2.5 rounded-full ${conditionsBySystem[sys] ? "bg-emerald-500" : "bg-slate-200"}`}
                title={`${sys}${conditionsBySystem[sys] ? ` (${conditionsBySystem[sys].length})` : " (not started)"}`} />
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl border border-[#2c5281]/10 shadow-sm">
          <div className="flex border-b border-slate-200 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? "text-[#2c5281] border-[#2c5281]"
                    : "text-slate-400 border-transparent hover:text-slate-600"
                }`}
              >
                <span className="material-symbols-outlined text-sm">{tab.icon}</span>
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          <div className="p-5">
            {/* ===== TAB: Case History ===== */}
            {activeTab === "history" && (
              completed.length > 0 ? (
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {[...completed].reverse().map((c, i) => (
                    <div key={i}>
                      <div
                        onClick={() => setExpandedCase(expandedCase === c.case_id ? null : c.case_id)}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
                          expandedCase === c.case_id ? "border-violet-300 bg-violet-50" : "border-slate-100 hover:border-[#2c5281]/30"
                        }`}
                      >
                        <div className={`size-10 rounded-full flex items-center justify-center font-bold text-sm ${
                          c.score !== null
                            ? c.score >= 7 ? "bg-emerald-100 text-emerald-700" : c.score >= 4 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                            : "bg-slate-100 text-slate-500"
                        }`}>
                          {c.score !== null ? c.score : "\u2014"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{c.case_id}: {c.admission_diagnosis}</p>
                          <div className="flex gap-2 mt-0.5">
                            <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">{c.specialty}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                              c.difficulty === "ICU / Fellow" ? "bg-red-50 text-red-700"
                                : c.difficulty === "Resident" ? "bg-orange-50 text-orange-700"
                                : "bg-emerald-50 text-emerald-700"
                            }`}>{c.difficulty}</span>
                            {c.debrief && <span className="text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded">Debrief</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-slate-400">{new Date(c.timestamp).toLocaleDateString()}</span>
                          <span className="material-symbols-outlined text-slate-400 text-sm">
                            {expandedCase === c.case_id ? "expand_less" : "expand_more"}
                          </span>
                        </div>
                      </div>
                      {expandedCase === c.case_id && (
                        <div className="mt-1 border border-violet-200 rounded-xl bg-gradient-to-br from-violet-50 to-indigo-50 p-4 space-y-3">
                          {c.debrief ? (
                            <>
                              <div className="flex items-center justify-between">
                                <h4 className="text-xs font-bold text-violet-700 uppercase tracking-wider">Case Debrief</h4>
                                <div className="flex items-center gap-2">
                                  <span className="text-lg font-black text-violet-700">{c.debrief.overall_score}/10</span>
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    c.debrief.score_label === "Expert" || c.debrief.score_label === "Proficient"
                                      ? "bg-emerald-100 text-emerald-800"
                                      : c.debrief.score_label === "Competent" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"
                                  }`}>{c.debrief.score_label}</span>
                                </div>
                              </div>
                              {c.debrief.expert_path && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {[
                                    { label: "Presentation Focus", value: c.debrief.expert_path.presentation_focus, icon: "visibility" },
                                    { label: "Key Pivot Point", value: c.debrief.expert_path.key_pivot, icon: "turn_right" },
                                    { label: "Optimal Workup", value: c.debrief.expert_path.optimal_workup, icon: "biotech" },
                                    { label: "Optimal Management", value: c.debrief.expert_path.optimal_management, icon: "medication" },
                                  ].filter((item) => item.value).map((item) => (
                                    <div key={item.label} className="bg-white/70 rounded-lg p-3 border border-violet-100">
                                      <div className="flex items-center gap-1.5 mb-1">
                                        <span className="material-symbols-outlined text-violet-500 text-sm">{item.icon}</span>
                                        <span className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">{item.label}</span>
                                      </div>
                                      <p className="text-xs text-slate-700 leading-relaxed">{item.value}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {c.debrief.missed_red_flags?.length > 0 && (
                                <div>
                                  <p className="text-[10px] font-bold text-red-600 uppercase tracking-wider mb-1">Missed Red Flags</p>
                                  <ul className="space-y-1">{c.debrief.missed_red_flags.map((flag: string, fi: number) => (
                                    <li key={fi} className="flex items-start gap-1.5 text-xs text-red-700 bg-red-50 rounded p-2 border border-red-100">
                                      <span className="material-symbols-outlined text-xs mt-0.5 shrink-0">warning</span>{flag}
                                    </li>
                                  ))}</ul>
                                </div>
                              )}
                              {c.debrief.takeaways && (
                                <div>
                                  <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wider mb-1">Key Takeaways</p>
                                  <ol className="space-y-1">{c.debrief.takeaways.map((t: string, ti: number) => (
                                    <li key={ti} className="flex items-start gap-2 text-xs text-slate-700 bg-white/70 rounded p-2 border border-violet-100">
                                      <span className="size-4 rounded-full bg-violet-600 text-white flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">{ti + 1}</span>{t}
                                    </li>
                                  ))}</ol>
                                </div>
                              )}
                              <div className="pt-2 flex justify-end">
                                <Link href={`/case/${c.case_id}`} className="text-xs font-semibold text-violet-700 hover:text-violet-900 flex items-center gap-1">
                                  View Full Case <span className="material-symbols-outlined text-sm">arrow_forward</span>
                                </Link>
                              </div>
                            </>
                          ) : (
                            <div className="text-center py-4">
                              <p className="text-xs text-slate-500 mb-2">No debrief saved for this session</p>
                              <Link href={`/case/${c.case_id}`} className="text-xs font-semibold text-[#2c5281] hover:underline">Retake this case</Link>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-slate-400">
                  <span className="material-symbols-outlined text-4xl">folder_open</span>
                  <p className="mt-2 text-sm">No cases completed yet</p>
                  <Link href="/" className="inline-block mt-3 text-[#2c5281] font-semibold text-sm hover:underline">Browse Cases</Link>
                </div>
              )
            )}

            {/* ===== TAB: Conditions Studied ===== */}
            {activeTab === "conditions" && (
              completed.length > 0 ? (
                <div className="space-y-5">
                  <p className="text-xs text-slate-500">Conditions you have studied, organized by organ system. Green means practiced, gray means not yet covered.</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {allSystems.map((sys) => {
                      const cases = conditionsBySystem[sys] || [];
                      const practiced = cases.length > 0;
                      return (
                        <div key={sys} className={`rounded-xl border p-4 ${practiced ? "bg-white border-emerald-200" : "bg-slate-50 border-slate-200"}`}>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className={`text-xs font-bold uppercase tracking-wider ${practiced ? "text-emerald-700" : "text-slate-400"}`}>
                              {sys}
                            </h4>
                            {practiced && (
                              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                                {cases.length} case{cases.length > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                          {practiced ? (
                            <div className="space-y-1.5">
                              {cases.map((c) => (
                                <Link href={`/case/${c.case_id}`} key={c.case_id}>
                                  <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-emerald-50 transition-colors">
                                    <div className={`size-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                      c.score !== null
                                        ? c.score >= 7 ? "bg-emerald-100 text-emerald-700" : c.score >= 4 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                                        : "bg-slate-100 text-slate-500"
                                    }`}>
                                      {c.score ?? "\u2014"}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium truncate text-slate-700">{c.diagnosis}</p>
                                    </div>
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                                      c.difficulty === "ICU / Fellow" ? "bg-red-50 text-red-600" : c.difficulty === "Resident" ? "bg-orange-50 text-orange-600" : "bg-slate-100 text-slate-500"
                                    }`}>{c.difficulty}</span>
                                  </div>
                                </Link>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-slate-400 italic">No cases in this system yet</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-slate-400">
                  <span className="material-symbols-outlined text-4xl">cardiology</span>
                  <p className="mt-2 text-sm">Complete cases to see your condition coverage</p>
                </div>
              )
            )}

            {/* ===== TAB: Mistake Patterns ===== */}
            {activeTab === "mistakes" && (
              <div className="space-y-6">
                {insights.allRedFlags.length === 0 && insights.allUnnecessary.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <span className="material-symbols-outlined text-4xl">verified</span>
                    <p className="mt-2 text-sm">No mistakes recorded yet. Complete cases with debrief to track patterns.</p>
                  </div>
                ) : (
                  <>
                    {insights.allRedFlags.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold text-red-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm">flag</span>
                          Missed Red Flags ({insights.allRedFlags.length})
                        </h4>
                        <p className="text-xs text-slate-500 mb-3">Critical findings you overlooked. Recognizing these early changes patient outcomes.</p>
                        <div className="space-y-2">
                          {insights.allRedFlags.map((rf, i) => (
                            <div key={i} className="flex items-start gap-3 p-3 bg-red-50 rounded-lg border border-red-100">
                              <span className="material-symbols-outlined text-red-500 text-sm mt-0.5 shrink-0">warning</span>
                              <div className="flex-1">
                                <p className="text-xs text-red-800 font-medium">{rf.flag}</p>
                                <p className="text-[10px] text-red-400 mt-0.5">{rf.case_id}: {rf.diagnosis}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {insights.allUnnecessary.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm">block</span>
                          Unnecessary Actions ({insights.allUnnecessary.length})
                        </h4>
                        <p className="text-xs text-slate-500 mb-3">Actions not indicated. Avoiding unnecessary workup reduces cost and patient harm.</p>
                        <div className="space-y-2">
                          {insights.allUnnecessary.map((ua, i) => (
                            <div key={i} className="flex items-start gap-3 p-3 bg-amber-50 rounded-lg border border-amber-100">
                              <span className="material-symbols-outlined text-amber-500 text-sm mt-0.5 shrink-0">do_not_disturb</span>
                              <div className="flex-1">
                                <p className="text-xs text-amber-800 font-medium">{ua.action}</p>
                                <p className="text-[10px] text-amber-400 mt-0.5">{ua.case_id}: {ua.diagnosis}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ===== TAB: Knowledge Gaps ===== */}
            {activeTab === "gaps" && (
              <div className="space-y-5">
                {knowledgeGaps.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <span className="material-symbols-outlined text-4xl">psychology_alt</span>
                    <p className="mt-2 text-sm">Complete cases with debrief to identify knowledge gaps</p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-slate-500">
                      Areas where you repeatedly missed findings or took unnecessary actions. Sorted by frequency — focus on the top items first.
                    </p>
                    <div className="space-y-3">
                      {knowledgeGaps.map((gap, i) => (
                        <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
                          <div className="flex items-center justify-between px-4 py-3 bg-slate-50">
                            <div className="flex items-center gap-2">
                              <span className={`size-7 rounded-full flex items-center justify-center text-xs font-bold ${
                                gap.count >= 3 ? "bg-red-100 text-red-700" : gap.count >= 2 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
                              }`}>
                                {gap.count}
                              </span>
                              <span className="text-sm font-bold text-slate-800">{gap.theme}</span>
                            </div>
                            <span className="text-[10px] text-slate-400">
                              across {gap.cases.length} case{gap.cases.length > 1 ? "s" : ""}
                            </span>
                          </div>
                          <div className="p-3 space-y-1.5">
                            {gap.flags.slice(0, 5).map((f, fi) => (
                              <p key={fi} className={`text-xs p-2 rounded ${
                                f.startsWith("[Unnecessary]")
                                  ? "bg-amber-50 text-amber-700 border border-amber-100"
                                  : "bg-red-50 text-red-700 border border-red-100"
                              }`}>
                                {f.replace("[Unnecessary] ", "")}
                                {f.startsWith("[Unnecessary]") && (
                                  <span className="ml-1 text-[9px] text-amber-500">(unnecessary)</span>
                                )}
                              </p>
                            ))}
                            {gap.flags.length > 5 && (
                              <p className="text-[10px] text-slate-400 pl-2">+{gap.flags.length - 5} more</p>
                            )}
                          </div>
                          <div className="px-4 py-2 bg-blue-50 border-t border-blue-100">
                            <p className="text-[10px] font-semibold text-blue-700">
                              Study tip: Review {gap.theme.toLowerCase()} fundamentals and practice recognizing these patterns earlier.
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ===== TAB: Clinical Pearls ===== */}
            {activeTab === "pearls" && (
              <div className="space-y-5">
                {insights.allTakeaways.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <span className="material-symbols-outlined text-4xl">lightbulb</span>
                    <p className="mt-2 text-sm">Complete cases with debrief to collect clinical pearls</p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-slate-500">Key clinical lessons from your cases. Review these regularly to reinforce learning.</p>
                    {/* Group pearls by system */}
                    {(() => {
                      const pearlsBySystem: Record<string, typeof insights.allTakeaways> = {};
                      insights.allTakeaways.forEach((t) => {
                        const sys = getSystem(t.specialty);
                        if (!pearlsBySystem[sys]) pearlsBySystem[sys] = [];
                        pearlsBySystem[sys].push(t);
                      });
                      return Object.entries(pearlsBySystem).map(([sys, pearls]) => (
                        <div key={sys}>
                          <h4 className="text-[10px] font-bold text-[#2c5281] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-sm">bookmark</span>
                            {sys}
                          </h4>
                          <div className="space-y-2 mb-4">
                            {pearls.map((t, i) => (
                              <div key={i} className="flex items-start gap-3 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                                <span className="size-5 rounded-full bg-[#2c5281] text-white flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">
                                  {i + 1}
                                </span>
                                <div className="flex-1">
                                  <p className="text-xs text-slate-800 leading-relaxed">{t.takeaway}</p>
                                  <p className="text-[10px] text-indigo-400 mt-1">{t.case_id}: {t.diagnosis}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ));
                    })()}
                  </>
                )}
              </div>
            )}

            {/* ===== TAB: Quick Review Cards ===== */}
            {activeTab === "review" && (
              <div className="space-y-5">
                {insights.allExpertPaths.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <span className="material-symbols-outlined text-4xl">quiz</span>
                    <p className="mt-2 text-sm">Complete cases with debrief to build your review cards</p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-slate-500">
                      One card per case. Core reasoning path and key differentials — use these for quick revision before exams.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {insights.allExpertPaths.map((ep, i) => {
                        const caseRecord = completed.find((c) => c.case_id === ep.case_id);
                        const debrief = caseRecord?.debrief;
                        return (
                          <div key={i} className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
                            {/* Card header */}
                            <div className="px-4 py-3 bg-[#2c5281] text-white">
                              <div className="flex items-center justify-between">
                                <p className="text-xs font-bold">{ep.case_id}</p>
                                <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full">{ep.specialty}</span>
                              </div>
                              <p className="text-sm font-bold mt-0.5">{ep.diagnosis}</p>
                            </div>
                            {/* Card body */}
                            <div className="p-4 space-y-3">
                              {ep.path.presentation_focus && (
                                <div>
                                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Key Presentation</p>
                                  <p className="text-xs text-slate-700 mt-0.5">{ep.path.presentation_focus}</p>
                                </div>
                              )}
                              {ep.path.key_pivot && (
                                <div>
                                  <p className="text-[9px] font-bold text-violet-500 uppercase tracking-wider">Critical Pivot</p>
                                  <p className="text-xs text-slate-700 mt-0.5">{ep.path.key_pivot}</p>
                                </div>
                              )}
                              {ep.path.optimal_workup && (
                                <div>
                                  <p className="text-[9px] font-bold text-blue-500 uppercase tracking-wider">Workup</p>
                                  <p className="text-xs text-slate-700 mt-0.5">{ep.path.optimal_workup}</p>
                                </div>
                              )}
                              {ep.path.optimal_management && (
                                <div>
                                  <p className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">Management</p>
                                  <p className="text-xs text-slate-700 mt-0.5">{ep.path.optimal_management}</p>
                                </div>
                              )}
                              {/* Red flags from this case */}
                              {debrief?.missed_red_flags?.length > 0 && (
                                <div className="pt-2 border-t border-slate-100">
                                  <p className="text-[9px] font-bold text-red-500 uppercase tracking-wider mb-1">Watch out for</p>
                                  {debrief.missed_red_flags.slice(0, 2).map((f: string, fi: number) => (
                                    <p key={fi} className="text-[11px] text-red-600 leading-relaxed">&bull; {f}</p>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex justify-end">
                              <Link href={`/case/${ep.case_id}`} className="text-[10px] font-semibold text-[#2c5281] hover:underline flex items-center gap-0.5">
                                Review case <span className="material-symbols-outlined text-xs">arrow_forward</span>
                              </Link>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Recommended Cases */}
        <section>
          <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-[#2c5281]">recommend</span>
            Recommended Next Cases
            {completed.length > 0 && (
              <span className="text-xs text-slate-400 font-normal">Based on your weak areas</span>
            )}
          </h3>
          {loading ? (
            <p className="text-slate-400">Loading...</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {recommended.map((c: any) => (
                <Link href={`/case/${c.case_id}`} key={c.case_id}>
                  <div className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-lg transition-shadow">
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-xs font-bold text-[#2c5281] bg-[#2c5281]/10 px-2 py-0.5 rounded">{c.case_id}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        c.difficulty === "ICU / Fellow" ? "bg-red-50 text-red-700"
                          : c.difficulty === "Resident" ? "bg-orange-50 text-orange-700"
                          : c.difficulty === "Intern" ? "bg-amber-50 text-amber-700"
                          : "bg-emerald-50 text-emerald-700"
                      }`}>{c.difficulty}</span>
                    </div>
                    <p className="text-sm font-semibold line-clamp-2 mb-2">{c.admission_diagnosis}</p>
                    <div className="flex gap-1.5">
                      {c.specialty && c.specialty !== "General" && (
                        <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">{c.specialty}</span>
                      )}
                      <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{c.age}y / {c.gender}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
