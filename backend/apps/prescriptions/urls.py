from django.urls import path
from .views import (
    ConfirmPrescriptionView,
    PrescriptionListView,
    PrescriptionUploadView,
    PrescriptionDetailView,
    PrescriptionAnalyzeView,
    PrescriptionAnalysisTaskStatusView,
    PrescriptionConfirmMedicationsView,
    PrescriptionRecommendationsView,
    PrescriptionSearchPharmaciesView,
    PrescriptionSelectPharmacyView,
    PrescriptionPharmacyConfirmView,
    PrescriptionPatientConfirmView,
    PrescriptionDocumentAccessView,
    PharmacyStockListView,
    PharmacyStockDetailView,
    ChatBotQAView,
)

urlpatterns = [
    path("", PrescriptionListView.as_view(), name="prescription-list"),
    path("upload/", PrescriptionUploadView.as_view(), name="prescription-upload"),
    path("upload-prescription/", PrescriptionUploadView.as_view(), name="upload-prescription-alias"),
    path("confirm-prescription/", ConfirmPrescriptionView.as_view(), name="confirm-prescription"),
    path("analysis-tasks/<uuid:task_id>/", PrescriptionAnalysisTaskStatusView.as_view(), name="prescription-analysis-task-status"),
    path("<int:id>/", PrescriptionDetailView.as_view(), name="prescription-detail"),
    path("<int:prescription_id>/confirm-medications/", PrescriptionConfirmMedicationsView.as_view(), name="prescription-confirm-medications"),
    path("<int:prescription_id>/confirm-items/", PrescriptionConfirmMedicationsView.as_view(), name="prescription-confirm-items"),
    path("<int:prescription_id>/search-pharmacies/", PrescriptionSearchPharmaciesView.as_view(), name="prescription-search-pharmacies"),
    path("<int:prescription_id>/match-pharmacies/", PrescriptionSearchPharmaciesView.as_view(), name="prescription-match-pharmacies"),
    path("<int:prescription_id>/recommendations/", PrescriptionRecommendationsView.as_view(), name="prescription-recommendations"),
    path("<int:prescription_id>/select-pharmacy/", PrescriptionSelectPharmacyView.as_view(), name="prescription-select-pharmacy"),
    path("<int:prescription_id>/document/", PrescriptionDocumentAccessView.as_view(), name="prescription-document-access"),
    path("<int:prescription_id>/pharmacy-confirm/", PrescriptionPharmacyConfirmView.as_view(), name="prescription-pharmacy-confirm"),
    path("<int:prescription_id>/patient-confirm/", PrescriptionPatientConfirmView.as_view(), name="prescription-patient-confirm"),
    path("<int:prescription_id>/analyze/", PrescriptionAnalyzeView.as_view(), name="prescription-analyze"),
    path("pharmacy-stock/", PharmacyStockListView.as_view(), name="pharmacy-stock-list"),
    path("pharmacy-stock/<int:id>/", PharmacyStockDetailView.as_view(), name="pharmacy-stock-detail"),
    path("chatbot-qa/", ChatBotQAView.as_view(), name="chatbot-qa"),
]




# {

# ajoute correctement ces details ou bien ajuste correctement ces details puis donne moi le detail bien structures et correcte: je veux alors que mon chatbot soit intelligent, je veux  faire un chatbot qui sera specialise a annalyser les captures des ordonnances,il sera entraine suffusamment pour comprendre les differentes ecritures de differents docteurs pour qu'il arrive a comprendre exacement les medicaments prescrits sur l'ordonance, puis apres avoir lu et compris l'ordonnance, et avoir confirme ces medicaments aupres du patient via un popu de confirmation, il va parcourir dans les donnees de toutes les pharmacies enregstrees sur la plateforme rechrechant dans quelle pharmacie il va trouver ces medicaments, et une fois les trouver, il revient au petient pour l'orienter vers cette pharmacie la, si c'est beaucoup, alors il va lui lister toutes les pharmacies qui possede se meidicaments puis lui il va choisir ou aller via le bouton dispoble sur chaque pharmacie possedant ces medicaments .donc je veux que mon chatbot intelligent fasse ceci:accueillir le patient ;
# expliquer comment utiliser la plateforme ,:1. Patient publie une ordonnance
#         ↓
# 2. Le chatbot analyse l’image de l’ordonnance
#         ↓
# 3. Le chatbot demande confirmation au patient ou au pharmacien s’il y a un doute
#         ↓
# 4. Après confirmation, il extrait les médicaments prescrits
#         ↓
# 5. Il compare les médicaments avec les stocks des pharmacies
#         ↓
# 6. Il liste les pharmacies qui possèdent les médicaments
#         ↓
# 7. Le patient choisit une pharmacie
#         ↓
# 8. La pharmacie prépare / sert les médicaments
#         ↓
# 9. La pharmacie clique “Ordonnance servie”
#         ↓
# 10. Le patient confirme “Oui, j’ai bien acheté”
#         ↓
# 11. L’ordonnance est classée comme “déjà servie” mais il faut bien verifie si toutes les activite sont a temps reel par ce que c'est ca l'objectif, tout doit etre a temps rel, l'enegistrement reussi,la connexion reussie,la sychronisation reusie et a temps reel, tous les dahboards fonctionnels et tout a temps reel,le chat repons correctement et bien a temps reel


# }
