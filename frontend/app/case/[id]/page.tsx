"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

const API = "http://localhost:8000";

interface CaseData {
  case_id: string;
  age: number;
  gender: string;
  admission_diagnosis: string;
  diagnoses: { icd9_code: string; title: string; seq_num: number }[];
  drugs: string[];
  key_labs: Record<string, { value: string; unit: string; charttime: string }>;
  num_lab_records: number;
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
}

interface Message {
  role: "tutor" | "student";
  content: string;
  stage?: number;
}

const STAGE_LABELS: Record<number, string> = {
  1: "Case Presentation",
  2: "Physical Examination",
  3: "Lab Results & Data Quality",
  4: "Treatment & Comparison",
  5: "Free Q&A",
};

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
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API}/api/case/${caseId}`)
      .then((r) => r.json())
      .then(setCaseData)
      .catch(console.error);
  }, [caseId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startSession = async () => {
    setActiveTab("chat");
    setStage(1);
    setLoading(true);
    const res = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ case_id: caseId, session_id: sessionId, stage: 1 }),
    });
    const data = await res.json();
    setMessages([{ role: "tutor", content: data.response, stage: 1 }]);
    setLoading(false);
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const studentMsg = input.trim();
    setInput("");

    const nextStage = stage < 4 ? stage + 1 : 5;
    setMessages((prev) => [...prev, { role: "student", content: studentMsg }]);
    setLoading(true);

    const res = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        case_id: caseId,
        session_id: sessionId,
        stage: nextStage,
        student_answer: studentMsg,
      }),
    });
    const data = await res.json();
    setStage(nextStage);
    setMessages((prev) => [
      ...prev,
      { role: "tutor", content: data.response, stage: nextStage },
    ]);
    setLoading(false);
  };

  if (!caseData) {
    return <div className="text-center py-20 text-gray-400">Loading case...</div>;
  }

  const severityColor: Record<string, string> = {
    critical: "bg-red-50 text-red-700 border-red-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    info: "bg-blue-50 text-blue-700 border-blue-200",
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-teal-700 text-white py-4 px-8 flex items-center justify-between">
        <div>
          <Link href="/" className="text-teal-200 text-sm hover:text-white">
            &larr; All Cases
          </Link>
          <h1 className="text-xl font-bold mt-1">
            {caseData.case_id}: {caseData.admission_diagnosis}
          </h1>
          <p className="text-teal-100 text-sm">
            {caseData.age}{caseData.gender} &middot;{" "}
            {caseData.diagnoses.length} Diagnoses &middot;{" "}
            {caseData.num_lab_records} Labs &middot;{" "}
            {caseData.drugs.length} Medications
          </p>
        </div>
        {stage === 0 && (
          <button
            onClick={startSession}
            className="bg-white text-teal-700 px-6 py-2.5 rounded-lg font-semibold hover:bg-teal-50 transition"
          >
            Start Teaching Session
          </button>
        )}
      </header>

      {/* Tabs */}
      <div className="bg-white border-b px-8 flex gap-1">
        <button
          onClick={() => setActiveTab("overview")}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
            activeTab === "overview"
              ? "border-teal-600 text-teal-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Case Overview
        </button>
        <button
          onClick={() => setActiveTab("chat")}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
            activeTab === "chat"
              ? "border-teal-600 text-teal-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Teaching Session
          {stage > 0 && (
            <span className="ml-2 text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full">
              Stage {Math.min(stage, 4)}/4
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "overview" ? (
          <div className="max-w-6xl mx-auto px-8 py-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Diagnoses */}
            <div className="bg-white rounded-xl border p-5">
              <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide mb-3">
                Diagnoses ({caseData.diagnoses.length})
              </h2>
              <div className="space-y-1.5">
                {caseData.diagnoses.map((d, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="text-gray-400 w-6 text-right shrink-0">
                      {d.seq_num}.
                    </span>
                    <span className="text-gray-700">{d.title}</span>
                    <span className="text-gray-400 text-xs">({d.icd9_code})</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Key Labs */}
            <div className="bg-white rounded-xl border p-5">
              <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide mb-3">
                Key Lab Results
              </h2>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                {Object.entries(caseData.key_labs)
                  .slice(0, 16)
                  .map(([name, lab]) => (
                    <div key={name} className="flex justify-between">
                      <span className="text-gray-600 truncate">{name}</span>
                      <span className="font-mono text-gray-800 ml-2">
                        {lab.value} {lab.unit}
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Medications */}
            <div className="bg-white rounded-xl border p-5">
              <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide mb-3">
                Medications ({caseData.drugs.length})
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {caseData.drugs.map((drug) => (
                  <span
                    key={drug}
                    className="bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded"
                  >
                    {drug}
                  </span>
                ))}
              </div>
            </div>

            {/* Similar Patients */}
            <div className="bg-white rounded-xl border p-5">
              <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide mb-3">
                Similar Patients (Knowledge Graph)
              </h2>
              <div className="space-y-3">
                {caseData.similar_patients.map((sp) => (
                  <div key={sp.case_id} className="border rounded-lg p-3">
                    <div className="flex justify-between items-start">
                      <Link
                        href={`/case/${sp.case_id}`}
                        className="font-medium text-sm text-teal-700 hover:underline"
                      >
                        {sp.case_id}
                      </Link>
                      <span className="text-xs bg-teal-50 text-teal-600 px-2 py-0.5 rounded-full">
                        Score: {sp.final_score}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      {sp.age}{sp.gender} &mdash; {sp.admission_diagnosis}
                    </p>
                    {sp.shared_diagnoses.length > 0 && (
                      <p className="text-xs text-gray-400 mt-1">
                        Shared Dx: {sp.shared_diagnoses.slice(0, 3).join(", ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Data Quality */}
            {caseData.quality_findings.length > 0 && (
              <div className="bg-white rounded-xl border p-5 lg:col-span-2">
                <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide mb-3">
                  Data Quality Findings
                </h2>
                <div className="space-y-2">
                  {caseData.quality_findings.map((f, i) => (
                    <div
                      key={i}
                      className={`text-sm p-3 rounded-lg border ${severityColor[f.severity] || "bg-gray-50"}`}
                    >
                      <span className="font-medium">[{f.type}]</span> {f.message}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Chat / Teaching Session */
          <div className="max-w-4xl mx-auto px-8 py-6 flex flex-col h-[calc(100vh-180px)]">
            {stage === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-gray-500 mb-4">
                    Start a teaching session to learn from this case.
                  </p>
                  <button
                    onClick={startSession}
                    className="bg-teal-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-teal-700 transition"
                  >
                    Begin Case Study
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Messages */}
                <div className="flex-1 overflow-y-auto space-y-4 pb-4">
                  {messages.map((msg, i) => (
                    <div key={i}>
                      {msg.stage && (
                        <div className="text-xs text-center text-gray-400 mb-2">
                          &mdash; {STAGE_LABELS[msg.stage]} &mdash;
                        </div>
                      )}
                      <div
                        className={`rounded-xl px-5 py-4 ${
                          msg.role === "tutor"
                            ? "bg-white border border-gray-200"
                            : "bg-teal-50 border border-teal-200 ml-12"
                        }`}
                      >
                        <div className="text-xs font-medium text-gray-400 mb-1.5">
                          {msg.role === "tutor" ? "Clinical Tutor" : "You"}
                        </div>
                        <div className="chat-content text-sm text-gray-800">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="bg-white border rounded-xl px-5 py-4">
                      <div className="text-xs font-medium text-gray-400 mb-1.5">
                        Clinical Tutor
                      </div>
                      <div className="text-sm text-gray-400 animate-pulse">
                        Thinking...
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Input */}
                <div className="border-t pt-4">
                  <div className="flex gap-3">
                    <input
                      type="text"
                      placeholder={
                        stage >= 4
                          ? "Ask any question about this case..."
                          : "Type your answer..."
                      }
                      className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                      disabled={loading}
                    />
                    <button
                      onClick={sendMessage}
                      disabled={loading || !input.trim()}
                      className="bg-teal-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-teal-700 transition disabled:opacity-40"
                    >
                      Send
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    {stage < 4
                      ? `Stage ${stage}/4 — ${STAGE_LABELS[stage + 1]} next`
                      : "Free Q&A — ask anything about this case"}
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
