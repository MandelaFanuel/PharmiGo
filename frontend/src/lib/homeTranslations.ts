import type { Language } from "./i18n";

export type LandingCopy = {
  navServices: string;
  navHow: string;
  navSupport: string;
  navLogin: string;
  navRegister: string;
  heroKicker: string;
  heroTitle: string;
  heroBody: string;
  heroPrimary: string;
  heroSecondary: string;
  statTime: string;
  statPharmacies: string;
  statSatisfaction: string;
  highlights: Array<{ title: string; body: string; icon: string }>;
  workflowKicker: string;
  workflowTitle: string;
  workflowBody: string;
  workflowSteps: Array<{ index: string; title: string; body: string }>;
  networkTitle: string;
  networkBody: string;
  featuresTitle: string;
  securityTitle: string;
  supportKicker: string;
  supportTitle: string;
  supportBody: string;
  supportCards: Array<{ title: string; body: string }>;
  finalKicker: string;
  finalTitle: string;
  finalBody: string;
  finalPrimary: string;
  finalSecondary: string;
  footerQuickLinks: string;
  footerAbout: string;
  footerContact: string;
  footerAction: string;
  footerActionBody: string;
  footerLinkServices: string;
  footerLinkPharmacies: string;
  footerLinkHow: string;
  footerLinkSupport: string;
  footerLinkLogin: string;
  footerLinkRegister: string;
  footerBottom: string;
  modalLoginTitle: string;
  modalLoginBody: string;
  modalRegisterTitle: string;
  modalRegisterBody: string;
  modalUploadTitle: string;
  modalUploadBody: string;
  modalClose: string;
  authEmail: string;
  authPassword: string;
  authLoginSubmit: string;
  authNoAccount: string;
  authCreateAccount: string;
  authHaveAccount: string;
  authLoginLink: string;
  authPatient: string;
  authPharmacy: string;
  authUsername: string;
  authPhone: string;
  authPharmacyName: string;
  authWhatsapp: string;
  authAddress: string;
  authPatientSubmit: string;
  authPharmacySubmit: string;
  uploadSuccessPrefix: string;
};

export type HomeUiText = {
  authIdentifier: string;
  authIdentifierPlaceholder: string;
  authLoginSuccess: string;
  authRegisterSuccessPatient: string;
  authRegisterSuccessPharmacy: string;
  authRequired: string;
  authPasswordMin: string;
  authPhoneHint: string;
  authRegisterPhoneHint: string;
  authPharmacyHint: string;
  uploadBody: string;
  uploadError: string;
  accountReady: string;
  footerCopy: string;
};

export const landingCopy: Record<Language, LandingCopy> = {
  fr: {
    navServices: "Services",
    navHow: "Comment ca marche",
    navSupport: "Aide & Support",
    navLogin: "Connexion",
    navRegister: "Inscription",
    heroKicker: "Acces rapide aux medicaments",
    heroTitle: "Trouvez rapidement les pharmacies qui disposent de vos medicaments.",
    heroBody:
      "Publiez votre ordonnance sur la plateforme, laissez les pharmacies inscrites repondre en temps reel puis choisissez l'option la plus pratique.",
    heroPrimary: "Publier mon ordonnance",
    heroSecondary: "En Savoir Plus",
    statTime: "Temps moyen",
    statPharmacies: "Pharmacies",
    statSatisfaction: "Satisfaction",
    highlights: [
      { title: "Pharmacies connectees", body: "Les pharmacies s'annoncent en temps reel si elles disposent de vos medicaments.", icon: "💬" },
      { title: "Trouvez la plus proche", body: "Choisissez la pharmacie la plus pratique selon la distance, le retrait ou la livraison.", icon: "📍" },
      { title: "Gagnez du temps", body: "Plus besoin d'appeler plusieurs pharmacies. Toute la recherche est centralisee.", icon: "⏱" },
    ],
    workflowKicker: "Comment ca marche",
    workflowTitle: "Une experience simple pour le patient, structurante pour les pharmacies.",
    workflowBody: "Chaque etape reste lisible, rapide et calme, meme sur mobile.",
    workflowSteps: [
      { index: "01", title: "Publiez votre ordonnance", body: "Ajoutez votre prescription en quelques secondes et laissez la plateforme diffuser votre besoin." },
      { index: "02", title: "Recevez des reponses", body: "Les pharmacies confirment la disponibilite et le delai de retrait." },
      { index: "03", title: "Choisissez simplement", body: "Comparez les options et retenez la pharmacie la plus pratique." },
    ],
    networkTitle: "PharmiGo : La Revolution de l'Acces aux Medicaments",
    networkBody: "Decouvrez comment PharmiGo transforme votre experience de recherche de medicaments avec une technologie innovante et un reseau intelligent.",
    featuresTitle: "Pourquoi PharmiGo est Essentiel pour Votre Sante",
    securityTitle: "La Technologie PharmiGo au Service de la Communaute",
    supportKicker: "Aide & Support",
    supportTitle: "Une interface rassurante pour les patients comme pour les pharmacies.",
    supportBody: "Chaque zone de la page est pensee pour guider sans surcharge.",
    supportCards: [
      { title: "Securite et confidentialite", body: "Ordonnances, conversations et donnees patient sont traitees dans un cadre securise." },
      { title: "Accompagnement patient", body: "Une equipe peut guider les patients pour publier ou suivre une demande." },
      { title: "Pilotage des operations", body: "Le back-office centralise les demandes pour aider les equipes a agir vite." },
    ],
    finalKicker: "Pret a lancer la recherche ?",
    finalTitle: "Une seule page, une direction claire et une experience nettement plus fluide.",
    finalBody: "Tout se fait ici: consulter, se connecter, s'inscrire et publier une ordonnance.",
    finalPrimary: "Publier mon ordonnance",
    finalSecondary: "Creer un compte",
    footerQuickLinks: "Navigation rapide",
    footerAbout: "A propos",
    footerContact: "Contact",
    footerAction: "Demarrage rapide",
    footerActionBody: "Utilisez les actions principales sans quitter la page.",
    footerLinkServices: "Services",
    footerLinkPharmacies: "Pharmacies",
    footerLinkHow: "Comment ca marche",
    footerLinkSupport: "Support",
    footerLinkLogin: "Connexion",
    footerLinkRegister: "Inscription",
    footerBottom: "PharmiGo. Une experience simple pour trouver vos medicaments plus vite.",
    modalLoginTitle: "Connexion",
    modalLoginBody: "Entrez vos informations pour acceder a votre espace PharmiGo.",
    modalRegisterTitle: "Inscription",
    modalRegisterBody: "Choisissez votre profil et remplissez uniquement les informations utiles.",
    modalUploadTitle: "Publier une ordonnance",
    modalUploadBody: "Diffusez votre besoin sans quitter cette page.",
    modalClose: "Fermer",
    authEmail: "Email",
    authPassword: "Mot de passe",
    authLoginSubmit: "Connexion",
    authNoAccount: "Pas encore de compte ?",
    authCreateAccount: "Creer un compte",
    authHaveAccount: "Vous avez deja un compte ?",
    authLoginLink: "Se connecter",
    authPatient: "Patient",
    authPharmacy: "Pharmacie",
    authUsername: "Nom d'utilisateur",
    authPhone: "Numero de telephone",
    authPharmacyName: "Nom de la pharmacie",
    authWhatsapp: "Numero WhatsApp",
    authAddress: "Adresse exacte",
    authPatientSubmit: "Creer mon compte patient",
    authPharmacySubmit: "Enregistrer ma pharmacie",
    uploadSuccessPrefix: "Ordonnance envoyee avec succes",
  },
  en: {
    navServices: "Services",
    navHow: "How it works",
    navSupport: "Support",
    navLogin: "Login",
    navRegister: "Register",
    heroKicker: "Fast access to medicine",
    heroTitle: "Quickly find pharmacies that have your medicine available.",
    heroBody: "Publish your prescription to the platform, let registered pharmacies respond in real time, then choose the option that suits you best.",
    heroPrimary: "Publish my prescription",
    heroSecondary: "Explore the network",
    statTime: "Average time",
    statPharmacies: "Pharmacies",
    statSatisfaction: "Satisfaction",
    highlights: [
      { title: "Connected pharmacies", body: "Pharmacies respond in real time when your medicine is available.", icon: "💬" },
      { title: "Find the nearest one", body: "Choose the most practical pharmacy based on distance or delivery.", icon: "📍" },
      { title: "Save time", body: "No need to call many pharmacies. The search stays centralized.", icon: "⏱" },
    ],
    workflowKicker: "How it works",
    workflowTitle: "A simple patient journey with clear structure for pharmacies.",
    workflowBody: "Each step stays readable, fast, and calm across screen sizes.",
    workflowSteps: [
      { index: "01", title: "Publish your prescription", body: "Add your prescription in seconds and broadcast your need." },
      { index: "02", title: "Receive responses", body: "Pharmacies confirm availability and pickup timing." },
      { index: "03", title: "Choose easily", body: "Compare options and pick the pharmacy that fits you best." },
    ],
    networkTitle: "A visible network that is useful and easy to compare.",
    networkBody: "Identify pharmacies ready to answer without leaving the page.",
    featuresTitle: "Key matching features",
    securityTitle: "Trust and security framework",
    supportKicker: "Help & Support",
    supportTitle: "A reassuring interface for patients and pharmacies alike.",
    supportBody: "Every area is designed to guide without visual overload.",
    supportCards: [
      { title: "Security and privacy", body: "Prescriptions, conversations, and patient data stay within a secure framework." },
      { title: "Patient support", body: "A support team can guide users when publishing or tracking a request." },
      { title: "Operations control", body: "Back-office tools centralize requests and help teams act faster." },
    ],
    finalKicker: "Ready to start?",
    finalTitle: "One page, one clear direction, and a much smoother experience.",
    finalBody: "Everything happens here: browse, log in, register, and publish a prescription.",
    finalPrimary: "Publish my prescription",
    finalSecondary: "Create an account",
    footerQuickLinks: "Quick navigation",
    footerAbout: "About",
    footerContact: "Contact",
    footerAction: "Quick start",
    footerActionBody: "Use the main actions without leaving the page.",
    footerLinkServices: "Services",
    footerLinkPharmacies: "Pharmacies",
    footerLinkHow: "How it works",
    footerLinkSupport: "Support",
    footerLinkLogin: "Login",
    footerLinkRegister: "Register",
    footerBottom: "PharmiGo. A calmer way to find your medicine faster.",
    modalLoginTitle: "Login",
    modalLoginBody: "Enter your details to access your PharmiGo space.",
    modalRegisterTitle: "Register",
    modalRegisterBody: "Choose your profile and fill only the useful information.",
    modalUploadTitle: "Publish a prescription",
    modalUploadBody: "Broadcast your need without leaving this page.",
    modalClose: "Close",
    authEmail: "Email",
    authPassword: "Password",
    authLoginSubmit: "Login",
    authNoAccount: "No account yet?",
    authCreateAccount: "Create one",
    authHaveAccount: "Already have an account?",
    authLoginLink: "Log in",
    authPatient: "Patient",
    authPharmacy: "Pharmacy",
    authUsername: "Username",
    authPhone: "Phone number",
    authPharmacyName: "Pharmacy name",
    authWhatsapp: "WhatsApp number",
    authAddress: "Exact address",
    authPatientSubmit: "Create patient account",
    authPharmacySubmit: "Register my pharmacy",
    uploadSuccessPrefix: "Prescription sent successfully",
  },
  rn: {
    navServices: "Services",
    navHow: "Uko bikora",
    navSupport: "Gufasha",
    navLogin: "Kwinjira",
    navRegister: "Kwiyandikisha",
    heroKicker: "Kuronka imiti vyihuse",
    heroTitle: "Rondera vuba amafarumasi afise imiti ukeneye.",
    heroBody: "Shira ordonnance yawe kuri plateforme, amafarumasi yanditswe yishure mu kanya nyako hanyuma uhitemwo ikubereye.",
    heroPrimary: "Shira ordonnance yanje",
    heroSecondary: "Raba reseau",
    statTime: "Umwanya",
    statPharmacies: "Amafarumasi",
    statSatisfaction: "Uguhimbarwa",
    highlights: [
      { title: "Amafarumasi ahujwe", body: "Amafarumasi yishura mu kanya nyako igihe imiti ibonetse.", icon: "💬" },
      { title: "Hitamwo irihegereye", body: "Hitamwo farumasi ikwegereye canke ifise livraison.", icon: "📍" },
      { title: "Bika umwanya", body: "Ntubwirizwa guhamagara amafarumasi menshi. Vyose biri hamwe.", icon: "⏱" },
    ],
    workflowKicker: "Uko bikora",
    workflowTitle: "Urugendo rworoshe ku murwayi kandi ruteguye neza amafarumasi.",
    workflowBody: "Intambwe zose zirasomeka kandi ziroroshe ku bikoresho vyose.",
    workflowSteps: [
      { index: "01", title: "Shira ordonnance", body: "Tanga prescription yawe mu masegonda make." },
      { index: "02", title: "Ronka inyishu", body: "Amafarumasi yemeza ukuboneka, igiciro n'umwanya." },
      { index: "03", title: "Hitamwo neza", body: "Gereranya amahitamwo maze uhitemwo ikubereye." },
    ],
    networkTitle: "Reseau iboneka kandi yoroshe kugereranya.",
    networkBody: "Menya amafarumasi ashobora kukwishura utavuye kuri uru rupapuro.",
    featuresTitle: "Ibikorwa nyamukuru",
    securityTitle: "Umutekano n'ukwizigirwa",
    supportKicker: "Gufasha",
    supportTitle: "Interface itanga amahoro ku murwayi no kuri farumasi.",
    supportBody: "Igice cose catekerejwe kugira kiyobore ata kuzitira amaso.",
    supportCards: [
      { title: "Umutekano", body: "Ordonnance n'amakuru y'umurwayi bibikwa neza." },
      { title: "Gufasha umurwayi", body: "Hari uwugufasha igihe ushaka gushira canke gukurikirana ivyo wasavye." },
      { title: "Gukurikirana ibikorwa", body: "Back-office ihuriza hamwe ibisabwa kugira ibikorwa vyihute." },
    ],
    finalKicker: "Witeguye gutangura ?",
    finalTitle: "Urupapuro rumwe, inzira imwe, n'uburyo bworoshe kurusha mbere.",
    finalBody: "Vyose bikorerwa hano: kuraba, kwinjira, kwiyandikisha no gushira ordonnance.",
    finalPrimary: "Shira ordonnance yanje",
    finalSecondary: "Fungura konti",
    footerQuickLinks: "Amayira yihuse",
    footerAbout: "Ibijanye natwe",
    footerContact: "Contact",
    footerAction: "Gutanguza vuba",
    footerActionBody: "Koresha ibikorwa vy'ingenzi utavuye kuri uru rupapuro.",
    footerLinkServices: "Services",
    footerLinkPharmacies: "Amafarumasi",
    footerLinkHow: "Uko bikora",
    footerLinkSupport: "Gufasha",
    footerLinkLogin: "Kwinjira",
    footerLinkRegister: "Kwiyandikisha",
    footerBottom: "PharmiGo. Inzira yoroshe yo kuronka imiti vuba.",
    modalLoginTitle: "Kwinjira",
    modalLoginBody: "Shiramwo amakuru yawe kugira winjire muri PharmiGo.",
    modalRegisterTitle: "Kwiyandikisha",
    modalRegisterBody: "Hitamwo profil yawe hanyuma ushireho amakuru akenewe gusa.",
    modalUploadTitle: "Shira ordonnance",
    modalUploadBody: "Tangaza ivyo ukeneye utavuye kuri uru rupapuro.",
    modalClose: "Funga",
    authEmail: "Email",
    authPassword: "Ijambo banga",
    authLoginSubmit: "Kwinjira",
    authNoAccount: "Nta konti ufise ?",
    authCreateAccount: "Fungura konti",
    authHaveAccount: "Usanzwe ufise konti ?",
    authLoginLink: "Injira",
    authPatient: "Umurwayi",
    authPharmacy: "Farumasi",
    authUsername: "Izina ukoresha",
    authPhone: "Numero ya telefone",
    authPharmacyName: "Izina rya farumasi",
    authWhatsapp: "Numero ya WhatsApp",
    authAddress: "Aderesi nyayo",
    authPatientSubmit: "Fungura konti y'umurwayi",
    authPharmacySubmit: "Andikisha farumasi yanje",
    uploadSuccessPrefix: "Ordonnance yoherejwe neza",
  },
  sw: {
    navServices: "Huduma",
    navHow: "Jinsi inavyofanya kazi",
    navSupport: "Msaada",
    navLogin: "Ingia",
    navRegister: "Jisajili",
    heroKicker: "Upatikanaji wa dawa haraka",
    heroTitle: "Pata haraka maduka ya dawa yenye dawa unazohitaji.",
    heroBody: "Tuma preskripsheni yako kwenye jukwaa, maduka yaliyosajiliwa yajibu kwa wakati halisi, kisha uchague linalokufaa.",
    heroPrimary: "Tuma preskripsheni yangu",
    heroSecondary: "Chunguza mtandao",
    statTime: "Muda",
    statPharmacies: "Maduka ya dawa",
    statSatisfaction: "Kuridhika",
    highlights: [
      { title: "Maduka yaliyounganishwa", body: "Maduka ya dawa hujibu kwa wakati halisi dawa zinapopatikana.", icon: "💬" },
      { title: "Pata lililo karibu", body: "Chagua duka lililo karibu au lenye usafirishaji.", icon: "📍" },
      { title: "Okoa muda", body: "Hakuna haja ya kupiga simu nyingi. Utafutaji wote upo sehemu moja.", icon: "⏱" },
    ],
    workflowKicker: "Jinsi inavyofanya kazi",
    workflowTitle: "Safari rahisi kwa mgonjwa na mfumo wazi kwa duka la dawa.",
    workflowBody: "Kila hatua ni nyepesi kusoma na kutumia kwenye skrini zote.",
    workflowSteps: [
      { index: "01", title: "Tuma preskripsheni", body: "Weka preskripsheni yako kwa sekunde chache." },
      { index: "02", title: "Pokea majibu", body: "Maduka yanathibitisha upatikanaji, bei na muda." },
      { index: "03", title: "Chagua kwa urahisi", body: "Linganisha chaguo na chagua linalokufaa." },
    ],
    networkTitle: "Mtandao unaoonekana wazi na rahisi kulinganisha.",
    networkBody: "Tambua maduka ya dawa yaliyo tayari kujibu bila kuondoka kwenye ukurasa huu.",
    featuresTitle: "Vipengele muhimu",
    securityTitle: "Uaminifu na usalama",
    supportKicker: "Msaada",
    supportTitle: "Kiolesura kinachotia imani kwa wagonjwa na maduka ya dawa.",
    supportBody: "Kila eneo limeandaliwa kuongoza bila msongamano wa kuona.",
    supportCards: [
      { title: "Usalama", body: "Preskripsheni na taarifa za wagonjwa zinatunzwa kwa usalama." },
      { title: "Msaada wa mgonjwa", body: "Timu inaweza kusaidia wakati wa kutuma au kufuatilia ombi." },
      { title: "Ufuatiliaji wa shughuli", body: "Back-office hukusanya maombi yote ili timu ifanye haraka." },
    ],
    finalKicker: "Uko tayari kuanza?",
    finalTitle: "Ukurasa mmoja, mwelekeo mmoja, na uzoefu mwepesi zaidi.",
    finalBody: "Kila kitu kinafanyika hapa: kuona, kuingia, kujisajili na kutuma preskripsheni.",
    finalPrimary: "Tuma preskripsheni yangu",
    finalSecondary: "Fungua akaunti",
    footerQuickLinks: "Njia za haraka",
    footerAbout: "Kuhusu",
    footerContact: "Mawasiliano",
    footerAction: "Anza haraka",
    footerActionBody: "Tumia vitendo vikuu bila kuondoka kwenye ukurasa.",
    footerLinkServices: "Huduma",
    footerLinkPharmacies: "Maduka ya dawa",
    footerLinkHow: "Jinsi inavyofanya kazi",
    footerLinkSupport: "Msaada",
    footerLinkLogin: "Ingia",
    footerLinkRegister: "Jisajili",
    footerBottom: "PharmiGo. Njia tulivu ya kupata dawa zako haraka zaidi.",
    modalLoginTitle: "Ingia",
    modalLoginBody: "Weka taarifa zako ili kuingia kwenye nafasi yako ya PharmiGo.",
    modalRegisterTitle: "Jisajili",
    modalRegisterBody: "Chagua aina ya akaunti na ujaze taarifa muhimu tu.",
    modalUploadTitle: "Tuma preskripsheni",
    modalUploadBody: "Tangaza hitaji lako bila kuondoka kwenye ukurasa huu.",
    modalClose: "Funga",
    authEmail: "Barua pepe",
    authPassword: "Nenosiri",
    authLoginSubmit: "Ingia",
    authNoAccount: "Huna akaunti bado?",
    authCreateAccount: "Fungua akaunti",
    authHaveAccount: "Tayari una akaunti?",
    authLoginLink: "Ingia",
    authPatient: "Mgonjwa",
    authPharmacy: "Duka la dawa",
    authUsername: "Jina la mtumiaji",
    authPhone: "Nambari ya simu",
    authPharmacyName: "Jina la duka la dawa",
    authWhatsapp: "Nambari ya WhatsApp",
    authAddress: "Anwani kamili",
    authPatientSubmit: "Fungua akaunti ya mgonjwa",
    authPharmacySubmit: "Sajili duka langu",
    uploadSuccessPrefix: "Preskripsheni imetumwa vizuri",
  },
  ln: {
    navServices: "Services",
    navHow: "Ndenge esalaka",
    navSupport: "Soutien",
    navLogin: "Kokota",
    navRegister: "Komikomisa",
    heroKicker: "Kozwa nkisi noki",
    heroTitle: "Luka noki ba pharmacie oyo bazali na nkisi oyo osengeli na yango.",
    heroBody: "Tinda ordonnance na yo na plateforme, bongo ba pharmacie oyo bakomami bakozongisa biyano na tango ya solo, mpe na nsima pona oyo ekokani na yo.",
    heroPrimary: "Tinda ordonnance na ngai",
    heroSecondary: "Tala reseau",
    statTime: "Tango",
    statPharmacies: "Ba pharmacie",
    statSatisfaction: "Esengo",
    highlights: [
      { title: "Ba pharmacie connectees", body: "Ba pharmacie bazongisaka eyano na tango ya solo soki nkisi ezali.", icon: "💬" },
      { title: "Mona oyo eleki pene", body: "Pona oyo ezali pene to oyo ekoki kosala livraison.", icon: "📍" },
      { title: "Bomba tango", body: "Ozali lisusu te kobenga ebele ya ba pharmacie. Nionso ezali esika moko.", icon: "⏱" },
    ],
    workflowKicker: "Ndenge esalaka",
    workflowTitle: "Mobembo ya pete mpo na patient mpe ebongisami mpo na pharmacie.",
    workflowBody: "Etape nyonso esalemi mpo na kosoma noki na ba ecrans nyonso.",
    workflowSteps: [
      { index: "01", title: "Tinda ordonnance", body: "Tia prescription na yo na mwa ba secondes." },
      { index: "02", title: "Zwa biyano", body: "Ba pharmacie bandimaka disponibilité, ntalo mpe tango." },
      { index: "03", title: "Pona malembe", body: "Compara ba options mpe pona oyo ekoki na yo." },
    ],
    networkTitle: "Reseau oyo emonanaka malamu mpe ezalaka pete mpo na kokokanisa.",
    networkBody: "Mona ba pharmacie oyo bakoki koyanola kozanga kobima na page oyo.",
    featuresTitle: "Makoki ya ntina",
    securityTitle: "Bokengi mpe bondimi",
    supportKicker: "Soutien",
    supportTitle: "Interface ya kimia mpo na ba patient mpe ba pharmacie.",
    supportBody: "Esika nyonso ebongisami mpo na kokamba kozanga kotondisa miso.",
    supportCards: [
      { title: "Bokengi", body: "Ordonnance mpe ba informations ya patient ebombamaka malamu." },
      { title: "Soutien ya patient", body: "Equipe ekoki kosunga ntango ya kotinda to kolanda demande." },
      { title: "Pilotage ya mosala", body: "Back-office esangisaka ba demandes mpo ete ba equipe basalaka noki." },
    ],
    finalKicker: "Ozali pene kobanda?",
    finalTitle: "Page moko, direction moko, mpe expérience ya pete koleka.",
    finalBody: "Nionso esalemaka awa: kotala, kokota, komikomisa mpe kotinda ordonnance.",
    finalPrimary: "Tinda ordonnance na ngai",
    finalSecondary: "Fungola compte",
    footerQuickLinks: "Ba liens rapides",
    footerAbout: "Na tina na biso",
    footerContact: "Contact",
    footerAction: "Debut rapide",
    footerActionBody: "Salela ba actions ya minene kozanga kobima na page.",
    footerLinkServices: "Services",
    footerLinkPharmacies: "Ba pharmacie",
    footerLinkHow: "Ndenge esalaka",
    footerLinkSupport: "Soutien",
    footerLinkLogin: "Kokota",
    footerLinkRegister: "Komikomisa",
    footerBottom: "PharmiGo. Ndenge ya kimia mpo na kozwa nkisi noki koleka.",
    modalLoginTitle: "Kokota",
    modalLoginBody: "Tia ba informations na yo mpo na kokota na espace PharmiGo.",
    modalRegisterTitle: "Komikomisa",
    modalRegisterBody: "Pona profil na yo mpe tia kaka makambo ya ntina.",
    modalUploadTitle: "Tinda ordonnance",
    modalUploadBody: "Sakola posa na yo kozanga kobima na page oyo.",
    modalClose: "Kanga",
    authEmail: "Email",
    authPassword: "Mot de passe",
    authLoginSubmit: "Kokota",
    authNoAccount: "Compte ezali naino te?",
    authCreateAccount: "Fungola compte",
    authHaveAccount: "Ozali deja na compte?",
    authLoginLink: "Kokota",
    authPatient: "Patient",
    authPharmacy: "Pharmacie",
    authUsername: "Kombo ya mosaleli",
    authPhone: "Numero ya telefone",
    authPharmacyName: "Kombo ya pharmacie",
    authWhatsapp: "Numero ya WhatsApp",
    authAddress: "Adresse ya solo",
    authPatientSubmit: "Fungola compte ya patient",
    authPharmacySubmit: "Komikomisa pharmacie na ngai",
    uploadSuccessPrefix: "Ordonnance etindami malamu",
  },
};

export const homeUiText: Record<Language, HomeUiText> = {
  fr: {
    authIdentifier: "Numero de telephone ou email",
    authIdentifierPlaceholder: "+243812345678 ou email administrateur",
    authLoginSuccess: "Connexion reussie. Votre espace PharmiGo est pret.",
    authRegisterSuccessPatient: "Inscription reussie. Vous pouvez maintenant vous connecter.",
    authRegisterSuccessPharmacy: "Pharmacie enregistree avec succes. Connectez-vous avec votre numero WhatsApp.",
    authRequired: "Veuillez remplir tous les champs requis.",
    authPasswordMin: "Le mot de passe doit contenir au moins 6 caracteres.",
    authPhoneHint: "Patients et pharmacies : numero complet avec indicatif pays. Administrateur : email officiel.",
    authRegisterPhoneHint: "Selectionnez le pays puis saisissez seulement votre numero local, sans l'indicatif.",
    authPharmacyHint: "Votre officine sera visible sur la plateforme des qu'elle est enregistree.",
    uploadBody: "Publiez votre ordonnance sur la plateforme. Les pharmacies deja inscrites la voient et y repondent en temps reel.",
    uploadError: "Impossible d'envoyer l'ordonnance pour le moment.",
    accountReady: "Connecte",
    footerCopy: "PharmiGo diffuse les ordonnances sur la plateforme, puis les pharmacies inscrites repondent en temps reel dans un cadre simple et fiable.",
  },
  en: {
    authIdentifier: "Phone number or email",
    authIdentifierPlaceholder: "+243812345678 or administrator email",
    authLoginSuccess: "Login successful. Your PharmiGo space is ready.",
    authRegisterSuccessPatient: "Registration successful. You can now sign in.",
    authRegisterSuccessPharmacy: "Pharmacy registered successfully. Sign in with your WhatsApp number.",
    authRequired: "Please fill in all required fields.",
    authPasswordMin: "Password must contain at least 6 characters.",
    authPhoneHint: "Patients and pharmacies use their full phone number. The administrator uses the official email only.",
    authRegisterPhoneHint: "Choose the country then enter only the local number, without the country code.",
    authPharmacyHint: "Your pharmacy becomes visible on the platform as soon as it is registered.",
    uploadBody: "Publish your prescription to the platform. Registered pharmacies see it and respond in real time.",
    uploadError: "Unable to submit the prescription right now.",
    accountReady: "Signed in",
    footerCopy: "PharmiGo broadcasts prescriptions to the platform, then registered pharmacies respond in real time within a simple and reliable workflow.",
  },
  rn: {
    authIdentifier: "Numero ya telefone canke email",
    authIdentifierPlaceholder: "+243812345678 canke email ya administrateur",
    authLoginSuccess: "Winjiye neza. Espace yawe ya PharmiGo irateguwe.",
    authRegisterSuccessPatient: "Kwiyandikisha vyagenze neza. Ubu ushobora kwinjira.",
    authRegisterSuccessPharmacy: "Farumasi yanditswe neza. Injira ukoresheje numero ya WhatsApp.",
    authRequired: "Uzuza amakuru yose akenewe.",
    authPasswordMin: "Ijambo banga ritegerezwa kuba rifise nibura inyuguti 6.",
    authPhoneHint: "Abarwayi n'amafarumasi bakoresha numero yuzuye. Administrateur akoresha email yemewe gusa.",
    authRegisterPhoneHint: "Hitamwo igihugu hanyuma wandike gusa numero yawe yo mu gihugu, ata ndanga gihugu.",
    authPharmacyHint: "Farumasi yawe izoboneka kuri plateforme igihe izoba yanditswe.",
    uploadBody: "Shira ordonnance yawe kuri plateforme. Amafarumasi yanditswe ayibona kandi akayishura mu kanya nyako.",
    uploadError: "Ntivyashobotse kohereza ordonnance ubu nyene.",
    accountReady: "Winjiye",
    footerCopy: "PharmiGo itangaza ordonnances kuri plateforme, hanyuma amafarumasi yanditswe agatanga inyishu mu kanya nyako mu buryo bworoshe kandi bwizewe.",
  },
  sw: {
    authIdentifier: "Nambari ya simu au barua pepe",
    authIdentifierPlaceholder: "+243812345678 au barua pepe ya admin",
    authLoginSuccess: "Umeingia vizuri. Nafasi yako ya PharmiGo iko tayari.",
    authRegisterSuccessPatient: "Usajili umefanikiwa. Sasa unaweza kuingia.",
    authRegisterSuccessPharmacy: "Duka la dawa limesajiliwa vizuri. Ingia kwa nambari yako ya WhatsApp.",
    authRequired: "Tafadhali jaza sehemu zote zinazohitajika.",
    authPasswordMin: "Nenosiri lazima liwe na angalau herufi 6.",
    authPhoneHint: "Wagonjwa na maduka ya dawa hutumia nambari kamili. Admin hutumia barua pepe rasmi pekee.",
    authRegisterPhoneHint: "Chagua nchi kisha andika tu nambari yako ya ndani bila msimbo wa nchi.",
    authPharmacyHint: "Duka lako litaonekana kwenye jukwaa mara tu litakaposajiliwa.",
    uploadBody: "Tuma preskripsheni yako kwenye jukwaa. Maduka ya dawa yaliyosajiliwa huiona na kujibu kwa wakati halisi.",
    uploadError: "Imeshindikana kutuma preskripsheni kwa sasa.",
    accountReady: "Umeingia",
    footerCopy: "PharmiGo hutangaza preskripsheni kwenye jukwaa, kisha maduka ya dawa yaliyosajiliwa hujibu kwa wakati halisi katika mfumo rahisi na wa kuaminika.",
  },
  ln: {
    authIdentifier: "Numero ya telefone to email",
    authIdentifierPlaceholder: "+243812345678 to email ya administrateur",
    authLoginSuccess: "Okoti malamu. Espace na yo ya PharmiGo ezali tayari.",
    authRegisterSuccessPatient: "Komikomisa elongi. Sikoyo okoki kokota.",
    authRegisterSuccessPharmacy: "Pharmacie ekomami malamu. Kota na numero na yo ya WhatsApp.",
    authRequired: "Tondisa makambo nyonso esengami.",
    authPasswordMin: "Mot de passe esengeli kozala na ata mikanda 6.",
    authPhoneHint: "Ba patient mpe ba pharmacie basalelaka numero mobimba. Administrateur asalelaka kaka email officiel.",
    authRegisterPhoneHint: "Pona mokili mpe sima koma kaka numero ya mboka na yo kozanga indicatif.",
    authPharmacyHint: "Pharmacie na yo ekomonana na plateforme tango ekomami.",
    uploadBody: "Tinda ordonnance na yo na plateforme. Ba pharmacie oyo bakomami bakomona yango mpe bakozongisa biyano na tango ya solo.",
    uploadError: "Ekoki te kotinda ordonnance sikoyo.",
    accountReady: "Okoti",
    footerCopy: "PharmiGo etindaka ba ordonnances na plateforme, mpe sima ba pharmacie oyo bakomami bazongisaka biyano na tango ya solo na ndenge ya pete mpe ya bondimi.",
  },
};
