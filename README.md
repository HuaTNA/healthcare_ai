# Clinical Tutor

AI-Powered Clinical Teaching Assistant built for the 2026 Healthcare AI Hackathon.

Uses real de-identified ICU patient data (MIMIC-III) to create interactive clinical reasoning exercises. A Claude-powered AI tutor guides students through progressive case disclosure, Socratic questioning, and evidence-based feedback.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Next.js UI  │────▶│  FastAPI API  │────▶│  Claude (Haiku)  │
│  :3000       │◀────│  :8000       │     │  Teaching Engine  │
└─────────────┘     └──────┬───────┘     └─────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Knowledge │ │   RAG    │ │  Data    │
        │  Graph   │ │  Engine  │ │ Quality  │
        │(NetworkX)│ │(ChromaDB)│ │ Checker  │
        └──────────┘ └──────────┘ └──────────┘
```

### Backend (Python)

| File | Purpose |
|------|---------|
| `api.py` | FastAPI REST API — case listing, detail, chat, search, filters |
| `data_loader.py` | Loads MIMIC-III subset from HuggingFace, builds `Patient` objects |
| `knowledge_graph.py` | Clinical knowledge graph (patients, diagnoses, drugs, labs) |
| `rag_engine.py` | Hybrid search: KG similarity + semantic embeddings (ChromaDB) |
| `reasoning.py` | Claude-powered 4-stage Socratic teaching engine |
| `data_quality.py` | Rule-based cross-validation (lab conflicts, allergy checks) |
| `config.py` | Environment config (API keys, model selection, thresholds) |

### Frontend (Next.js)

| Page | Purpose |
|------|---------|
| `/` | Case browser with search, filters, and stats |
| `/case/[id]` | Case detail: background, timeline, labs, teaching session |
| `/dashboard` | Student progress tracking |

## Features

### Case Complexity Scoring

Cases are classified as **Simple**, **Moderate**, or **Complex** using a multi-dimensional clinical scoring model:

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Multi-organ involvement | 3x | Distinct ICD-9 organ system chapters affected |
| Critical lab values | 4x | Labs significantly outside reference ranges |
| Diagnostic burden | 0.5x | Total number of diagnoses |
| Polypharmacy | 0.3x | Unique medications (capped at 30) |
| Monitoring intensity | 0.2x | Unique lab types ordered (capped at 20) |

### Patient Background Extraction

Discharge summaries are parsed to extract structured sections:
- Chief Complaint
- History of Present Illness (HPI)
- Past Medical History
- Allergies
- Social History
- Family History

### Teaching Session (4-Stage Progressive Disclosure)

1. **Presentation** — Demographics + chief complaint only; student builds differential
2. **Differential** — Evaluate student's reasoning; reveal physical exam / vitals
3. **Investigation** — Labs and imaging; guide toward diagnosis
4. **Management** — Treatment plan discussion with evidence-based feedback

### Other Features

- **Similar Patient Search** — Hybrid KG + semantic similarity matching
- **Clinical Timeline** — Chronological view of labs, medications, and events
- **Lab Trends** — Interactive charts with reference ranges
- **Data Quality** — Automated detection of lab conflicts, allergy contradictions
- **Data Provenance** — Full transparency on raw EHR vs AI-generated content

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- Anthropic API key

### Setup

```bash
# Clone
git clone <repo-url>
cd healthcare_ai

# Backend
pip install -r requirements.txt
cp .env.example .env  # Add your ANTHROPIC_API_KEY

# Frontend
cd frontend
npm install
cd ..
```

### Run

```bash
# Option 1: One-click (Windows)
start.bat          # Starts both servers, opens browser
stop.bat           # Stops all services

# Option 2: Manual
# Terminal 1 — Backend (takes ~45s to load data from HuggingFace)
python api.py

# Terminal 2 — Frontend
cd frontend && npm run dev
```

Open http://localhost:3000

## Data Source

**MIMIC-III Clinical Database v1.4** — Real de-identified ICU patient records from Beth Israel Deaconess Medical Center, maintained by MIT Lab for Computational Physiology.

- 2,000 clinical cases
- 23K+ diagnosis records
- 841K+ lab results
- 153K+ prescription records

All dates are shifted for de-identification. Hosted on HuggingFace (`bavehackathon/2026-healthcare-ai`).

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cases` | Paginated case list |
| GET | `/api/case/{id}` | Full case detail with background, labs, timeline |
| POST | `/api/chat` | Teaching session chat (progressive stages) |
| POST | `/api/search` | Semantic case search |
| GET | `/api/cases/search` | Filtered case search (gender, age, specialty, etc.) |
| GET | `/api/filters` | Available filter options |

## Tech Stack

- **Backend**: Python, FastAPI, NetworkX, ChromaDB, sentence-transformers
- **Frontend**: Next.js 16, React, TypeScript, Tailwind CSS
- **AI**: Claude (Haiku 4.5 for dev, Sonnet for demo)
- **Data**: HuggingFace Datasets, MIMIC-III subset
