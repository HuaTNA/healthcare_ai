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
}

export default function Home() {
  const [cases, setCases] = useState<Case[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Case[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/cases?page=${page}&per_page=20`)
      .then((r) => r.json())
      .then((data) => {
        setCases(data.cases);
        setTotal(data.total);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page]);

  const handleSearch = async () => {
    if (!search.trim()) {
      setSearchResults(null);
      return;
    }
    const res = await fetch(`${API}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: search, top_k: 10 }),
    });
    const data = await res.json();
    setSearchResults(data.results);
  };

  const displayCases = searchResults || cases;

  return (
    <div className="min-h-screen">
      <header className="bg-teal-700 text-white py-6 px-8">
        <h1 className="text-2xl font-bold">Clinical Tutor</h1>
        <p className="text-teal-100 mt-1">
          AI-Powered Clinical Teaching Assistant &mdash; 2,000 Real Patient Cases
        </p>
      </header>

      <div className="bg-white border-b px-8 py-3 flex gap-8 text-sm text-gray-600">
        <span><strong className="text-gray-900">{total}</strong> Cases</span>
        <span><strong className="text-gray-900">6,446</strong> KG Nodes</span>
        <span><strong className="text-gray-900">220,520</strong> KG Edges</span>
        <span><strong className="text-gray-900">841K</strong> Lab Records</span>
        <span><strong className="text-gray-900">153K</strong> Prescriptions</span>
      </div>

      <main className="max-w-7xl mx-auto px-8 py-6">
        <div className="mb-6 flex gap-3">
          <input
            type="text"
            placeholder="Search cases (e.g., 'elderly patient with sepsis and kidney failure')"
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <button
            onClick={handleSearch}
            className="bg-teal-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-teal-700 transition"
          >
            Search
          </button>
          {searchResults && (
            <button
              onClick={() => { setSearchResults(null); setSearch(""); }}
              className="border border-gray-300 px-4 py-2.5 rounded-lg text-sm hover:bg-gray-50"
            >
              Clear
            </button>
          )}
        </div>

        {searchResults && (
          <p className="text-sm text-gray-500 mb-4">
            Found {searchResults.length} matching cases for &quot;{search}&quot;
          </p>
        )}

        {loading ? (
          <div className="text-center py-20 text-gray-400">Loading cases...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayCases.map((c) => (
              <Link href={`/case/${c.case_id}`} key={c.case_id}>
                <div className="bg-white rounded-xl border border-gray-200 p-5 hover:border-teal-400 hover:shadow-md transition cursor-pointer">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-mono text-gray-400">{c.case_id}</span>
                    <span className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">
                      {c.age}{c.gender}
                    </span>
                  </div>
                  <h3 className="font-semibold text-sm mb-3 text-gray-800 leading-snug">
                    {c.admission_diagnosis}
                  </h3>
                  <div className="flex gap-4 text-xs text-gray-500">
                    <span>{c.num_diagnoses} Dx</span>
                    <span>{c.num_labs} Labs</span>
                    <span>{c.num_drugs} Drugs</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {!searchResults && (
          <div className="flex justify-center gap-3 mt-8">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 border rounded-lg text-sm disabled:opacity-30 hover:bg-gray-50"
            >
              Previous
            </button>
            <span className="px-4 py-2 text-sm text-gray-500">
              Page {page} of {Math.ceil(total / 20)}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= Math.ceil(total / 20)}
              className="px-4 py-2 border rounded-lg text-sm disabled:opacity-30 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
