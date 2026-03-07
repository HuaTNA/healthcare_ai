"""
Clinical Tutor Demo — Interactive CLI
End-to-end demonstration of the Clinical Teaching AI system.

Usage:
    python demo.py                    # Interactive mode
    python demo.py --case CASE_00001  # Start with a specific case
"""

import argparse
import sys
import os

# Fix Windows console encoding
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Suppress HuggingFace warnings
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

from data_loader import DataLoader
from knowledge_graph import ClinicalKnowledgeGraph
from rag_engine import RAGEngine
from data_quality import DataQualityChecker
from reasoning import ClinicalReasoner
from config import ANTHROPIC_API_KEY


class ClinicalTutorDemo:
    def __init__(self):
        self.loader = None
        self.kg = None
        self.rag = None
        self.quality_checker = DataQualityChecker()
        self.reasoner = None

    def initialize(self):
        """Boot all system layers."""
        print("=" * 60)
        print("  Clinical Tutor - AI Clinical Teaching Assistant")
        print("  Powered by Knowledge Graph + RAG + Claude")
        print("=" * 60)

        print("\n[Layer 1] Loading and fusing 6 clinical data tables...")
        self.loader = DataLoader().load()

        print("\n[Layer 2] Building Clinical Knowledge Graph...")
        self.kg = ClinicalKnowledgeGraph(self.loader).build()

        print("\n[Layer 3] Building RAG Engine (embedding + hybrid retrieval)...")
        self.rag = RAGEngine(self.loader, self.kg).build()

        print("\n[Layer 4] Data Quality Checker ready.")
        print("[Layer 5] Clinical Reasoning Engine ready.")

        if ANTHROPIC_API_KEY:
            self.reasoner = ClinicalReasoner()
            print("[Layer 6] Claude API connected.\n")
        else:
            print("[Layer 6] WARNING: No ANTHROPIC_API_KEY set. LLM features disabled.\n")

        print("System ready. All 7 pipeline layers operational.\n")

    def show_case_overview(self, case_id: str):
        """Show what the system knows about a case (for demo/presentation)."""
        patient = self.loader.get_patient_by_case_id(case_id)
        if not patient:
            print(f"Case {case_id} not found.")
            return None

        stats = patient.summary_stats()
        print("=" * 60)
        print(f"  CASE OVERVIEW: {case_id}")
        print("=" * 60)
        print(f"  Patient: {patient.age}{patient.gender}")
        print(f"  Admission Dx: {patient.admission_diagnosis}")
        print(f"  Data loaded from 6 tables:")
        print(f"    - Diagnoses: {stats['num_diagnoses']} ICD-9 codes")
        print(f"    - Lab records: {stats['num_lab_records']} ({stats['unique_lab_types']} unique tests)")
        print(f"    - Medications: {stats['num_drugs']} unique drugs")
        print(f"    - Discharge summary: {len(patient.discharge_summary)} chars")

        # Knowledge Graph connections
        similar = self.kg.find_similar_patients(patient.hadm_id, top_k=3)
        print(f"\n  Knowledge Graph: {self.kg.graph.number_of_nodes()} nodes, "
              f"{self.kg.graph.number_of_edges()} edges")
        print(f"  Similar patients found: {len(similar)}")
        for s in similar:
            sp = s["patient"]
            print(f"    - {sp.case_id} ({sp.age}{sp.gender}, {sp.admission_diagnosis}) "
                  f"[{len(s['shared_diagnoses'])} shared Dx, {len(s['shared_drugs'])} shared Rx]")

        # Data quality
        findings = self.quality_checker.check(patient)
        if findings:
            print(f"\n  Data Quality Issues: {len(findings)}")
            for f in findings[:3]:
                sev = {"critical": "!!!", "warning": " ? ", "info": " i "}.get(f["severity"], " - ")
                print(f"    [{sev}] {f['message'][:80]}")

        print("=" * 60)
        return patient

    def run_teaching_session(self, case_id: str):
        """Run a full interactive teaching session on a case."""
        patient = self.show_case_overview(case_id)
        if not patient:
            return

        if not self.reasoner:
            print("\nCannot run teaching session without ANTHROPIC_API_KEY.")
            return

        self.reasoner.reset_conversation()
        quality_findings = self.quality_checker.check(patient)
        similar = self.rag.hybrid_search(patient, top_k=3)

        # Stage 1: Introduction
        print("\n" + "=" * 60)
        print("  STAGE 1: Case Presentation")
        print("=" * 60)
        intro = self.reasoner.generate_case_introduction(patient)
        print(f"\nTutor: {intro}\n")

        student_input = input("Your answer (or 'skip'): ").strip()
        if student_input.lower() == "quit":
            return

        # Stage 2: Evaluate differential, reveal physical exam
        print("\n" + "=" * 60)
        print("  STAGE 2: Physical Examination")
        print("=" * 60)
        if student_input.lower() == "skip":
            student_input = "I'm not sure, please help me think through this."
        response = self.reasoner.evaluate_differential(patient, student_input)
        print(f"\nTutor: {response}\n")

        student_input = input("Your answer (or 'skip'): ").strip()
        if student_input.lower() == "quit":
            return

        # Stage 3: Labs + Data Quality
        print("\n" + "=" * 60)
        print("  STAGE 3: Laboratory Results & Data Quality")
        print("=" * 60)
        if student_input.lower() == "skip":
            student_input = "I would order a CBC, BMP, ABG, and troponin."
        response = self.reasoner.reveal_labs_and_teach(patient, student_input, quality_findings)
        print(f"\nTutor: {response}\n")

        student_input = input("Your answer (or 'skip'): ").strip()
        if student_input.lower() == "quit":
            return

        # Stage 4: Treatment + Similar Cases
        print("\n" + "=" * 60)
        print("  STAGE 4: Treatment & Similar Case Comparison")
        print("=" * 60)
        if student_input.lower() == "skip":
            student_input = "I would start IV steroids, antibiotics, and bronchodilators."
        response = self.reasoner.reveal_treatment_and_compare(patient, student_input, similar)
        print(f"\nTutor: {response}\n")

        # Free-form Q&A
        print("=" * 60)
        print("  FREE Q&A - Ask anything about this case (type 'done' to exit)")
        print("=" * 60)
        while True:
            question = input("\nYour question: ").strip()
            if question.lower() in ("done", "quit", "exit", ""):
                break
            response = self.reasoner.answer_question(
                patient, question, quality_findings, similar
            )
            print(f"\nTutor: {response}")

        print("\n--- Teaching session complete ---\n")

    def run_search_demo(self):
        """Demonstrate the retrieval capabilities."""
        print("\n" + "=" * 60)
        print("  SEARCH DEMO - Find similar cases")
        print("=" * 60)
        query = input("\nDescribe a patient (or type a case_id): ").strip()

        if query.startswith("CASE_"):
            patient = self.loader.get_patient_by_case_id(query)
            if patient:
                results = self.rag.hybrid_search(patient, top_k=5)
                print(f"\nTop 5 similar patients to {query} ({patient.admission_diagnosis}):\n")
                for i, r in enumerate(results, 1):
                    rp = r["patient"]
                    print(f"  {i}. {rp.case_id} ({rp.age}{rp.gender}, {rp.admission_diagnosis})")
                    print(f"     Score: KG={r['kg_score']:.2f} Semantic={r['semantic_score']:.2f} "
                          f"Final={r['final_score']:.2f}")
                    if r.get("shared_diagnoses"):
                        print(f"     Shared Dx: {', '.join(r['shared_diagnoses'][:3])}")
                    if r.get("shared_drugs"):
                        print(f"     Shared Rx: {', '.join(r['shared_drugs'][:3])}")
                    print()
        else:
            results = self.rag.search(query, top_k=5)
            print(f"\nSemantic search results for: '{query}'\n")
            for i, r in enumerate(results, 1):
                rp = r["patient"]
                print(f"  {i}. {rp.case_id} ({rp.age}{rp.gender}, {rp.admission_diagnosis}) "
                      f"score={r['semantic_score']:.3f}")

    def run_interactive(self, initial_case: str = None):
        """Main interactive loop."""
        if initial_case:
            self.run_teaching_session(initial_case)
            return

        while True:
            print("\n" + "-" * 40)
            print("  Clinical Tutor - Main Menu")
            print("-" * 40)
            print("  1. Start teaching session (enter case ID)")
            print("  2. Search for cases")
            print("  3. Random case")
            print("  4. Show system stats")
            print("  5. Quit")
            choice = input("\nChoice: ").strip()

            if choice == "1":
                case_id = input("Enter case ID (e.g., CASE_00001): ").strip()
                if case_id:
                    self.run_teaching_session(case_id)
            elif choice == "2":
                self.run_search_demo()
            elif choice == "3":
                import random
                all_cases = list(self.loader.case_id_map.keys())
                random_case = random.choice(all_cases)
                self.run_teaching_session(random_case)
            elif choice == "4":
                self._show_stats()
            elif choice == "5":
                print("Goodbye!")
                break

    def _show_stats(self):
        print("\n  System Statistics:")
        print(f"  - Patients: {len(self.loader.patients)}")
        print(f"  - Knowledge Graph: {self.kg.graph.number_of_nodes()} nodes, "
              f"{self.kg.graph.number_of_edges()} edges")
        kg_stats = self.kg._get_stats()
        print(f"  - Diseases: {kg_stats['diseases']}")
        print(f"  - Drugs: {kg_stats['drugs']}")
        print(f"  - Lab Tests: {kg_stats['lab_tests']}")
        print(f"  - Disease co-occurrence edges: {kg_stats['cooccurrence_edges']}")


def main():
    parser = argparse.ArgumentParser(description="Clinical Tutor - AI Teaching Assistant")
    parser.add_argument("--case", type=str, help="Start with a specific case ID")
    args = parser.parse_args()

    demo = ClinicalTutorDemo()
    demo.initialize()
    demo.run_interactive(initial_case=args.case)


if __name__ == "__main__":
    main()
