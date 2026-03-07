import os
from dotenv import load_dotenv
load_dotenv()

# API Configuration
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = "claude-haiku-4-5-20251001"  # Dev: haiku (cheap), Demo: switch to sonnet

# Dataset
REPO_ID = "bavehackathon/2026-healthcare-ai"
DATASET_FILES = [
    "clinical_cases.csv.gz",
    "diagnoses_subset.csv.gz",
    "diagnosis_dictionary.csv.gz",
    "labs_subset.csv.gz",
    "lab_dictionary.csv.gz",
    "prescriptions_subset.csv.gz",
]

# Embedding
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
CHROMA_COLLECTION = "clinical_cases"
CHROMA_DB_PATH = "./chroma_db"

# Clinical thresholds for data quality checks
LAB_CRITICAL_VALUES = {
    "Potassium": {"low": 3.0, "high": 6.0, "unit": "mEq/L"},
    "Sodium": {"low": 125, "high": 155, "unit": "mEq/L"},
    "Glucose": {"low": 40, "high": 400, "unit": "mg/dL"},
    "Creatinine": {"low": 0.5, "high": 4.0, "unit": "mg/dL"},
    "Hemoglobin": {"low": 7.0, "high": 18.0, "unit": "g/dL"},
    "Hematocrit": {"low": 21, "high": 54, "unit": "%"},
    "WBC": {"low": 2.0, "high": 20.0, "unit": "K/uL"},
    "Platelet Count": {"low": 50, "high": 500, "unit": "K/uL"},
    "INR(PT)": {"low": 0.8, "high": 3.5, "unit": ""},
    "pH": {"low": 7.25, "high": 7.55, "unit": ""},
    "pCO2": {"low": 25, "high": 55, "unit": "mmHg"},
    "Lactate": {"low": 0, "high": 2.0, "unit": "mmol/L"},
    "Troponin T": {"low": 0, "high": 0.04, "unit": "ng/mL"},
}
