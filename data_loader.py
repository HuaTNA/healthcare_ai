"""
Data Loader — Layer 1: Data Fusion
Loads 6 tables from HuggingFace, builds unified Patient objects keyed by hadm_id.
"""

from dataclasses import dataclass, field
from huggingface_hub import hf_hub_download
import pandas as pd
from config import REPO_ID, DATASET_FILES


@dataclass
class Patient:
    case_id: str
    subject_id: int
    hadm_id: int
    age: int
    gender: str
    admission_diagnosis: str
    discharge_summary: str
    diagnoses: list = field(default_factory=list)       # [{seq_num, icd9_code, short_title, long_title}]
    labs: list = field(default_factory=list)             # [{itemid, charttime, value, unit, lab_name, fluid, category}]
    prescriptions: list = field(default_factory=list)    # [{startdate, enddate, drug, dose_value, dose_unit, route}]

    def get_diagnosis_names(self) -> list[str]:
        return [d["long_title"] for d in self.diagnoses if "long_title" in d]

    def get_drug_names(self) -> list[str]:
        return list({p["drug"] for p in self.prescriptions if p.get("drug")})

    def get_lab_names(self) -> list[str]:
        return list({l["lab_name"] for l in self.labs if l.get("lab_name")})

    def get_labs_by_name(self, lab_name: str) -> list[dict]:
        return sorted(
            [l for l in self.labs if l.get("lab_name") == lab_name],
            key=lambda x: x.get("charttime", ""),
        )

    def summary_stats(self) -> dict:
        return {
            "case_id": self.case_id,
            "age": self.age,
            "gender": self.gender,
            "admission_diagnosis": self.admission_diagnosis,
            "num_diagnoses": len(self.diagnoses),
            "num_drugs": len(set(p["drug"] for p in self.prescriptions if p.get("drug"))),
            "num_lab_records": len(self.labs),
            "unique_lab_types": len(set(l.get("lab_name") for l in self.labs)),
        }


class DataLoader:
    def __init__(self):
        self.raw_tables: dict[str, pd.DataFrame] = {}
        self.patients: dict[int, Patient] = {}          # keyed by hadm_id
        self.case_id_map: dict[str, int] = {}           # case_id -> hadm_id
        self.diagnosis_dict: dict[str, dict] = {}       # icd9_code -> {short_title, long_title}
        self.lab_dict: dict[int, dict] = {}             # itemid -> {lab_name, fluid, category}

    def load(self) -> "DataLoader":
        print("Loading datasets from HuggingFace...")
        for f in DATASET_FILES:
            name = f.replace(".csv.gz", "")
            path = hf_hub_download(repo_id=REPO_ID, filename=f, repo_type="dataset")
            self.raw_tables[name] = pd.read_csv(path)
            print(f"  {name}: {self.raw_tables[name].shape}")

        self._build_dictionaries()
        self._build_patients()
        print(f"Built {len(self.patients)} patient objects.")
        return self

    def _build_dictionaries(self):
        # Diagnosis dictionary: icd9_code -> {short_title, long_title}
        dd = self.raw_tables["diagnosis_dictionary"]
        for _, row in dd.iterrows():
            self.diagnosis_dict[str(row["icd9_code"])] = {
                "short_title": row["short_title"],
                "long_title": row["long_title"],
            }

        # Lab dictionary: itemid -> {lab_name, fluid, category}
        ld = self.raw_tables["lab_dictionary"]
        for _, row in ld.iterrows():
            self.lab_dict[int(row["itemid"])] = {
                "lab_name": row["lab_name"],
                "fluid": row["fluid"],
                "category": row["category"],
            }

    def _build_patients(self):
        cc = self.raw_tables["clinical_cases"]
        diag = self.raw_tables["diagnoses_subset"]
        labs = self.raw_tables["labs_subset"]
        presc = self.raw_tables["prescriptions_subset"]

        # Index diagnoses, labs, prescriptions by hadm_id for fast lookup
        diag_grouped = diag.groupby("hadm_id")
        labs_grouped = labs.groupby("hadm_id")
        presc_grouped = presc.groupby("hadm_id")

        for _, row in cc.iterrows():
            hadm_id = int(row["hadm_id"]) if pd.notna(row["hadm_id"]) else None
            if hadm_id is None:
                continue

            patient = Patient(
                case_id=row["case_id"],
                subject_id=int(row["subject_id"]),
                hadm_id=hadm_id,
                age=int(row["age"]),
                gender=row["gender"],
                admission_diagnosis=row["admission_diagnosis"],
                discharge_summary=row["discharge_summary"],
            )

            # Attach diagnoses
            if hadm_id in diag_grouped.groups:
                for _, d in diag_grouped.get_group(hadm_id).iterrows():
                    code = str(d["icd9_code"])
                    info = self.diagnosis_dict.get(code, {})
                    patient.diagnoses.append({
                        "seq_num": d["seq_num"],
                        "icd9_code": code,
                        "short_title": info.get("short_title", "Unknown"),
                        "long_title": info.get("long_title", "Unknown"),
                    })

            # Attach labs
            if hadm_id in labs_grouped.groups:
                for _, l in labs_grouped.get_group(hadm_id).iterrows():
                    itemid = int(l["itemid"])
                    info = self.lab_dict.get(itemid, {})
                    val = l["value"]
                    if pd.isna(val):
                        val = ""
                    patient.labs.append({
                        "itemid": itemid,
                        "charttime": str(l["charttime"]) if pd.notna(l["charttime"]) else "",
                        "value": str(val),
                        "unit": str(l["unit"]) if pd.notna(l["unit"]) else "",
                        "lab_name": info.get("lab_name", "Unknown"),
                        "fluid": info.get("fluid", "Unknown"),
                        "category": info.get("category", "Unknown"),
                    })

            # Attach prescriptions
            if hadm_id in presc_grouped.groups:
                for _, p in presc_grouped.get_group(hadm_id).iterrows():
                    patient.prescriptions.append({
                        "startdate": p["startdate"] if pd.notna(p["startdate"]) else "",
                        "enddate": p["enddate"] if pd.notna(p["enddate"]) else "",
                        "drug": p["drug"],
                        "dose_value": p["dose_value"] if pd.notna(p["dose_value"]) else "",
                        "dose_unit": p["dose_unit"] if pd.notna(p["dose_unit"]) else "",
                        "route": p["route"] if pd.notna(p["route"]) else "",
                    })

            self.patients[hadm_id] = patient
            self.case_id_map[patient.case_id] = hadm_id

    def get_patient_by_case_id(self, case_id: str) -> Patient | None:
        hadm_id = self.case_id_map.get(case_id)
        return self.patients.get(hadm_id) if hadm_id else None

    def get_all_patients(self) -> list[Patient]:
        return list(self.patients.values())


if __name__ == "__main__":
    loader = DataLoader().load()
    p = loader.get_patient_by_case_id("CASE_00001")
    if p:
        print(f"\n{p.case_id}: {p.age}{p.gender}, {p.admission_diagnosis}")
        print(f"  Diagnoses: {len(p.diagnoses)}")
        print(f"  Labs: {len(p.labs)}")
        print(f"  Prescriptions: {len(p.prescriptions)}")
        stats = p.summary_stats()
        print(f"  Stats: {stats}")
