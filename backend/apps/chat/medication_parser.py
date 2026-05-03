import re
from dataclasses import dataclass
from typing import List

@dataclass
class Medication:
    name: str
    generic_name: str = ""
    dosage: str = ""
    quantity: int = 1
    unit: str = "comprimés"
    confidence: float = 0.0

    def to_dict(self):
        return {
            "name": self.name,
            "generic_name": self.generic_name,
            "dosage": self.dosage,
            "quantity": self.quantity,
            "unit": self.unit,
            "confidence": self.confidence,
        }

class MedicationParser:
    @staticmethod
    def parse_ocr_text(text: str) -> List[Medication]:
        """Very simple OCR parsing logic.
        Assumes each medication is on a separate line, e.g.:
            Paracetamol 500 mg 2 comprimés
        This can be extended with fuzzy matching and more sophisticated NLP.
        """
        medications: List[Medication] = []
        lines = text.splitlines()
        pattern = re.compile(r"(?P<name>[A-Za-zÀ-ÿ\-\s]+)\s+(?P<dosage>\d+\s*mg|\d+\s*ml|\d+\s*µg)?\s*(?P<quantity>\d+)?\s*(?P<unit>comprim[ées]*|gélule[s]?|sachets?)?", re.IGNORECASE)
        for line in lines:
            line = line.strip()
            if not line:
                continue
            match = pattern.search(line)
            if match:
                name = match.group('name').strip()
                dosage = match.group('dosage') or ""
                quantity = int(match.group('quantity')) if match.group('quantity') else 1
                unit = match.group('unit') or "comprimés"
                medications.append(Medication(name=name, dosage=dosage, quantity=quantity, unit=unit, confidence=0.9))
        return medications
