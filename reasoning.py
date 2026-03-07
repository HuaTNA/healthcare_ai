"""
Reasoning — Layer 5: LLM Clinical Teaching Engine
Uses Claude API to generate progressive teaching dialogues based on patient data.
"""

import anthropic
from data_loader import Patient
from config import ANTHROPIC_API_KEY, CLAUDE_MODEL


SYSTEM_PROMPT = """You are an experienced attending physician teaching clinical reasoning at the bedside.
You are working through a real de-identified patient case with a medical student.

Core principles:
1. TEACH LIKE A REAL ATTENDING: Be direct, occasionally challenge the student, vary your style.
   Don't follow a rigid template every time. Sometimes start with a question, sometimes with an observation.
2. PROGRESSIVE DISCLOSURE: Reveal information step by step, mimicking a real clinical encounter.
3. SOCRATIC BUT NATURAL: Ask probing questions, but don't always follow the same pattern.
   Push back when the student is vague. Praise only when genuinely warranted — not every response.
4. EVIDENCE-BASED: Reference actual patient data (labs, meds, diagnoses). Cite specific numbers.
5. HONEST ABOUT UNCERTAINTY: When data is incomplete, contradictory, or ambiguous, say so directly.
   Real medicine has gray areas — don't pretend everything has a clean answer.
6. NEVER FABRICATE: Only use information from the provided patient data. If something is missing, say so.

Style rules:
- Do NOT use formulaic templates like "What the student got RIGHT/WRONG" every time.
- Do NOT use section headers like "Teaching Points" or "Clinical Puzzle Solved" — weave insights naturally.
- Vary your response structure. Sometimes use bullet points, sometimes prose, sometimes a rapid-fire Q&A.
- Be concise. A real attending doesn't give 500-word speeches at the bedside.
- Use medical terminology naturally. Explain only when a concept is genuinely complex.

NOTE: This data comes from MIMIC-III, a de-identified clinical database. All dates are shifted
(you may see years like 2100-2200) — this is intentional for patient privacy. Do not comment on
unusual dates. Focus on the clinical content."""


class ClinicalReasoner:
    def __init__(self):
        self.client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        self.conversation_history = []

    def _call_claude(self, user_message: str, system: str = SYSTEM_PROMPT) -> str:
        self.conversation_history.append({"role": "user", "content": user_message})
        response = self.client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=2000,
            system=system,
            messages=self.conversation_history,
        )
        assistant_msg = response.content[0].text
        self.conversation_history.append({"role": "assistant", "content": assistant_msg})
        return assistant_msg

    def reset_conversation(self):
        self.conversation_history = []

    def generate_case_introduction(self, patient: Patient) -> str:
        """Stage 1: Present basic demographics and chief complaint only."""
        prompt = f"""Present this case like a real attending on rounds. Only reveal the INITIAL presentation
— demographics, chief complaint, brief HPI. Do NOT reveal diagnoses, labs, or treatment.

Patient Data:
- Age: {patient.age}, Gender: {patient.gender}
- Admission Diagnosis: {patient.admission_diagnosis}
- Discharge Summary (first 500 chars): {patient.discharge_summary[:500]}

After presenting, ask the student what they think is going on and what they'd want to know next.
Keep it conversational and under 150 words. Don't number your questions — just ask naturally."""
        return self._call_claude(prompt)

    def evaluate_differential(self, patient: Patient, student_answer: str) -> str:
        """Stage 2: Evaluate student's differential and reveal physical exam/vitals."""
        dx_list = [d["long_title"] for d in patient.diagnoses[:5]]

        # Get key vitals/exam from summary
        summary_excerpt = patient.discharge_summary[:2000]

        prompt = f"""The student answered: "{student_answer}"

Actual diagnoses: {dx_list}
Discharge summary excerpt: {summary_excerpt}

React naturally to the student's answer. If they're on track, push them deeper — don't just praise.
If they missed something critical, challenge them: "What about X? Why might that matter here?"

Now reveal relevant physical exam findings and vitals from the case data.
Then ask what labs or workup they'd want — be specific, don't accept vague answers.

Keep it under 200 words. Sound like a real attending, not a grading rubric."""
        return self._call_claude(prompt)

    def reveal_labs_and_teach(self, patient: Patient, student_answer: str,
                              quality_findings: list[dict]) -> str:
        """Stage 3: Reveal lab results, flag critical values and data quality issues."""
        # Get key labs
        key_labs = {}
        for lab in patient.labs:
            name = lab.get("lab_name", "")
            if name and name not in key_labs:
                try:
                    val = float(lab["value"])
                    key_labs[name] = f"{val} {lab.get('unit', '')}"
                except (ValueError, TypeError):
                    key_labs[name] = f"{lab['value']} {lab.get('unit', '')}"
            if len(key_labs) >= 20:
                break

        # Format quality findings
        quality_text = ""
        if quality_findings:
            quality_text = "\n\nDATA QUALITY ISSUES DETECTED:\n"
            for f in quality_findings[:5]:
                quality_text += f"- [{f['severity'].upper()}] {f['message']}\n"

        prompt = f"""The student said: "{student_answer}"

Here are the lab results:
{chr(10).join(f'- {k}: {v}' for k, v in key_labs.items())}
{quality_text}

Walk the student through the labs like you would at the bedside. Don't list every single value —
highlight what's clinically significant and why. If something is critically abnormal, ask the
student what they'd do RIGHT NOW before continuing.

If there are data quality issues (missing data, contradictions), bring them up naturally:
"Interesting — the summary mentions X but I don't see it in the labs. What do you make of that?"

Then ask the student for their working diagnosis and initial treatment plan.
Be direct. Under 250 words."""
        return self._call_claude(prompt)

    def reveal_treatment_and_compare(self, patient: Patient, student_answer: str,
                                      similar_patients: list[dict]) -> str:
        """Stage 4: Reveal actual treatment, compare with similar cases."""
        # Get medications
        drugs = list({p["drug"] for p in patient.prescriptions if p.get("drug")})[:15]

        # Build similar cases summary
        similar_text = ""
        if similar_patients:
            similar_text = "\n\nSIMILAR CASES FROM DATABASE:\n"
            for s in similar_patients[:3]:
                sp = s["patient"]
                sp_drugs = list({p["drug"] for p in sp.prescriptions if p.get("drug")})[:8]
                similar_text += (
                    f"- {sp.case_id} ({sp.age}{sp.gender}, {sp.admission_diagnosis}): "
                    f"Meds: {', '.join(sp_drugs[:5])}\n"
                )
                if s.get("shared_diagnoses"):
                    similar_text += f"  Shared diagnoses: {', '.join(s['shared_diagnoses'][:3])}\n"

        prompt = f"""The student's treatment plan: "{student_answer}"

ACTUAL TREATMENT:
Medications: {', '.join(drugs)}

Discharge summary excerpt:
{patient.discharge_summary[len(patient.discharge_summary)//2:len(patient.discharge_summary)//2+1500]}
{similar_text}

Compare their plan with what actually happened. Don't use a "what matched / what didn't" template.
Instead, discuss it like a real debrief:
- Where the student's reasoning was solid and where it diverged from practice
- If similar cases exist, mention interesting patterns naturally (not as bullet lists)
- What happened to this patient — the actual outcome

End with one or two genuine takeaways from this case. Not a generic "teaching points" list —
something specific that this case illustrates that they should remember.

Under 300 words."""
        return self._call_claude(prompt)

    def answer_question(self, patient: Patient, question: str,
                        quality_findings: list[dict] = None,
                        similar_patients: list[dict] = None) -> str:
        """Free-form question about the current case."""
        context_parts = [
            f"Current case: {patient.case_id}, {patient.age}{patient.gender}, {patient.admission_diagnosis}",
            f"Diagnoses: {[d['long_title'] for d in patient.diagnoses[:8]]}",
            f"Key drugs: {list({p['drug'] for p in patient.prescriptions if p.get('drug')})[:10]}",
        ]

        if quality_findings:
            context_parts.append(f"Data quality issues: {[f['message'] for f in quality_findings[:3]]}")

        if similar_patients:
            for s in similar_patients[:2]:
                sp = s["patient"]
                context_parts.append(
                    f"Similar case: {sp.case_id} ({sp.age}{sp.gender}, {sp.admission_diagnosis})"
                )

        prompt = f"""Context:
{chr(10).join(context_parts)}

Discharge summary: {patient.discharge_summary[:3000]}

Student question: "{question}"

Answer the question using ONLY the provided data. If the data doesn't contain the answer, say so explicitly.
Use this as a teaching opportunity - don't just answer, help the student understand the reasoning."""
        return self._call_claude(prompt)


if __name__ == "__main__":
    from data_loader import DataLoader

    loader = DataLoader().load()
    p = loader.get_patient_by_case_id("CASE_00001")

    if not ANTHROPIC_API_KEY:
        print("Set ANTHROPIC_API_KEY to test reasoning module.")
        print("Example: export ANTHROPIC_API_KEY=sk-ant-...")
    elif p:
        reasoner = ClinicalReasoner()
        print("Testing case introduction...")
        intro = reasoner.generate_case_introduction(p)
        print(intro)
