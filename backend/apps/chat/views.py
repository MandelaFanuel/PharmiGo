from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action
from .models import Prescription, MedicationExtraction
from .serializers import PrescriptionSerializer, MedicationExtractionSerializer
from .ocr_service import OCRService
from .medication_parser import MedicationParser

class PrescriptionViewSet(viewsets.ModelViewSet):
    queryset = Prescription.objects.all()
    serializer_class = PrescriptionSerializer

    @action(detail=True, methods=['post'])
    def analyze(self, request, pk=None):
        prescription = self.get_object()
        # Process image with OCR
        ocr_text = OCRService.process_image(prescription.prescription_image)
        prescription.ocr_text = ocr_text
        prescription.save()
        # Extract medications
        medications = MedicationParser.parse_ocr_text(ocr_text)
        serializer = MedicationExtractionSerializer(data=[med.to_dict() for med in medications])
        serializer.is_valid(raise_exception=True)
        MedicationExtraction.objects.bulk_create([
            MedicationExtraction(
                prescription=prescription,
                name=med.name,
                generic_name=med.generic_name,
                dosage=med.dosage,
                quantity=med.quantity,
                unit=med.unit,
                confidence=med.confidence
            ) for med in medications
        ])
        return Response(serializer.data, status=status.HTTP_201_CREATED)

# Additional views and endpoints would be added here