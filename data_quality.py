"""
Data Quality — Layer 4: Completeness & Consistency Checks
Detects missing data, contradictions between structured and unstructured data,
and flags clinically significant anomalies.
"""

import re
from data_loader import Patient
from config import LAB_CRITICAL_VALUES


class DataQualityChecker:
    """Checks a single patient's data for quality issues."""

    def check(self, patient: Patient) -> list[dict]:
        """Run all checks, return list of findings."""
        findings = []
        findings.extend(self._check_lab_gaps(patient))
        findings.extend(self._check_critical_lab_values(patient))
        findings.extend(self._check_drug_diagnosis_consistency(patient))
        findings.extend(self._check_summary_vs_structured(patient))
        return findings

    def _check_lab_gaps(self, patient: Patient) -> list[dict]:
        """Check if discharge summary mentions tests not found in labs data."""
        findings = []
        summary_lower = patient.discharge_summary.lower()
        lab_names = {l.get("lab_name", "").lower() for l in patient.labs}

        # Common tests that should have lab records if mentioned in summary
        test_patterns = {
            "troponin": ["troponin", "cardiac enzyme", "cardiac marker"],
            "blood culture": ["blood culture"],
            "urinalysis": ["urinalysis", "urine culture"],
            "ABG": ["abg", "arterial blood gas", "blood gas"],
            "chest x-ray": ["chest x-ray", "cxr", "chest film"],
            "echocardiogram": ["echocardiogram", "echo", "tte", "tee"],
        }

        for test_name, patterns in test_patterns.items():
            mentioned = any(p in summary_lower for p in patterns)
            if not mentioned:
                continue

            # Check if corresponding lab exists
            has_lab = False
            if test_name == "troponin":
                has_lab = any("troponin" in ln for ln in lab_names)
            elif test_name == "blood culture":
                has_lab = any("culture" in ln for ln in lab_names)
            elif test_name == "urinalysis":
                has_lab = any("urine" in ln or "urinalysis" in ln for ln in lab_names)
            elif test_name == "ABG":
                has_lab = any("ph" == ln or "pco2" in ln or "po2" in ln for ln in lab_names)
            elif test_name in ("chest x-ray", "echocardiogram"):
                # Imaging not in labs table, skip
                continue

            if mentioned and not has_lab:
                findings.append({
                    "type": "MISSING_DATA",
                    "severity": "warning",
                    "message": f"Discharge summary mentions '{test_name}' but no corresponding lab records found.",
                    "teaching_question": f"The note mentions {test_name} was performed, but we have no lab data for it. "
                                         f"In practice, what would you do if you noticed this gap in a patient's chart?",
                })

        return findings

    def _check_critical_lab_values(self, patient: Patient) -> list[dict]:
        """Flag lab values outside critical ranges."""
        findings = []

        for lab in patient.labs:
            lab_name = lab.get("lab_name", "")
            if lab_name not in LAB_CRITICAL_VALUES:
                continue

            try:
                value = float(lab["value"])
            except (ValueError, TypeError):
                continue

            thresholds = LAB_CRITICAL_VALUES[lab_name]
            if value < thresholds["low"] or value > thresholds["high"]:
                direction = "LOW" if value < thresholds["low"] else "HIGH"
                findings.append({
                    "type": "CRITICAL_LAB",
                    "severity": "critical",
                    "message": f"Critical {lab_name}: {value} {thresholds['unit']} ({direction}) "
                               f"at {lab['charttime']}. Normal range: {thresholds['low']}-{thresholds['high']}.",
                    "lab_name": lab_name,
                    "value": value,
                    "charttime": lab["charttime"],
                    "direction": direction,
                    "teaching_question": f"{lab_name} is {value} ({direction}). "
                                         f"What are the possible causes and immediate management steps?",
                })

        # Deduplicate: keep only the most extreme value per lab
        critical_by_lab = {}
        for f in findings:
            if f["type"] != "CRITICAL_LAB":
                continue
            key = f["lab_name"]
            if key not in critical_by_lab:
                critical_by_lab[key] = f
            else:
                existing = critical_by_lab[key]
                if f["direction"] == "HIGH" and f["value"] > existing["value"]:
                    critical_by_lab[key] = f
                elif f["direction"] == "LOW" and f["value"] < existing["value"]:
                    critical_by_lab[key] = f

        non_critical = [f for f in findings if f["type"] != "CRITICAL_LAB"]
        return non_critical + list(critical_by_lab.values())

    def _check_drug_diagnosis_consistency(self, patient: Patient) -> list[dict]:
        """Check if prescribed drugs match documented diagnoses."""
        findings = []
        dx_text = " ".join(d.get("long_title", "").lower() for d in patient.diagnoses)
        summary_lower = patient.discharge_summary.lower()
        drug_names = {p["drug"].lower() for p in patient.prescriptions if p.get("drug")}

        # Drug-diagnosis expected associations
        associations = [
            {
                "drugs": ["warfarin", "coumadin"],
                "expected_dx": ["atrial fibrillation", "atrial flutter", "deep vein thrombosis",
                                "pulmonary embolism", "mechanical valve"],
                "description": "Warfarin/Coumadin without documented anticoagulation indication",
            },
            {
                "drugs": ["insulin", "metformin", "glipizide", "glyburide"],
                "expected_dx": ["diabetes"],
                "description": "Diabetes medication without diabetes diagnosis",
            },
            {
                "drugs": ["levothyroxine", "synthroid"],
                "expected_dx": ["hypothyroid", "thyroid"],
                "description": "Thyroid medication without thyroid diagnosis",
            },
            {
                "drugs": ["albuterol", "ipratropium", "combivent"],
                "expected_dx": ["copd", "asthma", "bronchitis", "obstructive"],
                "description": "Bronchodilator without respiratory diagnosis",
            },
        ]

        for assoc in associations:
            has_drug = any(d in drug_names for d in assoc["drugs"])
            has_dx = any(dx in dx_text or dx in summary_lower for dx in assoc["expected_dx"])

            if has_drug and not has_dx:
                matched_drug = next(d for d in assoc["drugs"] if d in drug_names)
                findings.append({
                    "type": "DRUG_DX_MISMATCH",
                    "severity": "info",
                    "message": f"{assoc['description']}: '{matched_drug}' prescribed "
                               f"but no matching diagnosis code found.",
                    "teaching_question": f"This patient is prescribed {matched_drug}, "
                                         f"but the diagnosis codes don't include the typical indication. "
                                         f"What might explain this discrepancy?",
                })

        return findings

    def _check_summary_vs_structured(self, patient: Patient) -> list[dict]:
        """Check for contradictions between discharge summary and structured data."""
        findings = []
        summary_lower = patient.discharge_summary.lower()

        # Check: summary mentions allergies but we can check drug prescriptions
        allergy_match = re.search(r'allergies?[:\s]+([^\n]+)', summary_lower)
        if allergy_match:
            allergy_text = allergy_match.group(1).strip()
            drug_names = {p["drug"].lower() for p in patient.prescriptions if p.get("drug")}

            # Simple check: if allergy drug is in prescriptions
            common_allergies = ["penicillin", "sulfa", "codeine", "aspirin", "morphine",
                                "vancomycin", "ibuprofen", "ace inhibitor"]
            for allergy in common_allergies:
                if allergy in allergy_text:
                    # Check if any prescribed drug matches
                    for drug in drug_names:
                        if allergy in drug:
                            findings.append({
                                "type": "ALLERGY_CONFLICT",
                                "severity": "critical",
                                "message": f"Patient has documented allergy to '{allergy}' "
                                           f"but '{drug}' is in prescriptions.",
                                "teaching_question": f"The patient's allergy list includes '{allergy}', "
                                                     f"but they were prescribed '{drug}'. "
                                                     f"How would you handle this in clinical practice?",
                            })

        return findings


if __name__ == "__main__":
    from data_loader import DataLoader

    loader = DataLoader().load()
    checker = DataQualityChecker()

    # Check a few patients
    for case_id in ["CASE_00001", "CASE_00002", "CASE_00004", "CASE_00005"]:
        p = loader.get_patient_by_case_id(case_id)
        if not p:
            continue

        findings = checker.check(p)
        if findings:
            print(f"\n{'='*60}")
            print(f"{p.case_id} ({p.age}{p.gender}, {p.admission_diagnosis})")
            for f in findings[:5]:  # show top 5
                icon = {"critical": "[!]", "warning": "[?]", "info": "[i]"}.get(f["severity"], "[-]")
                print(f"  {icon} [{f['type']}] {f['message']}")
