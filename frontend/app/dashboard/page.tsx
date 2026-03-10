"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API = "http://localhost:8000";

interface CaseRecord {
  case_id: string;
  admission_diagnosis: string;
  specialty: string;
  difficulty: string;
  score: number | null; // debrief score 0-10
  timestamp: number;
  stages_completed: number;
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

// Radar chart using SVG
function RadarChart({ data }: { data: { label: string; value: number }[] }) {
  const cx = 100, cy = 100, r = 70;
  const n = data.length;
  if (n < 3) return null;
  const angleStep = (Math.PI * 2) / n;

  const getPoint = (i: number, v: number) => ({
    x: cx + r * v * Math.sin(i * angleStep),
    y: cy - r * v * Math.cos(i * angleStep),
  });

  const bgPoints = Array.from({ length: n }, (_, i) => getPoint(i, 1));
  const dataPoints = data.map((d, i) => getPoint(i, d.value / 10));

  return (
    <svg viewBox="0 0 200 200" className="w-full max-w-[280px] mx-auto">
      {/* Grid rings */}
      {[0.25, 0.5, 0.75, 1].map((scale) => (
        <polygon
          key={scale}
          points={Array.from({ length: n }, (_, i) => {
            const p = getPoint(i, scale);
            return `${p.x},${p.y}`;
          }).join(" ")}
          fill="none"
          stroke="#cbd5e1"
          strokeWidth={0.5}
        />
      ))}
      {/* Axes */}
      {bgPoints.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#cbd5e1" strokeWidth={0.5} />
      ))}
      {/* Data polygon */}
      <polygon
        points={dataPoints.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="rgba(44,82,129,0.2)"
        stroke="#2c5281"
        strokeWidth={1.5}
      />
      {/* Data dots + labels */}
      {data.map((d, i) => {
        const dp = dataPoints[i];
        const lp = getPoint(i, 1.2);
        return (
          <g key={i}>
            <circle cx={dp.x} cy={dp.y} r={3} fill="#2c5281" />
            <text
              x={lp.x}
              y={lp.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="text-[8px] fill-slate-600 font-semibold"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function DashboardPage() {
  const [profile, setProfile] = useState<LearnerProfile>({ cases_completed: [], total_sessions: 0 });
  const [recommended, setRecommended] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const p = getProfile();
    setProfile(p);

    // Fetch recommended cases based on weak areas
    fetch(`${API}/api/cases?page=1&per_page=100`)
      .then((r) => r.json())
      .then((data) => {
        const completedIds = new Set(p.cases_completed.map((c) => c.case_id));
        const notDone = data.cases.filter((c: any) => !completedIds.has(c.case_id));
        // Prioritize: cases in specialties where student scored lowest
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

        // Sort: weak specialty first, then harder difficulty
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

  // Compute radar chart data from specialty performance
  const specMap: Record<string, number[]> = {};
  scored.forEach((c) => {
    if (!specMap[c.specialty]) specMap[c.specialty] = [];
    specMap[c.specialty].push(c.score || 0);
  });
  const radarData = Object.entries(specMap).map(([label, scores]) => ({
    label: label.length > 12 ? label.slice(0, 10) + ".." : label,
    value: scores.reduce((a, b) => a + b, 0) / scores.length,
  }));
  // Pad to at least 5 dimensions
  const defaultDims = ["Differential", "Data Interp", "Management", "Prioritization", "Communication"];
  while (radarData.length < 5) {
    radarData.push({ label: defaultDims[radarData.length] || "Other", value: 0 });
  }

  // Difficulty distribution
  const diffDist: Record<string, number> = {};
  completed.forEach((c) => {
    diffDist[c.difficulty] = (diffDist[c.difficulty] || 0) + 1;
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-[#2c5281]/10 px-4 py-6 md:px-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="p-2 hover:bg-[#2c5281]/10 rounded-full transition-colors">
              <span className="material-symbols-outlined text-[#2c5281]">arrow_back</span>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-[#2c5281]">Learning Dashboard</h1>
              <p className="text-slate-500 text-sm">Track your clinical reasoning progress</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-grow px-4 py-8 md:px-8 max-w-6xl mx-auto w-full space-y-8">
        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: "school", label: "Cases Completed", value: completed.length },
            { icon: "analytics", label: "Avg Score", value: avgScore > 0 ? `${avgScore.toFixed(1)}/10` : "—" },
            { icon: "trending_up", label: "Sessions", value: profile.total_sessions },
            { icon: "star", label: "Best Score", value: scored.length > 0 ? `${Math.max(...scored.map((s) => s.score || 0))}/10` : "—" },
          ].map((stat) => (
            <div key={stat.label} className="bg-white p-5 rounded-xl border border-[#2c5281]/10 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-[#2c5281]/10 rounded-lg">
                  <span className="material-symbols-outlined text-[#2c5281]">{stat.icon}</span>
                </div>
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{stat.label}</span>
              </div>
              <p className="text-2xl font-black text-slate-900">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Radar Chart */}
          <div className="bg-white rounded-xl border border-[#2c5281]/10 p-5 shadow-sm">
            <h3 className="text-sm font-bold text-[#2c5281] uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-lg">radar</span>
              Competency Radar
            </h3>
            {scored.length > 0 ? (
              <RadarChart data={radarData} />
            ) : (
              <div className="text-center py-12 text-slate-400">
                <span className="material-symbols-outlined text-4xl">radar</span>
                <p className="mt-2 text-sm">Complete cases with debrief to see your radar</p>
              </div>
            )}
          </div>

          {/* Case History */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-[#2c5281]/10 p-5 shadow-sm">
            <h3 className="text-sm font-bold text-[#2c5281] uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-lg">history</span>
              Case History
            </h3>
            {completed.length > 0 ? (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {[...completed].reverse().map((c, i) => (
                  <Link href={`/case/${c.case_id}`} key={i}>
                    <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-100 hover:border-[#2c5281]/30 transition-all cursor-pointer">
                      <div className={`size-10 rounded-full flex items-center justify-center font-bold text-sm ${
                        c.score !== null
                          ? c.score >= 7 ? "bg-emerald-100 text-emerald-700"
                            : c.score >= 4 ? "bg-amber-100 text-amber-700"
                            : "bg-red-100 text-red-700"
                          : "bg-slate-100 text-slate-500"
                      }`}>
                        {c.score !== null ? c.score : "—"}
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
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {new Date(c.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400">
                <span className="material-symbols-outlined text-4xl">folder_open</span>
                <p className="mt-2 text-sm">No cases completed yet</p>
                <Link href="/" className="inline-block mt-3 text-[#2c5281] font-semibold text-sm hover:underline">
                  Browse Cases
                </Link>
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
                      <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                        {c.age}y / {c.gender}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Difficulty Distribution */}
        {completed.length > 0 && (
          <section className="bg-white rounded-xl border border-[#2c5281]/10 p-5 shadow-sm">
            <h3 className="text-sm font-bold text-[#2c5281] uppercase tracking-wider mb-4">
              Difficulty Distribution
            </h3>
            <div className="flex gap-3">
              {["Clerkship", "Intern", "Resident", "ICU / Fellow"].map((diff) => {
                const count = diffDist[diff] || 0;
                const pct = completed.length > 0 ? (count / completed.length) * 100 : 0;
                return (
                  <div key={diff} className="flex-1">
                    <div className="text-center mb-2">
                      <span className="text-lg font-bold text-slate-900">{count}</span>
                      <p className="text-[10px] text-slate-500 font-semibold uppercase">{diff}</p>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          diff === "ICU / Fellow" ? "bg-red-500"
                            : diff === "Resident" ? "bg-orange-500"
                            : diff === "Intern" ? "bg-amber-500"
                            : "bg-emerald-500"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
