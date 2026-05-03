"""
Medication Extraction Service
Extracts medication information from OCR text using NLP and pattern matching
"""

import re
from difflib import SequenceMatcher
from typing import Dict, List, Optional

try:
    from fuzzywuzzy import fuzz, process
except ImportError:  # pragma: no cover - environment dependent
    fuzz = None
    process = None


class MedicationExtractor:
    """Extract medication information from OCR text"""
    
    def __init__(self):
        self.stopwords = {
            "dr", "docteur", "doctor", "docteure", "ordonnance", "prescription",
            "patient", "nom", "prenom", "âge", "age", "date", "signature",
            "matin", "soir", "midi", "jour", "jours", "prise", "prenez",
            "comprime", "comprimé", "comprimés", "gelule", "gélule", "gélules",
            "boite", "boîte", "boites", "boîtes", "ml", "mg", "g", "cp",
            "ampoule", "ampoules", "flacon", "flacons", "sachet", "sachets",
            "avant", "apres", "après", "repas", "pendant", "fois", "quantite",
            "quantité", "posologie", "service", "hopital", "hôpital"
        }
        # Common medication patterns and keywords
        self.dosage_patterns = [
            r'(\d+)\s*(mg|g|ml|µg)',  # Dosage patterns
            r'(\d+)\s*(cp|comprimé|comprimés|gelule|gélule)',
            r'(\d+)\s*(flacon|fl|ampoule|amp)',
            r'(\d+)\s*(fois|par jour|matin|soir)',
        ]
        
        # Common French medical terms
        self.medical_keywords = [
            'mg', 'g', 'ml', 'cp', 'comprimé', 'gelule', 'flacon',
            'fois', 'jour', 'matin', 'soir', 'avant', 'après',
            'repas', 'prise', 'quantité', 'boîte', 'box'
        ]
        
        # Mock medication database (should be replaced with real Vidal database)
        self.medication_db = self._load_medication_database()
    
    def _load_medication_database(self) -> Dict:
        """
        Load medication database (mock for now, should connect to Vidal or similar)
        
        Returns:
            Dictionary with medication information
        """
        # This is a mock database - in production, connect to Vidal or similar
        return {
            'medications': [
                {
                    'commercial_name': 'Doliprane',
                    'generic_name': 'Paracétamol',
                    'aliases': ['doliprane', 'paracetamol', 'efferalgan', 'dafalgan'],
                    'common_dosages': ['500mg', '1000mg', '1g'],
                    'requires_prescription': False
                },
                {
                    'commercial_name': 'Ibuprofène',
                    'generic_name': 'Ibuprofène',
                    'aliases': ['ibuprofene', 'ibuprofène', 'advil', 'nurofen', 'spedifen'],
                    'common_dosages': ['200mg', '400mg', '600mg'],
                    'requires_prescription': False
                },
                {
                    'commercial_name': 'Amoxicilline',
                    'generic_name': 'Amoxicilline',
                    'aliases': ['amoxicilline', 'amoxycilline', 'augmentin'],
                    'common_dosages': ['500mg', '1g'],
                    'requires_prescription': True
                },
                {
                    'commercial_name': 'Voltarene',
                    'generic_name': 'Diclofénac',
                    'aliases': ['voltarene', 'diclofenac', 'diclofénac'],
                    'common_dosages': ['50mg', '75mg', '100mg'],
                    'requires_prescription': True
                },
                {
                    'commercial_name': 'Smecta',
                    'generic_name': 'Diosmectite',
                    'aliases': ['smecta', 'diosmectite'],
                    'common_dosages': ['3g', ' Sachet'],
                    'requires_prescription': False
                },
                {
                    'commercial_name': 'Doliprane',
                    'generic_name': 'Paracétamol',
                    'aliases': ['doliprane', 'paracetamol', 'efferalgan', 'dafalgan'],
                    'common_dosages': ['500mg', '1000mg', '1g'],
                    'requires_prescription': False
                },
            ],
            'common_medications': [
                'doliprane', 'paracetamol', 'ibuprofene', 'aspirine', 'amoxicilline',
                'voltarene', 'smecta', 'gaviscon', 'imodium', 'doliprane',
                'dafalgan', 'efferalgan', 'advil', 'nurofen', 'spedifen'
            ]
        }
    
    def extract_medications(self, ocr_text: str, confidence_threshold: float = 0.6) -> List[Dict]:
        """
        Extract medications from OCR text
        
        Args:
            ocr_text: Text extracted from OCR
            confidence_threshold: Minimum confidence score for medications
            
        Returns:
            List of extracted medications with their details
        """
        if not ocr_text or len(ocr_text.strip()) < 10:
            return []
        
        # Clean the OCR text first
        cleaned_text = self._clean_ocr_text(ocr_text)
        
        medications = []

        # Extract potential medication names
        potential_medications = self._find_potential_medications(cleaned_text)
        
        # Extract dosages
        dosages = self._extract_dosages(cleaned_text)
        
        # Extract quantities
        quantities = self._extract_quantities(cleaned_text)
        
        # Match medications with dosages and quantities
        for med_name in potential_medications:
            medication_info = self._normalize_medication(med_name)
            if not medication_info:
                continue
            
            dosage = self._find_associated_dosage(med_name, cleaned_text, dosages)
            quantity = self._find_associated_quantity(med_name, cleaned_text, quantities)
            confidence = self._calculate_medication_confidence(
                med_name, medication_info, cleaned_text, dosage
            )
            is_candidate = not bool(medication_info.get("generic_name"))

            if confidence >= confidence_threshold or self._should_keep_candidate(med_name, dosage, confidence, is_candidate):
                medications.append({
                    'name': self._format_display_name(med_name, medication_info),
                    'generic_name': medication_info['generic_name'],
                    'dosage': dosage,
                    'quantity': quantity,
                    'unit': self._determine_unit(dosage),
                    'confidence': confidence,
                    'confirmed': False,
                    'alternatives': medication_info.get('alternatives', []),
                    'requires_prescription': medication_info.get('requires_prescription', True),
                    'needs_review': is_candidate or confidence < confidence_threshold,
                })
        
        # Remove duplicates
        medications = self._deduplicate_medications(medications)
        
        # Sort by confidence
        medications.sort(key=lambda x: x['confidence'], reverse=True)
        
        return medications
    
    def _clean_ocr_text(self, text: str) -> str:
        """
        Clean OCR text to improve medication detection
        
        Args:
            text: Raw OCR text
            
        Returns:
            Cleaned text
        """
        if not text:
            return ""
        
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text)
        
        # Normalize a few OCR artifacts without damaging medication names.
        text = re.sub(r'(?<=\d)[oO](?=\s*(mg|g|ml|mcg|µg|ui)\b)', '0', text)
        text = re.sub(r'(?<=\b\d)[Il|](?=\b)', '1', text)
        
        # Remove special characters that might interfere
        text = re.sub(r'[^\w\sàâäéèêëïîôùûüÿç\-.,]', ' ', text)
        
        # Preserve important medical symbols
        text = re.sub(r'\s*-\s*', '-', text)  # Normalize hyphens
        text = re.sub(r'\s*\.\s*', '.', text)  # Normalize periods
        
        # Remove repeated characters (common OCR error)
        text = re.sub(r'(.)\1{2,}', r'\1', text)
        
        # Trim whitespace
        text = text.strip()
        
        return text
    
    def _find_potential_medications(self, text: str) -> List[str]:
        """Find potential medication names in text"""
        potential_meds = []
        text_lower = text.lower()
        
        # Check against common medications
        for med in self.medication_db['common_medications']:
            if re.search(rf"\b{re.escape(med.lower())}\b", text_lower):
                potential_meds.append(med)
        
        # Extract medication-like sequences from original OCR text
        words = re.findall(r'\b[A-Z][A-Za-zéèêëàâäùûüôöîïç-]{3,}\b', text)
        for word in words:
            if len(word) > 4 and word.lower() not in potential_meds:
                potential_meds.append(word.lower())

        # Capture terms immediately followed by a dosage, a common prescription pattern.
        dosage_candidates = re.findall(
            r'\b([A-Za-zéèêëàâäùûüôöîïç-]{4,}(?:\s+[A-Za-zéèêëàâäùûüôöîïç-]{2,})?)\s+\d+\s*(?:mg|g|ml|mcg|µg|ui)\b',
            text,
            re.IGNORECASE,
        )
        for candidate in dosage_candidates:
            cleaned_candidate = candidate.strip()
            if not self._is_valid_candidate(cleaned_candidate):
                continue
            if cleaned_candidate.lower() not in {med.lower() for med in potential_meds}:
                potential_meds.append(cleaned_candidate)

        line_candidates = re.findall(
            r'(?:^|\n)\s*([A-Za-zéèêëàâäùûüôöîïç-]{4,}(?:\s+[A-Za-zéèêëàâäùûüôöîïç-]{2,}){0,2})\s+\d+\s*(?:mg|g|ml|mcg|µg|ui)\b',
            text,
            re.IGNORECASE | re.MULTILINE,
        )
        for candidate in line_candidates:
            cleaned_candidate = candidate.strip()
            if not self._is_valid_candidate(cleaned_candidate):
                continue
            if cleaned_candidate.lower() not in {med.lower() for med in potential_meds}:
                potential_meds.append(cleaned_candidate)
        
        unique_candidates = []
        seen = set()
        for candidate in potential_meds:
            normalized_candidate = candidate.lower()
            if normalized_candidate in seen:
                continue
            seen.add(normalized_candidate)
            unique_candidates.append(candidate)
        return unique_candidates
    
    def _extract_dosages(self, text: str) -> List[str]:
        """Extract dosage patterns from text"""
        dosages = []
        for pattern in self.dosage_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            for match in matches:
                if isinstance(match, tuple):
                    dosages.append(' '.join(str(m) for m in match))
                else:
                    dosages.append(match)
        return list(set(dosages))
    
    def _extract_quantities(self, text: str) -> List[int]:
        """Extract quantity numbers from text"""
        quantities = re.findall(r'\b(\d+)\s*(?:bo[iî]te|bo[iî]tes|box|flacon|flacons|cp|comprimé|comprimés|gelule|gélule|gelules|gélules|ampoule|ampoules|sachet|sachets)\b', text, re.IGNORECASE)
        return [int(q) for q in quantities]
    
    def _normalize_medication(self, med_name: str) -> Optional[Dict]:
        """Normalize medication name using database"""
        med_name_lower = med_name.lower().strip()
        if not self._is_valid_candidate(med_name):
            return None
        
        # Check exact match
        for med in self.medication_db['medications']:
            if med_name_lower in [alias.lower() for alias in med['aliases']]:
                return med
        
        # Fuzzy match
        all_aliases = []
        for med in self.medication_db['medications']:
            all_aliases.extend([(alias, med) for alias in med['aliases']])

        matched_alias, score = self._best_alias_match(
            med_name_lower,
            [alias for alias, _ in all_aliases],
        )

        if matched_alias and score > 70:  # 70% similarity threshold
            for alias, med in all_aliases:
                if alias.lower() == matched_alias.lower():
                    return med
        
        # Return as unknown medication
        return {
            'commercial_name': self._titleize_medication(med_name),
            'generic_name': None,
            'aliases': [med_name_lower],
            'common_dosages': [],
            'requires_prescription': True
        }

    def _best_alias_match(self, needle: str, aliases: List[str]) -> tuple[Optional[str], int]:
        """Return the best alias match even when fuzzywuzzy is unavailable."""
        if not aliases:
            return None, 0

        if process is not None and fuzz is not None:
            result = process.extractOne(needle, aliases, scorer=fuzz.ratio)
            if result:
                return result[0], int(result[1])
            return None, 0

        best_alias = None
        best_score = 0
        for alias in aliases:
            score = int(SequenceMatcher(None, needle, alias.lower()).ratio() * 100)
            if score > best_score:
                best_alias = alias
                best_score = score
        return best_alias, best_score
    
    def _find_associated_dosage(self, med_name: str, text: str, dosages: List[str]) -> str:
        """Find dosage associated with a medication"""
        # Look for dosage near the medication name
        med_index = text.lower().find(med_name.lower())
        if med_index == -1:
            return None
        
        # Search within 50 characters of the medication name
        context_start = max(0, med_index - 50)
        context_end = min(len(text), med_index + len(med_name) + 50)
        context = text[context_start:context_end]
        relative_med_index = med_index - context_start
        post_context = context[relative_med_index:]
        pre_context = context[:relative_med_index]

        post_matches = re.findall(r'\b\d+\s*(?:mg|g|ml|mcg|µg|ui)\b', post_context, re.IGNORECASE)
        if post_matches:
            return post_matches[0].replace(" ", "")

        for dosage in dosages:
            if dosage.lower() in context.lower():
                return dosage

        pre_matches = re.findall(r'\b\d+\s*(?:mg|g|ml|mcg|µg|ui)\b', pre_context, re.IGNORECASE)
        if pre_matches:
            return pre_matches[-1].replace(" ", "")

        # Fallback: detect an inline dosage near the medication mention.
        match = re.search(r'\b\d+\s*(?:mg|g|ml|mcg|µg|ui)\b', context, re.IGNORECASE)
        if match:
            return match.group(0).replace(" ", "")
        
        return None
    
    def _find_associated_quantity(self, med_name: str, text: str, quantities: List[int]) -> int:
        """Find quantity associated with a medication"""
        med_index = text.lower().find(med_name.lower())
        if med_index == -1:
            return 1
        
        context_start = max(0, med_index - 30)
        context_end = min(len(text), med_index + len(med_name) + 30)
        context = text[context_start:context_end]
        relative_med_index = med_index - context_start
        post_context = context[relative_med_index:]
        pre_context = context[:relative_med_index]

        post_match = re.search(
            r'\b(\d+)\s*(?:bo[iî]te|bo[iî]tes|box|flacon|flacons|cp|comprimé|comprimés|gelule|gélule|gelules|gélules|ampoule|ampoules|sachet|sachets)\b',
            post_context,
            re.IGNORECASE,
        )
        if post_match:
            return int(post_match.group(1))

        pre_matches = re.findall(
            r'\b(\d+)\s*(?:bo[iî]te|bo[iî]tes|box|flacon|flacons|cp|comprimé|comprimés|gelule|gélule|gelules|gélules|ampoule|ampoules|sachet|sachets)\b',
            pre_context,
            re.IGNORECASE,
        )
        if pre_matches:
            return int(pre_matches[-1])
        
        for quantity in quantities:
            if str(quantity) in context:
                return quantity
        
        return 1
    
    def _calculate_medication_confidence(self, med_name: str, medication_info: Dict, text: str, dosage: Optional[str]) -> float:
        """Calculate confidence score for medication extraction"""
        confidence = 0.0
        
        # Check if medication is in database
        if medication_info.get('generic_name'):
            confidence += 0.4
        
        # Check for dosage presence
        if dosage:
            confidence += 0.25
        
        # Check for medical keywords nearby
        med_index = text.lower().find(med_name.lower())
        if med_index != -1:
            context = text[max(0, med_index - 20):min(len(text), med_index + len(med_name) + 20)]
            keyword_count = sum(1 for keyword in self.medical_keywords if keyword.lower() in context.lower())
            confidence += min(keyword_count * 0.1, 0.3)
        
        # Check for proper capitalization (medications often start with capital)
        if med_name[0].isupper():
            confidence += 0.1

        # Unknown medications can still be legitimate if they are followed by a dosage.
        if not medication_info.get("generic_name") and dosage:
            confidence += 0.15
        
        return min(confidence, 1.0)

    def _should_keep_candidate(self, med_name: str, dosage: Optional[str], confidence: float, is_candidate: bool) -> bool:
        """Keep plausible low-confidence candidates for patient confirmation."""
        if not self._is_valid_candidate(med_name):
            return False
        if not is_candidate:
            return confidence >= 0.45
        if dosage and confidence >= 0.3:
            return True
        return False

    def _is_valid_candidate(self, med_name: str) -> bool:
        """Reject obvious non-medication tokens."""
        normalized = re.sub(r"\s+", " ", med_name or "").strip(" .,-").lower()
        if len(normalized) < 4:
            return False
        words = normalized.split()
        if any(word in self.stopwords for word in words):
            return False
        if sum(char.isalpha() for char in normalized) < 4:
            return False
        return True

    def _titleize_medication(self, med_name: str) -> str:
        return " ".join(part[:1].upper() + part[1:] for part in med_name.split())

    def _format_display_name(self, med_name: str, medication_info: Dict) -> str:
        display_name = medication_info.get("commercial_name") or med_name
        if medication_info.get("generic_name"):
            return display_name
        return self._titleize_medication(display_name)
    
    def _determine_unit(self, dosage: str) -> str:
        """Determine unit based on dosage"""
        if not dosage:
            return 'comprimés'
        
        dosage_lower = dosage.lower()
        if 'cp' in dosage_lower or 'comprimé' in dosage_lower:
            return 'comprimés'
        elif 'flacon' in dosage_lower or 'fl' in dosage_lower:
            return 'flacons'
        elif 'ampoule' in dosage_lower or 'amp' in dosage_lower:
            return 'ampoules'
        elif 'gelule' in dosage_lower:
            return 'gélules'
        elif 'sachet' in dosage_lower:
            return 'sachets'
        else:
            return 'comprimés'
    
    def _deduplicate_medications(self, medications: List[Dict]) -> List[Dict]:
        """Remove duplicate medications"""
        seen = set()
        unique_meds = []
        
        for med in medications:
            key = (med['name'], med['dosage'])
            if key not in seen:
                seen.add(key)
                unique_meds.append(med)
        
        return unique_meds
    
    def check_interactions(self, medications: List[Dict]) -> List[Dict]:
        """
        Check for potential drug interactions
        
        Args:
            medications: List of medications
            
        Returns:
            List of potential interactions
        """
        # This is a simplified version - in production, use a real drug interaction database
        interactions = []
        
        known_interactions = {
            ('paracétamol', 'ibuprofène'): {
                'severity': 'low',
                'description': 'Combination generally safe but monitor for side effects'
            },
            ('amoxicilline', 'ibuprofène'): {
                'severity': 'low',
                'description': 'No significant interaction'
            },
        }
        
        for i, med1 in enumerate(medications):
            for med2 in medications[i+1:]:
                key1 = (med1['generic_name'] or med1['name']).lower()
                key2 = (med2['generic_name'] or med2['name']).lower()
                
                # Check both orderings
                interaction = known_interactions.get((key1, key2)) or known_interactions.get((key2, key1))
                
                if interaction:
                    interactions.append({
                        'medication1': med1['name'],
                        'medication2': med2['name'],
                        'severity': interaction['severity'],
                        'description': interaction['description']
                    })
        
        return interactions
