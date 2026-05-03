import pytesseract
from PIL import Image
import io
import logging

logger = logging.getLogger(__name__)

class OCRService:
    @staticmethod
    def process_image(image_file):
        """
        Process an uploaded image file and extract text using OCR
        """
        try:
            # Convert uploaded file to PIL Image
            image = Image.open(io.BytesIO(image_file.read()))
            # Preprocess image for better OCR accuracy
            processed_image = OCRService._preprocess_image(image)
            # Perform OCR with French and English language support
            text = pytesseract.image_to_string(processed_image, lang='fra+eng')
            logger.info(f"OCR extracted text: {text[:100]}...")
            return text
        except Exception as e:
            logger.error(f"Error processing image with OCR: {str(e)}")
            raise

    @staticmethod
    def _preprocess_image(image):
        """
        Preprocess image to improve OCR accuracy
        """
        # Convert to grayscale
        gray = image.convert('L')
        # Apply thresholding to get black and white image
        threshold = 128
        bw = gray.point(lambda x: 0 if x < threshold else 255, mode='1')
        return bw