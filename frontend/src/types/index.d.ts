export interface Pharmacy {
  id: number;
  name: string;
  profile_image?: string | null;
  city: string;
  address: string;
  phone_number: string;
  email: string;
  opening_hours: string;
  delivery_supported: boolean;
  wholesale_supported?: boolean;
  retail_supported?: boolean;
  delivery_available?: boolean;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  is_active?: boolean;
  is_online?: boolean;
  last_seen?: string | null;
  subscription_status?: string | null;
  trial_days_remaining?: number | null;
  is_official?: boolean;

  // Champs optionnels utiles pour le design premium
  cover_image?: string;
  logo?: string;
  rating?: number;
  distance_km?: number;
  is_open?: boolean;
  response_time_minutes?: number;
  prescription_count?: number;
  response_count?: number;
  comment_count?: number;
  comments?: PrescriptionComment[];
  like_count?: number;
  share_count?: number;
  viewer_has_liked?: boolean;
  viewer_has_shared?: boolean;
}

export interface Notification {
  id: number;
  title: string;
  message: string;
  channel: string;
  is_read: boolean;
  created_at: string;

  // Pour badges visuels / cartes
  variant?: "info" | "success" | "warning" | "error";
}

export interface ChatMessage {
  id: number;
  pharmacy: number | null;
  pharmacy_name?: string;
  sender_pharmacy?: number | null;
  sender_pharmacy_name?: string;
  recipient_user?: number | null;
  recipient_user_name?: string;
  recipient_user_profile_image?: string | null;
  sender_user?: number | null;
  sender_user_name?: string;
  sender_user_profile_image?: string | null;
  sender_name: string;
  sender_role: "customer" | "patient" | "pharmacy";
  message: string;
  created_at: string;
}

export interface ChatBotMessage {
  id: number;
  sender: "user" | "bot";
  message: string;
  created_at: string;
}

export interface ChatBotPayload {
  message: string;
  prescription_id?: string;
  language?: "fr" | "en" | "rn" | "sw" | "ln";
}

export interface ChatBotResponse {
  message: string;
  answer?: string;
  question?: string;
  session_key?: string | null;
}

export interface PrescriptionResponse {
  id: number;
  prescription: number;
  prescription_label?: string;
  pharmacy: number;
  pharmacy_name?: string;
  responder_name: string;
  availability_note: string;
  estimated_minutes: number;
  total_price: string;
  status: string;
  created_at: string;

  // Pour meilleure carte de réponse
  delivery_supported?: boolean;
  distance_km?: number;
}

export interface PrescriptionComment {
  id: number;
  author_name: string;
  author_role: "patient" | "pharmacy";
  body: string;
  created_at: string;
}

export interface PrescriptionPayload {
  patient_name: string;
  patient_email: string;
  medication_name: string;
  dosage: string;
  instructions: string;
  prescription_file?: File | string | null;
  analysis_text?: string;
}

export interface MatchedPharmacy {
  pharmacy_id: number;
  pharmacy_name?: string;
  name: string;
  address: string;
  phone: string;
  distance: number | null;
  distance_km?: number | null;
  availability?: "complete" | "partial";
  matched_count?: number;
  missing_count?: number;
  matched_items?: Array<{
    medicine: string;
    requested_medicine?: string;
    matched_name?: string | null;
    generic_name?: string | null;
    dosage?: string | null;
    matched_dosage?: string | null;
    form?: string | null;
    quantity?: number;
    posology?: string | null;
    price?: number;
    quantity_available?: number;
    unit?: string | null;
    stock_last_updated?: string | null;
  }>;
  missing_items?: Array<{
    medicine: string;
    dosage?: string | null;
    form?: string | null;
    quantity?: number;
    posology?: string | null;
  }>;
  available_medications: Array<{
    name: string;
    dosage: string | null;
    quantity: number;
    price: number;
  }>;
  missing_medications: Array<{
    name: string;
    dosage: string | null;
    quantity: number;
  }>;
  match_score: number;
  estimated_price: number;
  estimated_total_price?: number;
  score?: number;
}

export interface PrescriptionBotResult {
  is_valid_prescription: boolean;
  message: string;
  pharmacies: MatchedPharmacy[];
  needs_confirmation?: boolean;
  raw_text_displayable?: boolean;
  analysis_source?: "gemini" | "analysis" | "manual";
  technical_error?: string | null;
  medications?: Array<{
    id?: number;
    name: string;
    generic_name?: string | null;
    dosage?: string | null;
    form?: string | null;
    quantity?: number;
    unit?: string;
    posology?: string | null;
    confidence?: number;
    needs_review?: boolean;
    confirmed?: boolean;
  }>;
  recommendation_status?: "searching" | "ready" | "empty" | "failed";
}

export interface PharmacyStockItem {
  id: number;
  pharmacy_name: string;
  medication_name: string;
  generic_name?: string | null;
  dosage?: string | null;
  quantity: number;
  sale_scope: "retail" | "wholesale";
  unit: string;
  price: number;
  currency: "BIF" | "FC" | "TSH";
  last_updated: string;
  is_available: boolean;
}

export interface PrescriptionUploadReceipt {
  status: string;
  task_id: string;
  prescription_id: number;
  message: string;
  medication_name: string;
  task_status: string;
}

export interface PrescriptionRecommendationsResponse {
  prescription_id: number;
  status: "searching" | "ready" | "empty" | "failed";
  message: string;
  recommendations: MatchedPharmacy[];
}

export interface PrescriptionAnalysisTaskResult {
  status: string;
  task_id: string;
  prescription_id: number;
  task_status: string;
  data: {
    prescription_id: string;
    analysis: Array<{
      detected_name: string;
      corrected_name: string;
      dosage?: string | null;
      confidence: number;
    }>;
    global_score: number;
    needs_confirmation: boolean;
  };
  record?: PrescriptionRecord | null;
  error?: string | null;
}

export interface PrescriptionRecord extends PrescriptionPayload {
  id: number;
  public_reference?: string | null;
  geo_zone?: string;
  prescription_image?: string | null;
  document_access_url?: string | null;
  document_access_granted?: boolean;
  patient_user?: number | null;
  pharmacy?: number | null;
  pharmacy_name?: string;
  status: string;
  ocr_text?: string | null;
  confidence_score?: number;
  response_count?: number;
  comment_count?: number;
  responses?: PrescriptionResponse[];
  comments?: PrescriptionComment[];
  extracted_medications?: Array<{
    id: number;
    name: string;
    generic_name?: string | null;
    dosage?: string | null;
    form?: string | null;
    quantity?: number;
    unit?: string;
    posology?: string | null;
    confidence?: number;
    confirmed?: boolean;
    alternatives?: string[];
    requires_prescription?: boolean;
  }>;
  like_count?: number;
  share_count?: number;
  viewer_has_liked?: boolean;
  viewer_has_shared?: boolean;
  created_at: string;
  message?: string;
  bot_result?: PrescriptionBotResult;
  recommendations?: MatchedPharmacy[];

  // Utile pour affichage dashboard
  priority?: "low" | "medium" | "high";
  is_resolved?: boolean;
}

export interface DashboardKpis {
  response_time_minutes: number;
  resolution_rate: number;
  satisfaction_score: number;
  active_pharmacies: number;
  live_prescriptions: number;
  confirmed_quotes: number;
}

export interface DashboardJourneys {
  patient: string[];
  pharmacy: string[];
}

export interface DashboardHero {
  badge?: string;
  title?: string;
  subtitle?: string;
  search_placeholder?: string;
  search_categories?: string[];
  quick_tags?: string[];
  primary_cta_label?: string;
  primary_cta_link?: string;
  secondary_cta_label?: string;
  secondary_cta_link?: string;
}

export interface DashboardPromoCard {
  id: string | number;
  label: string;
  title: string;
  description: string;
  link?: string;
  variant?: "default" | "success" | "info" | "promo";
}

export interface DashboardData {
  kpis: DashboardKpis;
  journeys: DashboardJourneys;
  pharmacies: Pharmacy[];
  prescriptions: Array<PrescriptionRecord & { pharmacy__name?: string }>;
  responses: Array<
    PrescriptionResponse & {
      pharmacy__name?: string;
      prescription__medication_name?: string;
    }
  >;
  notifications: Notification[];
  messages: ChatMessage[];

  // Nouveaux champs utiles au design homepage premium
  hero?: DashboardHero;
  promo_cards?: DashboardPromoCard[];
}

export interface SubscriptionSystemSettings {
  trial_period_days: number;
  monthly_price_usd: number;
  payment_methods: PaymentMethodConfig[];
  updated_by?: number | null;
  updated_at: string;
}

export interface PaymentMethodConfig {
  code: string;
  label: string;
  currency: string;
  enabled: boolean;
  account_name: string;
  account_number: string;
  instructions: string;
}

export interface AdminDashboardSummary {
  users_total: number;
  pharmacies_total: number;
  prescriptions_total: number;
  responses_total: number;
  notifications_total: number;
  messages_total: number;
  subscriptions_total: number;
  payments_total: number;
  trial_pharmacies: number;
  active_paid_pharmacies: number;
  expired_or_limited_pharmacies: number;
  lost_prescriptions_total: number;
}

export interface AdminDashboardUser {
  id: number;
  username: string;
  email: string;
  is_staff: boolean;
  is_active?: boolean;
  role: string;
  pharmacy_name?: string;
}

export interface AdminDashboardSubscription {
  id: number;
  pharmacy_id: number;
  pharmacy_name: string;
  subscription_status: string;
  is_trial_active: boolean;
  trial_start_date: string;
  trial_end_date: string;
  days_remaining: number;
  monthly_price_usd: number;
  monthly_price_bif: number | null;
  lost_prescriptions_count: number;
}

export interface AdminDashboardPayment {
  id: number;
  pharmacy_id?: number;
  pharmacy_name: string;
  amount_usd: number;
  amount_bif: number;
  currency: string;
  payment_method: string;
  payment_status: string;
  transaction_reference: string;
  sender_phone?: string;
  receiver_phone?: string;
  proof_image?: string | null;
  payer_name?: string;
  payer_address?: string;
  payment_month?: string;
  verified_at?: string | null;
  verified_by_name?: string | null;
  created_at: string;
}

export interface AdminDashboardAISettings {
  human_layer: boolean;
  learning_passif: boolean;
  fallback_ai: boolean;
  memory_engine: boolean;
  semantic_search: boolean;
  local_reasoning: boolean;
}

export interface AdminDashboardAIHealth {
  gemini_enabled: boolean;
  gemini_configured: boolean;
  gemini_available: boolean;
  gemini_model: string;
  average_response_time_ms?: number;
}

export interface AdminDashboardBugReport {
  id: number;
  error_type: string;
  message: string;
  severity: "critical" | "warning" | "info";
  status: "new" | "in_progress" | "resolved";
  module: string;
  actor_label: string;
  user_id?: number | null;
  path: string;
  method: string;
  request_data: Record<string, unknown>;
  traceback: string;
  created_at: string;
  updated_at: string;
}

export interface AdminDashboardSystemActivityItem {
  type: string;
  title: string;
  description: string;
  created_at: string;
  module: string;
  severity: "critical" | "warning" | "info";
}

export interface AdminDashboardAILearningAuditItem {
  id: number;
  source: string;
  detected_intent: string;
  original_text: string;
  corrected_medicine: string;
  confidence_before: number;
  confidence_after: number;
  created_at: string;
}

export interface AdminDashboardAILogItem {
  id: number;
  event_type: string;
  severity: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface RewardReferralItem {
  id: number;
  pharmacy_name?: string;
  referrer_name?: string;
  referee_name?: string;
  status: string;
  payment_validated_at?: string | null;
  validated_activity_count: number;
  created_at: string;
  updated_at?: string;
  reward_granted_at?: string | null;
  fraud_blocked_at?: string | null;
  payment_reference?: string;
  payment_validated_by_name?: string | null;
}

export interface RewardFraudAlertItem {
  id: number;
  referral_id: number;
  pharmacy_id: number;
  pharmacy_name: string;
  device_fingerprint: string;
  repeated_dates: string[];
  message: string;
  status: string;
  created_at: string;
}

export interface RewardProgramSettings {
  reward_guide_title?: string;
  reward_event_start_date?: string | null;
  reward_event_end_date?: string | null;
  reward_referral_threshold: number;
  reward_min_activity_count: number;
  reward_device_daily_limit: number;
  reward_bonus_days: number;
  reward_instructions: string;
}

export interface RewardEventCard {
  id: string;
  title: string;
  start?: string | null;
  end?: string | null;
  threshold: number;
  bonus_days: number;
  min_activity_count: number;
  device_daily_limit: number;
  status: string;
  summary: string;
}

export interface RewardProgramAdminPayload {
  settings: RewardProgramSettings;
  summary: {
    referrals_total: number;
    validated_referrals_total: number;
    fraud_alerts_open: number;
  };
  events: RewardEventCard[];
  referrals: Array<RewardReferralItem & {
    referrer_id: number;
    referrer_name: string;
    referee_id: number;
    referee_name: string;
  }>;
  fraud_alerts: RewardFraudAlertItem[];
}

export interface RewardProgramPharmacyPayload {
  enabled: boolean;
  guide_title?: string;
  referral_code: string;
  referral_link: string;
  threshold: number;
  bonus_days: number;
  validated_count: number;
  progress_ratio: number;
  instructions: string;
  event_window: {
    start?: string | null;
    end?: string | null;
  };
  events: RewardEventCard[];
  referrals: RewardReferralItem[];
}

export interface AdminDashboardData {
  generated_at: string;
  settings: SubscriptionSystemSettings;
  summary: AdminDashboardSummary;
  chatbot_metrics: {
    learning_events_total: number;
    improved_events_total: number;
    average_confidence_before: number;
    average_confidence_after: number;
    success_rate: number;
    failure_rate: number;
  };
  users: AdminDashboardUser[];
  pharmacies: Pharmacy[];
  prescriptions: PrescriptionRecord[];
  responses: PrescriptionResponse[];
  notifications: Notification[];
  messages: ChatMessage[];
  subscriptions: AdminDashboardSubscription[];
  payments: AdminDashboardPayment[];
  ai_settings: AdminDashboardAISettings;
  ai_health: AdminDashboardAIHealth;
  ai_learning_audit: AdminDashboardAILearningAuditItem[];
  ai_recent_logs: AdminDashboardAILogItem[];
  reward_program: RewardProgramAdminPayload;
  bug_reports: AdminDashboardBugReport[];
  system_activity: AdminDashboardSystemActivityItem[];
}

export interface AppProductConfig {
  name: string;
  vision: string;
  countries: string[];
  slogan?: string;
  tagline?: string;
}

export interface AppConfig {
  product: AppProductConfig;
  actors: string[];
  features: string[];
  security: string[];
  evolution: string[];
  languages: string[];
  themes: string[];

  // Nouveaux champs pour enrichir la home
  categories?: string[];
  quick_tags?: string[];
  hero_stats?: Array<{
    label: string;
    value: string | number;
  }>;
}

export interface EndpointItem {
  name: string;
  method: string;
  path: string;
}

export interface AuthUserProfile {
  role: "patient" | "pharmacy" | "admin";
  phone_number: string;
  whatsapp_number: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  location_city?: string;
  location_country?: string;
  email_verified?: boolean;
  google_connected?: boolean;
  created_at?: string;
  profile_image?: string | null;
  is_online?: boolean;
  last_seen?: string | null;
  pharmacy: number | null;
  pharmacy_name?: string;
  pharmacy_image?: string | null;
  pharmacy_created_at?: string;
  pharmacy_is_online?: boolean;
  pharmacy_city?: string;
  pharmacy_email?: string;
  pharmacy_opening_hours?: string;
  pharmacy_delivery_supported?: boolean;
  pharmacy_wholesale_supported?: boolean;
  pharmacy_retail_supported?: boolean;
  pharmacy_phone_number?: string;
}

export interface AuthUserHistory {
  prescriptions?: PrescriptionRecord[];
  messages?: ChatMessage[];
  responses?: PrescriptionResponse[];
}

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_staff: boolean;
  is_active?: boolean;
  profile?: AuthUserProfile;
  history?: AuthUserHistory;
}

export interface AuthResponse {
  message: string;
  user: AuthUser;
  token?: string;
  requires_email_verification?: boolean;
  email_delivery_mode?: "smtp" | "console_preview";
  debug_verification_token?: string;
}
