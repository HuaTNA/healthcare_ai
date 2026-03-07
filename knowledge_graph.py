"""
Knowledge Graph — Layer 2: Clinical Knowledge Graph
Builds a networkx graph with Patient, Disease, Drug, LabTest nodes.
Enables graph-based similar patient retrieval and relationship reasoning.
"""

import networkx as nx
from collections import Counter
from data_loader import DataLoader, Patient


class ClinicalKnowledgeGraph:
    def __init__(self, loader: DataLoader):
        self.loader = loader
        self.graph = nx.Graph()
        self.disease_cooccurrence: dict[tuple, int] = {}

    def build(self) -> "ClinicalKnowledgeGraph":
        print("Building Clinical Knowledge Graph...")
        patients = self.loader.get_all_patients()

        for p in patients:
            # Add patient node
            self.graph.add_node(
                f"P:{p.hadm_id}",
                type="patient",
                case_id=p.case_id,
                age=p.age,
                gender=p.gender,
                admission_dx=p.admission_diagnosis,
            )

            # Add disease nodes and edges
            icd_codes = []
            for d in p.diagnoses:
                disease_id = f"D:{d['icd9_code']}"
                if not self.graph.has_node(disease_id):
                    self.graph.add_node(
                        disease_id,
                        type="disease",
                        icd9_code=d["icd9_code"],
                        short_title=d["short_title"],
                        long_title=d["long_title"],
                    )
                self.graph.add_edge(
                    f"P:{p.hadm_id}", disease_id,
                    relation="HAS_DIAGNOSIS",
                    seq_num=d["seq_num"],
                )
                icd_codes.append(d["icd9_code"])

            # Build disease co-occurrence pairs
            for i in range(len(icd_codes)):
                for j in range(i + 1, len(icd_codes)):
                    pair = tuple(sorted([icd_codes[i], icd_codes[j]]))
                    self.disease_cooccurrence[pair] = self.disease_cooccurrence.get(pair, 0) + 1

            # Add drug nodes and edges
            drugs_seen = set()
            for rx in p.prescriptions:
                drug_name = rx.get("drug", "")
                if not drug_name or drug_name in drugs_seen:
                    continue
                drugs_seen.add(drug_name)
                drug_id = f"RX:{drug_name}"
                if not self.graph.has_node(drug_id):
                    self.graph.add_node(drug_id, type="drug", name=drug_name)
                self.graph.add_edge(
                    f"P:{p.hadm_id}", drug_id,
                    relation="PRESCRIBED",
                )

            # Add lab test type nodes and edges (unique lab types only)
            labs_seen = set()
            for lab in p.labs:
                lab_name = lab.get("lab_name", "")
                if not lab_name or lab_name in labs_seen:
                    continue
                labs_seen.add(lab_name)
                lab_id = f"LAB:{lab_name}"
                if not self.graph.has_node(lab_id):
                    self.graph.add_node(
                        lab_id,
                        type="lab_test",
                        name=lab_name,
                        category=lab.get("category", ""),
                    )
                self.graph.add_edge(
                    f"P:{p.hadm_id}", lab_id,
                    relation="HAS_LAB",
                )

        # Add disease co-occurrence edges (top frequent pairs)
        for (d1, d2), count in self.disease_cooccurrence.items():
            if count >= 10:  # only frequent co-occurrences
                self.graph.add_edge(
                    f"D:{d1}", f"D:{d2}",
                    relation="CO_OCCURS",
                    count=count,
                )

        stats = self._get_stats()
        print(f"  Nodes: {stats['total_nodes']} ({stats['patients']} patients, "
              f"{stats['diseases']} diseases, {stats['drugs']} drugs, {stats['lab_tests']} lab tests)")
        print(f"  Edges: {stats['total_edges']}")
        print(f"  Disease co-occurrence edges (>=10): {stats['cooccurrence_edges']}")
        return self

    def _get_stats(self) -> dict:
        nodes_by_type = Counter(
            self.graph.nodes[n].get("type", "unknown") for n in self.graph.nodes
        )
        cooc_edges = sum(
            1 for _, _, d in self.graph.edges(data=True) if d.get("relation") == "CO_OCCURS"
        )
        return {
            "total_nodes": self.graph.number_of_nodes(),
            "total_edges": self.graph.number_of_edges(),
            "patients": nodes_by_type.get("patient", 0),
            "diseases": nodes_by_type.get("disease", 0),
            "drugs": nodes_by_type.get("drug", 0),
            "lab_tests": nodes_by_type.get("lab_test", 0),
            "cooccurrence_edges": cooc_edges,
        }

    def find_similar_patients(self, hadm_id: int, top_k: int = 5) -> list[dict]:
        """Find similar patients based on shared diseases, drugs, and labs."""
        patient_node = f"P:{hadm_id}"
        if patient_node not in self.graph:
            return []

        # Get all neighbors of this patient (diseases, drugs, labs)
        neighbors = set(self.graph.neighbors(patient_node))

        # Score other patients by shared neighbors
        scores = {}
        for neighbor in neighbors:
            edge_data = self.graph.edges[patient_node, neighbor]
            relation = edge_data.get("relation", "")

            # Weight different relation types
            weight = {"HAS_DIAGNOSIS": 3.0, "PRESCRIBED": 1.5, "HAS_LAB": 0.5}.get(relation, 1.0)

            # Find other patients connected to the same neighbor
            for other in self.graph.neighbors(neighbor):
                if other == patient_node or not other.startswith("P:"):
                    continue
                scores[other] = scores.get(other, 0) + weight

        # Sort by score, get top_k
        ranked = sorted(scores.items(), key=lambda x: -x[1])[:top_k]

        results = []
        source_patient = self.loader.patients.get(hadm_id)
        for node_id, score in ranked:
            other_hadm = int(node_id.split(":")[1])
            other_patient = self.loader.patients.get(other_hadm)
            if not other_patient:
                continue

            # Compute shared details
            shared = self._compute_shared(patient_node, node_id)
            results.append({
                "patient": other_patient,
                "score": score,
                "shared_diagnoses": shared["diagnoses"],
                "shared_drugs": shared["drugs"],
                "shared_labs": shared["labs"],
            })

        return results

    def _compute_shared(self, node_a: str, node_b: str) -> dict:
        """Compute shared diseases, drugs, labs between two patients."""
        neighbors_a = {n: self.graph.edges[node_a, n].get("relation")
                       for n in self.graph.neighbors(node_a)}
        neighbors_b = {n: self.graph.edges[node_b, n].get("relation")
                       for n in self.graph.neighbors(node_b)}

        shared = set(neighbors_a.keys()) & set(neighbors_b.keys())

        result = {"diagnoses": [], "drugs": [], "labs": []}
        for n in shared:
            node_data = self.graph.nodes[n]
            node_type = node_data.get("type")
            if node_type == "disease":
                result["diagnoses"].append(node_data.get("long_title", node_data.get("icd9_code")))
            elif node_type == "drug":
                result["drugs"].append(node_data.get("name"))
            elif node_type == "lab_test":
                result["labs"].append(node_data.get("name"))

        return result

    def get_disease_cooccurrences(self, icd9_code: str, top_k: int = 10) -> list[dict]:
        """Get diseases that frequently co-occur with a given disease."""
        disease_node = f"D:{icd9_code}"
        if disease_node not in self.graph:
            return []

        cooc = []
        for neighbor in self.graph.neighbors(disease_node):
            edge_data = self.graph.edges[disease_node, neighbor]
            if edge_data.get("relation") == "CO_OCCURS":
                node_data = self.graph.nodes[neighbor]
                cooc.append({
                    "icd9_code": node_data.get("icd9_code"),
                    "title": node_data.get("long_title", ""),
                    "count": edge_data.get("count", 0),
                })

        return sorted(cooc, key=lambda x: -x["count"])[:top_k]

    def get_drugs_for_diagnosis(self, icd9_code: str) -> list[dict]:
        """Find drugs commonly prescribed to patients with a specific diagnosis."""
        disease_node = f"D:{icd9_code}"
        if disease_node not in self.graph:
            return []

        # Find all patients with this diagnosis
        patient_nodes = [
            n for n in self.graph.neighbors(disease_node)
            if n.startswith("P:")
        ]

        # Count drugs across these patients
        drug_counts = Counter()
        for pn in patient_nodes:
            for neighbor in self.graph.neighbors(pn):
                if neighbor.startswith("RX:"):
                    drug_counts[neighbor] += 1

        total = len(patient_nodes)
        results = []
        for drug_node, count in drug_counts.most_common(15):
            name = self.graph.nodes[drug_node].get("name", "")
            results.append({
                "drug": name,
                "count": count,
                "percentage": round(count / total * 100, 1) if total > 0 else 0,
            })
        return results


if __name__ == "__main__":
    loader = DataLoader().load()
    kg = ClinicalKnowledgeGraph(loader).build()

    # Test similar patients
    p = loader.get_patient_by_case_id("CASE_00001")
    if p:
        print(f"\nSimilar patients to {p.case_id} ({p.admission_diagnosis}):")
        similar = kg.find_similar_patients(p.hadm_id, top_k=3)
        for s in similar:
            sp = s["patient"]
            print(f"  {sp.case_id} ({sp.age}{sp.gender}, {sp.admission_diagnosis}) "
                  f"score={s['score']:.1f}")
            print(f"    Shared diagnoses: {s['shared_diagnoses'][:3]}")
            print(f"    Shared drugs: {s['shared_drugs'][:3]}")

        # Test disease co-occurrence
        if p.diagnoses:
            code = p.diagnoses[0]["icd9_code"]
            title = p.diagnoses[0]["long_title"]
            print(f"\nDiseases co-occurring with {title} ({code}):")
            cooc = kg.get_disease_cooccurrences(code, top_k=5)
            for c in cooc:
                print(f"  {c['title']} (count={c['count']})")
