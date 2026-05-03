"""
OCR Service for Prescription Analysis
Handles optical character recognition from prescription images
"""

import logging
import os
from typing import Dict, List

from django.conf import settings
from PIL import Image, ImageEnhance, ImageFilter

try:
    import pytesseract
except ImportError:  # pragma: no cover - environment dependent
    pytesseract = None

try:
    from google.cloud import vision
except ImportError:  # pragma: no cover - environment dependent
    vision = None

from .json_utils import ensure_json_serializable

logger = logging.getLogger(__name__)


class GoogleVisionOCR:
    """Primary OCR service using Google Cloud Vision API"""
    
    def __init__(self):
        self.enabled = bool(getattr(settings, "GOOGLE_VISION_ENABLED", False))
        self.credentials_path = str(getattr(settings, "GOOGLE_APPLICATION_CREDENTIALS", "") or "").strip()

        if not self.enabled:
            self.client = None
            self.available = False
            return

        if vision is None:
            logger.info("Google Vision OCR disabled because google-cloud-vision is not installed.")
            self.client = None
            self.available = False
            return

        if not self.credentials_path:
            logger.info("Google Vision OCR disabled because GOOGLE_APPLICATION_CREDENTIALS is not configured.")
            self.client = None
            self.available = False
            return

        if not os.path.exists(self.credentials_path):
            logger.warning("Google Vision OCR disabled because credentials file was not found at %s.", self.credentials_path)
            self.client = None
            self.available = False
            return
        try:
            self.client = vision.ImageAnnotatorClient()
            self.available = True
        except Exception as e:
            logger.warning("Google Vision OCR initialization failed after enablement: %s", e)
            self.available = False
    
    def analyze_prescription(self, image_path: str) -> Dict:
        """
        Analyze a prescription image using Google Cloud Vision API
        
        Args:
            image_path: Path to the prescription image file
            
        Returns:
            Dictionary containing OCR results with text and confidence scores
        """
        if not self.available:
            return {
                'success': False,
                'error': 'Google Vision API is disabled or unavailable',
                'text': '',
                'confidence': 0.0
            }
        
        try:
            with open(image_path, 'rb') as image_file:
                content = image_file.read()
            
            image = vision.Image(content=content)
            
            # Document text detection for handwriting recognition
            response = self.client.document_text_detection(image=image)
            
            # Extract text and confidence
            text_annotations = response.text_annotations
            full_text = text_annotations[0].description if text_annotations else ""
            
            # Calculate confidence score
            confidence_scores = [
                page.confidence 
                for page in response.full_text_annotation.pages
            ]
            avg_confidence = sum(confidence_scores) / len(confidence_scores) if confidence_scores else 0.0
            
            # Extract structured text blocks
            blocks = self._extract_blocks(response)
            paragraphs = self._extract_paragraphs(response)
            
            result = {
                'success': True,
                'text': full_text,
                'confidence': avg_confidence,
                'blocks': blocks,
                'paragraphs': paragraphs,
                'raw_response': {
                    'text_annotations_count': len(text_annotations),
                    'page_count': len(response.full_text_annotation.pages),
                },
            }
            return ensure_json_serializable(result)
            
        except Exception as e:
            logger.warning("Google Vision analysis error: %s", e)
            return {
                'success': False,
                'error': str(e),
                'text': '',
                'confidence': 0.0
            }
    
    def _extract_blocks(self, response) -> List[Dict]:
        """Extract text blocks from OCR response"""
        blocks = []
        for page in response.full_text_annotation.pages:
            for block in page.blocks:
                block_text = ' '.join([
                    symbol.text 
                    for paragraph in block.paragraphs 
                    for word in paragraph.words 
                    for symbol in word.symbols
                ])
                blocks.append({
                    'text': block_text,
                    'confidence': block.confidence,
                    'bounding_box': [
                        {'x': vertex.x, 'y': vertex.y}
                        for vertex in getattr(block.bounding_box, 'vertices', [])
                    ],
                })
        return blocks
    
    def _extract_paragraphs(self, response) -> List[Dict]:
        """Extract paragraphs from OCR response"""
        paragraphs = []
        for page in response.full_text_annotation.pages:
            for block in page.paragraphs:
                paragraph_text = ' '.join([
                    symbol.text 
                    for word in block.words 
                    for symbol in word.symbols
                ])
                paragraphs.append({
                    'text': paragraph_text,
                    'confidence': block.confidence
                })
        return paragraphs


class TesseractOCR:
    """Secondary OCR service using Tesseract OCR as fallback"""
    
    def __init__(self):
        # Configuration optimized for medical handwriting in French
        self.config = r'--oem 3 --psm 6 -l fra+eng'
        self.available = self._check_availability()
    
    def _check_availability(self) -> bool:
        """Check if Tesseract is available"""
        if pytesseract is None:
            return False
        try:
            pytesseract.get_tesseract_version()
            return True
        except Exception as e:
            logger.warning("Tesseract OCR not available: %s", e)
            return False
    
    def preprocess_image(self, image_path: str) -> Image.Image:
        """
        Preprocess image to improve OCR accuracy
        
        Args:
            image_path: Path to the image file
            
        Returns:
            Preprocessed PIL Image
        """
        img = Image.open(image_path)
        
        # Convert to grayscale
        img = img.convert('L')
        
        # Enhance contrast
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(2.0)
        
        # Reduce noise
        img = img.filter(ImageFilter.MedianFilter())
        
        # Sharpen image
        img = img.filter(ImageFilter.SHARPEN)
        
        # Upscale for better recognition
        img = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
        
        return img
    
    def analyze_prescription(self, image_path: str) -> Dict:
        """
        Analyze prescription image using Tesseract OCR
        
        Args:
            image_path: Path to the prescription image file
            
        Returns:
            Dictionary containing OCR results
        """
        if not self.available:
            return {
                'success': False,
                'error': 'Tesseract OCR not available',
                'text': '',
                'confidence': 0.0
            }
        
        try:
            # Preprocess image
            processed_img = self.preprocess_image(image_path)
            
            # Primary OCR attempt
            text = pytesseract.image_to_string(processed_img, config=self.config)
            confidence = self._calculate_confidence(text)
            
            if confidence > 0.5 and len(text.strip()) > 10:
                return {
                    'success': True,
                    'text': text,
                    'confidence': confidence,
                    'method': 'tesseract_primary'
                }
            
            # Fallback with different configuration
            fallback_config = r'--oem 1 --psm 3 -l fra'
            text = pytesseract.image_to_string(processed_img, config=fallback_config)
            
            return {
                'success': True,
                'text': text,
                'confidence': 0.5,  # Lower confidence for fallback
                'method': 'tesseract_fallback'
            }
            
        except Exception as e:
            logger.warning("Tesseract analysis error: %s", e)
            return {
                'success': False,
                'error': str(e),
                'text': '',
                'confidence': 0.0
            }
    
    def _calculate_confidence(self, text: str) -> float:
        """
        Calculate confidence score for OCR result
        
        Args:
            text: Extracted text
            
        Returns:
            Confidence score between 0 and 1
        """
        if not text or len(text.strip()) < 5:
            return 0.0
        
        # Check for common medical terms
        medical_terms = ['mg', 'g', 'ml', 'cp', 'comprimé', 'fois', 'jour', 'matin', 'soir']
        medical_score = sum(1 for term in medical_terms if term.lower() in text.lower())
        
        # Check text length
        length_score = min(len(text.strip()) / 100, 1.0)
        
        # Check for alphabetic characters
        alpha_ratio = sum(c.isalpha() for c in text) / len(text) if text else 0
        
        # Combined score
        confidence = (medical_score * 0.4 + length_score * 0.4 + alpha_ratio * 0.2)
        return min(confidence, 1.0)


class OCRService:
    """Main OCR service that manages multiple OCR engines"""
    
    def __init__(self):
        self.google_vision = GoogleVisionOCR()
        self.tesseract = TesseractOCR()
    
    def analyze_prescription(self, image_path: str) -> Dict:
        """
        Analyze prescription image using available OCR engines
        Tries Google Vision first, falls back to Tesseract
        
        Args:
            image_path: Path to the prescription image file
            
        Returns:
            Best OCR result from available engines
        """
        # Try Google Vision first (primary)
        if self.google_vision.available:
            result = self.google_vision.analyze_prescription(image_path)
            if result['success'] and result['confidence'] > 0.7:
                result['engine'] = 'google_vision'
                return result
        
        # Fallback to Tesseract
        if self.tesseract.available:
            result = self.tesseract.analyze_prescription(image_path)
            if result['success']:
                result['engine'] = 'tesseract'
                return result
        
        # Both engines failed
        return {
            'success': False,
            'error': 'No OCR engine available',
            'text': '',
            'confidence': 0.0,
            'engine': 'none'
        }
    
    def analyze_with_both_engines(self, image_path: str) -> Dict:
        """
        Analyze with both engines and return combined results
        
        Args:
            image_path: Path to the prescription image file
            
        Returns:
            Combined results from both engines
        """
        results = {}
        
        if self.google_vision.available:
            results['google_vision'] = self.google_vision.analyze_prescription(image_path)
        
        if self.tesseract.available:
            results['tesseract'] = self.tesseract.analyze_prescription(image_path)
        
        # Select best result
        best_result = None
        best_confidence = 0.0
        
        for engine, result in results.items():
            if result['success'] and result['confidence'] > best_confidence:
                best_result = result
                best_confidence = result['confidence']
                best_result['engine'] = engine
        
        if best_result:
            best_result['all_results'] = results
            return ensure_json_serializable(best_result)
        
        return ensure_json_serializable({
            'success': False,
            'error': 'All OCR engines failed',
            'text': '',
            'confidence': 0.0,
            'engine': 'none',
            'all_results': results
        })
