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

FEEDBACK rules — after every student answer you MUST:
- Identify what was correct and WHY it was good reasoning (not just "good job")
- Identify what was missed and WHY it matters clinically
- Flag the highest-risk misdiagnosis: "The most dangerous miss here would be X because..."
- Explain your own reasoning: how YOU would prioritize and why

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

    def _call_claude_stream(self, user_message: str, system: str = SYSTEM_PROMPT):
        """Streaming version — yields text chunks as they arrive."""
        self.conversation_history.append({"role": "user", "content": user_message})
        full_text = ""
        with self.client.messages.stream(
            model=CLAUDE_MODEL,
            max_tokens=2000,
            system=system,
            messages=self.conversation_history,
        ) as stream:
            for text in stream.text_stream:
                full_text += text
                yield text
        self.conversation_history.append({"role": "assistant", "content": full_text})

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

You MUST do all of these:
1. For each item the student mentioned: was it reasonable? Why or why not?
2. What critical diagnoses did they MISS? Why is each dangerous to miss?
3. State the single most dangerous misdiagnosis: "The most dangerous miss here would be X because..."
4. Briefly explain YOUR reasoning: "Here's how I'd think through this — [your approach]"
5. Reveal relevant physical exam findings and vitals from the case data.
6. Ask what specific labs or workup they'd order — don't accept vague answers like "blood work".

Keep it under 300 words. Be direct and specific."""
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

You MUST do all of these:
1. Evaluate what the student ordered vs what was actually done — did they miss key tests?
2. Walk through the CRITICAL lab findings. For each abnormal value, ask: "This value is X — what does that mean and what do you do about it RIGHT NOW?"
3. If there are DATA QUALITY ISSUES, turn them into clinical reasoning questions:
   - "The discharge summary mentions X but there's no lab record for it. Why might this happen? Does it change your management?"
   - "We see contradictory information: [contradiction]. Which source do you trust and why?"
4. Ask the student for their working diagnosis and initial treatment plan — be specific:
   "Give me your problem list, your top diagnosis, and your first three orders."

Under 300 words."""
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

You MUST do all of these:
1. Compare their plan with what actually happened — where did they align and where did they diverge?
2. For each divergence: was the student's approach reasonable, or did they miss something important?
3. If similar cases exist, mention patterns: "Interestingly, in similar cases we also see..."
4. Discuss the OUTCOME: what happened to this patient?
5. End with the ATTENDING REASONING PATH: "Here's how I would have approached this case from the start:
   - On presentation, I'd focus on...
   - The key pivot point was...
   - The data that clinched the diagnosis was...
   - My management priorities would be..."

Under 400 words."""
        return self._call_claude(prompt)

    def generate_hint(self, patient: Patient, stage: int, hint_level: int) -> str:
        """Generate progressive hints: 1=gentle, 2=moderate, 3=strong."""
        dx_list = [d["long_title"] for d in patient.diagnoses[:3]]
        summary_excerpt = patient.discharge_summary[:500]

        hint_instructions = {
            1: "Give a GENTLE hint. Don't reveal the answer. Just redirect their thinking: 'Think about what organ systems could cause these symptoms together.' or 'What's the most time-sensitive diagnosis to rule out?'",
            2: "Give a MODERATE hint. Narrow the focus: 'Consider whether this is cardiac vs respiratory vs infectious.' or 'The vital signs suggest a specific pattern — look at the heart rate and blood pressure together.'",
            3: "Give a STRONG hint. Almost reveal the answer: 'Given the history and presentation, you should be strongly considering [category]. What specific diagnosis in that category fits best?' Reference specific findings from the case.",
        }

        prompt = f"""The student is stuck at Stage {stage} of the case.

Case data:
- Age: {patient.age}, Gender: {patient.gender}
- Admission: {patient.admission_diagnosis}
- Key diagnoses: {dx_list}
- Summary excerpt: {summary_excerpt}

{hint_instructions.get(hint_level, hint_instructions[1])}

Keep it to 1-2 sentences. Be helpful but don't give away the answer (unless level 3)."""
        return self._call_claude(prompt)

    def generate_case_review(self, patient: Patient, quality_findings: list[dict],
                              similar_patients: list[dict]) -> str:
        """Generate end-of-case review: expert path, key takeaways, missed red flags."""
        dx_list = [d["long_title"] for d in patient.diagnoses[:8]]
        drugs = list({p["drug"] for p in patient.prescriptions if p.get("drug")})[:15]

        quality_text = ""
        if quality_findings:
            for f in quality_findings[:5]:
                quality_text += f"- {f['message']}\n"

        similar_text = ""
        if similar_patients:
            for s in similar_patients[:3]:
                sp = s["patient"]
                similar_text += f"- {sp.case_id}: {sp.age}{sp.gender}, {sp.admission_diagnosis}\n"

        prompt = f"""Generate a comprehensive CASE REVIEW for a completed teaching session.

Case: {patient.case_id}, {patient.age}{patient.gender}
Admission: {patient.admission_diagnosis}
Final Diagnoses: {dx_list}
Medications: {', '.join(drugs)}
Data Quality Issues: {quality_text or 'None'}
Similar Cases: {similar_text or 'None'}
Discharge Summary: {patient.discharge_summary[:3000]}

Structure the review as:

**Expert Reasoning Path**
Walk through how an experienced clinician would approach this case from start to finish.
What was the key information at each stage? What was the pivot point that clinched the diagnosis?

**Red Flags in This Case**
What findings should immediately raise concern? What's the worst-case differential?

**Key Takeaways**
2-3 specific clinical pearls from THIS case (not generic advice).

**Data Quality Observations**
If there were data issues, explain their clinical implications.

**Pattern Recognition**
How does this case compare to the similar cases? What patterns should the student remember?

Under 500 words total."""
        return self._call_claude(prompt)

    def _build_stage_prompt(self, patient: Patient, stage: int,
                            student_answer: str = "",
                            quality_findings: list[dict] = None,
                            similar_patients: list[dict] = None) -> str:
        """Build the prompt for a given stage without calling Claude."""
        if stage == 1:
            return f"""Present this case like a real attending on rounds. Only reveal the INITIAL presentation
— demographics, chief complaint, brief HPI. Do NOT reveal diagnoses, labs, or treatment.

Patient Data:
- Age: {patient.age}, Gender: {patient.gender}
- Admission Diagnosis: {patient.admission_diagnosis}
- Discharge Summary (first 500 chars): {patient.discharge_summary[:500]}

After presenting, ask the student what they think is going on and what they'd want to know next.
Keep it conversational and under 150 words. Don't number your questions — just ask naturally."""

        elif stage == 2:
            dx_list = [d["long_title"] for d in patient.diagnoses[:5]]
            summary_excerpt = patient.discharge_summary[:2000]
            return f"""The student answered: "{student_answer}"

Actual diagnoses: {dx_list}
Discharge summary excerpt: {summary_excerpt}

You MUST do all of these:
1. For each item the student mentioned: was it reasonable? Why or why not?
2. What critical diagnoses did they MISS? Why is each dangerous to miss?
3. State the single most dangerous misdiagnosis: "The most dangerous miss here would be X because..."
4. Briefly explain YOUR reasoning: "Here's how I'd think through this — [your approach]"
5. Reveal relevant physical exam findings and vitals from the case data.
6. Ask what specific labs or workup they'd order — don't accept vague answers like "blood work".

Keep it under 300 words. Be direct and specific."""

        elif stage == 3:
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
            quality_text = ""
            if quality_findings:
                quality_text = "\n\nDATA QUALITY ISSUES DETECTED:\n"
                for f in quality_findings[:5]:
                    quality_text += f"- [{f['severity'].upper()}] {f['message']}\n"
            return f"""The student said: "{student_answer}"

Here are the lab results:
{chr(10).join(f'- {k}: {v}' for k, v in key_labs.items())}
{quality_text}

You MUST do all of these:
1. Evaluate what the student ordered vs what was actually done — did they miss key tests?
2. Walk through the CRITICAL lab findings. For each abnormal value, ask: "This value is X — what does that mean and what do you do about it RIGHT NOW?"
3. If there are DATA QUALITY ISSUES, turn them into clinical reasoning questions:
   - "The discharge summary mentions X but there's no lab record for it. Why might this happen? Does it change your management?"
   - "We see contradictory information: [contradiction]. Which source do you trust and why?"
4. Ask the student for their working diagnosis and initial treatment plan — be specific:
   "Give me your problem list, your top diagnosis, and your first three orders."

Under 300 words."""

        elif stage == 4:
            drugs = list({p["drug"] for p in patient.prescriptions if p.get("drug")})[:15]
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
            return f"""The student's treatment plan: "{student_answer}"

ACTUAL TREATMENT:
Medications: {', '.join(drugs)}

Discharge summary excerpt:
{patient.discharge_summary[len(patient.discharge_summary)//2:len(patient.discharge_summary)//2+1500]}
{similar_text}

You MUST do all of these:
1. Compare their plan with what actually happened — where did they align and where did they diverge?
2. For each divergence: was the student's approach reasonable, or did they miss something important?
3. If similar cases exist, mention patterns: "Interestingly, in similar cases we also see..."
4. Discuss the OUTCOME: what happened to this patient?
5. End with the ATTENDING REASONING PATH: "Here's how I would have approached this case from the start:
   - On presentation, I'd focus on...
   - The key pivot point was...
   - The data that clinched the diagnosis was...
   - My management priorities would be..."

Under 400 words."""

        else:  # stage 5 — free Q&A
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
            return f"""Context:
{chr(10).join(context_parts)}

Discharge summary: {patient.discharge_summary[:3000]}

Student question: "{student_answer}"

Answer the question using ONLY the provided data. If the data doesn't contain the answer, say so explicitly.
Use this as a teaching opportunity - don't just answer, help the student understand the reasoning."""

    def stream_stage(self, patient: Patient, stage: int,
                     student_answer: str = "",
                     quality_findings: list[dict] = None,
                     similar_patients: list[dict] = None):
        """Stream a teaching stage response. Yields text chunks."""
        if stage == 1:
            self.reset_conversation()
        prompt = self._build_stage_prompt(
            patient, stage, student_answer, quality_findings, similar_patients
        )
        yield from self._call_claude_stream(prompt)

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

    def generate_structured_debrief(self, patient: Patient,
                                     student_answers: dict[str, str],
                                     quality_findings: list[dict] = None,
                                     similar_patients: list[dict] = None) -> str:
        """Generate structured debrief comparing student path vs expert path.

        student_answers: {"stage2": "...", "stage3": "...", "stage4": "..."}
        """
        dx_list = [d["long_title"] for d in patient.diagnoses[:8]]
        drugs = list({p["drug"] for p in patient.prescriptions if p.get("drug")})[:15]

        # Key labs summary
        key_labs = {}
        for lab in patient.labs:
            name = lab.get("lab_name", "")
            if name and name not in key_labs:
                try:
                    val = float(lab["value"])
                    key_labs[name] = f"{val} {lab.get('unit', '')}"
                except (ValueError, TypeError):
                    key_labs[name] = f"{lab['value']} {lab.get('unit', '')}"
            if len(key_labs) >= 15:
                break

        quality_text = ""
        if quality_findings:
            for f in quality_findings[:5]:
                quality_text += f"- {f['message']}\n"

        similar_text = ""
        if similar_patients:
            for s in similar_patients[:3]:
                sp = s["patient"]
                similar_text += f"- {sp.case_id}: {sp.age}{sp.gender}, {sp.admission_diagnosis}\n"

        prompt = f"""Generate a STRUCTURED CASE DEBRIEF as JSON. Compare the student's reasoning path against the expert path.

CASE DATA:
- Patient: {patient.case_id}, {patient.age}{patient.gender}
- Admission: {patient.admission_diagnosis}
- Final Diagnoses: {dx_list}
- Medications given: {', '.join(drugs)}
- Key Labs: {chr(10).join(f'  {k}: {v}' for k, v in list(key_labs.items())[:15])}
- Data Quality Issues: {quality_text or 'None'}
- Similar Cases: {similar_text or 'None'}
- Discharge Summary: {patient.discharge_summary[:2500]}

STUDENT'S ANSWERS ACROSS ALL STAGES:
- Stage 2 (Differential): {student_answers.get('stage2', 'Not answered')}
- Stage 3 (Labs/Workup): {student_answers.get('stage3', 'Not answered')}
- Stage 4 (Treatment Plan): {student_answers.get('stage4', 'Not answered')}

You MUST return ONLY valid JSON with this exact structure (no markdown, no code fences):
{{
  "overall_score": <number 1-10>,
  "score_label": "<Novice|Developing|Competent|Proficient|Expert>",
  "expert_path": {{
    "presentation_focus": "<what an expert would focus on from the initial presentation>",
    "key_pivot": "<the critical finding that clinched the diagnosis>",
    "optimal_workup": "<the ideal lab/test sequence>",
    "optimal_management": "<the correct treatment approach>"
  }},
  "student_vs_expert": [
    {{
      "stage": "Differential Diagnosis",
      "student_did": "<what the student actually said>",
      "expert_would": "<what an expert would do>",
      "alignment": "<Aligned|Partially Aligned|Diverged|Missed>",
      "comment": "<specific feedback>"
    }},
    {{
      "stage": "Labs & Workup",
      "student_did": "<...>",
      "expert_would": "<...>",
      "alignment": "<...>",
      "comment": "<...>"
    }},
    {{
      "stage": "Treatment Plan",
      "student_did": "<...>",
      "expert_would": "<...>",
      "alignment": "<...>",
      "comment": "<...>"
    }}
  ],
  "missed_red_flags": [
    "<specific red flag 1 the student missed>",
    "<specific red flag 2>"
  ],
  "unnecessary_actions": [
    "<test or action the student ordered that wasn't needed and why>"
  ],
  "management_timing": {{
    "delayed": <true or false>,
    "details": "<what should have been done sooner, or 'Timing was appropriate'>"
  }},
  "takeaways": [
    "<key learning point 1 specific to THIS case>",
    "<key learning point 2>",
    "<key learning point 3>"
  ]
}}

Be specific but CONCISE — keep each field under 2 sentences. Do not give generic advice. If the student did well, acknowledge it — don't invent problems.

CRITICAL: Return ONLY the raw JSON object. Do NOT wrap it in ```json``` or any markdown. Start your response with {{ and end with }}."""

        # Use a fresh call (not in teaching conversation) so it doesn't pollute history
        response = self.client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=3000,
            system="You are a clinical education assessment engine. Return ONLY valid JSON. No markdown fences, no explanation text. Start with { and end with }. Be concise.",
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3].strip()
        return raw


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
