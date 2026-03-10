"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

const API = "http://localhost:8000";

interface LabEntry {
  value: string;
  unit: string;
  charttime: string;
  status?: "normal" | "high" | "low";
  group?: string;
}

interface TimelineEvent {
  type: "lab" | "med_start" | "med_end";
  time: string;
  name: string;
  value?: string;
  unit?: string;
  status?: string;
  group?: string;
  dose?: string;
  route?: string;
}

interface LabTrendMeta {
  points: { time: string; value: number }[];
  ref_low?: number;
  ref_high?: number;
  unit?: string;
}

interface EducationalFraming {
  difficulty: string;
  specialty: string;
  learning_objectives: string[];
  high_yield: string[];
  pitfalls: string[];
}

interface CaseData {
  case_id: string;
  age: number;
  gender: string;
  admission_diagnosis: string;
  diagnoses: { icd9_code: string; title: string; seq_num: number }[];
  drugs: string[];
  key_labs: Record<string, LabEntry>;
  lab_trends: Record<string, LabTrendMeta>;
  num_lab_records: number;
  timeline: TimelineEvent[];
  similar_patients: {
    case_id: string;
    age: number;
    gender: string;
    admission_diagnosis: string;
    final_score: number;
    shared_diagnoses: string[];
    shared_drugs: string[];
  }[];
  quality_findings: { type: string; severity: string; message: string }[];
  kg_stats: { total_nodes: number; total_edges: number };
  background?: {
    chief_complaint?: string;
    hpi?: string;
    past_medical_history?: string;
    allergies?: string;
    social_history?: string;
    family_history?: string;
  };
  educational_framing: EducationalFraming;
  provenance?: {
    source: string;
    institution: string;
    maintained_by: string;
    patient_type: string;
    date_note: string;
    raw_ehr_fields: string[];
    ai_generated_fields: string[];
    clinician_review_note: string;
    quality_issues_count: number;
    completeness_score: number;
    completeness_detail: Record<string, boolean>;
  };
}

interface Message {
  role: "tutor" | "student" | "hint" | "review";
  content: string;
  stage?: number;
}

const STAGE_LABELS: Record<number, string> = {
  1: "Case Presentation",
  2: "Differential Diagnosis",
  3: "Labs & Data Quality",
  4: "Treatment & Comparison",
  5: "Free Q&A",
};

const LAB_GROUP_ORDER = ["CBC", "BMP", "Liver", "Coagulation", "Cardiac", "ABG", "Electrolytes", "Other"];
const LAB_GROUP_ICONS: Record<string, string> = {
  CBC: "bloodtype",
  BMP: "science",
  Liver: "hepatology",
  Coagulation: "water_drop",
  Cardiac: "cardiology",
  ABG: "pulmonology",
  Electrolytes: "labs",
  Other: "biotech",
};

// --- Sparkline SVG Component ---
function Sparkline({ points, refLow, refHigh, width = 120, height = 32 }: {
  points: { time: string; value: number }[];
  refLow?: number;
  refHigh?: number;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values, refLow ?? Infinity);
  const max = Math.max(...values, refHigh ?? -Infinity);
  const range = max - min || 1;
  const pad = 2;
  const xStep = (width - pad * 2) / (points.length - 1);
  const toY = (v: number) => height - pad - ((v - min) / range) * (height - pad * 2);
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${pad + i * xStep},${toY(p.value)}`).join(" ");
  const lastVal = values[values.length - 1];
  const isAbnormal = (refLow !== undefined && lastVal < refLow) || (refHigh !== undefined && lastVal > refHigh);

  return (
    <svg width={width} height={height} className="inline-block">
      {/* Reference range band */}
      {refLow !== undefined && refHigh !== undefined && (
        <rect x={pad} y={toY(refHigh)} width={width - pad * 2} height={Math.max(1, toY(refLow) - toY(refHigh))}
          fill="#10b981" opacity={0.1} rx={2} />
      )}
      {/* Line */}
      <path d={pathD} fill="none" stroke={isAbnormal ? "#ef4444" : "#2c5281"} strokeWidth={1.5} />
      {/* Dots */}
      {points.map((p, i) => {
        const dotAbnormal = (refLow !== undefined && p.value < refLow) || (refHigh !== undefined && p.value > refHigh);
        return (
          <circle key={i} cx={pad + i * xStep} cy={toY(p.value)} r={2}
            fill={dotAbnormal ? "#ef4444" : "#2c5281"} />
        );
      })}
    </svg>
  );
}

// --- Format timeline date ---
function fmtTime(t: string): string {
  try {
    const d = new Date(t);
    if (isNaN(d.getTime())) return t.slice(0, 16);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return t.slice(0, 16);
  }
}
function fmtDate(t: string): string {
  try {
    const d = new Date(t);
    if (isNaN(d.getTime())) return t.slice(0, 10);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return t.slice(0, 10);
  }
}

// --- Learning Progress Tracking (localStorage) ---
function saveToLearningProfile(record: {
  case_id: string;
  admission_diagnosis: string;
  specialty: string;
  difficulty: string;
  score: number | null;
  stages_completed: number;
  debrief?: any;
}) {
  if (typeof window === "undefined") return;
  const raw = localStorage.getItem("clinical_tutor_profile");
  let profile: { cases_completed: any[]; total_sessions: number } = { cases_completed: [], total_sessions: 0 };
  if (raw) try { profile = JSON.parse(raw); } catch { /* ignore */ }

  // Update or add record
  const existing = profile.cases_completed.findIndex((c: any) => c.case_id === record.case_id);
  const entry = { ...record, timestamp: Date.now() };
  if (existing >= 0) {
    profile.cases_completed[existing] = entry;
  } else {
    profile.cases_completed.push(entry);
  }
  profile.total_sessions += 1;
  localStorage.setItem("clinical_tutor_profile", JSON.stringify(profile));
}

export default function CasePage() {
  const params = useParams();
  const caseId = params.id as string;
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [stage, setStage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => `session_${Date.now()}`);
  const [activeTab, setActiveTab] = useState<"chat" | "overview">("overview");
  const [hintLevel, setHintLevel] = useState(0);
  const [hintLoading, setHintLoading] = useState(false);
  const [reviewData, setReviewData] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [useTemplate, setUseTemplate] = useState(false);
  const [templateData, setTemplateData] = useState({
    problem: "",
    differentials: "",
    tests: "",
    management: "",
  });
  const [studentAnswers, setStudentAnswers] = useState<Record<string, string>>({});
  const [debriefData, setDebriefData] = useState<any>(null);
  const [debriefLoading, setDebriefLoading] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [expandedTrend, setExpandedTrend] = useState<string | null>(null);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const debriefRef = useRef<HTMLDivElement>(null);

  const downloadDebriefPdf = () => {
    if (!debriefRef.current || !caseData) return;
    const el = debriefRef.current;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    // Clone the debrief content and render in a print-friendly page
    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${caseData.case_id} - Case Debrief</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', sans-serif; padding: 40px; color: #1e293b; font-size: 12px; line-height: 1.6; }
  h1 { font-size: 20px; color: #2c5281; margin-bottom: 4px; }
  h2 { font-size: 14px; color: #6d28d9; text-transform: uppercase; letter-spacing: 0.05em; margin: 20px 0 8px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #2c5281; padding-bottom: 12px; margin-bottom: 20px; }
  .score { font-size: 28px; font-weight: 900; color: #6d28d9; }
  .score-label { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 12px; display: inline-block; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
  .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; background: #f8fafc; }
  .card-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #6d28d9; margin-bottom: 4px; }
  .card-value { font-size: 11px; color: #334155; }
  .flag { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 8px; margin-bottom: 6px; color: #991b1b; }
  .action { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 8px; margin-bottom: 6px; color: #92400e; }
  .takeaway { background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 6px; padding: 8px; margin-bottom: 6px; display: flex; gap: 8px; align-items: flex-start; }
  .takeaway-num { width: 18px; height: 18px; border-radius: 50%; background: #6d28d9; color: white; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; flex-shrink: 0; }
  .comp-row { border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 6px; overflow: hidden; }
  .comp-header { background: #f1f5f9; padding: 6px 10px; display: flex; justify-content: space-between; font-weight: 600; font-size: 11px; }
  .comp-body { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 8px 10px; }
  .comp-label { font-size: 9px; font-weight: 700; text-transform: uppercase; color: #94a3b8; margin-bottom: 2px; }
  .meta { font-size: 10px; color: #94a3b8; }
  .timing { padding: 8px; border-radius: 6px; margin-bottom: 16px; }
  .timing-ok { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; }
  .timing-delayed { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
  @media print { body { padding: 20px; } }
</style>
</head><body>
<div class="header">
  <div>
    <h1>${caseData.case_id}: ${caseData.admission_diagnosis}</h1>
    <div class="meta">${caseData.age}y / ${caseData.gender} &bull; ${caseData.educational_framing?.specialty || ""} &bull; ${caseData.educational_framing?.difficulty || ""} &bull; ${new Date().toLocaleDateString()}</div>
  </div>
  <div style="text-align:right">
    <div class="score">${debriefData?.overall_score ?? ""}/10</div>
    <span class="score-label" style="background:${
      debriefData?.score_label === "Expert" || debriefData?.score_label === "Proficient" ? "#d1fae5;color:#065f46"
      : debriefData?.score_label === "Competent" ? "#dbeafe;color:#1e40af"
      : "#fef3c7;color:#92400e"
    }">${debriefData?.score_label || ""}</span>
  </div>
</div>
${debriefData?.expert_path ? `
<h2>Expert Reasoning Path</h2>
<div class="grid">
  ${["presentation_focus", "key_pivot", "optimal_workup", "optimal_management"]
    .filter(k => debriefData.expert_path[k])
    .map(k => `<div class="card"><div class="card-label">${k.replace(/_/g, " ")}</div><div class="card-value">${debriefData.expert_path[k]}</div></div>`)
    .join("")}
</div>` : ""}
${debriefData?.student_vs_expert?.length ? `
<h2>Your Path vs Expert Path</h2>
${debriefData.student_vs_expert.map((c: any) => `
<div class="comp-row">
  <div class="comp-header"><span>${c.stage}</span><span>${c.alignment}</span></div>
  <div class="comp-body">
    <div><div class="comp-label">You said</div><div>${c.student_did}</div></div>
    <div><div class="comp-label">Expert would</div><div>${c.expert_would}</div></div>
  </div>
  <div style="padding:4px 10px 8px;font-style:italic;color:#64748b;font-size:11px">${c.comment}</div>
</div>`).join("")}` : ""}
${debriefData?.missed_red_flags?.length ? `
<h2>Missed Red Flags</h2>
${debriefData.missed_red_flags.map((f: string) => `<div class="flag">${f}</div>`).join("")}` : ""}
${debriefData?.unnecessary_actions?.length ? `
<h2>Unnecessary Actions</h2>
${debriefData.unnecessary_actions.map((a: string) => `<div class="action">${a}</div>`).join("")}` : ""}
${debriefData?.management_timing ? `
<h2>Management Timing</h2>
<div class="timing ${debriefData.management_timing.delayed ? "timing-delayed" : "timing-ok"}">${debriefData.management_timing.details}</div>` : ""}
${debriefData?.takeaways?.length ? `
<h2>Key Takeaways</h2>
${debriefData.takeaways.map((t: string, i: number) => `<div class="takeaway"><div class="takeaway-num">${i + 1}</div><div>${t}</div></div>`).join("")}` : ""}
</body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.print();
    };
  };

  useEffect(() => {
    fetch(`${API}/api/case/${caseId}`)
      .then((r) => r.json())
      .then(setCaseData)
      .catch(console.error);
  }, [caseId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const streamChat = async (
    stage: number,
    studentAnswer: string,
    onStart: () => void,
  ) => {
    onStart();
    setLoading(true);

    const res = await fetch(`${API}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        case_id: caseId,
        session_id: sessionId,
        stage,
        student_answer: studentAnswer,
      }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const payload = line.slice(6);
          if (payload === "[DONE]") break;
          try {
            const parsed = JSON.parse(payload);
            fullText += parsed.text;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: "tutor", content: fullText, stage };
              return updated;
            });
          } catch {}
        }
      }
    }
    setLoading(false);
  };

  const startSession = async () => {
    setActiveTab("chat");
    setStage(1);
    setHintLevel(0);
    setReviewData(null);

    await streamChat(1, "", () => {
      setMessages([{ role: "tutor", content: "", stage: 1 }]);
    });
  };

  const sendMessage = async () => {
    if (loading) return;

    let studentMsg = "";
    if (useTemplate) {
      const parts = [];
      if (templateData.problem.trim()) parts.push(`**Problem:** ${templateData.problem.trim()}`);
      if (templateData.differentials.trim()) parts.push(`**Differential Diagnosis:** ${templateData.differentials.trim()}`);
      if (templateData.tests.trim()) parts.push(`**Tests/Workup:** ${templateData.tests.trim()}`);
      if (templateData.management.trim()) parts.push(`**Management Plan:** ${templateData.management.trim()}`);
      studentMsg = parts.join("\n\n");
      if (!studentMsg) return;
      setTemplateData({ problem: "", differentials: "", tests: "", management: "" });
    } else {
      if (!input.trim()) return;
      studentMsg = input.trim();
      setInput("");
    }

    const nextStage = stage < 4 ? stage + 1 : 5;
    setHintLevel(0);

    // Track student answers per stage for debrief
    if (nextStage >= 2 && nextStage <= 4) {
      setStudentAnswers((prev) => ({ ...prev, [`stage${nextStage}`]: studentMsg }));
    }

    await streamChat(nextStage, studentMsg, () => {
      setMessages((prev) => [
        ...prev,
        { role: "student", content: studentMsg },
        { role: "tutor", content: "", stage: nextStage },
      ]);
      setStage(nextStage);
    });
  };

  const requestHint = async () => {
    if (hintLoading || stage === 0 || stage >= 5) return;
    const nextHintLevel = Math.min(hintLevel + 1, 3);
    setHintLevel(nextHintLevel);
    setHintLoading(true);

    const res = await fetch(`${API}/api/hint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        case_id: caseId,
        session_id: sessionId,
        stage,
        hint_level: nextHintLevel,
      }),
    });
    const data = await res.json();
    setMessages((prev) => [
      ...prev,
      { role: "hint", content: data.hint },
    ]);
    setHintLoading(false);
  };

  const requestReview = async () => {
    if (reviewLoading) return;
    setReviewLoading(true);

    const res = await fetch(`${API}/api/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        case_id: caseId,
        session_id: sessionId,
      }),
    });
    const data = await res.json();
    setReviewData(data.review);
    setReviewLoading(false);
  };

  // Group labs by system
  const groupedLabs = () => {
    if (!caseData) return {};
    const groups: Record<string, { name: string; lab: LabEntry }[]> = {};
    Object.entries(caseData.key_labs).forEach(([name, lab]) => {
      const group = lab.group || "Other";
      if (!groups[group]) groups[group] = [];
      groups[group].push({ name, lab });
    });
    return groups;
  };

  if (!caseData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <span className="material-symbols-outlined text-[#2c5281]/30 text-6xl animate-pulse">clinical_notes</span>
          <p className="text-slate-400 mt-4 text-lg">Loading case...</p>
        </div>
      </div>
    );
  }

  const labs = groupedLabs();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Navigation */}
      <header className="sticky top-0 z-50 bg-[#f6f7f8] border-b border-[#2c5281]/10">
        <div className="flex items-center p-4 justify-between max-w-5xl mx-auto w-full">
          <div className="flex items-center gap-3">
            <Link href="/" className="p-2 hover:bg-[#2c5281]/10 rounded-full transition-colors">
              <span className="material-symbols-outlined text-[#2c5281]">arrow_back</span>
            </Link>
            <h1 className="text-lg font-bold tracking-tight">Case Detail</h1>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Case Header */}
        <section className="flex flex-col md:flex-row gap-6 items-start">
          <div className="bg-[#2c5281]/10 rounded-xl h-28 w-28 flex items-center justify-center border border-[#2c5281]/20 shrink-0">
            <span className="material-symbols-outlined text-[#2c5281] text-5xl">monitor_heart</span>
          </div>
          <div className="flex-1 space-y-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Case ID: {caseData.case_id}</h2>
              <p className="text-[#2c5281] font-medium flex items-center gap-2 mt-1">
                <span className="material-symbols-outlined text-sm">medical_services</span>
                {caseData.admission_diagnosis}
              </p>
              <p className="text-sm text-slate-500 mt-1">
                {caseData.age}y / {caseData.gender} &middot;{" "}
                {caseData.diagnoses.length} Diagnoses &middot;{" "}
                {caseData.num_lab_records.toLocaleString()} Labs &middot;{" "}
                {caseData.drugs.length} Medications
              </p>
              {/* Difficulty + Specialty badges */}
              {caseData.educational_framing && (
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                    caseData.educational_framing.difficulty === "ICU / Fellow" ? "bg-red-50 text-red-700 border-red-200"
                      : caseData.educational_framing.difficulty === "Resident" ? "bg-orange-50 text-orange-700 border-orange-200"
                      : caseData.educational_framing.difficulty === "Intern" ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-emerald-50 text-emerald-700 border-emerald-200"
                  }`}>
                    {caseData.educational_framing.difficulty}
                  </span>
                  {caseData.educational_framing.specialty !== "General" && (
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {caseData.educational_framing.specialty}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              {stage === 0 && (
                <button
                  onClick={startSession}
                  className="flex items-center justify-center gap-2 px-6 py-2.5 bg-[#2c5281] text-white rounded-lg font-bold shadow-sm hover:bg-[#2c5281]/90 transition-all"
                >
                  <span className="material-symbols-outlined text-[20px]">school</span>
                  <span>Start Teaching Session</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Patient Background */}
        {caseData.background && Object.keys(caseData.background).length > 0 && (
          <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
              <span className="material-symbols-outlined text-[#2c5281] text-lg">person</span>
              Patient Background
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {caseData.background.chief_complaint && (
                <div className="md:col-span-2 bg-blue-50 border border-blue-100 rounded-xl p-4">
                  <p className="text-xs font-bold text-blue-700 uppercase tracking-wider mb-1">Chief Complaint</p>
                  <p className="text-sm text-slate-700 leading-relaxed">{caseData.background.chief_complaint}</p>
                </div>
              )}
              {caseData.background.hpi && (
                <div className="md:col-span-2 bg-slate-50 border border-slate-100 rounded-xl p-4">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">History of Present Illness</p>
                  <p className="text-sm text-slate-700 leading-relaxed">{caseData.background.hpi}</p>
                </div>
              )}
              {caseData.background.past_medical_history && (
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Past Medical History</p>
                  <p className="text-sm text-slate-700 leading-relaxed">{caseData.background.past_medical_history}</p>
                </div>
              )}
              {caseData.background.allergies && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                  <p className="text-xs font-bold text-red-600 uppercase tracking-wider mb-1">Allergies</p>
                  <p className="text-sm text-slate-700 leading-relaxed">{caseData.background.allergies}</p>
                </div>
              )}
              {caseData.background.social_history && (
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Social History</p>
                  <p className="text-sm text-slate-700 leading-relaxed">{caseData.background.social_history}</p>
                </div>
              )}
              {caseData.background.family_history && (
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Family History</p>
                  <p className="text-sm text-slate-700 leading-relaxed">{caseData.background.family_history}</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Educational Framing Panel */}
        {caseData.educational_framing && (
          <section className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-2xl p-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Learning Objectives */}
              <div>
                <h4 className="text-xs font-bold text-indigo-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm">target</span>
                  Learning Objectives
                </h4>
                <ul className="space-y-1.5">
                  {caseData.educational_framing.learning_objectives.map((obj, i) => (
                    <li key={i} className="text-xs text-slate-700 flex items-start gap-1.5">
                      <span className="text-indigo-500 font-bold mt-0.5 shrink-0">{i + 1}.</span>
                      {obj}
                    </li>
                  ))}
                </ul>
              </div>
              {/* High-Yield Points */}
              <div>
                <h4 className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm">star</span>
                  High-Yield Points
                </h4>
                {caseData.educational_framing.high_yield.length > 0 ? (
                  <ul className="space-y-1.5">
                    {caseData.educational_framing.high_yield.map((pt, i) => (
                      <li key={i} className="text-xs text-slate-700 bg-amber-50 border border-amber-100 rounded-lg p-2">
                        {pt}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500 italic">Standard presentation</p>
                )}
              </div>
              {/* Common Pitfalls */}
              <div>
                <h4 className="text-xs font-bold text-red-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm">warning</span>
                  Common Pitfalls
                </h4>
                <ul className="space-y-1.5">
                  {caseData.educational_framing.pitfalls.map((pit, i) => (
                    <li key={i} className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">
                      {pit}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}

        {/* Tabs */}
        <div className="border-b border-[#2c5281]/10 sticky top-[72px] bg-[#f6f7f8] z-40">
          <div className="flex gap-8">
            <button
              onClick={() => setActiveTab("overview")}
              className={`flex items-center gap-2 border-b-2 pb-3 pt-2 px-1 font-bold text-sm transition-colors ${
                activeTab === "overview"
                  ? "border-[#2c5281] text-[#2c5281]"
                  : "border-transparent text-slate-500 hover:text-[#2c5281]"
              }`}
            >
              Case Overview
            </button>
            <button
              onClick={() => setActiveTab("chat")}
              className={`flex items-center gap-2 border-b-2 pb-3 pt-2 px-1 font-bold text-sm transition-colors ${
                activeTab === "chat"
                  ? "border-[#2c5281] text-[#2c5281]"
                  : "border-transparent text-slate-500 hover:text-[#2c5281]"
              }`}
            >
              Teaching Session
              {stage > 0 && (
                <span className="text-xs bg-[#2c5281]/10 text-[#2c5281] px-2 py-0.5 rounded-full">
                  Stage {Math.min(stage, 4)}/4
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === "overview" ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column */}
            <div className="lg:col-span-2 space-y-8">
              {/* Case Timeline */}
              {caseData.timeline && caseData.timeline.length > 0 && (
                <section>
                  <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#2c5281]">timeline</span>
                    Clinical Timeline
                    <span className="text-xs text-slate-400 font-normal ml-auto">
                      {caseData.timeline.length} events
                    </span>
                  </h3>
                  <div className="bg-white rounded-xl border border-[#2c5281]/10 overflow-hidden">
                    <div className="relative pl-8 pr-4 py-4">
                      {/* Timeline line */}
                      <div className="absolute left-6 top-4 bottom-4 w-0.5 bg-[#2c5281]/20" />
                      {(() => {
                        // Group consecutive events by date
                        const events = timelineExpanded ? caseData.timeline : caseData.timeline.slice(0, 20);
                        let lastDate = "";
                        return events.map((ev, i) => {
                          const evDate = fmtDate(ev.time);
                          const showDate = evDate !== lastDate;
                          lastDate = evDate;
                          return (
                            <div key={i}>
                              {showDate && (
                                <div className="flex items-center gap-2 mb-2 mt-3 first:mt-0 -ml-5">
                                  <div className="size-4 rounded-full bg-[#2c5281] border-2 border-white z-10" />
                                  <span className="text-xs font-bold text-[#2c5281]">{evDate}</span>
                                </div>
                              )}
                              <div className="flex items-start gap-3 mb-1.5 ml-1">
                                <div className={`size-2.5 rounded-full mt-1.5 shrink-0 ${
                                  ev.type === "lab"
                                    ? ev.status === "high" ? "bg-red-500"
                                      : ev.status === "low" ? "bg-blue-500"
                                      : "bg-slate-300"
                                    : ev.type === "med_start" ? "bg-emerald-500"
                                    : "bg-slate-400"
                                }`} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className={`text-xs font-medium ${
                                      ev.type === "lab" && ev.status !== "normal" ? "font-bold" : ""
                                    } ${
                                      ev.status === "high" ? "text-red-700"
                                        : ev.status === "low" ? "text-blue-700"
                                        : ev.type === "med_start" ? "text-emerald-700"
                                        : ev.type === "med_end" ? "text-slate-500"
                                        : "text-slate-600"
                                    }`}>
                                      {ev.name}
                                    </span>
                                    {ev.type === "lab" && (
                                      <span className={`text-[10px] font-mono font-bold ${
                                        ev.status === "high" ? "text-red-600" : ev.status === "low" ? "text-blue-600" : "text-slate-500"
                                      }`}>
                                        {ev.value} {ev.unit}
                                        {ev.status === "high" && " \u2191"}
                                        {ev.status === "low" && " \u2193"}
                                      </span>
                                    )}
                                    {ev.type === "med_start" && (
                                      <span className="text-[10px] text-emerald-600 font-medium">
                                        Started {ev.dose && `- ${ev.dose}`} {ev.route && `(${ev.route})`}
                                      </span>
                                    )}
                                    {ev.type === "med_end" && (
                                      <span className="text-[10px] text-slate-400">Stopped</span>
                                    )}
                                    <span className="text-[10px] text-slate-400 ml-auto shrink-0">
                                      {fmtTime(ev.time)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                    {caseData.timeline.length > 20 && (
                      <button
                        onClick={() => setTimelineExpanded(!timelineExpanded)}
                        className="w-full py-2 text-xs font-semibold text-[#2c5281] hover:bg-[#2c5281]/5 transition-colors border-t border-[#2c5281]/10"
                      >
                        {timelineExpanded ? "Show Less" : `Show All ${caseData.timeline.length} Events`}
                      </button>
                    )}
                  </div>
                </section>
              )}

              {/* Diagnoses */}
              <section>
                <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#2c5281]">description</span>
                  Diagnoses (ICD-9)
                </h3>
                <div className="bg-white rounded-xl border border-[#2c5281]/10 overflow-hidden">
                  <ul className="divide-y divide-[#2c5281]/5">
                    {caseData.diagnoses.map((d, i) => (
                      <li key={i} className="p-3 flex justify-between items-center hover:bg-[#2c5281]/5 transition-colors">
                        <span className="text-sm font-medium">
                          {d.icd9_code} - {d.title}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded ${
                          d.seq_num === 1
                            ? "text-[#2c5281] bg-[#2c5281]/10 font-bold"
                            : "text-slate-400"
                        }`}>
                          {d.seq_num === 1 ? "Primary" : `#${d.seq_num}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>

              {/* Key Lab Results - Grouped by System */}
              <section>
                <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#2c5281]">biotech</span>
                  Lab Results (Grouped by System)
                </h3>
                <div className="space-y-4">
                  {LAB_GROUP_ORDER.filter((g) => labs[g] && labs[g].length > 0).map((groupName) => (
                    <div key={groupName} className="bg-white rounded-xl border border-[#2c5281]/10 overflow-hidden">
                      <div className="bg-[#2c5281]/5 px-3 py-2 flex items-center gap-2 border-b border-[#2c5281]/10">
                        <span className="material-symbols-outlined text-[#2c5281] text-base">
                          {LAB_GROUP_ICONS[groupName] || "biotech"}
                        </span>
                        <span className="text-xs font-bold text-[#2c5281]">{groupName}</span>
                        <span className="text-xs text-slate-400 ml-auto">
                          {labs[groupName].filter((l) => l.lab.status !== "normal").length > 0 && (
                            <span className="text-amber-600 font-semibold">
                              {labs[groupName].filter((l) => l.lab.status !== "normal").length} abnormal
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-px bg-slate-100 p-px">
                        {labs[groupName].map(({ name, lab }) => {
                          const trend = caseData.lab_trends?.[name];
                          const isAbnormal = lab.status === "high" || lab.status === "low";
                          const isExpanded = expandedTrend === name;
                          return (
                            <div
                              key={name}
                              onClick={() => trend && setExpandedTrend(isExpanded ? null : name)}
                              className={`p-2.5 cursor-pointer transition-colors ${
                                isExpanded
                                  ? "bg-[#2c5281]/5 ring-1 ring-[#2c5281]/30"
                                  : lab.status === "high"
                                  ? "bg-red-50 hover:bg-red-100"
                                  : lab.status === "low"
                                  ? "bg-blue-50 hover:bg-blue-100"
                                  : "bg-white hover:bg-slate-50"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[10px] font-semibold text-slate-500 truncate">{name}</span>
                                {isAbnormal && (
                                  <span className={`material-symbols-outlined text-xs ${lab.status === "high" ? "text-red-500" : "text-blue-500"}`}>
                                    {lab.status === "high" ? "arrow_upward" : "arrow_downward"}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-baseline gap-1">
                                <span className={`text-sm font-bold font-mono ${
                                  lab.status === "high" ? "text-red-700" : lab.status === "low" ? "text-blue-700" : "text-slate-900"
                                }`}>
                                  {lab.value}
                                </span>
                                <span className="text-[9px] text-slate-400">{lab.unit}</span>
                              </div>
                              {trend && (
                                <div className="mt-1">
                                  <Sparkline points={trend.points} refLow={trend.ref_low} refHigh={trend.ref_high} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {/* Expanded trend detail */}
                      {labs[groupName].some(({ name }) => expandedTrend === name) && (() => {
                        const trend = caseData.lab_trends?.[expandedTrend!];
                        if (!trend) return null;
                        return (
                          <div className="px-4 py-3 bg-slate-50 border-t border-[#2c5281]/10">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-bold text-[#2c5281]">{expandedTrend} Trend</span>
                              {trend.ref_low !== undefined && (
                                <span className="text-[10px] text-slate-500">
                                  Ref: {trend.ref_low} - {trend.ref_high} {trend.unit}
                                </span>
                              )}
                            </div>
                            <Sparkline points={trend.points} refLow={trend.ref_low} refHigh={trend.ref_high} width={400} height={60} />
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                              {trend.points.map((p, i) => (
                                <span key={i} className={`text-[10px] font-mono ${
                                  (trend.ref_low !== undefined && p.value < trend.ref_low) ||
                                  (trend.ref_high !== undefined && p.value > trend.ref_high)
                                    ? "text-red-600 font-bold" : "text-slate-500"
                                }`}>
                                  {fmtTime(p.time)}: {p.value}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </section>

              {/* Medications */}
              <section>
                <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#2c5281]">pill</span>
                  Medications ({caseData.drugs.length})
                </h3>
                <div className="flex flex-wrap gap-2">
                  {caseData.drugs.map((drug) => (
                    <span
                      key={drug}
                      className="bg-[#2c5281]/10 text-[#2c5281] border border-[#2c5281]/20 px-3 py-1.5 rounded-full text-xs font-bold"
                    >
                      {drug}
                    </span>
                  ))}
                </div>
              </section>
            </div>

            {/* Right Column */}
            <div className="space-y-8">
              {/* Data Quality Findings */}
              {caseData.quality_findings.length > 0 && (
                <section>
                  <h3 className="text-lg font-bold mb-3 flex items-center gap-2 text-[#2c5281]">
                    <span className="material-symbols-outlined">analytics</span>
                    Data Quality
                  </h3>
                  <div className="space-y-3">
                    {caseData.quality_findings.map((f, i) => {
                      const isCritical = f.severity === "critical";
                      return (
                        <div
                          key={i}
                          className={`p-4 rounded-xl border ${
                            isCritical
                              ? "bg-red-50 border-red-200"
                              : "bg-orange-50 border-orange-200"
                          }`}
                        >
                          <div className="flex justify-between items-start mb-1">
                            <span className={`text-sm font-bold ${
                              isCritical ? "text-red-800" : "text-orange-800"
                            }`}>
                              {f.type}
                            </span>
                            <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold tracking-wider ${
                              isCritical
                                ? "bg-red-200 text-red-800"
                                : "bg-orange-200 text-orange-800"
                            }`}>
                              {f.severity}
                            </span>
                          </div>
                          <p className={`text-xs ${isCritical ? "text-red-700" : "text-orange-700"}`}>
                            {f.message}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Data Provenance & Trustworthiness */}
              {caseData.provenance && (
                <section>
                  <h3 className="text-lg font-bold mb-3 flex items-center gap-2 text-[#2c5281]">
                    <span className="material-symbols-outlined">verified</span>
                    Data Provenance
                  </h3>
                  <div className="bg-white rounded-xl border border-[#2c5281]/10 overflow-hidden">
                    {/* Completeness Score */}
                    <div className="p-4 border-b border-[#2c5281]/10">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Case Completeness</span>
                        <span className={`text-lg font-bold ${
                          caseData.provenance.completeness_score >= 80 ? "text-emerald-600"
                            : caseData.provenance.completeness_score >= 50 ? "text-amber-600"
                            : "text-red-600"
                        }`}>
                          {caseData.provenance.completeness_score}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2 mb-3">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            caseData.provenance.completeness_score >= 80 ? "bg-emerald-500"
                              : caseData.provenance.completeness_score >= 50 ? "bg-amber-500"
                              : "bg-red-500"
                          }`}
                          style={{ width: `${caseData.provenance.completeness_score}%` }}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        {Object.entries(caseData.provenance.completeness_detail).map(([key, ok]) => (
                          <div key={key} className="flex items-center gap-1.5 text-xs">
                            <span className={`material-symbols-outlined text-xs ${ok ? "text-emerald-500" : "text-red-400"}`}>
                              {ok ? "check_circle" : "cancel"}
                            </span>
                            <span className={ok ? "text-slate-600" : "text-red-500 font-medium"}>
                              {key.replace(/_/g, " ")}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Source */}
                    <div className="p-4 border-b border-[#2c5281]/10">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Source</p>
                      <p className="text-sm font-semibold text-slate-900">{caseData.provenance.source}</p>
                      <p className="text-xs text-slate-500">{caseData.provenance.institution}</p>
                      <p className="text-xs text-slate-400 mt-0.5">Maintained by {caseData.provenance.maintained_by}</p>
                    </div>

                    {/* What is real vs AI */}
                    <div className="p-4 border-b border-[#2c5281]/10">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Raw EHR Data</p>
                      {caseData.provenance.raw_ehr_fields.map((f) => (
                        <div key={f} className="flex items-start gap-1.5 text-xs text-slate-600 mb-1">
                          <span className="material-symbols-outlined text-emerald-500 text-xs mt-0.5 shrink-0">database</span>
                          {f}
                        </div>
                      ))}
                    </div>
                    <div className="p-4 border-b border-[#2c5281]/10">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">AI / Algorithmic</p>
                      {caseData.provenance.ai_generated_fields.map((f) => (
                        <div key={f} className="flex items-start gap-1.5 text-xs text-slate-600 mb-1">
                          <span className="material-symbols-outlined text-[#2c5281] text-xs mt-0.5 shrink-0">smart_toy</span>
                          {f}
                        </div>
                      ))}
                    </div>

                    {/* Clinician Note */}
                    <div className="p-4 bg-slate-50">
                      <div className="flex items-start gap-2">
                        <span className="material-symbols-outlined text-amber-600 text-sm mt-0.5 shrink-0">info</span>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          {caseData.provenance.clinician_review_note}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* Similar Patients */}
              <section>
                <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#2c5281]">groups</span>
                  Similar Patients
                </h3>
                <div className="space-y-3">
                  {caseData.similar_patients.map((sp) => (
                    <Link href={`/case/${sp.case_id}`} key={sp.case_id}>
                      <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-[#2c5281]/10 hover:border-[#2c5281]/30 transition-all cursor-pointer mb-3">
                        <div className="size-10 rounded-full bg-[#2c5281]/20 flex items-center justify-center font-bold text-[#2c5281] text-xs">
                          {Math.round(sp.final_score * 100)}%
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold">{sp.case_id}</p>
                          <p className="text-xs text-slate-500 truncate">
                            {sp.age}y {sp.gender}, {sp.admission_diagnosis}
                          </p>
                          {sp.shared_diagnoses.length > 0 && (
                            <p className="text-xs text-slate-400 mt-0.5 truncate">
                              Shared: {sp.shared_diagnoses.slice(0, 2).join(", ")}
                            </p>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            </div>
          </div>
        ) : (
          /* Teaching Session Tab */
          <div className="flex flex-col h-[calc(100vh-280px)]">
            {stage === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <span className="material-symbols-outlined text-[#2c5281]/20 text-7xl">school</span>
                  <p className="text-slate-500 mt-4 mb-6">
                    Start an interactive teaching session to learn from this case.
                  </p>
                  <button
                    onClick={startSession}
                    className="bg-[#2c5281] text-white px-8 py-3 rounded-xl font-bold hover:bg-[#2c5281]/90 transition shadow-sm"
                  >
                    Begin Case Study
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Stage Progress */}
                <div className="mb-4">
                  <div className="flex justify-between items-center px-4 py-2 bg-[#2c5281]/5 rounded-full overflow-hidden">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <div
                        key={s}
                        className={`flex-1 h-2 rounded-full mx-1 transition-colors ${
                          s <= stage ? "bg-[#2c5281]" : "bg-[#2c5281]/20"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-center text-xs font-bold text-[#2c5281] uppercase tracking-widest mt-2">
                    {STAGE_LABELS[stage] || ""}
                  </p>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto space-y-4 pb-4">
                  {messages.map((msg, i) => (
                    <div key={i}>
                      {msg.stage && (
                        <div className="text-xs text-center text-slate-400 mb-2">
                          &mdash; {STAGE_LABELS[msg.stage]} &mdash;
                        </div>
                      )}
                      {msg.role === "tutor" ? (
                        <div className="flex gap-3 max-w-[85%]">
                          <div className="size-8 rounded-full bg-[#2c5281] flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-white text-sm">smart_toy</span>
                          </div>
                          <div className="bg-white p-4 rounded-2xl rounded-tl-none border border-[#2c5281]/10 shadow-sm">
                            <div className="chat-content text-sm">
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      ) : msg.role === "hint" ? (
                        <div className="flex gap-3 max-w-[85%]">
                          <div className="size-8 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-white text-sm">lightbulb</span>
                          </div>
                          <div className="bg-amber-50 p-4 rounded-2xl rounded-tl-none border border-amber-200 shadow-sm">
                            <p className="text-xs font-bold text-amber-700 mb-1 uppercase tracking-wider">
                              Hint (Level {hintLevel}/3)
                            </p>
                            <div className="chat-content text-sm text-amber-900">
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      ) : msg.role === "review" ? (
                        <div className="flex gap-3 max-w-[95%]">
                          <div className="size-8 rounded-full bg-emerald-600 flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-white text-sm">summarize</span>
                          </div>
                          <div className="bg-emerald-50 p-4 rounded-2xl rounded-tl-none border border-emerald-200 shadow-sm flex-1">
                            <p className="text-xs font-bold text-emerald-700 mb-2 uppercase tracking-wider">
                              Case Review
                            </p>
                            <div className="chat-content text-sm text-emerald-900">
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-3 max-w-[85%] ml-auto flex-row-reverse">
                          <div className="size-8 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-slate-600 text-sm">person</span>
                          </div>
                          <div className="bg-[#2c5281] text-white p-4 rounded-2xl rounded-tr-none shadow-sm">
                            <div className="text-sm whitespace-pre-wrap chat-content [&_strong]:text-white">
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {loading && (
                    <div className="flex gap-3 max-w-[85%]">
                      <div className="size-8 rounded-full bg-[#2c5281] flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-white text-sm">smart_toy</span>
                      </div>
                      <div className="bg-white p-4 rounded-2xl rounded-tl-none border border-[#2c5281]/10 shadow-sm">
                        <div className="flex gap-1">
                          <div className="w-2 h-2 bg-[#2c5281]/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <div className="w-2 h-2 bg-[#2c5281]/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <div className="w-2 h-2 bg-[#2c5281]/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Case Review + Debrief Buttons (after Stage 4) */}
                {stage >= 4 && (!reviewData || !debriefData) && (
                  <div className="pb-3 flex justify-center gap-3">
                    {!reviewData && (
                      <button
                        onClick={async () => {
                          setReviewLoading(true);
                          setMessages((prev) => [
                            ...prev,
                            { role: "review" as const, content: "Generating comprehensive case review..." },
                          ]);
                          const res = await fetch(`${API}/api/review`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ case_id: caseId, session_id: sessionId }),
                          });
                          const data = await res.json();
                          setReviewData(data.review);
                          setMessages((prev) => {
                            const updated = [...prev];
                            updated[updated.length - 1] = { role: "review", content: data.review };
                            return updated;
                          });
                          setReviewLoading(false);
                        }}
                        disabled={reviewLoading}
                        className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-lg">summarize</span>
                        {reviewLoading ? "Generating..." : "Case Review"}
                      </button>
                    )}
                    {!debriefData && (
                      <button
                        onClick={async () => {
                          setDebriefLoading(true);
                          const res = await fetch(`${API}/api/debrief`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              case_id: caseId,
                              session_id: sessionId,
                              student_answers: studentAnswers,
                            }),
                          });
                          const data = await res.json();
                          setDebriefData(data.debrief);
                          // Track learning progress
                          if (caseData && data.debrief && !data.debrief.error) {
                            saveToLearningProfile({
                              case_id: caseData.case_id,
                              admission_diagnosis: caseData.admission_diagnosis,
                              specialty: caseData.educational_framing?.specialty || "General",
                              difficulty: caseData.educational_framing?.difficulty || "Intern",
                              score: data.debrief.overall_score ?? null,
                              stages_completed: stage,
                              debrief: data.debrief,
                            });
                          }
                          setDebriefLoading(false);
                        }}
                        disabled={debriefLoading}
                        className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-xl font-bold hover:bg-violet-700 transition-colors disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-lg">analytics</span>
                        {debriefLoading ? "Analyzing..." : "Case Debrief"}
                      </button>
                    )}
                  </div>
                )}

                {/* Debrief Error Fallback */}
                {debriefData?.error && (
                  <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4">
                    <p className="text-sm font-bold text-red-700 mb-2">Debrief generation failed — showing raw response:</p>
                    <pre className="text-xs text-slate-600 whitespace-pre-wrap max-h-[300px] overflow-y-auto">{debriefData.raw}</pre>
                  </div>
                )}

                {/* Structured Debrief Panel */}
                {debriefData && !debriefData.error && (
                  <div ref={debriefRef} className="mb-4 bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-200 rounded-2xl">
                    {/* Debrief Header with Score */}
                    <div className="p-5 border-b border-violet-200 flex items-center justify-between rounded-t-2xl">
                      <div className="flex items-center gap-3">
                        <div className="size-12 rounded-full bg-violet-600 flex items-center justify-center">
                          <span className="material-symbols-outlined text-white text-2xl">analytics</span>
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-900 text-lg">Case Debrief</h3>
                          <p className="text-xs text-slate-500">Your performance analysis</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <button
                          onClick={downloadDebriefPdf}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-violet-700 bg-white border border-violet-200 rounded-lg hover:bg-violet-100 transition-colors"
                          title="Download as PDF"
                        >
                          <span className="material-symbols-outlined text-sm">download</span>
                          PDF
                        </button>
                        <div className="text-right">
                          <div className="text-3xl font-black text-violet-700">{debriefData.overall_score}/10</div>
                          <div className={`text-xs font-bold px-2 py-0.5 rounded-full inline-block ${
                            debriefData.score_label === "Expert" || debriefData.score_label === "Proficient"
                              ? "bg-emerald-100 text-emerald-800"
                              : debriefData.score_label === "Competent"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-amber-100 text-amber-800"
                          }`}>{debriefData.score_label}</div>
                        </div>
                      </div>
                    </div>

                    {/* Expert Reasoning Path */}
                    {debriefData.expert_path && (
                      <div className="p-4 border-b border-violet-100">
                        <h4 className="text-xs font-bold text-violet-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm">route</span>
                          Expert Reasoning Path
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {[
                            { label: "Presentation Focus", value: debriefData.expert_path.presentation_focus, icon: "visibility" },
                            { label: "Key Pivot Point", value: debriefData.expert_path.key_pivot, icon: "turn_right" },
                            { label: "Optimal Workup", value: debriefData.expert_path.optimal_workup, icon: "biotech" },
                            { label: "Optimal Management", value: debriefData.expert_path.optimal_management, icon: "medication" },
                          ].filter((item) => item.value).map((item) => (
                            <div key={item.label} className="bg-white/70 rounded-xl p-4 border border-violet-100">
                              <div className="flex items-center gap-1.5 mb-2">
                                <span className="material-symbols-outlined text-violet-500 text-base">{item.icon}</span>
                                <span className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">{item.label}</span>
                              </div>
                              <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{item.value}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Stage-by-Stage Comparison */}
                    {debriefData.student_vs_expert && (
                      <div className="p-4 border-b border-violet-100">
                        <h4 className="text-xs font-bold text-violet-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm">compare_arrows</span>
                          Your Path vs Expert Path
                        </h4>
                        <div className="space-y-3">
                          {debriefData.student_vs_expert.map((comp: any, i: number) => (
                            <div key={i} className="bg-white/70 rounded-lg border border-violet-100">
                              <div className="flex items-center justify-between px-3 py-2 bg-violet-100/50">
                                <span className="text-xs font-bold text-slate-700">{comp.stage}</span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  comp.alignment === "Aligned"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : comp.alignment === "Partially Aligned"
                                    ? "bg-blue-100 text-blue-800"
                                    : comp.alignment === "Diverged"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-red-100 text-red-800"
                                }`}>{comp.alignment}</span>
                              </div>
                              <div className="p-3 grid grid-cols-2 gap-3">
                                <div>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">You said</p>
                                  <p className="text-xs text-slate-600">{comp.student_did}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-bold text-violet-500 uppercase mb-1">Expert would</p>
                                  <p className="text-xs text-slate-700">{comp.expert_would}</p>
                                </div>
                              </div>
                              <div className="px-3 pb-3">
                                <p className="text-xs text-slate-600 italic bg-slate-50 rounded p-2">{comp.comment}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Red Flags + Unnecessary Actions Row */}
                    <div className="p-4 border-b border-violet-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Missed Red Flags */}
                      <div>
                        <h4 className="text-xs font-bold text-red-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm">flag</span>
                          Missed Red Flags
                        </h4>
                        {debriefData.missed_red_flags?.length > 0 ? (
                          <ul className="space-y-1.5">
                            {debriefData.missed_red_flags.map((flag: string, i: number) => (
                              <li key={i} className="flex items-start gap-1.5 text-xs text-red-700 bg-red-50 rounded-lg p-2 border border-red-100">
                                <span className="material-symbols-outlined text-xs mt-0.5 shrink-0">warning</span>
                                {flag}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-emerald-600 bg-emerald-50 rounded-lg p-2 border border-emerald-100 flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-sm">check_circle</span>
                            No critical red flags missed
                          </p>
                        )}
                      </div>

                      {/* Unnecessary Actions */}
                      <div>
                        <h4 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm">block</span>
                          Unnecessary Actions
                        </h4>
                        {debriefData.unnecessary_actions?.length > 0 ? (
                          <ul className="space-y-1.5">
                            {debriefData.unnecessary_actions.map((action: string, i: number) => (
                              <li key={i} className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 rounded-lg p-2 border border-amber-100">
                                <span className="material-symbols-outlined text-xs mt-0.5 shrink-0">do_not_disturb</span>
                                {action}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-emerald-600 bg-emerald-50 rounded-lg p-2 border border-emerald-100 flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-sm">check_circle</span>
                            All actions were appropriate
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Management Timing */}
                    {debriefData.management_timing && (
                      <div className="p-4 border-b border-violet-100">
                        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm">schedule</span>
                          Management Timing
                        </h4>
                        <div className={`rounded-lg p-3 text-xs flex items-start gap-2 ${
                          debriefData.management_timing.delayed
                            ? "bg-red-50 border border-red-100 text-red-700"
                            : "bg-emerald-50 border border-emerald-100 text-emerald-700"
                        }`}>
                          <span className="material-symbols-outlined text-sm mt-0.5">
                            {debriefData.management_timing.delayed ? "timer_off" : "timer"}
                          </span>
                          {debriefData.management_timing.details}
                        </div>
                      </div>
                    )}

                    {/* Key Takeaways */}
                    {debriefData.takeaways && (
                      <div className="p-4">
                        <h4 className="text-xs font-bold text-violet-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm">school</span>
                          Key Takeaways
                        </h4>
                        <ol className="space-y-2">
                          {debriefData.takeaways.map((t: string, i: number) => (
                            <li key={i} className="flex items-start gap-2.5 text-xs text-slate-700 bg-white/70 rounded-lg p-3 border border-violet-100">
                              <span className="size-5 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0">{i + 1}</span>
                              {t}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>
                )}

                  <div ref={chatEndRef} />
                </div>

                {/* Collapsible Evidence Panel */}
                {showEvidence && caseData && (
                  <div className="mb-3 bg-white border border-[#2c5281]/15 rounded-xl shadow-sm overflow-hidden max-h-[300px] overflow-y-auto">
                    <div className="sticky top-0 bg-[#2c5281]/5 px-4 py-2 flex items-center justify-between border-b border-[#2c5281]/10 z-10">
                      <span className="text-xs font-bold text-[#2c5281] uppercase tracking-wider flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-sm">folder_open</span>
                        Quick Reference
                      </span>
                      <button onClick={() => setShowEvidence(false)} className="text-slate-400 hover:text-slate-600">
                        <span className="material-symbols-outlined text-sm">close</span>
                      </button>
                    </div>
                    <div className="p-3 space-y-3">
                      {/* Patient Summary */}
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Patient</p>
                        <p className="text-xs text-slate-700">
                          {caseData.age}y {caseData.gender} — {caseData.admission_diagnosis}
                        </p>
                      </div>
                      {/* Abnormal Labs */}
                      {Object.entries(caseData.key_labs).filter(([, l]) => l.status !== "normal").length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-1">
                            Abnormal Labs ({Object.entries(caseData.key_labs).filter(([, l]) => l.status !== "normal").length})
                          </p>
                          <div className="grid grid-cols-2 gap-1">
                            {Object.entries(caseData.key_labs)
                              .filter(([, l]) => l.status !== "normal")
                              .slice(0, 12)
                              .map(([name, lab]) => (
                                <div key={name} className={`text-[11px] px-2 py-1 rounded flex justify-between ${
                                  lab.status === "high" ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"
                                }`}>
                                  <span className="font-medium truncate">{name}</span>
                                  <span className="font-mono font-bold ml-1">{lab.value} {lab.status === "high" ? "\u2191" : "\u2193"}</span>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                      {/* Diagnoses */}
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                          Diagnoses ({caseData.diagnoses.length})
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {caseData.diagnoses.slice(0, 6).map((d, i) => (
                            <span key={i} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                              {d.title.length > 30 ? d.title.slice(0, 30) + "..." : d.title}
                            </span>
                          ))}
                          {caseData.diagnoses.length > 6 && (
                            <span className="text-[10px] text-slate-400">+{caseData.diagnoses.length - 6} more</span>
                          )}
                        </div>
                      </div>
                      {/* Medications */}
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                          Medications ({caseData.drugs.length})
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {caseData.drugs.slice(0, 8).map((drug) => (
                            <span key={drug} className="text-[10px] bg-[#2c5281]/10 text-[#2c5281] px-2 py-0.5 rounded">
                              {drug}
                            </span>
                          ))}
                          {caseData.drugs.length > 8 && (
                            <span className="text-[10px] text-slate-400">+{caseData.drugs.length - 8} more</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Input Area */}
                <div className="pt-4 border-t border-[#2c5281]/10">
                  {/* Hint + Template + Evidence Toggle Row */}
                  <div className="flex items-center gap-2 mb-2">
                    {stage >= 1 && stage < 5 && (
                      <button
                        onClick={requestHint}
                        disabled={hintLoading || hintLevel >= 3}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold border border-amber-300 text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-40"
                      >
                        <span className="material-symbols-outlined text-sm">lightbulb</span>
                        {hintLoading ? "..." : hintLevel >= 3 ? "No more hints" : `Hint (${hintLevel}/3)`}
                      </button>
                    )}
                    <button
                      onClick={() => setUseTemplate(!useTemplate)}
                      className={`flex items-center gap-1 px-3 py-1.5 text-xs font-semibold border rounded-lg transition-colors ${
                        useTemplate
                          ? "border-[#2c5281] text-[#2c5281] bg-[#2c5281]/10"
                          : "border-slate-300 text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm">assignment</span>
                      {useTemplate ? "Free Text" : "Structured Template"}
                    </button>
                    <button
                      onClick={() => setShowEvidence(!showEvidence)}
                      className={`flex items-center gap-1 px-3 py-1.5 text-xs font-semibold border rounded-lg transition-colors ml-auto ${
                        showEvidence
                          ? "border-teal-400 text-teal-700 bg-teal-50"
                          : "border-slate-300 text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm">folder_open</span>
                      Evidence
                    </button>
                  </div>

                  {useTemplate ? (
                    /* Structured Answer Template */
                    <div className="bg-white border border-[#2c5281]/20 rounded-2xl p-4 shadow-sm space-y-3">
                      <div>
                        <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Problem Statement</label>
                        <input
                          className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2c5281]/20 focus:border-[#2c5281] outline-none"
                          placeholder="What is the main clinical problem?"
                          value={templateData.problem}
                          onChange={(e) => setTemplateData({ ...templateData, problem: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Differential Diagnosis</label>
                        <textarea
                          className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2c5281]/20 focus:border-[#2c5281] outline-none resize-none"
                          rows={2}
                          placeholder="List your differentials (most likely first)"
                          value={templateData.differentials}
                          onChange={(e) => setTemplateData({ ...templateData, differentials: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Tests / Workup</label>
                        <textarea
                          className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2c5281]/20 focus:border-[#2c5281] outline-none resize-none"
                          rows={2}
                          placeholder="What labs, imaging, or tests would you order?"
                          value={templateData.tests}
                          onChange={(e) => setTemplateData({ ...templateData, tests: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Management Plan</label>
                        <textarea
                          className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2c5281]/20 focus:border-[#2c5281] outline-none resize-none"
                          rows={2}
                          placeholder="Initial management steps and medications"
                          value={templateData.management}
                          onChange={(e) => setTemplateData({ ...templateData, management: e.target.value })}
                        />
                      </div>
                      <button
                        onClick={sendMessage}
                        disabled={loading || (!templateData.problem.trim() && !templateData.differentials.trim() && !templateData.tests.trim() && !templateData.management.trim())}
                        className="w-full bg-[#2c5281] text-white py-2.5 rounded-xl font-bold hover:bg-[#2c5281]/90 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
                      >
                        <span className="material-symbols-outlined text-lg">send</span>
                        Submit Answer
                      </button>
                    </div>
                  ) : (
                    /* Free Text Input */
                    <div className="bg-white border border-[#2c5281]/20 rounded-2xl p-2 shadow-sm flex items-center gap-2">
                      <input
                        className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none text-sm py-2 px-3"
                        placeholder={
                          stage >= 5
                            ? "Ask anything about this case..."
                            : stage === 1
                            ? "Enter your differential diagnosis..."
                            : stage === 2
                            ? "What labs would you order and why?"
                            : stage === 3
                            ? "What's your treatment plan?"
                            : "Type your response..."
                        }
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                        disabled={loading}
                      />
                      <button
                        onClick={sendMessage}
                        disabled={loading || !input.trim()}
                        className="bg-[#2c5281] text-white size-10 rounded-xl flex items-center justify-center hover:bg-[#2c5281]/90 disabled:opacity-40 transition-colors"
                      >
                        <span className="material-symbols-outlined">send</span>
                      </button>
                    </div>
                  )}
                  <p className="text-xs text-slate-400 mt-2 text-center">
                    {stage < 4
                      ? `Stage ${stage}/4 — ${STAGE_LABELS[stage + 1]} next`
                      : stage === 4
                      ? "Last stage — Free Q&A next"
                      : "Free Q&A — ask anything about this case"}
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
