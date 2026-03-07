"""
FastAPI Backend — Serves Clinical Tutor as REST API for Next.js frontend.
"""

import os
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from data_loader import DataLoader
from knowledge_graph import ClinicalKnowledgeGraph
from rag_engine import RAGEngine
from data_quality import DataQualityChecker
from reasoning import ClinicalReasoner
from config import ANTHROPIC_API_KEY

app = FastAPI(title="Clinical Tutor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
loader = None
kg = None
rag = None
checker = DataQualityChecker()
sessions: dict[str, ClinicalReasoner] = {}


@app.on_event("startup")
async def startup():
    global loader, kg, rag
    print("Initializing Clinical Tutor backend...")
    loader = DataLoader().load()
    kg = ClinicalKnowledgeGraph(loader).build()
    rag = RAGEngine(loader, kg).build()
    print("Backend ready.")


# --- Request/Response Models ---

class ChatRequest(BaseModel):
    case_id: str
    session_id: str
    stage: int  # 1-4 for teaching stages, 5 for free Q&A
    student_answer: str = ""


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5


# --- Endpoints ---

@app.get("/api/cases")
def list_cases(page: int = 1, per_page: int = 20):
    """List all available cases with summary stats."""
    all_patients = loader.get_all_patients()
    start = (page - 1) * per_page
    end = start + per_page
    cases = []
    for p in all_patients[start:end]:
        cases.append({
            "case_id": p.case_id,
            "age": p.age,
            "gender": p.gender,
            "admission_diagnosis": p.admission_diagnosis,
            "num_diagnoses": len(p.diagnoses),
            "num_labs": len(p.labs),
            "num_drugs": len(set(rx["drug"] for rx in p.prescriptions if rx.get("drug"))),
        })
    return {"cases": cases, "total": len(all_patients), "page": page}


@app.get("/api/case/{case_id}")
def get_case(case_id: str):
    """Get full case overview including KG and quality findings."""
    patient = loader.get_patient_by_case_id(case_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Case not found")

    # Similar patients
    similar_raw = rag.hybrid_search(patient, top_k=3)
    similar = []
    for s in similar_raw:
        sp = s["patient"]
        def safe_float(v):
            import math
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                return 0.0
            return round(v, 2)
        similar.append({
            "case_id": sp.case_id,
            "age": sp.age,
            "gender": sp.gender,
            "admission_diagnosis": sp.admission_diagnosis,
            "kg_score": safe_float(s["kg_score"]),
            "semantic_score": safe_float(s["semantic_score"]),
            "final_score": safe_float(s["final_score"]),
            "shared_diagnoses": s.get("shared_diagnoses", [])[:5],
            "shared_drugs": s.get("shared_drugs", [])[:5],
        })

    # Quality findings
    findings = checker.check(patient)
    quality = [
        {"type": f["type"], "severity": f["severity"], "message": f["message"]}
        for f in findings
    ]

    # Key labs (first occurrence of each)
    import math
    key_labs = {}
    for lab in patient.labs:
        name = lab.get("lab_name", "")
        val = lab.get("value", "")
        if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
            val = ""
        if name and name not in key_labs:
            key_labs[name] = {
                "value": str(val),
                "unit": str(lab.get("unit", "") or ""),
                "charttime": str(lab.get("charttime", "") or ""),
            }
        if len(key_labs) >= 25:
            break

    return {
        "case_id": patient.case_id,
        "age": patient.age,
        "gender": patient.gender,
        "admission_diagnosis": patient.admission_diagnosis,
        "diagnoses": [
            {"icd9_code": d["icd9_code"], "title": d["long_title"], "seq_num": d["seq_num"]}
            for d in patient.diagnoses
        ],
        "drugs": list(set(rx["drug"] for rx in patient.prescriptions if rx.get("drug"))),
        "key_labs": key_labs,
        "num_lab_records": len(patient.labs),
        "similar_patients": similar,
        "quality_findings": quality,
        "kg_stats": {
            "total_nodes": kg.graph.number_of_nodes(),
            "total_edges": kg.graph.number_of_edges(),
        },
    }


@app.post("/api/chat")
def chat(req: ChatRequest):
    """Progressive teaching chat endpoint."""
    patient = loader.get_patient_by_case_id(req.case_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Case not found")

    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    # Get or create session
    if req.session_id not in sessions:
        sessions[req.session_id] = ClinicalReasoner()

    reasoner = sessions[req.session_id]
    quality_findings = checker.check(patient)
    similar = rag.hybrid_search(patient, top_k=3)

    if req.stage == 1:
        reasoner.reset_conversation()
        response = reasoner.generate_case_introduction(patient)
    elif req.stage == 2:
        response = reasoner.evaluate_differential(patient, req.student_answer)
    elif req.stage == 3:
        response = reasoner.reveal_labs_and_teach(patient, req.student_answer, quality_findings)
    elif req.stage == 4:
        response = reasoner.reveal_treatment_and_compare(patient, req.student_answer, similar)
    elif req.stage == 5:
        response = reasoner.answer_question(patient, req.student_answer, quality_findings, similar)
    else:
        raise HTTPException(status_code=400, detail="Invalid stage (1-5)")

    return {
        "response": response,
        "stage": req.stage,
        "case_id": req.case_id,
    }


@app.post("/api/search")
def search(req: SearchRequest):
    """Search for similar cases by text query."""
    results = rag.search(req.query, top_k=req.top_k)
    return {
        "results": [
            {
                "case_id": r["patient"].case_id,
                "age": r["patient"].age,
                "gender": r["patient"].gender,
                "admission_diagnosis": r["patient"].admission_diagnosis,
                "score": round(r["semantic_score"], 3),
            }
            for r in results
        ]
    }


@app.delete("/api/session/{session_id}")
def delete_session(session_id: str):
    """Clear a teaching session."""
    if session_id in sessions:
        del sessions[session_id]
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
