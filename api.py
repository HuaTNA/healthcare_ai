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
from fastapi.responses import StreamingResponse
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


class HintRequest(BaseModel):
    case_id: str
    session_id: str
    stage: int
    hint_level: int = 1  # 1=gentle, 2=moderate, 3=strong


class ReviewRequest(BaseModel):
    case_id: str
    session_id: str


class DebriefRequest(BaseModel):
    case_id: str
    session_id: str
    student_answers: dict  # {"stage2": "...", "stage3": "...", "stage4": "..."}


def _difficulty_level(patient) -> str:
    """Compute difficulty from dx + drug count."""
    n_dx = len(patient.diagnoses)
    n_drugs = len(set(rx["drug"] for rx in patient.prescriptions if rx.get("drug")))
    score = n_dx + n_drugs
    if score <= 8:
        return "Clerkship"
    elif score <= 18:
        return "Intern"
    elif score <= 35:
        return "Resident"
    else:
        return "ICU / Fellow"


def _case_summary(p) -> dict:
    """Build a case card summary dict."""
    primary_dx = p.admission_diagnosis
    if p.diagnoses:
        for d in p.diagnoses:
            if d.get("long_title") and d["long_title"] != "Unknown":
                primary_dx = d["long_title"]
                break
    return {
        "case_id": p.case_id,
        "age": p.age,
        "gender": p.gender,
        "admission_diagnosis": p.admission_diagnosis,
        "num_diagnoses": len(p.diagnoses),
        "num_labs": len(p.labs),
        "num_drugs": len(set(rx["drug"] for rx in p.prescriptions if rx.get("drug"))),
        "specialty": _get_specialty(p),
        "complexity": _get_complexity(p),
        "case_focus": _get_case_focus(p),
        "difficulty": _difficulty_level(p),
        "primary_dx": primary_dx,
        "background": _get_brief_background(p),
    }


# --- Endpoints ---

@app.get("/api/cases")
def list_cases(page: int = 1, per_page: int = 20):
    """List all available cases with summary stats."""
    all_patients = loader.get_all_patients()
    start = (page - 1) * per_page
    end = start + per_page
    cases = []
    for p in all_patients[start:end]:
        cases.append(_case_summary(p))
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

    # Key labs (first occurrence of each) with reference ranges and grouping
    import math

    # Lab reference ranges (approximate normal ranges)
    LAB_RANGES = {
        "Glucose": (70, 100, "mg/dL"), "Potassium": (3.5, 5.0, "mEq/L"),
        "Sodium": (136, 145, "mEq/L"), "Chloride": (98, 106, "mEq/L"),
        "Bicarbonate": (22, 29, "mEq/L"), "BUN": (7, 20, "mg/dL"),
        "Creatinine": (0.6, 1.2, "mg/dL"), "Calcium": (8.5, 10.5, "mg/dL"),
        "Magnesium": (1.7, 2.2, "mg/dL"), "Phosphate": (2.5, 4.5, "mg/dL"),
        "Hemoglobin": (12.0, 17.5, "g/dL"), "Hematocrit": (36, 54, "%"),
        "WBC": (4.5, 11.0, "K/uL"), "Platelet Count": (150, 400, "K/uL"),
        "RBC": (4.0, 6.0, "m/uL"), "MCV": (80, 100, "fL"),
        "MCH": (27, 31, "pg"), "MCHC": (32, 36, "g/dL"),
        "RDW": (11.5, 14.5, "%"), "INR(PT)": (0.8, 1.1, ""),
        "PT": (11, 13.5, "sec"), "PTT": (25, 35, "sec"),
        "ALT": (7, 56, "IU/L"), "AST": (10, 40, "IU/L"),
        "Alkaline Phosphatase": (44, 147, "IU/L"), "Bilirubin": (0.1, 1.2, "mg/dL"),
        "Albumin": (3.5, 5.0, "g/dL"), "Total Protein": (6.0, 8.3, "g/dL"),
        "Lactate": (0.5, 2.0, "mmol/L"), "Troponin T": (0, 0.04, "ng/mL"),
        "CRP": (0, 1.0, "mg/dL"), "pH": (7.35, 7.45, ""),
        "pCO2": (35, 45, "mmHg"), "pO2": (80, 100, "mmHg"),
        "Base Excess": (-2, 2, "mEq/L"),
    }

    # Lab system grouping
    LAB_GROUPS = {
        "CBC": ["WBC", "RBC", "Hemoglobin", "Hematocrit", "Platelet Count", "MCV", "MCH", "MCHC", "RDW"],
        "BMP": ["Glucose", "Sodium", "Potassium", "Chloride", "Bicarbonate", "BUN", "Creatinine", "Calcium"],
        "Liver": ["ALT", "AST", "Alkaline Phosphatase", "Bilirubin", "Albumin", "Total Protein"],
        "Coagulation": ["INR(PT)", "PT", "PTT"],
        "Cardiac": ["Troponin T", "CRP", "Lactate"],
        "ABG": ["pH", "pCO2", "pO2", "Base Excess"],
        "Electrolytes": ["Magnesium", "Phosphate"],
    }
    group_lookup = {}
    for group, labs in LAB_GROUPS.items():
        for lab_name in labs:
            group_lookup[lab_name] = group

    key_labs = {}
    for lab in patient.labs:
        name = lab.get("lab_name", "")
        val = lab.get("value", "")
        if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
            val = ""
        if name and name not in key_labs:
            # Determine if abnormal
            status = "normal"
            numeric_val = None
            try:
                numeric_val = float(val)
            except (ValueError, TypeError):
                pass

            if numeric_val is not None and name in LAB_RANGES:
                low, high, _ = LAB_RANGES[name]
                if numeric_val < low:
                    status = "low"
                elif numeric_val > high:
                    status = "high"

            key_labs[name] = {
                "value": str(val),
                "unit": str(lab.get("unit", "") or ""),
                "charttime": str(lab.get("charttime", "") or ""),
                "status": status,
                "group": group_lookup.get(name, "Other"),
            }
        if len(key_labs) >= 50:
            break

    # Case completeness score
    completeness_checks = {
        "demographics": bool(patient.age and patient.gender),
        "admission_diagnosis": bool(patient.admission_diagnosis and patient.admission_diagnosis.strip()),
        "diagnoses": len(patient.diagnoses) >= 1,
        "lab_results": len(patient.labs) >= 5,
        "prescriptions": len(patient.prescriptions) >= 1,
        "discharge_summary": bool(patient.discharge_summary and len(patient.discharge_summary) > 100),
    }
    completeness_score = round(sum(completeness_checks.values()) / len(completeness_checks) * 100)

    # Data provenance breakdown: what is raw EHR vs AI-generated
    provenance = {
        "source": "MIMIC-III Clinical Database v1.4",
        "institution": "Beth Israel Deaconess Medical Center (Boston, MA)",
        "maintained_by": "MIT Lab for Computational Physiology",
        "patient_type": "Real de-identified ICU patients",
        "date_note": "All dates are shifted (offset by random interval per patient) for de-identification",
        "raw_ehr_fields": [
            "Demographics (age, gender)",
            "Admission diagnosis",
            "ICD-9 diagnosis codes",
            "Lab results (values, units, timestamps)",
            "Prescription records (drug names, dosages)",
            "Discharge summary (clinician-authored)",
        ],
        "ai_generated_fields": [
            "Teaching dialogue (Claude API — generated per session, never cached)",
            "Similar patient matching (KG + embedding similarity — algorithmic, not AI-generated)",
            "Data quality findings (rule-based cross-validation, not AI-generated)",
            "Lab abnormal flags (reference range comparison, not AI-generated)",
        ],
        "clinician_review_note": "MIMIC-III data was collected during routine clinical care and reviewed by the original treating physicians. This teaching tool does not substitute for clinician oversight.",
        "quality_issues_count": len(findings),
        "completeness_score": completeness_score,
        "completeness_detail": completeness_checks,
    }

    # --- Timeline: merge labs + meds into chronological events ---
    timeline_events = []
    for lab in patient.labs:
        ct = lab.get("charttime", "")
        if not ct or ct == "nan":
            continue
        name = lab.get("lab_name", "")
        val = lab.get("value", "")
        if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
            val = ""
        status = "normal"
        try:
            nv = float(val)
            if name in LAB_RANGES:
                lo, hi, _ = LAB_RANGES[name]
                status = "low" if nv < lo else ("high" if nv > hi else "normal")
        except (ValueError, TypeError):
            pass
        timeline_events.append({
            "type": "lab",
            "time": ct,
            "name": name,
            "value": str(val),
            "unit": str(lab.get("unit", "") or ""),
            "status": status,
            "group": group_lookup.get(name, "Other"),
        })
    for rx in patient.prescriptions:
        sd = rx.get("startdate", "")
        if sd and str(sd) != "nan":
            timeline_events.append({
                "type": "med_start",
                "time": str(sd),
                "name": rx.get("drug", ""),
                "dose": f"{rx.get('dose_value', '')} {rx.get('dose_unit', '')}".strip(),
                "route": str(rx.get("route", "") or ""),
            })
        ed = rx.get("enddate", "")
        if ed and str(ed) != "nan":
            timeline_events.append({
                "type": "med_end",
                "time": str(ed),
                "name": rx.get("drug", ""),
            })
    timeline_events.sort(key=lambda x: x["time"])

    # --- Lab Trends: all values for key labs (for sparklines) ---
    lab_trends: dict[str, list] = {}
    for lab in patient.labs:
        name = lab.get("lab_name", "")
        ct = lab.get("charttime", "")
        val = lab.get("value", "")
        if not name or not ct or ct == "nan":
            continue
        try:
            nv = float(val)
        except (ValueError, TypeError):
            continue
        if isinstance(nv, float) and (math.isnan(nv) or math.isinf(nv)):
            continue
        if name not in lab_trends:
            lab_trends[name] = []
        lab_trends[name].append({"time": ct, "value": round(nv, 2)})
    # Sort each trend by time and only keep labs with 2+ data points
    lab_trends = {
        k: sorted(v, key=lambda x: x["time"])
        for k, v in lab_trends.items()
        if len(v) >= 2
    }
    # Add reference ranges to trends
    lab_trend_meta = {}
    for name, points in lab_trends.items():
        meta = {"points": points}
        if name in LAB_RANGES:
            lo, hi, unit = LAB_RANGES[name]
            meta["ref_low"] = lo
            meta["ref_high"] = hi
            meta["unit"] = unit
        lab_trend_meta[name] = meta

    # --- Educational Framing ---
    specialty = _get_specialty(patient)
    complexity = _get_complexity(patient)

    # Difficulty level
    n_dx = len(patient.diagnoses)
    n_drugs = len(set(rx["drug"] for rx in patient.prescriptions if rx.get("drug")))
    n_critical = sum(1 for f in findings if f["severity"] == "critical")
    diff_score = n_dx + n_drugs + n_critical * 3
    if diff_score <= 8:
        difficulty = "Clerkship"
    elif diff_score <= 18:
        difficulty = "Intern"
    elif diff_score <= 35:
        difficulty = "Resident"
    else:
        difficulty = "ICU / Fellow"

    # Learning objectives from diagnoses + specialty
    learning_objectives = []
    primary_dx = patient.admission_diagnosis
    if patient.diagnoses:
        for d in patient.diagnoses:
            if d.get("long_title") and d["long_title"] != "Unknown":
                primary_dx = d["long_title"]
                break
    learning_objectives.append(f"Recognize the clinical presentation of {primary_dx}")
    if n_dx > 1:
        comorbidities = [d["long_title"] for d in patient.diagnoses[1:4]]
        learning_objectives.append(f"Manage comorbidities: {', '.join(comorbidities)}")
    abnormal_labs = [name for name, lab in key_labs.items() if lab["status"] != "normal"]
    if abnormal_labs:
        learning_objectives.append(f"Interpret key lab abnormalities ({', '.join(abnormal_labs[:4])})")
    if n_drugs > 3:
        learning_objectives.append("Evaluate polypharmacy and drug selection rationale")
    if n_critical > 0:
        learning_objectives.append("Identify and respond to critical values")

    # High-yield points
    high_yield = []
    if n_critical > 0:
        crit_msgs = [f["message"][:80] for f in findings if f["severity"] == "critical"]
        high_yield.append(f"Critical findings: {'; '.join(crit_msgs[:2])}")
    if n_dx > 3:
        high_yield.append(f"Multi-system disease with {n_dx} diagnoses — requires systematic approach")
    if any(f["type"] == "DRUG_DX_MISMATCH" for f in findings):
        high_yield.append("Drug-diagnosis mismatch detected — challenges clinical reasoning")

    # Common pitfalls
    pitfalls = []
    if any("troponin" in f["message"].lower() for f in findings):
        pitfalls.append("Missing cardiac workup when troponin is mentioned but not ordered")
    if any(f["type"] == "MISSING_DATA" for f in findings):
        pitfalls.append("Assuming normal when data is missing rather than ordering the test")
    if n_dx > 5:
        pitfalls.append("Anchoring on a single diagnosis and missing comorbidities")
    if any(d["long_title"].lower().find("septic") >= 0 for d in patient.diagnoses):
        pitfalls.append("Delayed recognition of sepsis — time to antibiotics matters")
    if not pitfalls:
        pitfalls.append("Over-reliance on a single lab value without clinical correlation")

    educational_framing = {
        "difficulty": difficulty,
        "specialty": specialty,
        "learning_objectives": learning_objectives,
        "high_yield": high_yield,
        "pitfalls": pitfalls,
    }

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
        "lab_trends": lab_trend_meta,
        "num_lab_records": len(patient.labs),
        "timeline": timeline_events,
        "similar_patients": similar,
        "quality_findings": quality,
        "provenance": provenance,
        "educational_framing": educational_framing,
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


@app.post("/api/chat/stream")
def chat_stream(req: ChatRequest):
    """Streaming version of the teaching chat — returns SSE."""
    patient = loader.get_patient_by_case_id(req.case_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Case not found")
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    if req.session_id not in sessions:
        sessions[req.session_id] = ClinicalReasoner()

    reasoner = sessions[req.session_id]
    quality_findings = checker.check(patient)
    similar = rag.hybrid_search(patient, top_k=3)

    def generate():
        import json
        for chunk in reasoner.stream_stage(
            patient, req.stage, req.student_answer, quality_findings, similar
        ):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


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


@app.post("/api/hint")
def hint(req: HintRequest):
    """Get a progressive hint for the current stage."""
    patient = loader.get_patient_by_case_id(req.case_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Case not found")
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    if req.session_id not in sessions:
        sessions[req.session_id] = ClinicalReasoner()

    reasoner = sessions[req.session_id]
    response = reasoner.generate_hint(patient, req.stage, req.hint_level)
    return {"hint": response, "hint_level": req.hint_level, "stage": req.stage}


@app.post("/api/review")
def review(req: ReviewRequest):
    """Generate end-of-case comprehensive review."""
    patient = loader.get_patient_by_case_id(req.case_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Case not found")
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    if req.session_id not in sessions:
        sessions[req.session_id] = ClinicalReasoner()

    reasoner = sessions[req.session_id]
    quality_findings = checker.check(patient)
    similar = rag.hybrid_search(patient, top_k=3)
    response = reasoner.generate_case_review(patient, quality_findings, similar)
    return {"review": response, "case_id": req.case_id}


@app.post("/api/debrief")
def debrief(req: DebriefRequest):
    """Generate structured case debrief comparing student vs expert path."""
    patient = loader.get_patient_by_case_id(req.case_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Case not found")
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    if req.session_id not in sessions:
        sessions[req.session_id] = ClinicalReasoner()

    reasoner = sessions[req.session_id]
    quality_findings = checker.check(patient)
    similar = rag.hybrid_search(patient, top_k=3)

    raw = reasoner.generate_structured_debrief(
        patient, req.student_answers, quality_findings, similar
    )

    import json
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        # Try to extract JSON from the response
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                parsed = json.loads(raw[start:end])
            except json.JSONDecodeError:
                parsed = {"error": "Failed to parse debrief", "raw": raw}
        else:
            parsed = {"error": "Failed to parse debrief", "raw": raw}

    return {"debrief": parsed, "case_id": req.case_id}


# ICD-9 code ranges → specialty mapping
ICD9_SPECIALTY = {
    "Cardiology": [("390", "459"), ("745", "747")],
    "Pulmonology": [("460", "519")],
    "Gastroenterology": [("520", "579")],
    "Nephrology": [("580", "629")],
    "Neurology": [("320", "389")],
    "Endocrinology": [("240", "279")],
    "Infectious Disease": [("001", "139")],
    "Oncology": [("140", "239")],
    "Hematology": [("280", "289")],
    "Orthopedics": [("710", "739"), ("800", "829")],
    "Psychiatry": [("290", "319")],
}


def _get_specialty(patient) -> str:
    """Infer primary specialty from the first ICD-9 code."""
    if not patient.diagnoses:
        return "General"
    code = patient.diagnoses[0].get("icd9_code", "")
    # Handle V-codes and E-codes
    if code.startswith("V"):
        return "General"
    if code.startswith("E"):
        return "General"
    try:
        code_num = code.split(".")[0].zfill(3)
    except (ValueError, AttributeError):
        return "General"
    for specialty, ranges in ICD9_SPECIALTY.items():
        for low, high in ranges:
            if low <= code_num <= high:
                return specialty
    return "General"


def _get_brief_background(patient) -> str:
    """Extract a brief background snippet (≤150 chars) from the discharge summary."""
    text = (patient.discharge_summary or "").strip()
    if not text:
        return ""
    # Try to find HPI / chief complaint / history of present illness section
    import re
    # Common MIMIC section headers
    for pattern in [
        r"(?i)history of present illness[:\s]*\n?(.*?)(?:\n\s*\n|\n[A-Z])",
        r"(?i)chief complaint[:\s]*\n?(.*?)(?:\n\s*\n|\n[A-Z])",
        r"(?i)hpi[:\s]*\n?(.*?)(?:\n\s*\n|\n[A-Z])",
        r"(?i)reason for.*?admission[:\s]*\n?(.*?)(?:\n\s*\n|\n[A-Z])",
    ]:
        m = re.search(pattern, text, re.DOTALL)
        if m:
            snippet = " ".join(m.group(1).split())  # collapse whitespace
            if len(snippet) > 20:
                return (snippet[:147] + "...") if len(snippet) > 150 else snippet
    # Fallback: first meaningful sentence from summary
    lines = [l.strip() for l in text.split("\n") if len(l.strip()) > 30]
    if lines:
        snippet = lines[0]
        return (snippet[:147] + "...") if len(snippet) > 150 else snippet
    return ""


def _get_complexity(patient) -> str:
    """Simple/Moderate/Complex based on diagnosis+drug count."""
    n_dx = len(patient.diagnoses)
    n_drugs = len(set(rx["drug"] for rx in patient.prescriptions if rx.get("drug")))
    score = n_dx + n_drugs
    if score <= 10:
        return "Simple"
    elif score <= 25:
        return "Moderate"
    else:
        return "Complex"


def _get_case_focus(patient) -> str:
    """Diagnosis-heavy vs Management-heavy based on drug-to-diagnosis ratio."""
    n_dx = max(len(patient.diagnoses), 1)
    n_drugs = len(set(rx["drug"] for rx in patient.prescriptions if rx.get("drug")))
    ratio = n_drugs / n_dx
    if ratio >= 2.0:
        return "Management-heavy"
    elif ratio <= 0.5:
        return "Diagnosis-heavy"
    else:
        return "Balanced"


@app.get("/api/filters")
def get_filter_options():
    """Return available filter options computed from the dataset."""
    all_patients = loader.get_all_patients()
    specialties = set()
    for p in all_patients:
        specialties.add(_get_specialty(p))
    return {
        "genders": ["M", "F"],
        "specialties": sorted(specialties),
        "complexities": ["Simple", "Moderate", "Complex"],
        "case_focus": ["Diagnosis-heavy", "Balanced", "Management-heavy"],
    }


@app.get("/api/cases/search")
def advanced_search(
    query: str = "",
    gender: str = "",
    age_min: int = 0,
    age_max: int = 200,
    diagnosis: str = "",
    specialty: str = "",
    complexity: str = "",
    case_focus: str = "",
    drug: str = "",
    page: int = 1,
    per_page: int = 15,
):
    """Advanced case search with multiple filter dimensions."""
    all_patients = loader.get_all_patients()
    filtered = []
    for p in all_patients:
        if gender and p.gender.upper() != gender.upper():
            continue
        if p.age < age_min or p.age > age_max:
            continue
        if diagnosis and diagnosis.lower() not in (p.admission_diagnosis or "").lower():
            if not any(diagnosis.lower() in d.get("long_title", "").lower() for d in p.diagnoses):
                continue
        if query and query.lower() not in (p.admission_diagnosis or "").lower():
            continue
        if specialty and _get_specialty(p) != specialty:
            continue
        if complexity and _get_complexity(p) != complexity:
            continue
        if case_focus and _get_case_focus(p) != case_focus:
            continue
        if drug and not any(drug.lower() in rx.get("drug", "").lower() for rx in p.prescriptions):
            continue
        filtered.append(p)

    start = (page - 1) * per_page
    end = start + per_page
    cases = [_case_summary(p) for p in filtered[start:end]]
    return {"cases": cases, "total": len(filtered), "page": page}


@app.delete("/api/session/{session_id}")
def delete_session(session_id: str):
    """Clear a teaching session."""
    if session_id in sessions:
        del sessions[session_id]
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
