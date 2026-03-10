"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API = "http://localhost:8000";

interface Case {
  case_id: string;
  age: number;
  gender: string;
  admission_diagnosis: string;
  num_diagnoses: number;
  num_labs: number;
  num_drugs: number;
  specialty?: string;
  complexity?: string;
  case_focus?: string;
  difficulty?: string;
  primary_dx?: string;
  background?: string;
}

export default function Home() {
  const [cases, setCases] = useState<Case[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Case[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [filterGender, setFilterGender] = useState("");
  const [filterAgeMin, setFilterAgeMin] = useState("");
  const [filterAgeMax, setFilterAgeMax] = useState("");
  const [filterDiagnosis, setFilterDiagnosis] = useState("");
  const [filterSpecialty, setFilterSpecialty] = useState("");
  const [filterComplexity, setFilterComplexity] = useState("");
  const [filterCaseFocus, setFilterCaseFocus] = useState("");
  const [filterDrug, setFilterDrug] = useState("");
  const [filterActive, setFilterActive] = useState(false);
  const [filterOptions, setFilterOptions] = useState<{
    specialties: string[];
    complexities: string[];
    case_focus: string[];
  } | null>(null);
  const perPage = 15;
  const totalPages = Math.ceil(total / perPage);

  useEffect(() => {
    if (filterActive) return;
    fetch(`${API}/api/cases?page=${page}&per_page=${perPage}`)
      .then((r) => r.json())
      .then((data) => {
        setCases(data.cases);
        setTotal(data.total);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page, filterActive]);

  // Load filter options once
  useEffect(() => {
    fetch(`${API}/api/filters`)
      .then((r) => r.json())
      .then(setFilterOptions)
      .catch(() => {});
  }, []);

  const handleSearch = async () => {
    if (!search.trim()) {
      setSearchResults(null);
      return;
    }
    const res = await fetch(`${API}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: search, top_k: 12 }),
    });
    const data = await res.json();
    setSearchResults(data.results);
  };

  const applyFilters = async () => {
    setLoading(true);
    setSearchResults(null);
    const params = new URLSearchParams();
    if (filterGender) params.set("gender", filterGender);
    if (filterAgeMin) params.set("age_min", filterAgeMin);
    if (filterAgeMax) params.set("age_max", filterAgeMax);
    if (filterDiagnosis) params.set("diagnosis", filterDiagnosis);
    if (filterSpecialty) params.set("specialty", filterSpecialty);
    if (filterComplexity) params.set("complexity", filterComplexity);
    if (filterCaseFocus) params.set("case_focus", filterCaseFocus);
    if (filterDrug) params.set("drug", filterDrug);
    params.set("page", String(page));
    params.set("per_page", String(perPage));

    const res = await fetch(`${API}/api/cases/search?${params.toString()}`);
    const data = await res.json();
    setCases(data.cases);
    setTotal(data.total);
    setFilterActive(true);
    setLoading(false);
  };

  const clearFilters = () => {
    setFilterGender("");
    setFilterAgeMin("");
    setFilterAgeMax("");
    setFilterDiagnosis("");
    setFilterSpecialty("");
    setFilterComplexity("");
    setFilterCaseFocus("");
    setFilterDrug("");
    setFilterActive(false);
    setPage(1);
  };

  // Re-fetch when page changes with active filters
  useEffect(() => {
    if (filterActive) {
      applyFilters();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const displayCases = searchResults || cases;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-[#2c5281]/10 px-4 py-6 md:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-[#2c5281] text-4xl">clinical_notes</span>
              <h1 className="text-3xl font-bold tracking-tight text-[#2c5281]">Clinical Tutor</h1>
            </div>
            <p className="text-slate-500 mt-1 font-medium">AI-Powered Clinical Teaching Assistant</p>
          </div>
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-5 py-2.5 bg-[#2c5281] text-white rounded-xl font-bold hover:bg-[#2c5281]/90 transition-colors shadow-sm"
          >
            <span className="material-symbols-outlined text-lg">analytics</span>
            My Progress
          </Link>
        </div>
      </header>

      {/* Stats Bar */}
      <section className="px-4 py-6 md:px-8 bg-slate-50">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { icon: "folder_managed", label: "Total Cases", value: total.toLocaleString() },
            { icon: "hub", label: "KG Nodes", value: "6,446" },
            { icon: "account_tree", label: "KG Edges", value: "220,520" },
            { icon: "biotech", label: "Lab Records", value: "841K" },
            { icon: "pill", label: "Prescriptions", value: "153K" },
          ].map((stat) => (
            <div key={stat.label} className="bg-white p-4 rounded-xl border border-[#2c5281]/10 flex items-center gap-4 shadow-sm">
              <div className="p-3 bg-[#2c5281]/10 rounded-lg">
                <span className="material-symbols-outlined text-[#2c5281] text-2xl">{stat.icon}</span>
              </div>
              <div>
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider">{stat.label}</p>
                <p className="text-xl font-bold text-slate-900">{stat.value}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Main Content */}
      <main className="flex-grow px-4 py-8 md:px-8 max-w-7xl mx-auto w-full">
        {/* Search + Filters */}
        <div className="mb-8">
          <div className="relative group flex gap-3">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <span className="material-symbols-outlined text-slate-400 group-focus-within:text-[#2c5281]">search</span>
              </div>
              <input
                className="block w-full pl-12 pr-4 py-4 bg-white border-2 border-slate-200 rounded-xl focus:ring-4 focus:ring-[#2c5281]/20 focus:border-[#2c5281] transition-all outline-none text-base shadow-sm"
                placeholder="Search cases (e.g., elderly patient with sepsis and kidney failure)"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>
            <button
              onClick={handleSearch}
              className="bg-[#2c5281] text-white px-8 py-4 rounded-xl font-semibold hover:bg-[#2c5281]/90 transition-colors shadow-sm"
            >
              Search
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`border-2 px-4 py-4 rounded-xl font-semibold transition-colors flex items-center gap-2 ${
                showFilters || filterActive
                  ? "border-[#2c5281] text-[#2c5281] bg-[#2c5281]/5"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <span className="material-symbols-outlined text-lg">tune</span>
              Filters
              {filterActive && (
                <span className="size-2 bg-[#2c5281] rounded-full" />
              )}
            </button>
            {searchResults && (
              <button
                onClick={() => { setSearchResults(null); setSearch(""); }}
                className="border-2 border-slate-200 px-6 py-4 rounded-xl font-semibold hover:bg-slate-50 transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {/* Advanced Filters Panel */}
          {showFilters && (
            <div className="mt-4 bg-white rounded-xl border-2 border-slate-200 p-5 shadow-sm">
              {/* Row 1: Demographics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Gender</label>
                  <select
                    value={filterGender}
                    onChange={(e) => setFilterGender(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#2c5281]/20 focus:border-[#2c5281] outline-none"
                  >
                    <option value="">All</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Age Min</label>
                  <input
                    type="number"
                    value={filterAgeMin}
                    onChange={(e) => setFilterAgeMin(e.target.value)}
                    placeholder="0"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#2c5281]/20 focus:border-[#2c5281] outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Age Max</label>
                  <input
                    type="number"
                    value={filterAgeMax}
                    onChange={(e) => setFilterAgeMax(e.target.value)}
                    placeholder="200"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#2c5281]/20 focus:border-[#2c5281] outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Diagnosis</label>
                  <input
                    type="text"
                    value={filterDiagnosis}
                    onChange={(e) => setFilterDiagnosis(e.target.value)}
                    placeholder="e.g., pneumonia"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#2c5281]/20 focus:border-[#2c5281] outline-none"
                  />
                </div>
              </div>
              {/* Row 2: Clinical filters */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Specialty</label>
                  <select
                    value={filterSpecialty}
                    onChange={(e) => setFilterSpecialty(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#2c5281]/20 focus:border-[#2c5281] outline-none"
                  >
                    <option value="">All Specialties</option>
                    {filterOptions?.specialties.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Complexity</label>
                  <select
                    value={filterComplexity}
                    onChange={(e) => setFilterComplexity(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#2c5281]/20 focus:border-[#2c5281] outline-none"
                  >
                    <option value="">All</option>
                    {filterOptions?.complexities.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Case Focus</label>
                  <select
                    value={filterCaseFocus}
                    onChange={(e) => setFilterCaseFocus(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#2c5281]/20 focus:border-[#2c5281] outline-none"
                  >
                    <option value="">All</option>
                    {filterOptions?.case_focus.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Drug</label>
                  <input
                    type="text"
                    value={filterDrug}
                    onChange={(e) => setFilterDrug(e.target.value)}
                    placeholder="e.g., insulin"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#2c5281]/20 focus:border-[#2c5281] outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => { setPage(1); applyFilters(); }}
                  className="bg-[#2c5281] text-white px-6 py-2 rounded-lg font-semibold hover:bg-[#2c5281]/90 transition-colors text-sm"
                >
                  Apply Filters
                </button>
                {filterActive && (
                  <button
                    onClick={clearFilters}
                    className="border border-slate-200 px-6 py-2 rounded-lg font-semibold hover:bg-slate-50 transition-colors text-sm"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            </div>
          )}

          {searchResults && (
            <p className="text-sm text-slate-500 mt-3">
              Found {searchResults.length} matching cases for &quot;{search}&quot;
            </p>
          )}
          {filterActive && !searchResults && (
            <p className="text-sm text-slate-500 mt-3">
              Showing {total} filtered cases
              {filterGender && ` | Gender: ${filterGender}`}
              {filterAgeMin && ` | Age >= ${filterAgeMin}`}
              {filterAgeMax && ` | Age <= ${filterAgeMax}`}
              {filterDiagnosis && ` | Diagnosis: "${filterDiagnosis}"`}
              {filterSpecialty && ` | Specialty: ${filterSpecialty}`}
              {filterComplexity && ` | Complexity: ${filterComplexity}`}
              {filterCaseFocus && ` | Focus: ${filterCaseFocus}`}
              {filterDrug && ` | Drug: "${filterDrug}"`}
            </p>
          )}
        </div>

        {/* Case Cards Grid */}
        {loading ? (
          <div className="text-center py-20 text-slate-400">Loading cases...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayCases.map((c) => (
              <Link href={`/case/${c.case_id}`} key={c.case_id}>
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-lg transition-shadow flex flex-col h-full">
                  <div className="p-5 border-b border-slate-100 flex justify-between items-start">
                    <div>
                      <span className="text-xs font-bold text-[#2c5281] bg-[#2c5281]/10 px-2 py-1 rounded mb-2 inline-block">
                        {c.case_id}
                      </span>
                      <h3 className="text-base font-bold leading-tight line-clamp-2 mt-1">
                        {c.admission_diagnosis}
                      </h3>
                    </div>
                    <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ml-3">
                      {c.age}y / {c.gender}
                    </span>
                  </div>
                  <div className="p-5 flex-grow">
                    {/* Tags row */}
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {c.difficulty && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          c.difficulty === "ICU / Fellow" ? "bg-red-50 text-red-700 border-red-200"
                            : c.difficulty === "Resident" ? "bg-orange-50 text-orange-700 border-orange-200"
                            : c.difficulty === "Intern" ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}>
                          {c.difficulty}
                        </span>
                      )}
                      {c.specialty && c.specialty !== "General" && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {c.specialty}
                        </span>
                      )}
                      {c.complexity && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          c.complexity === "Complex" ? "bg-red-50 text-red-700 border-red-200"
                            : c.complexity === "Moderate" ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}>
                          {c.complexity}
                        </span>
                      )}
                    </div>
                    {/* Primary Dx learning focus */}
                    {c.primary_dx && c.primary_dx !== c.admission_diagnosis && (
                      <p className="text-[11px] text-slate-500 mb-3 line-clamp-1">
                        <span className="font-semibold text-slate-600">Focus:</span> {c.primary_dx}
                      </p>
                    )}
                    {c.background && (
                      <p className="text-[11px] text-slate-500 mb-3 line-clamp-2 leading-relaxed">
                        <span className="font-semibold text-slate-600">Background:</span> {c.background}
                      </p>
                    )}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center">
                        <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Dx</p>
                        <p className="text-sm font-bold">{c.num_diagnoses}</p>
                      </div>
                      <div className="text-center border-x border-slate-100">
                        <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Labs</p>
                        <p className="text-sm font-bold">{c.num_labs}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Drugs</p>
                        <p className="text-sm font-bold">{c.num_drugs}</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-5 py-4 bg-slate-50 mt-auto border-t border-slate-100">
                    <span className="block text-center py-2 bg-[#2c5281] text-white rounded-lg font-semibold hover:bg-[#2c5281]/90 transition-colors text-sm">
                      Review Case
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Pagination */}
        {!searchResults && totalPages > 1 && (
          <div className="mt-12 flex items-center justify-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center justify-center w-10 h-10 rounded-lg border border-slate-200 hover:bg-[#2c5281]/10 transition-colors disabled:opacity-30"
            >
              <span className="material-symbols-outlined text-sm">chevron_left</span>
            </button>
            {[...Array(Math.min(5, totalPages))].map((_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = page - 2 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-10 h-10 rounded-lg font-semibold text-sm ${
                    page === pageNum
                      ? "bg-[#2c5281] text-white"
                      : "border border-slate-200 hover:bg-[#2c5281]/10 transition-colors"
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            {totalPages > 5 && page < totalPages - 2 && (
              <>
                <span className="mx-1 text-slate-400">...</span>
                <button
                  onClick={() => setPage(totalPages)}
                  className="w-10 h-10 rounded-lg border border-slate-200 hover:bg-[#2c5281]/10 transition-colors font-semibold text-sm"
                >
                  {totalPages}
                </button>
              </>
            )}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center justify-center w-10 h-10 rounded-lg border border-slate-200 hover:bg-[#2c5281]/10 transition-colors disabled:opacity-30"
            >
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
