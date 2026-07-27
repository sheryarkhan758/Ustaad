/**
 * Reference-data seed — specification §9.1.
 *
 * This file is committed to the repository on purpose (§12): locations,
 * curriculum, boards, service types and interface strings are static and
 * contain no user information.  Everything else in this system does contain
 * user information and is never committed.
 *
 * The data is hand-authored rather than generated.  Area names are real Pakistani
 * localities, adjacency reflects actual road proximity within a city, and the
 * chapter references follow the published board syllabi.  The Mathematics
 * prerequisite chain is the specification's own worked example (§2.4) —
 * signed-number arithmetic → algebraic factorisation → quadratic equations —
 * and the diagnostic agent in §6.10 depends on it being genuine.
 *
 * Every structural rule is checked before a single row is written; see
 * `./validate.ts`.  The seed aborts loudly rather than writing a broken graph.
 */

import { LANGS } from '../schema/reference';
import type { Db } from '../index';
import {
  areaAdjacency,
  areas,
  boards,
  cities,
  i18nStrings,
  levels,
  provinces,
  serviceTypes,
  subjects,
  topicPrerequisites,
  topics,
} from '../schema/reference';
import {
  assertAdjacencyWellFormed,
  assertI18nComplete,
  assertPrerequisiteGraphIsAcyclic,
  assertPrerequisitesShareBoard,
  assertReferencesExist,
  assertUniqueIds,
} from './validate';

/* =========================================================================
 * 1. Location taxonomy
 * ====================================================================== */

/**
 * FR-2.2 requires all eight top-level units.  The task asked for the four
 * provinces plus Islamabad Capital Territory; Gilgit-Baltistan and Azad Jammu
 * and Kashmir are included as well so the seed satisfies the Must requirement.
 */
export const PROVINCES = [
  { id: 'punjab', name: 'Punjab', nameUr: 'پنجاب', code: 'PB' },
  { id: 'sindh', name: 'Sindh', nameUr: 'سندھ', code: 'SD' },
  { id: 'khyber-pakhtunkhwa', name: 'Khyber Pakhtunkhwa', nameUr: 'خیبر پختونخوا', code: 'KP' },
  { id: 'balochistan', name: 'Balochistan', nameUr: 'بلوچستان', code: 'BA' },
  { id: 'islamabad-capital-territory', name: 'Islamabad Capital Territory', nameUr: 'اسلام آباد وفاقی دارالحکومت', code: 'ICT' },
  { id: 'gilgit-baltistan', name: 'Gilgit-Baltistan', nameUr: 'گلگت بلتستان', code: 'GB' },
  { id: 'azad-jammu-and-kashmir', name: 'Azad Jammu and Kashmir', code: 'AJK' },
] as const;

export const CITIES = [
  { id: 'karachi', provinceId: 'sindh', name: 'Karachi', nameUr: 'کراچی' },
  { id: 'hyderabad', provinceId: 'sindh', name: 'Hyderabad', nameUr: 'حیدرآباد' },
  { id: 'lahore', provinceId: 'punjab', name: 'Lahore', nameUr: 'لاہور' },
  { id: 'rawalpindi', provinceId: 'punjab', name: 'Rawalpindi', nameUr: 'راولپنڈی' },
  { id: 'faisalabad', provinceId: 'punjab', name: 'Faisalabad', nameUr: 'فیصل آباد' },
  { id: 'islamabad', provinceId: 'islamabad-capital-territory', name: 'Islamabad', nameUr: 'اسلام آباد' },
] as const;

/**
 * Areas.  This is the finest location granularity the platform has — FR-2.8
 * and SEC-3 forbid a street address on a public profile, and §4.2 rules out
 * GPS entirely because the platform coordinates adults visiting homes where
 * minors live.
 */
export const AREAS = [
  // --- Karachi -----------------------------------------------------------
  { id: 'karachi-gulshan-e-iqbal', cityId: 'karachi', name: 'Gulshan-e-Iqbal', nameUr: 'گلشنِ اقبال' },
  { id: 'karachi-gulistan-e-johar', cityId: 'karachi', name: 'Gulistan-e-Johar', nameUr: 'گلستانِ جوہر' },
  { id: 'karachi-dha', cityId: 'karachi', name: 'DHA', nameUr: 'ڈی ایچ اے' },
  { id: 'karachi-clifton', cityId: 'karachi', name: 'Clifton', nameUr: 'کلفٹن' },
  { id: 'karachi-north-nazimabad', cityId: 'karachi', name: 'North Nazimabad', nameUr: 'نارتھ ناظم آباد' },
  { id: 'karachi-nazimabad', cityId: 'karachi', name: 'Nazimabad', nameUr: 'ناظم آباد' },
  { id: 'karachi-pechs', cityId: 'karachi', name: 'PECHS', nameUr: 'پی ای سی ایچ ایس' },
  { id: 'karachi-saddar', cityId: 'karachi', name: 'Saddar', nameUr: 'صدر' },
  { id: 'karachi-malir', cityId: 'karachi', name: 'Malir', nameUr: 'ملیر' },
  { id: 'karachi-korangi', cityId: 'karachi', name: 'Korangi', nameUr: 'کورنگی' },
  { id: 'karachi-federal-b-area', cityId: 'karachi', name: 'Federal B Area', nameUr: 'فیڈرل بی ایریا' },
  { id: 'karachi-shah-faisal-colony', cityId: 'karachi', name: 'Shah Faisal Colony', nameUr: 'شاہ فیصل کالونی' },

  // --- Lahore ------------------------------------------------------------
  { id: 'lahore-gulberg', cityId: 'lahore', name: 'Gulberg', nameUr: 'گلبرگ' },
  { id: 'lahore-model-town', cityId: 'lahore', name: 'Model Town', nameUr: 'ماڈل ٹاؤن' },
  { id: 'lahore-garden-town', cityId: 'lahore', name: 'Garden Town', nameUr: 'گارڈن ٹاؤن' },
  { id: 'lahore-faisal-town', cityId: 'lahore', name: 'Faisal Town', nameUr: 'فیصل ٹاؤن' },
  { id: 'lahore-johar-town', cityId: 'lahore', name: 'Johar Town', nameUr: 'جوہر ٹاؤن' },
  { id: 'lahore-wapda-town', cityId: 'lahore', name: 'Wapda Town' },
  { id: 'lahore-township', cityId: 'lahore', name: 'Township', nameUr: 'ٹاؤن شپ' },
  { id: 'lahore-allama-iqbal-town', cityId: 'lahore', name: 'Allama Iqbal Town', nameUr: 'علامہ اقبال ٹاؤن' },
  { id: 'lahore-dha', cityId: 'lahore', name: 'DHA Lahore', nameUr: 'ڈی ایچ اے' },
  { id: 'lahore-cantt', cityId: 'lahore', name: 'Lahore Cantt', nameUr: 'چھاؤنی' },
  { id: 'lahore-shadman', cityId: 'lahore', name: 'Shadman', nameUr: 'شادمان' },
  { id: 'lahore-bahria-town', cityId: 'lahore', name: 'Bahria Town Lahore', nameUr: 'بحریہ ٹاؤن' },

  // --- Islamabad ---------------------------------------------------------
  { id: 'islamabad-f-6', cityId: 'islamabad', name: 'F-6', nameUr: 'ایف سکس' },
  { id: 'islamabad-f-7', cityId: 'islamabad', name: 'F-7', nameUr: 'ایف سیون' },
  { id: 'islamabad-f-8', cityId: 'islamabad', name: 'F-8', nameUr: 'ایف ایٹ' },
  { id: 'islamabad-f-10', cityId: 'islamabad', name: 'F-10', nameUr: 'ایف ٹین' },
  { id: 'islamabad-f-11', cityId: 'islamabad', name: 'F-11', nameUr: 'ایف الیون' },
  { id: 'islamabad-e-11', cityId: 'islamabad', name: 'E-11', nameUr: 'ای الیون' },
  { id: 'islamabad-g-6', cityId: 'islamabad', name: 'G-6', nameUr: 'جی سکس' },
  { id: 'islamabad-g-9', cityId: 'islamabad', name: 'G-9', nameUr: 'جی نائن' },
  { id: 'islamabad-g-10', cityId: 'islamabad', name: 'G-10', nameUr: 'جی ٹین' },
  { id: 'islamabad-g-11', cityId: 'islamabad', name: 'G-11', nameUr: 'جی الیون' },
  { id: 'islamabad-i-8', cityId: 'islamabad', name: 'I-8', nameUr: 'آئی ایٹ' },
  { id: 'islamabad-bahria-enclave', cityId: 'islamabad', name: 'Bahria Enclave', nameUr: 'بحریہ اینکلیو' },

  // --- Rawalpindi --------------------------------------------------------
  { id: 'rawalpindi-saddar', cityId: 'rawalpindi', name: 'Saddar', nameUr: 'صدر' },
  { id: 'rawalpindi-committee-chowk', cityId: 'rawalpindi', name: 'Committee Chowk', nameUr: 'کمیٹی چوک' },
  { id: 'rawalpindi-satellite-town', cityId: 'rawalpindi', name: 'Satellite Town', nameUr: 'سیٹلائٹ ٹاؤن' },
  { id: 'rawalpindi-chaklala', cityId: 'rawalpindi', name: 'Chaklala', nameUr: 'چکلالہ' },
  { id: 'rawalpindi-gulraiz', cityId: 'rawalpindi', name: 'Gulraiz', nameUr: 'گلریز' },
  { id: 'rawalpindi-dha', cityId: 'rawalpindi', name: 'DHA Rawalpindi', nameUr: 'ڈی ایچ اے' },
  { id: 'rawalpindi-bahria-town', cityId: 'rawalpindi', name: 'Bahria Town Rawalpindi', nameUr: 'بحریہ ٹاؤن' },
  { id: 'rawalpindi-adiala-road', cityId: 'rawalpindi', name: 'Adiala Road', nameUr: 'اڈیالہ روڈ' },
  { id: 'rawalpindi-morgah', cityId: 'rawalpindi', name: 'Morgah', nameUr: 'مورگاہ' },
  { id: 'rawalpindi-westridge', cityId: 'rawalpindi', name: 'Westridge', nameUr: 'ویسٹ رج' },
  { id: 'rawalpindi-peshawar-road', cityId: 'rawalpindi', name: 'Peshawar Road', nameUr: 'پشاور روڈ' },
  { id: 'rawalpindi-chandni-chowk', cityId: 'rawalpindi', name: 'Chandni Chowk', nameUr: 'چاندنی چوک' },

  // --- Faisalabad --------------------------------------------------------
  { id: 'faisalabad-d-ground', cityId: 'faisalabad', name: 'D Ground', nameUr: 'ڈی گراؤنڈ' },
  { id: 'faisalabad-peoples-colony', cityId: 'faisalabad', name: 'Peoples Colony', nameUr: 'پیپلز کالونی' },
  { id: 'faisalabad-madina-town', cityId: 'faisalabad', name: 'Madina Town', nameUr: 'مدینہ ٹاؤن' },
  { id: 'faisalabad-susan-road', cityId: 'faisalabad', name: 'Susan Road', nameUr: 'سوسن روڈ' },
  { id: 'faisalabad-gulberg', cityId: 'faisalabad', name: 'Gulberg', nameUr: 'گلبرگ' },
  { id: 'faisalabad-batala-colony', cityId: 'faisalabad', name: 'Batala Colony', nameUr: 'بٹالہ کالونی' },
  { id: 'faisalabad-samanabad', cityId: 'faisalabad', name: 'Samanabad', nameUr: 'ثمن آباد' },
  { id: 'faisalabad-ghulam-muhammadabad', cityId: 'faisalabad', name: 'Ghulam Muhammadabad', nameUr: 'غلام محمد آباد' },
  { id: 'faisalabad-millat-town', cityId: 'faisalabad', name: 'Millat Town', nameUr: 'ملت ٹاؤن' },
  { id: 'faisalabad-jaranwala-road', cityId: 'faisalabad', name: 'Jaranwala Road', nameUr: 'جڑانوالہ روڈ' },
  { id: 'faisalabad-sargodha-road', cityId: 'faisalabad', name: 'Sargodha Road', nameUr: 'سرگودھا روڈ' },
  { id: 'faisalabad-civil-lines', cityId: 'faisalabad', name: 'Civil Lines', nameUr: 'سول لائنز' },

  // --- Hyderabad ---------------------------------------------------------
  { id: 'hyderabad-latifabad', cityId: 'hyderabad', name: 'Latifabad', nameUr: 'لطیف آباد' },
  { id: 'hyderabad-qasimabad', cityId: 'hyderabad', name: 'Qasimabad' },
  { id: 'hyderabad-hirabad', cityId: 'hyderabad', name: 'Hirabad', nameUr: 'ہیرآباد' },
  { id: 'hyderabad-saddar', cityId: 'hyderabad', name: 'Saddar' },
  { id: 'hyderabad-cantonment', cityId: 'hyderabad', name: 'Hyderabad Cantonment', nameUr: 'چھاؤنی' },
  { id: 'hyderabad-hussainabad', cityId: 'hyderabad', name: 'Hussainabad', nameUr: 'حسین آباد' },
  { id: 'hyderabad-gulistan-e-sarmast', cityId: 'hyderabad', name: 'Gulistan-e-Sarmast', nameUr: 'گلستانِ سرمست' },
  { id: 'hyderabad-citizen-colony', cityId: 'hyderabad', name: 'Citizen Colony', nameUr: 'سٹیزن کالونی' },
  { id: 'hyderabad-auto-bhan-road', cityId: 'hyderabad', name: 'Auto Bhan Road', nameUr: 'آٹو بھان روڈ' },
  { id: 'hyderabad-phuleli', cityId: 'hyderabad', name: 'Phuleli' },
  { id: 'hyderabad-tando-yousuf', cityId: 'hyderabad', name: 'Tando Yousuf' },
  { id: 'hyderabad-gari-khata', cityId: 'hyderabad', name: 'Gari Khata', nameUr: 'گاڑی کھاتہ' },
] as const;

/**
 * Adjacency declared once per undirected pair, as
 * `[areaA, areaB, travelMinutes]`, and expanded to the two symmetric rows the
 * table stores.  Declaring it undirected is what makes symmetry structural
 * rather than something a future edit could quietly break; `validate.ts` checks
 * the expansion anyway.
 *
 * Travel minutes are coarse estimates of ordinary road travel, not derived from
 * coordinates.  Pairs reflect real proximity — Clifton borders DHA, Nazimabad
 * borders North Nazimabad, the Islamabad sectors follow the actual grid — and
 * never cross a city boundary (FR-2.9).
 */
export const ADJACENCY_PAIRS: ReadonlyArray<readonly [string, string, number]> = [
  // --- Karachi -----------------------------------------------------------
  ['karachi-gulshan-e-iqbal', 'karachi-gulistan-e-johar', 15],
  ['karachi-gulshan-e-iqbal', 'karachi-pechs', 20],
  ['karachi-gulshan-e-iqbal', 'karachi-federal-b-area', 15],
  ['karachi-gulshan-e-iqbal', 'karachi-north-nazimabad', 25],
  ['karachi-federal-b-area', 'karachi-north-nazimabad', 15],
  ['karachi-north-nazimabad', 'karachi-nazimabad', 10],
  ['karachi-nazimabad', 'karachi-saddar', 20],
  ['karachi-saddar', 'karachi-clifton', 15],
  ['karachi-saddar', 'karachi-pechs', 15],
  ['karachi-clifton', 'karachi-dha', 10],
  ['karachi-dha', 'karachi-pechs', 20],
  ['karachi-dha', 'karachi-korangi', 25],
  ['karachi-korangi', 'karachi-shah-faisal-colony', 15],
  ['karachi-shah-faisal-colony', 'karachi-malir', 15],
  ['karachi-malir', 'karachi-gulistan-e-johar', 25],
  ['karachi-gulistan-e-johar', 'karachi-shah-faisal-colony', 20],

  // --- Lahore ------------------------------------------------------------
  ['lahore-gulberg', 'lahore-garden-town', 10],
  ['lahore-gulberg', 'lahore-shadman', 10],
  ['lahore-gulberg', 'lahore-model-town', 12],
  ['lahore-gulberg', 'lahore-cantt', 15],
  ['lahore-garden-town', 'lahore-model-town', 8],
  ['lahore-garden-town', 'lahore-faisal-town', 7],
  ['lahore-model-town', 'lahore-faisal-town', 8],
  ['lahore-faisal-town', 'lahore-johar-town', 12],
  ['lahore-johar-town', 'lahore-wapda-town', 10],
  ['lahore-johar-town', 'lahore-township', 12],
  ['lahore-wapda-town', 'lahore-township', 8],
  ['lahore-township', 'lahore-allama-iqbal-town', 12],
  ['lahore-allama-iqbal-town', 'lahore-johar-town', 15],
  ['lahore-cantt', 'lahore-dha', 12],
  ['lahore-cantt', 'lahore-shadman', 15],
  ['lahore-dha', 'lahore-bahria-town', 25],
  ['lahore-bahria-town', 'lahore-township', 25],

  // --- Islamabad (sector grid) -------------------------------------------
  ['islamabad-f-6', 'islamabad-f-7', 7],
  ['islamabad-f-6', 'islamabad-g-6', 6],
  ['islamabad-f-7', 'islamabad-f-8', 8],
  ['islamabad-f-8', 'islamabad-f-10', 10],
  ['islamabad-f-8', 'islamabad-g-9', 8],
  ['islamabad-f-8', 'islamabad-i-8', 10],
  ['islamabad-f-10', 'islamabad-f-11', 7],
  ['islamabad-f-10', 'islamabad-g-10', 7],
  ['islamabad-f-11', 'islamabad-e-11', 8],
  ['islamabad-f-11', 'islamabad-g-11', 7],
  ['islamabad-g-6', 'islamabad-g-9', 12],
  ['islamabad-g-9', 'islamabad-g-10', 7],
  ['islamabad-g-9', 'islamabad-i-8', 10],
  ['islamabad-g-10', 'islamabad-g-11', 7],
  ['islamabad-e-11', 'islamabad-bahria-enclave', 25],

  // --- Rawalpindi --------------------------------------------------------
  ['rawalpindi-saddar', 'rawalpindi-committee-chowk', 8],
  ['rawalpindi-saddar', 'rawalpindi-westridge', 10],
  ['rawalpindi-saddar', 'rawalpindi-chandni-chowk', 10],
  ['rawalpindi-committee-chowk', 'rawalpindi-satellite-town', 7],
  ['rawalpindi-committee-chowk', 'rawalpindi-chandni-chowk', 7],
  ['rawalpindi-satellite-town', 'rawalpindi-chaklala', 12],
  ['rawalpindi-chaklala', 'rawalpindi-gulraiz', 10],
  ['rawalpindi-chaklala', 'rawalpindi-morgah', 15],
  ['rawalpindi-gulraiz', 'rawalpindi-dha', 12],
  ['rawalpindi-dha', 'rawalpindi-morgah', 12],
  ['rawalpindi-dha', 'rawalpindi-bahria-town', 15],
  ['rawalpindi-bahria-town', 'rawalpindi-adiala-road', 15],
  ['rawalpindi-westridge', 'rawalpindi-peshawar-road', 7],
  ['rawalpindi-peshawar-road', 'rawalpindi-adiala-road', 20],

  // --- Faisalabad --------------------------------------------------------
  ['faisalabad-d-ground', 'faisalabad-peoples-colony', 7],
  ['faisalabad-d-ground', 'faisalabad-batala-colony', 10],
  ['faisalabad-d-ground', 'faisalabad-civil-lines', 8],
  ['faisalabad-peoples-colony', 'faisalabad-madina-town', 8],
  ['faisalabad-madina-town', 'faisalabad-susan-road', 7],
  ['faisalabad-madina-town', 'faisalabad-sargodha-road', 12],
  ['faisalabad-susan-road', 'faisalabad-gulberg', 8],
  ['faisalabad-susan-road', 'faisalabad-sargodha-road', 10],
  ['faisalabad-gulberg', 'faisalabad-batala-colony', 10],
  ['faisalabad-samanabad', 'faisalabad-ghulam-muhammadabad', 10],
  ['faisalabad-samanabad', 'faisalabad-jaranwala-road', 12],
  ['faisalabad-samanabad', 'faisalabad-civil-lines', 10],
  ['faisalabad-ghulam-muhammadabad', 'faisalabad-millat-town', 12],
  ['faisalabad-millat-town', 'faisalabad-jaranwala-road', 12],

  // --- Hyderabad ---------------------------------------------------------
  ['hyderabad-latifabad', 'hyderabad-hirabad', 10],
  ['hyderabad-latifabad', 'hyderabad-phuleli', 12],
  ['hyderabad-latifabad', 'hyderabad-tando-yousuf', 15],
  ['hyderabad-hirabad', 'hyderabad-saddar', 7],
  ['hyderabad-hirabad', 'hyderabad-auto-bhan-road', 10],
  ['hyderabad-saddar', 'hyderabad-gari-khata', 6],
  ['hyderabad-saddar', 'hyderabad-cantonment', 8],
  ['hyderabad-cantonment', 'hyderabad-hussainabad', 10],
  ['hyderabad-hussainabad', 'hyderabad-qasimabad', 10],
  ['hyderabad-qasimabad', 'hyderabad-gulistan-e-sarmast', 8],
  ['hyderabad-qasimabad', 'hyderabad-citizen-colony', 8],
  ['hyderabad-citizen-colony', 'hyderabad-auto-bhan-road', 7],
  ['hyderabad-phuleli', 'hyderabad-tando-yousuf', 12],
  ['hyderabad-gari-khata', 'hyderabad-hirabad', 8],
];

/* =========================================================================
 * 2. Curriculum taxonomy
 * ====================================================================== */

export const LEVELS = [
  { id: 'primary', name: 'Primary (Classes 1–5)', sortOrder: 1 },
  { id: 'middle', name: 'Middle (Classes 6–8)', sortOrder: 2 },
  { id: 'matric', name: 'Matriculation (Classes 9–10)', sortOrder: 3 },
  { id: 'intermediate', name: 'Intermediate / FSc (Classes 11–12)', sortOrder: 4 },
  { id: 'o-level', name: 'O Level', sortOrder: 5 },
  { id: 'a-level', name: 'A Level', sortOrder: 6 },
  { id: 'undergraduate', name: 'Undergraduate', sortOrder: 7 },
] as const;

/**
 * Boards (FR-3.1).  The task named six; the remainder are added because FR-3.1
 * lists them as a Must.  Cambridge is one board here, with O Level and A Level
 * expressed through `levels` — the alternative (two Cambridge boards) would
 * duplicate the level dimension.
 */
export const BOARDS = [
  { id: 'sindh-board', name: 'Sindh Board', nameUr: 'تعلیمی بورڈ سندھ' },
  { id: 'punjab-board', name: 'Punjab Board', nameUr: 'تعلیمی بورڈ پنجاب' },
  { id: 'federal-board', name: 'Federal Board', nameUr: 'وفاقی تعلیمی بورڈ' },
  { id: 'kp-board', name: 'Khyber Pakhtunkhwa Board', nameUr: 'تعلیمی بورڈ خیبر پختونخوا' },
  { id: 'balochistan-board', name: 'Balochistan Board', nameUr: 'تعلیمی بورڈ بلوچستان' },
  { id: 'aga-khan-board', name: 'Aga Khan Board', nameUr: 'آغا خان تعلیمی بورڈ' },
  { id: 'cambridge', name: 'Cambridge (CAIE)', nameUr: 'کیمبرج' },
  { id: 'edexcel', name: 'Edexcel', nameUr: 'ایڈیکسل' },
  { id: 'ib', name: 'International Baccalaureate', nameUr: 'انٹرنیشنل بکلوریٹ' },
  { id: 'university', name: 'University', nameUr: 'جامعہ' },
] as const;

export const SUBJECTS = [
  { id: 'mathematics', name: 'Mathematics', nameUr: 'ریاضی' },
  { id: 'physics', name: 'Physics', nameUr: 'طبیعیات' },
  { id: 'chemistry', name: 'Chemistry', nameUr: 'کیمیا' },
  { id: 'biology', name: 'Biology', nameUr: 'حیاتیات' },
  { id: 'english', name: 'English', nameUr: 'انگریزی' },
  { id: 'urdu', name: 'Urdu', nameUr: 'اردو' },
  { id: 'computer-science', name: 'Computer Science', nameUr: 'کمپیوٹر سائنس' },
] as const;

/** Short forms used to build readable topic ids. */
const SUBJECT_ABBR: Record<string, string> = {
  mathematics: 'math',
  physics: 'phy',
  chemistry: 'chem',
  biology: 'bio',
  english: 'eng',
  urdu: 'urdu',
  'computer-science': 'cs',
};

const LEVEL_ABBR: Record<string, string> = {
  primary: 'primary',
  middle: 'middle',
  matric: 'matric',
  intermediate: 'fsc',
  'o-level': 'olevel',
  'a-level': 'alevel',
  undergraduate: 'ug',
};

const BOARD_ABBR: Record<string, string> = {
  'sindh-board': 'sindh',
  'punjab-board': 'punjab',
  'federal-board': 'federal',
  'kp-board': 'kp',
  'balochistan-board': 'balochistan',
  'aga-khan-board': 'agakhan',
  cambridge: 'cambridge',
  edexcel: 'edexcel',
  ib: 'ib',
  university: 'university',
};

interface TopicSpec {
  slug: string;
  name: string;
  nameUr: string;
  chapterRef: string;
}

interface SyllabusBlock {
  subjectId: string;
  levelId: string;
  boardId: string;
  topics: TopicSpec[];
}

/** `topicId('mathematics','matric','sindh-board','quadratic-equations')`. */
export function topicId(
  subjectId: string,
  levelId: string,
  boardId: string,
  slug: string,
): string {
  return `${SUBJECT_ABBR[subjectId]}-${LEVEL_ABBR[levelId]}-${BOARD_ABBR[boardId]}-${slug}`;
}

/**
 * Syllabus blocks.
 *
 * Sindh Board carries the full seven-subject, two-level coverage required by
 * FR-3.5.  Punjab Board and Cambridge carry Mathematics only — deliberately, to
 * make the point that boards are not interchangeable (decision 5): the same
 * chapter name under three boards is three distinct rows with three distinct
 * prerequisite chains, and nothing in the system may substitute one for
 * another.  Remaining board/subject coverage is seeded as the tutor supply for
 * it appears.
 */
const SYLLABUS: SyllabusBlock[] = [
  /* ---------------- Sindh Board · Mathematics · Matric ---------------- */
  {
    subjectId: 'mathematics',
    levelId: 'matric',
    boardId: 'sindh-board',
    topics: [
      { slug: 'real-numbers', name: 'Real Numbers and Number Systems', nameUr: 'حقیقی اعداد اور نظامِ اعداد', chapterRef: 'Class 9 · Ch 1' },
      { slug: 'signed-number-arithmetic', name: 'Signed Number Arithmetic', nameUr: 'مثبت و منفی اعداد کا حساب', chapterRef: 'Class 9 · Ch 1.2' },
      { slug: 'exponents-and-radicals', name: 'Exponents and Radicals', nameUr: 'اُسّیہ اور جذری اعداد', chapterRef: 'Class 9 · Ch 2' },
      { slug: 'logarithms', name: 'Logarithms', nameUr: 'لاگرتھم', chapterRef: 'Class 9 · Ch 3' },
      { slug: 'algebraic-expressions', name: 'Algebraic Expressions and Formulas', nameUr: 'الجبری اظہارات اور فارمولے', chapterRef: 'Class 9 · Ch 4' },
      { slug: 'algebraic-factorisation', name: 'Algebraic Factorisation', nameUr: 'الجبری تجزی', chapterRef: 'Class 9 · Ch 5' },
      { slug: 'linear-equations', name: 'Linear Equations and Inequalities', nameUr: 'خطی مساوات اور عدم مساوات', chapterRef: 'Class 9 · Ch 7' },
      { slug: 'matrices-and-determinants', name: 'Matrices and Determinants', nameUr: 'میٹرکس اور محدَّدات', chapterRef: 'Class 9 · Ch 9' },
      { slug: 'quadratic-equations', name: 'Quadratic Equations', nameUr: 'دو درجی مساوات', chapterRef: 'Class 10 · Ch 1' },
      { slug: 'theory-of-quadratic-equations', name: 'Theory of Quadratic Equations', nameUr: 'نظریہ دو درجی مساوات', chapterRef: 'Class 10 · Ch 2' },
      { slug: 'variations', name: 'Variations', nameUr: 'تناسب و تغیّر', chapterRef: 'Class 10 · Ch 3' },
      { slug: 'partial-fractions', name: 'Partial Fractions', nameUr: 'جزوی کسور', chapterRef: 'Class 10 · Ch 4' },
      { slug: 'sets-and-functions', name: 'Sets and Functions', nameUr: 'مجموعے اور دالہ', chapterRef: 'Class 10 · Ch 5' },
      { slug: 'basic-statistics', name: 'Basic Statistics', nameUr: 'بنیادی شماریات', chapterRef: 'Class 10 · Ch 6' },
      { slug: 'introduction-to-trigonometry', name: 'Introduction to Trigonometry', nameUr: 'مثلثیات کا تعارف', chapterRef: 'Class 10 · Ch 7' },
    ],
  },

  /* ------------- Sindh Board · Mathematics · Intermediate ------------- */
  {
    subjectId: 'mathematics',
    levelId: 'intermediate',
    boardId: 'sindh-board',
    topics: [
      { slug: 'number-systems', name: 'Number Systems', nameUr: 'نظامِ اعداد', chapterRef: 'Part I · Ch 1' },
      { slug: 'sets-functions-and-groups', name: 'Sets, Functions and Groups', nameUr: 'مجموعے، دالہ اور گروہ', chapterRef: 'Part I · Ch 2' },
      { slug: 'matrices-and-determinants', name: 'Matrices and Determinants', nameUr: 'میٹرکس اور محدَّدات', chapterRef: 'Part I · Ch 3' },
      { slug: 'quadratic-equations', name: 'Quadratic Equations', nameUr: 'دو درجی مساوات', chapterRef: 'Part I · Ch 4' },
      { slug: 'partial-fractions', name: 'Partial Fractions', nameUr: 'جزوی کسور', chapterRef: 'Part I · Ch 5' },
      { slug: 'sequences-and-series', name: 'Sequences and Series', nameUr: 'متوالیات اور سلسلے', chapterRef: 'Part I · Ch 6' },
      { slug: 'permutation-combination-probability', name: 'Permutation, Combination and Probability', nameUr: 'ترتیب، تالیف اور احتمال', chapterRef: 'Part I · Ch 7' },
      { slug: 'induction-and-binomial-theorem', name: 'Mathematical Induction and the Binomial Theorem', nameUr: 'ریاضیاتی استقرا اور ذوحدی مسئلہ', chapterRef: 'Part I · Ch 8' },
      { slug: 'fundamentals-of-trigonometry', name: 'Fundamentals of Trigonometry', nameUr: 'مثلثیات کے بنیادی اصول', chapterRef: 'Part I · Ch 9' },
      { slug: 'trigonometric-identities', name: 'Trigonometric Identities', nameUr: 'مثلثیاتی مساوات', chapterRef: 'Part I · Ch 10' },
      { slug: 'functions-and-limits', name: 'Functions and Limits', nameUr: 'دالہ اور حدود', chapterRef: 'Part II · Ch 1' },
      { slug: 'differentiation', name: 'Differentiation', nameUr: 'تفرقیت', chapterRef: 'Part II · Ch 2' },
      { slug: 'integration', name: 'Integration', nameUr: 'تکمیل', chapterRef: 'Part II · Ch 3' },
      { slug: 'analytic-geometry', name: 'Introduction to Analytic Geometry', nameUr: 'تحلیلی ہندسہ کا تعارف', chapterRef: 'Part II · Ch 4' },
      { slug: 'vectors', name: 'Vectors', nameUr: 'سمتیے', chapterRef: 'Part II · Ch 7' },
    ],
  },

  /* ------------------ Sindh Board · Physics · Matric ------------------ */
  {
    subjectId: 'physics',
    levelId: 'matric',
    boardId: 'sindh-board',
    topics: [
      { slug: 'physical-quantities-and-measurement', name: 'Physical Quantities and Measurement', nameUr: 'طبیعی مقداریں اور پیمائش', chapterRef: 'Class 9 · Ch 1' },
      { slug: 'kinematics', name: 'Kinematics', nameUr: 'حرکیات', chapterRef: 'Class 9 · Ch 2' },
      { slug: 'dynamics', name: 'Dynamics', nameUr: 'قوت و حرکت', chapterRef: 'Class 9 · Ch 3' },
      { slug: 'turning-effect-of-forces', name: 'Turning Effect of Forces', nameUr: 'قوتوں کا گردشی اثر', chapterRef: 'Class 9 · Ch 4' },
      { slug: 'gravitation', name: 'Gravitation', nameUr: 'ثقل', chapterRef: 'Class 9 · Ch 5' },
      { slug: 'work-and-energy', name: 'Work and Energy', nameUr: 'کام اور توانائی', chapterRef: 'Class 9 · Ch 6' },
      { slug: 'properties-of-matter', name: 'Properties of Matter', nameUr: 'مادے کی خصوصیات', chapterRef: 'Class 9 · Ch 7' },
      { slug: 'thermal-properties-of-matter', name: 'Thermal Properties of Matter', nameUr: 'مادے کی حرارتی خصوصیات', chapterRef: 'Class 9 · Ch 8' },
      { slug: 'simple-harmonic-motion-and-waves', name: 'Simple Harmonic Motion and Waves', nameUr: 'سادہ ہم آہنگ حرکت اور امواج', chapterRef: 'Class 10 · Ch 10' },
      { slug: 'sound', name: 'Sound', nameUr: 'آواز', chapterRef: 'Class 10 · Ch 11' },
      { slug: 'geometrical-optics', name: 'Geometrical Optics', nameUr: 'ہندسی بصریات', chapterRef: 'Class 10 · Ch 12' },
      { slug: 'electrostatics', name: 'Electrostatics', nameUr: 'ساکن برقیات', chapterRef: 'Class 10 · Ch 14' },
      { slug: 'current-electricity', name: 'Current Electricity', nameUr: 'برقی رو', chapterRef: 'Class 10 · Ch 15' },
      { slug: 'electromagnetism', name: 'Electromagnetism', nameUr: 'برقی مقناطیسیت', chapterRef: 'Class 10 · Ch 16' },
    ],
  },

  /* --------------- Sindh Board · Physics · Intermediate --------------- */
  {
    subjectId: 'physics',
    levelId: 'intermediate',
    boardId: 'sindh-board',
    topics: [
      { slug: 'measurements', name: 'Measurements', nameUr: 'پیمائش', chapterRef: 'Part I · Ch 1' },
      { slug: 'vectors-and-equilibrium', name: 'Vectors and Equilibrium', nameUr: 'سمتیے اور توازن', chapterRef: 'Part I · Ch 2' },
      { slug: 'motion-and-force', name: 'Motion and Force', nameUr: 'حرکت اور قوت', chapterRef: 'Part I · Ch 3' },
      { slug: 'work-and-energy', name: 'Work and Energy', nameUr: 'کام اور توانائی', chapterRef: 'Part I · Ch 4' },
      { slug: 'circular-motion', name: 'Circular Motion', nameUr: 'دائروی حرکت', chapterRef: 'Part I · Ch 5' },
      { slug: 'fluid-dynamics', name: 'Fluid Dynamics', nameUr: 'رطوبتی حرکیات', chapterRef: 'Part I · Ch 6' },
      { slug: 'oscillations', name: 'Oscillations', nameUr: 'ارتعاشات', chapterRef: 'Part I · Ch 7' },
      { slug: 'waves', name: 'Waves', nameUr: 'امواج', chapterRef: 'Part I · Ch 8' },
      { slug: 'physical-optics', name: 'Physical Optics', nameUr: 'طبیعی بصریات', chapterRef: 'Part I · Ch 9' },
      { slug: 'thermodynamics', name: 'Thermodynamics', nameUr: 'حرحرکیات', chapterRef: 'Part I · Ch 11' },
      { slug: 'electrostatics', name: 'Electrostatics', nameUr: 'ساکن برقیات', chapterRef: 'Part II · Ch 12' },
      { slug: 'current-electricity', name: 'Current Electricity', nameUr: 'برقی رو', chapterRef: 'Part II · Ch 13' },
      { slug: 'electromagnetic-induction', name: 'Electromagnetic Induction', nameUr: 'برقی مقناطیسی اِستقرا', chapterRef: 'Part II · Ch 15' },
      { slug: 'atomic-spectra', name: 'Atomic Spectra', nameUr: 'جوہری طیف', chapterRef: 'Part II · Ch 19' },
      { slug: 'nuclear-physics', name: 'Nuclear Physics', nameUr: 'مرکزی طبیعیات', chapterRef: 'Part II · Ch 21' },
    ],
  },

  /* ----------------- Sindh Board · Chemistry · Matric ----------------- */
  {
    subjectId: 'chemistry',
    levelId: 'matric',
    boardId: 'sindh-board',
    topics: [
      { slug: 'fundamentals-of-chemistry', name: 'Fundamentals of Chemistry', nameUr: 'کیمیا کے بنیادی اصول', chapterRef: 'Class 9 · Ch 1' },
      { slug: 'structure-of-atoms', name: 'Structure of Atoms', nameUr: 'جوہر کی ساخت', chapterRef: 'Class 9 · Ch 2' },
      { slug: 'periodic-table-and-periodicity', name: 'Periodic Table and Periodicity', nameUr: 'جدولِ دوری اور دوریت', chapterRef: 'Class 9 · Ch 3' },
      { slug: 'structure-of-molecules', name: 'Structure of Molecules', nameUr: 'سالمے کی ساخت', chapterRef: 'Class 9 · Ch 4' },
      { slug: 'physical-states-of-matter', name: 'Physical States of Matter', nameUr: 'مادے کی طبیعی حالتیں', chapterRef: 'Class 9 · Ch 5' },
      { slug: 'solutions', name: 'Solutions', nameUr: 'محلول', chapterRef: 'Class 9 · Ch 6' },
      { slug: 'electrochemistry', name: 'Electrochemistry', nameUr: 'برقی کیمیا', chapterRef: 'Class 9 · Ch 7' },
      { slug: 'chemical-reactivity', name: 'Chemical Reactivity', nameUr: 'کیمیائی تعاملیت', chapterRef: 'Class 9 · Ch 8' },
      { slug: 'chemical-equilibrium', name: 'Chemical Equilibrium', nameUr: 'کیمیائی توازن', chapterRef: 'Class 10 · Ch 9' },
      { slug: 'acids-bases-and-salts', name: 'Acids, Bases and Salts', nameUr: 'تیزاب، اساس اور نمکیات', chapterRef: 'Class 10 · Ch 10' },
      { slug: 'organic-chemistry', name: 'Organic Chemistry', nameUr: 'نامیاتی کیمیا', chapterRef: 'Class 10 · Ch 11' },
      { slug: 'hydrocarbons', name: 'Hydrocarbons', nameUr: 'ہائیڈروکاربن', chapterRef: 'Class 10 · Ch 12' },
      { slug: 'biochemistry', name: 'Biochemistry', nameUr: 'حیاتی کیمیا', chapterRef: 'Class 10 · Ch 13' },
      { slug: 'environmental-chemistry', name: 'Environmental Chemistry', nameUr: 'ماحولیاتی کیمیا', chapterRef: 'Class 10 · Ch 14' },
    ],
  },

  /* -------------- Sindh Board · Chemistry · Intermediate -------------- */
  {
    subjectId: 'chemistry',
    levelId: 'intermediate',
    boardId: 'sindh-board',
    topics: [
      { slug: 'basic-concepts', name: 'Basic Concepts', nameUr: 'بنیادی تصورات', chapterRef: 'Part I · Ch 1' },
      { slug: 'atomic-structure', name: 'Atomic Structure', nameUr: 'جوہری ساخت', chapterRef: 'Part I · Ch 2' },
      { slug: 'theories-of-covalent-bonding', name: 'Theories of Covalent Bonding', nameUr: 'ہم جفتی بندھن کے نظریات', chapterRef: 'Part I · Ch 3' },
      { slug: 'gases', name: 'States of Matter: Gases', nameUr: 'مادے کی حالتیں: گیسیں', chapterRef: 'Part I · Ch 4' },
      { slug: 'liquids-and-solids', name: 'States of Matter: Liquids and Solids', nameUr: 'مادے کی حالتیں: مائعات اور ٹھوس', chapterRef: 'Part I · Ch 5' },
      { slug: 'chemical-equilibrium', name: 'Chemical Equilibrium', nameUr: 'کیمیائی توازن', chapterRef: 'Part I · Ch 7' },
      { slug: 'reaction-kinetics', name: 'Reaction Kinetics', nameUr: 'تعاملی حرکیات', chapterRef: 'Part I · Ch 8' },
      { slug: 'thermochemistry', name: 'Thermochemistry', nameUr: 'حرارتی کیمیا', chapterRef: 'Part I · Ch 6' },
      { slug: 'electrochemistry', name: 'Electrochemistry', nameUr: 'برقی کیمیا', chapterRef: 'Part I · Ch 9' },
      { slug: 'alkanes-alkenes-alkynes', name: 'Alkanes, Alkenes and Alkynes', nameUr: 'الکینز، الکینز اور الکائنز', chapterRef: 'Part II · Ch 15' },
      { slug: 'alcohols-phenols-ethers', name: 'Alcohols, Phenols and Ethers', nameUr: 'الکحل، فینول اور ایتھر', chapterRef: 'Part II · Ch 17' },
      { slug: 'carboxylic-acids', name: 'Carboxylic Acids', nameUr: 'کاربوکسلک تیزاب', chapterRef: 'Part II · Ch 19' },
      { slug: 'macromolecules', name: 'Macromolecules', nameUr: 'بڑے سالمات', chapterRef: 'Part II · Ch 20' },
    ],
  },

  /* ------------------ Sindh Board · Biology · Matric ------------------ */
  {
    subjectId: 'biology',
    levelId: 'matric',
    boardId: 'sindh-board',
    topics: [
      { slug: 'introduction-to-biology', name: 'Introduction to Biology', nameUr: 'حیاتیات کا تعارف', chapterRef: 'Class 9 · Ch 1' },
      { slug: 'solving-a-biological-problem', name: 'Solving a Biological Problem', nameUr: 'حیاتیاتی مسئلے کا حل', chapterRef: 'Class 9 · Ch 2' },
      { slug: 'biodiversity', name: 'Biodiversity', nameUr: 'حیاتیاتی تنوع', chapterRef: 'Class 9 · Ch 3' },
      { slug: 'cells-and-tissues', name: 'Cells and Tissues', nameUr: 'خلیے اور بافتیں', chapterRef: 'Class 9 · Ch 4' },
      { slug: 'cell-cycle', name: 'Cell Cycle', nameUr: 'خلوی چکر', chapterRef: 'Class 9 · Ch 5' },
      { slug: 'enzymes', name: 'Enzymes', nameUr: 'خامرے', chapterRef: 'Class 9 · Ch 6' },
      { slug: 'bioenergetics', name: 'Bioenergetics', nameUr: 'حیاتی توانائیات', chapterRef: 'Class 9 · Ch 7' },
      { slug: 'nutrition', name: 'Nutrition', nameUr: 'غذائیت', chapterRef: 'Class 9 · Ch 8' },
      { slug: 'transport', name: 'Transport', nameUr: 'ترسیل', chapterRef: 'Class 10 · Ch 9' },
      { slug: 'gaseous-exchange', name: 'Gaseous Exchange', nameUr: 'گیسوں کا تبادلہ', chapterRef: 'Class 10 · Ch 10' },
      { slug: 'homeostasis', name: 'Homeostasis', nameUr: 'توازنِ داخلی', chapterRef: 'Class 10 · Ch 11' },
      { slug: 'coordination-and-control', name: 'Coordination and Control', nameUr: 'ربط و ضبط اور کنٹرول', chapterRef: 'Class 10 · Ch 12' },
      { slug: 'support-and-movement', name: 'Support and Movement', nameUr: 'سہارا اور حرکت', chapterRef: 'Class 10 · Ch 13' },
      { slug: 'reproduction', name: 'Reproduction', nameUr: 'تولید', chapterRef: 'Class 10 · Ch 14' },
      { slug: 'inheritance', name: 'Inheritance', nameUr: 'وراثت', chapterRef: 'Class 10 · Ch 15' },
      { slug: 'biotechnology', name: 'Biotechnology', nameUr: 'حیاتی ٹیکنالوجی', chapterRef: 'Class 10 · Ch 17' },
    ],
  },

  /* --------------- Sindh Board · Biology · Intermediate --------------- */
  {
    subjectId: 'biology',
    levelId: 'intermediate',
    boardId: 'sindh-board',
    topics: [
      { slug: 'the-cell', name: 'The Cell', nameUr: 'خلیہ', chapterRef: 'Part I · Ch 4' },
      { slug: 'biological-molecules', name: 'Biological Molecules', nameUr: 'حیاتیاتی سالمات', chapterRef: 'Part I · Ch 2' },
      { slug: 'enzymes', name: 'Enzymes', nameUr: 'خامرے', chapterRef: 'Part I · Ch 3' },
      { slug: 'bioenergetics', name: 'Bioenergetics', nameUr: 'حیاتی توانائیات', chapterRef: 'Part I · Ch 11' },
      { slug: 'variety-of-life', name: 'Variety of Life', nameUr: 'زندگی کا تنوع', chapterRef: 'Part I · Ch 5' },
      { slug: 'kingdom-prokaryotae', name: 'Kingdom Prokaryotae', nameUr: 'مملکت پروکیریوٹی', chapterRef: 'Part I · Ch 6' },
      { slug: 'kingdom-plantae', name: 'Kingdom Plantae', nameUr: 'مملکت نباتات', chapterRef: 'Part I · Ch 8' },
      { slug: 'kingdom-animalia', name: 'Kingdom Animalia', nameUr: 'مملکت حیوانات', chapterRef: 'Part I · Ch 9' },
      { slug: 'digestion', name: 'Digestion', nameUr: 'ہاضمہ', chapterRef: 'Part II · Ch 12' },
      { slug: 'gaseous-exchange', name: 'Gaseous Exchange', nameUr: 'گیسوں کا تبادلہ', chapterRef: 'Part II · Ch 13' },
      { slug: 'circulation', name: 'Circulation', nameUr: 'گردشِ خون', chapterRef: 'Part II · Ch 14' },
      { slug: 'homeostasis', name: 'Homeostasis', nameUr: 'توازنِ داخلی', chapterRef: 'Part II · Ch 15' },
      { slug: 'coordination-and-control', name: 'Coordination and Control', nameUr: 'ربط و ضبط اور کنٹرول', chapterRef: 'Part II · Ch 16' },
      { slug: 'reproduction', name: 'Reproduction', nameUr: 'تولید', chapterRef: 'Part II · Ch 18' },
      { slug: 'genetics', name: 'Genetics', nameUr: 'علمِ وراثت', chapterRef: 'Part II · Ch 20' },
      { slug: 'evolution', name: 'Evolution', nameUr: 'ارتقا', chapterRef: 'Part II · Ch 22' },
    ],
  },

  /* ------------------ Sindh Board · English · Matric ------------------ */
  {
    subjectId: 'english',
    levelId: 'matric',
    boardId: 'sindh-board',
    topics: [
      { slug: 'reading-comprehension', name: 'Reading Comprehension', nameUr: 'فہمِ عبارت', chapterRef: 'Paper A · Section I' },
      { slug: 'parts-of-speech', name: 'Parts of Speech', nameUr: 'اجزائے کلام', chapterRef: 'Grammar · Unit 1' },
      { slug: 'tenses', name: 'Tenses', nameUr: 'زمانے', chapterRef: 'Grammar · Unit 2' },
      { slug: 'active-and-passive-voice', name: 'Active and Passive Voice', nameUr: 'معروف اور مجہول', chapterRef: 'Grammar · Unit 4' },
      { slug: 'narration', name: 'Direct and Indirect Narration', nameUr: 'بلا واسطہ اور بالواسطہ بیان', chapterRef: 'Grammar · Unit 5' },
      { slug: 'punctuation', name: 'Punctuation', nameUr: 'رموزِ اوقاف', chapterRef: 'Grammar · Unit 6' },
      { slug: 'vocabulary-and-idioms', name: 'Vocabulary and Idioms', nameUr: 'ذخیرۂ الفاظ اور محاورات', chapterRef: 'Paper B · Section II' },
      { slug: 'essay-writing', name: 'Essay Writing', nameUr: 'مضمون نویسی', chapterRef: 'Paper B · Section III' },
      { slug: 'letter-and-application-writing', name: 'Letter and Application Writing', nameUr: 'خط اور درخواست نویسی', chapterRef: 'Paper B · Section IV' },
      { slug: 'precis-writing', name: 'Précis Writing', nameUr: 'تلخیص نویسی', chapterRef: 'Paper B · Section V' },
      { slug: 'translation-urdu-to-english', name: 'Translation: Urdu to English', nameUr: 'ترجمہ: اردو سے انگریزی', chapterRef: 'Paper B · Section VI' },
    ],
  },

  /* --------------- Sindh Board · English · Intermediate --------------- */
  {
    subjectId: 'english',
    levelId: 'intermediate',
    boardId: 'sindh-board',
    topics: [
      { slug: 'advanced-reading-comprehension', name: 'Advanced Reading Comprehension', nameUr: 'اعلیٰ فہمِ عبارت', chapterRef: 'Paper A · Section I' },
      { slug: 'sentence-structure-and-clauses', name: 'Sentence Structure and Clauses', nameUr: 'جملے کی ساخت اور فقرے', chapterRef: 'Grammar · Unit 1' },
      { slug: 'modal-verbs', name: 'Modal Verbs', nameUr: 'معاون افعال', chapterRef: 'Grammar · Unit 3' },
      { slug: 'idiomatic-usage', name: 'Idiomatic Usage', nameUr: 'محاوراتی استعمال', chapterRef: 'Grammar · Unit 5' },
      { slug: 'report-writing', name: 'Report Writing', nameUr: 'رپورٹ نویسی', chapterRef: 'Composition · Unit 2' },
      { slug: 'dialogue-writing', name: 'Dialogue Writing', nameUr: 'مکالمہ نویسی', chapterRef: 'Composition · Unit 3' },
      { slug: 'story-writing', name: 'Story Writing', nameUr: 'کہانی نویسی', chapterRef: 'Composition · Unit 4' },
      { slug: 'prose-and-poems', name: 'Prose and Poems', nameUr: 'نثر اور نظمیں', chapterRef: 'Textbook · Book III' },
    ],
  },

  /* ------------------- Sindh Board · Urdu · Matric -------------------- */
  {
    subjectId: 'urdu',
    levelId: 'matric',
    boardId: 'sindh-board',
    topics: [
      { slug: 'qawaid', name: 'Grammar (Qawaid)', nameUr: 'قواعد', chapterRef: 'حصہ اول · باب ۱' },
      { slug: 'nasr', name: 'Prose (Nasr)', nameUr: 'نثر', chapterRef: 'حصہ نثر' },
      { slug: 'nazm', name: 'Poetry (Nazm)', nameUr: 'نظم', chapterRef: 'حصہ نظم' },
      { slug: 'ghazal', name: 'Ghazal', nameUr: 'غزل', chapterRef: 'حصہ نظم · غزلیات' },
      { slug: 'muhawarat', name: 'Idioms and Proverbs', nameUr: 'محاورات اور ضرب الامثال', chapterRef: 'حصہ اول · باب ۴' },
      { slug: 'mazmoon-nawisi', name: 'Essay Writing', nameUr: 'مضمون نویسی', chapterRef: 'انشا · باب ۱' },
      { slug: 'khat-nawisi', name: 'Letter Writing', nameUr: 'خط نویسی', chapterRef: 'انشا · باب ۲' },
      { slug: 'darkhwast-nawisi', name: 'Application Writing', nameUr: 'درخواست نویسی', chapterRef: 'انشا · باب ۳' },
      { slug: 'khulasa-nawisi', name: 'Summary Writing', nameUr: 'خلاصہ نویسی', chapterRef: 'انشا · باب ۴' },
      { slug: 'tarjuma-english-to-urdu', name: 'Translation: English to Urdu', nameUr: 'ترجمہ: انگریزی سے اردو', chapterRef: 'انشا · باب ۵' },
    ],
  },

  /* ---------------- Sindh Board · Urdu · Intermediate ----------------- */
  {
    subjectId: 'urdu',
    levelId: 'intermediate',
    boardId: 'sindh-board',
    topics: [
      { slug: 'aala-qawaid', name: 'Advanced Grammar', nameUr: 'اعلیٰ قواعد', chapterRef: 'حصہ اول' },
      { slug: 'nasr', name: 'Prose (Nasr)', nameUr: 'نثر', chapterRef: 'حصہ نثر' },
      { slug: 'nazm', name: 'Poetry (Nazm)', nameUr: 'نظم', chapterRef: 'حصہ نظم' },
      { slug: 'ghazal-o-nazm-fahmi', name: 'Ghazal and Nazm Appreciation', nameUr: 'غزل و نظم کی تفہیم', chapterRef: 'حصہ نظم · تنقید' },
      { slug: 'adabi-istilahat', name: 'Literary Terms', nameUr: 'ادبی اصطلاحات', chapterRef: 'ضمیمہ ۱' },
      { slug: 'balaghat-o-arooz', name: 'Rhetoric and Prosody', nameUr: 'بلاغت و عروض', chapterRef: 'ضمیمہ ۲' },
      { slug: 'mazmoon-nawisi', name: 'Essay Writing', nameUr: 'مضمون نویسی', chapterRef: 'انشا · باب ۱' },
      { slug: 'talkhees', name: 'Précis and Summary', nameUr: 'تلخیص و خلاصہ', chapterRef: 'انشا · باب ۳' },
    ],
  },

  /* ------------- Sindh Board · Computer Science · Matric -------------- */
  {
    subjectId: 'computer-science',
    levelId: 'matric',
    boardId: 'sindh-board',
    topics: [
      { slug: 'fundamentals-of-computer', name: 'Fundamentals of Computer', nameUr: 'کمپیوٹر کے بنیادی اصول', chapterRef: 'Class 9 · Ch 1' },
      { slug: 'computer-components', name: 'Computer Components', nameUr: 'کمپیوٹر کے اجزا', chapterRef: 'Class 9 · Ch 2' },
      { slug: 'number-systems-and-binary', name: 'Number Systems and Binary', nameUr: 'نظامِ اعداد اور ثنائی نظام', chapterRef: 'Class 9 · Ch 3' },
      { slug: 'operating-systems', name: 'Operating Systems', nameUr: 'آپریٹنگ سسٹم', chapterRef: 'Class 9 · Ch 4' },
      { slug: 'word-processing', name: 'Word Processing', nameUr: 'ورڈ پروسیسنگ', chapterRef: 'Class 9 · Ch 6' },
      { slug: 'spreadsheets', name: 'Spreadsheets', nameUr: 'اسپریڈ شیٹ', chapterRef: 'Class 9 · Ch 7' },
      { slug: 'problem-solving-and-algorithms', name: 'Problem Solving and Algorithms', nameUr: 'مسئلہ حل کرنا اور الگورتھم', chapterRef: 'Class 10 · Ch 1' },
      { slug: 'programming-in-c', name: 'Programming in C', nameUr: 'سی زبان میں پروگرامنگ', chapterRef: 'Class 10 · Ch 2' },
      { slug: 'databases', name: 'Databases', nameUr: 'ڈیٹا بیس', chapterRef: 'Class 10 · Ch 4' },
      { slug: 'networks-and-the-internet', name: 'Networks and the Internet', nameUr: 'نیٹ ورک اور انٹرنیٹ', chapterRef: 'Class 10 · Ch 5' },
    ],
  },

  /* ---------- Sindh Board · Computer Science · Intermediate ----------- */
  {
    subjectId: 'computer-science',
    levelId: 'intermediate',
    boardId: 'sindh-board',
    topics: [
      { slug: 'data-and-information', name: 'Data and Information', nameUr: 'ڈیٹا اور معلومات', chapterRef: 'Part I · Ch 1' },
      { slug: 'data-communication', name: 'Data Communication', nameUr: 'ابلاغِ ڈیٹا', chapterRef: 'Part I · Ch 3' },
      { slug: 'computer-networks', name: 'Computer Networks', nameUr: 'کمپیوٹر نیٹ ورک', chapterRef: 'Part I · Ch 4' },
      { slug: 'data-structures', name: 'Data Structures', nameUr: 'ڈیٹا اسٹرکچر', chapterRef: 'Part I · Ch 6' },
      { slug: 'database-management-systems', name: 'Database Management Systems', nameUr: 'ڈیٹا بیس مینجمنٹ سسٹم', chapterRef: 'Part I · Ch 7' },
      { slug: 'programming-fundamentals', name: 'Programming Fundamentals', nameUr: 'پروگرامنگ کے بنیادی اصول', chapterRef: 'Part II · Ch 2' },
      { slug: 'loops-and-arrays', name: 'Loops and Arrays', nameUr: 'لوپ اور اریز', chapterRef: 'Part II · Ch 4' },
      { slug: 'functions-and-pointers', name: 'Functions and Pointers', nameUr: 'فنکشن اور پوائنٹر', chapterRef: 'Part II · Ch 5' },
      { slug: 'object-oriented-programming', name: 'Object Oriented Programming', nameUr: 'آبجیکٹ اورینٹڈ پروگرامنگ', chapterRef: 'Part II · Ch 7' },
    ],
  },

  /* --------------- Punjab Board · Mathematics · Matric ---------------- */
  {
    subjectId: 'mathematics',
    levelId: 'matric',
    boardId: 'punjab-board',
    topics: [
      { slug: 'matrices-and-determinants', name: 'Matrices and Determinants', nameUr: 'میٹرکس اور محدَّدات', chapterRef: 'Class 9 · Ch 1' },
      { slug: 'real-and-complex-numbers', name: 'Real and Complex Numbers', nameUr: 'حقیقی اور مرکب اعداد', chapterRef: 'Class 9 · Ch 2' },
      { slug: 'signed-number-arithmetic', name: 'Signed Number Arithmetic', nameUr: 'مثبت و منفی اعداد کا حساب', chapterRef: 'Class 9 · Ch 2.1' },
      { slug: 'logarithms', name: 'Logarithms', nameUr: 'لاگرتھم', chapterRef: 'Class 9 · Ch 3' },
      { slug: 'algebraic-expressions', name: 'Algebraic Expressions and Algebraic Formulas', nameUr: 'الجبری اظہارات اور الجبری فارمولے', chapterRef: 'Class 9 · Ch 4' },
      { slug: 'algebraic-factorisation', name: 'Factorization', nameUr: 'تجزی', chapterRef: 'Class 9 · Ch 5' },
      { slug: 'algebraic-manipulation', name: 'Algebraic Manipulation', nameUr: 'الجبری تصرف', chapterRef: 'Class 9 · Ch 6' },
      { slug: 'linear-equations', name: 'Linear Equations and Inequalities', nameUr: 'خطی مساوات اور عدم مساوات', chapterRef: 'Class 9 · Ch 7' },
      { slug: 'quadratic-equations', name: 'Quadratic Equations', nameUr: 'دو درجی مساوات', chapterRef: 'Class 10 · Ch 1' },
      { slug: 'theory-of-quadratic-equations', name: 'Theory of Quadratic Equations', nameUr: 'نظریہ دو درجی مساوات', chapterRef: 'Class 10 · Ch 2' },
      { slug: 'variations', name: 'Variations', nameUr: 'تناسب و تغیّر', chapterRef: 'Class 10 · Ch 3' },
      { slug: 'partial-fractions', name: 'Partial Fractions', nameUr: 'جزوی کسور', chapterRef: 'Class 10 · Ch 4' },
      { slug: 'sets-and-functions', name: 'Sets and Functions', nameUr: 'مجموعے اور دالہ', chapterRef: 'Class 10 · Ch 5' },
      { slug: 'basic-statistics', name: 'Basic Statistics', nameUr: 'بنیادی شماریات', chapterRef: 'Class 10 · Ch 6' },
      { slug: 'introduction-to-trigonometry', name: 'Introduction to Trigonometry', nameUr: 'مثلثیات کا تعارف', chapterRef: 'Class 10 · Ch 7' },
    ],
  },

  /* ---------------- Cambridge · Mathematics · O Level ----------------- */
  {
    subjectId: 'mathematics',
    levelId: 'o-level',
    boardId: 'cambridge',
    topics: [
      { slug: 'number', name: 'Number', nameUr: 'اعداد', chapterRef: 'Syllabus 4024 · Topic 1' },
      { slug: 'directed-numbers', name: 'Directed Numbers', nameUr: 'جہتی اعداد', chapterRef: 'Syllabus 4024 · Topic 1.6' },
      { slug: 'indices-and-surds', name: 'Indices and Surds', nameUr: 'اُسّیہ اور جذری اعداد', chapterRef: 'Syllabus 4024 · Topic 1.7' },
      { slug: 'algebraic-manipulation', name: 'Algebraic Manipulation', nameUr: 'الجبری تصرف', chapterRef: 'Syllabus 4024 · Topic 2.2' },
      { slug: 'factorisation', name: 'Factorisation', nameUr: 'تجزی', chapterRef: 'Syllabus 4024 · Topic 2.3' },
      { slug: 'quadratic-equations-and-functions', name: 'Quadratic Equations and Functions', nameUr: 'دو درجی مساوات اور دالہ', chapterRef: 'Syllabus 4024 · Topic 2.5' },
      { slug: 'coordinate-geometry', name: 'Coordinate Geometry', nameUr: 'محددی ہندسہ', chapterRef: 'Syllabus 4024 · Topic 3' },
      { slug: 'mensuration', name: 'Mensuration', nameUr: 'پیمائش', chapterRef: 'Syllabus 4024 · Topic 5' },
      { slug: 'trigonometry', name: 'Trigonometry', nameUr: 'مثلثیات', chapterRef: 'Syllabus 4024 · Topic 6' },
      { slug: 'vectors-in-two-dimensions', name: 'Vectors in Two Dimensions', nameUr: 'دو ابعادی سمتیے', chapterRef: 'Syllabus 4024 · Topic 7' },
      { slug: 'matrices', name: 'Matrices', nameUr: 'میٹرکس', chapterRef: 'Syllabus 4024 · Topic 8' },
      { slug: 'statistics', name: 'Statistics', nameUr: 'شماریات', chapterRef: 'Syllabus 4024 · Topic 9' },
      { slug: 'probability', name: 'Probability', nameUr: 'احتمال', chapterRef: 'Syllabus 4024 · Topic 10' },
    ],
  },
];

/** Flattened topic rows, with `sortOrder` taken from position in the block. */
export const TOPICS = SYLLABUS.flatMap((block) =>
  block.topics.map((spec, index) => ({
    id: topicId(block.subjectId, block.levelId, block.boardId, spec.slug),
    subjectId: block.subjectId,
    levelId: block.levelId,
    boardId: block.boardId,
    name: spec.name,
    nameUr: spec.nameUr,
    chapterRef: spec.chapterRef,
    sortOrder: index + 1,
  })),
);

/* -------------------------------------------------------------------------
 * Prerequisite graph
 * ---------------------------------------------------------------------- */

/** Terse local helpers so the edge list below reads as the graph it describes. */
const sindhMathMatric = (slug: string) => topicId('mathematics', 'matric', 'sindh-board', slug);
const sindhMathFsc = (slug: string) => topicId('mathematics', 'intermediate', 'sindh-board', slug);
const punjabMathMatric = (slug: string) => topicId('mathematics', 'matric', 'punjab-board', slug);
const camMathOLevel = (slug: string) => topicId('mathematics', 'o-level', 'cambridge', slug);
const sindhPhyMatric = (slug: string) => topicId('physics', 'matric', 'sindh-board', slug);
const sindhPhyFsc = (slug: string) => topicId('physics', 'intermediate', 'sindh-board', slug);
const sindhChemMatric = (slug: string) => topicId('chemistry', 'matric', 'sindh-board', slug);
const sindhChemFsc = (slug: string) => topicId('chemistry', 'intermediate', 'sindh-board', slug);
const sindhBioMatric = (slug: string) => topicId('biology', 'matric', 'sindh-board', slug);
const sindhBioFsc = (slug: string) => topicId('biology', 'intermediate', 'sindh-board', slug);
const sindhEngMatric = (slug: string) => topicId('english', 'matric', 'sindh-board', slug);
const sindhEngFsc = (slug: string) => topicId('english', 'intermediate', 'sindh-board', slug);
const sindhUrduMatric = (slug: string) => topicId('urdu', 'matric', 'sindh-board', slug);
const sindhUrduFsc = (slug: string) => topicId('urdu', 'intermediate', 'sindh-board', slug);
const sindhCsMatric = (slug: string) => topicId('computer-science', 'matric', 'sindh-board', slug);
const sindhCsFsc = (slug: string) => topicId('computer-science', 'intermediate', 'sindh-board', slug);

/**
 * Prerequisite edges, written as `[topic, requires]`.
 *
 * The Mathematics chain is the specification's §2.4 worked example and is
 * modelled exactly as the document describes it: a student failing quadratic
 * equations is very often unable to factorise, and a student who cannot
 * factorise very often cannot handle signed numbers.  Both hops are therefore
 * direct edges, so the diagnostic agent's upstream walk from quadratic
 * equations reaches signed-number arithmetic in two steps without depending on
 * any intermediate chapter being present.
 *
 * The graph is deliberately not a tree: quadratic equations also requires
 * exponents and radicals (completing the square), and physics kinematics
 * genuinely requires algebraic manipulation.  Cross-*board* edges are rejected
 * by the validator; cross-level and cross-subject edges are legitimate.
 */
export const PREREQUISITES: ReadonlyArray<readonly [string, string]> = [
  /* ---- Sindh Board Mathematics · the §2.4 chain ---- */
  [sindhMathMatric('signed-number-arithmetic'), sindhMathMatric('real-numbers')],
  [sindhMathMatric('exponents-and-radicals'), sindhMathMatric('real-numbers')],
  [sindhMathMatric('logarithms'), sindhMathMatric('exponents-and-radicals')],
  [sindhMathMatric('algebraic-expressions'), sindhMathMatric('signed-number-arithmetic')],
  [sindhMathMatric('algebraic-factorisation'), sindhMathMatric('signed-number-arithmetic')],
  [sindhMathMatric('algebraic-factorisation'), sindhMathMatric('algebraic-expressions')],
  [sindhMathMatric('linear-equations'), sindhMathMatric('algebraic-expressions')],
  [sindhMathMatric('quadratic-equations'), sindhMathMatric('algebraic-factorisation')],
  [sindhMathMatric('quadratic-equations'), sindhMathMatric('exponents-and-radicals')],
  [sindhMathMatric('theory-of-quadratic-equations'), sindhMathMatric('quadratic-equations')],
  [sindhMathMatric('partial-fractions'), sindhMathMatric('algebraic-factorisation')],
  [sindhMathMatric('variations'), sindhMathMatric('linear-equations')],
  [sindhMathMatric('sets-and-functions'), sindhMathMatric('real-numbers')],
  [sindhMathMatric('introduction-to-trigonometry'), sindhMathMatric('algebraic-expressions')],
  [sindhMathMatric('basic-statistics'), sindhMathMatric('real-numbers')],
  [sindhMathMatric('matrices-and-determinants'), sindhMathMatric('algebraic-expressions')],

  /* ---- Sindh Board Mathematics · Intermediate builds on Matric ---- */
  [sindhMathFsc('quadratic-equations'), sindhMathMatric('theory-of-quadratic-equations')],
  [sindhMathFsc('number-systems'), sindhMathMatric('real-numbers')],
  [sindhMathFsc('sets-functions-and-groups'), sindhMathMatric('sets-and-functions')],
  [sindhMathFsc('matrices-and-determinants'), sindhMathMatric('matrices-and-determinants')],
  [sindhMathFsc('partial-fractions'), sindhMathMatric('partial-fractions')],
  [sindhMathFsc('fundamentals-of-trigonometry'), sindhMathMatric('introduction-to-trigonometry')],
  [sindhMathFsc('trigonometric-identities'), sindhMathFsc('fundamentals-of-trigonometry')],
  [sindhMathFsc('sequences-and-series'), sindhMathFsc('number-systems')],
  [sindhMathFsc('induction-and-binomial-theorem'), sindhMathFsc('sequences-and-series')],
  [sindhMathFsc('permutation-combination-probability'), sindhMathFsc('sequences-and-series')],
  [sindhMathFsc('functions-and-limits'), sindhMathFsc('sets-functions-and-groups')],
  [sindhMathFsc('differentiation'), sindhMathFsc('functions-and-limits')],
  [sindhMathFsc('integration'), sindhMathFsc('differentiation')],
  [sindhMathFsc('analytic-geometry'), sindhMathFsc('functions-and-limits')],
  [sindhMathFsc('vectors'), sindhMathFsc('analytic-geometry')],

  /* ---- Punjab Board Mathematics · the same chain, its own chapters ---- */
  [punjabMathMatric('signed-number-arithmetic'), punjabMathMatric('real-and-complex-numbers')],
  [punjabMathMatric('algebraic-expressions'), punjabMathMatric('signed-number-arithmetic')],
  [punjabMathMatric('algebraic-factorisation'), punjabMathMatric('signed-number-arithmetic')],
  [punjabMathMatric('algebraic-factorisation'), punjabMathMatric('algebraic-expressions')],
  [punjabMathMatric('algebraic-manipulation'), punjabMathMatric('algebraic-factorisation')],
  [punjabMathMatric('linear-equations'), punjabMathMatric('algebraic-expressions')],
  [punjabMathMatric('quadratic-equations'), punjabMathMatric('algebraic-factorisation')],
  [punjabMathMatric('theory-of-quadratic-equations'), punjabMathMatric('quadratic-equations')],
  [punjabMathMatric('partial-fractions'), punjabMathMatric('algebraic-manipulation')],
  [punjabMathMatric('logarithms'), punjabMathMatric('real-and-complex-numbers')],
  [punjabMathMatric('variations'), punjabMathMatric('linear-equations')],
  [punjabMathMatric('introduction-to-trigonometry'), punjabMathMatric('algebraic-expressions')],

  /* ---- Cambridge Mathematics · the same idea, a different syllabus ---- */
  [camMathOLevel('directed-numbers'), camMathOLevel('number')],
  [camMathOLevel('indices-and-surds'), camMathOLevel('number')],
  [camMathOLevel('algebraic-manipulation'), camMathOLevel('directed-numbers')],
  [camMathOLevel('factorisation'), camMathOLevel('algebraic-manipulation')],
  [camMathOLevel('quadratic-equations-and-functions'), camMathOLevel('factorisation')],
  [camMathOLevel('quadratic-equations-and-functions'), camMathOLevel('indices-and-surds')],
  [camMathOLevel('coordinate-geometry'), camMathOLevel('algebraic-manipulation')],
  [camMathOLevel('trigonometry'), camMathOLevel('coordinate-geometry')],
  [camMathOLevel('probability'), camMathOLevel('statistics')],

  /* ---- Sindh Board Physics ---- */
  [sindhPhyMatric('kinematics'), sindhPhyMatric('physical-quantities-and-measurement')],
  [sindhPhyMatric('kinematics'), sindhMathMatric('algebraic-expressions')],
  [sindhPhyMatric('dynamics'), sindhPhyMatric('kinematics')],
  [sindhPhyMatric('turning-effect-of-forces'), sindhPhyMatric('dynamics')],
  [sindhPhyMatric('gravitation'), sindhPhyMatric('dynamics')],
  [sindhPhyMatric('work-and-energy'), sindhPhyMatric('dynamics')],
  [sindhPhyMatric('properties-of-matter'), sindhPhyMatric('physical-quantities-and-measurement')],
  [sindhPhyMatric('thermal-properties-of-matter'), sindhPhyMatric('properties-of-matter')],
  [sindhPhyMatric('simple-harmonic-motion-and-waves'), sindhPhyMatric('work-and-energy')],
  [sindhPhyMatric('sound'), sindhPhyMatric('simple-harmonic-motion-and-waves')],
  [sindhPhyMatric('current-electricity'), sindhPhyMatric('electrostatics')],
  [sindhPhyMatric('electromagnetism'), sindhPhyMatric('current-electricity')],
  [sindhPhyFsc('vectors-and-equilibrium'), sindhPhyMatric('dynamics')],
  [sindhPhyFsc('motion-and-force'), sindhPhyFsc('vectors-and-equilibrium')],
  [sindhPhyFsc('work-and-energy'), sindhPhyFsc('motion-and-force')],
  [sindhPhyFsc('circular-motion'), sindhPhyFsc('motion-and-force')],
  [sindhPhyFsc('fluid-dynamics'), sindhPhyFsc('motion-and-force')],
  [sindhPhyFsc('oscillations'), sindhPhyFsc('work-and-energy')],
  [sindhPhyFsc('waves'), sindhPhyFsc('oscillations')],
  [sindhPhyFsc('physical-optics'), sindhPhyFsc('waves')],
  [sindhPhyFsc('thermodynamics'), sindhPhyFsc('work-and-energy')],
  [sindhPhyFsc('current-electricity'), sindhPhyFsc('electrostatics')],
  [sindhPhyFsc('electromagnetic-induction'), sindhPhyFsc('current-electricity')],
  [sindhPhyFsc('atomic-spectra'), sindhPhyFsc('waves')],
  [sindhPhyFsc('nuclear-physics'), sindhPhyFsc('atomic-spectra')],
  [sindhPhyFsc('measurements'), sindhPhyMatric('physical-quantities-and-measurement')],

  /* ---- Sindh Board Chemistry ---- */
  [sindhChemMatric('structure-of-atoms'), sindhChemMatric('fundamentals-of-chemistry')],
  [sindhChemMatric('periodic-table-and-periodicity'), sindhChemMatric('structure-of-atoms')],
  [sindhChemMatric('structure-of-molecules'), sindhChemMatric('periodic-table-and-periodicity')],
  [sindhChemMatric('physical-states-of-matter'), sindhChemMatric('structure-of-molecules')],
  [sindhChemMatric('solutions'), sindhChemMatric('physical-states-of-matter')],
  [sindhChemMatric('electrochemistry'), sindhChemMatric('structure-of-molecules')],
  [sindhChemMatric('chemical-reactivity'), sindhChemMatric('periodic-table-and-periodicity')],
  [sindhChemMatric('chemical-equilibrium'), sindhChemMatric('chemical-reactivity')],
  [sindhChemMatric('acids-bases-and-salts'), sindhChemMatric('chemical-equilibrium')],
  [sindhChemMatric('organic-chemistry'), sindhChemMatric('structure-of-molecules')],
  [sindhChemMatric('hydrocarbons'), sindhChemMatric('organic-chemistry')],
  [sindhChemMatric('biochemistry'), sindhChemMatric('hydrocarbons')],
  [sindhChemFsc('atomic-structure'), sindhChemMatric('structure-of-atoms')],
  [sindhChemFsc('theories-of-covalent-bonding'), sindhChemFsc('atomic-structure')],
  [sindhChemFsc('gases'), sindhChemFsc('basic-concepts')],
  [sindhChemFsc('liquids-and-solids'), sindhChemFsc('gases')],
  [sindhChemFsc('thermochemistry'), sindhChemFsc('basic-concepts')],
  [sindhChemFsc('chemical-equilibrium'), sindhChemFsc('thermochemistry')],
  [sindhChemFsc('reaction-kinetics'), sindhChemFsc('chemical-equilibrium')],
  [sindhChemFsc('electrochemistry'), sindhChemFsc('chemical-equilibrium')],
  [sindhChemFsc('alkanes-alkenes-alkynes'), sindhChemFsc('theories-of-covalent-bonding')],
  [sindhChemFsc('alcohols-phenols-ethers'), sindhChemFsc('alkanes-alkenes-alkynes')],
  [sindhChemFsc('carboxylic-acids'), sindhChemFsc('alcohols-phenols-ethers')],
  [sindhChemFsc('macromolecules'), sindhChemFsc('carboxylic-acids')],
  [sindhChemFsc('basic-concepts'), sindhChemMatric('fundamentals-of-chemistry')],

  /* ---- Sindh Board Biology ---- */
  [sindhBioMatric('cells-and-tissues'), sindhBioMatric('introduction-to-biology')],
  [sindhBioMatric('cell-cycle'), sindhBioMatric('cells-and-tissues')],
  [sindhBioMatric('enzymes'), sindhBioMatric('cells-and-tissues')],
  [sindhBioMatric('bioenergetics'), sindhBioMatric('enzymes')],
  [sindhBioMatric('nutrition'), sindhBioMatric('bioenergetics')],
  [sindhBioMatric('transport'), sindhBioMatric('nutrition')],
  [sindhBioMatric('gaseous-exchange'), sindhBioMatric('transport')],
  [sindhBioMatric('homeostasis'), sindhBioMatric('transport')],
  [sindhBioMatric('coordination-and-control'), sindhBioMatric('homeostasis')],
  [sindhBioMatric('support-and-movement'), sindhBioMatric('cells-and-tissues')],
  [sindhBioMatric('reproduction'), sindhBioMatric('cell-cycle')],
  [sindhBioMatric('inheritance'), sindhBioMatric('reproduction')],
  [sindhBioMatric('biotechnology'), sindhBioMatric('inheritance')],
  [sindhBioMatric('biodiversity'), sindhBioMatric('solving-a-biological-problem')],
  [sindhBioFsc('the-cell'), sindhBioMatric('cells-and-tissues')],
  [sindhBioFsc('biological-molecules'), sindhBioFsc('the-cell')],
  [sindhBioFsc('enzymes'), sindhBioFsc('biological-molecules')],
  [sindhBioFsc('bioenergetics'), sindhBioFsc('enzymes')],
  [sindhBioFsc('variety-of-life'), sindhBioMatric('biodiversity')],
  [sindhBioFsc('kingdom-prokaryotae'), sindhBioFsc('variety-of-life')],
  [sindhBioFsc('kingdom-plantae'), sindhBioFsc('variety-of-life')],
  [sindhBioFsc('kingdom-animalia'), sindhBioFsc('variety-of-life')],
  [sindhBioFsc('digestion'), sindhBioFsc('kingdom-animalia')],
  [sindhBioFsc('gaseous-exchange'), sindhBioFsc('kingdom-animalia')],
  [sindhBioFsc('circulation'), sindhBioFsc('gaseous-exchange')],
  [sindhBioFsc('homeostasis'), sindhBioFsc('circulation')],
  [sindhBioFsc('coordination-and-control'), sindhBioFsc('homeostasis')],
  [sindhBioFsc('reproduction'), sindhBioFsc('kingdom-animalia')],
  [sindhBioFsc('genetics'), sindhBioFsc('reproduction')],
  [sindhBioFsc('evolution'), sindhBioFsc('genetics')],

  /* ---- Sindh Board English ---- */
  [sindhEngMatric('active-and-passive-voice'), sindhEngMatric('tenses')],
  [sindhEngMatric('narration'), sindhEngMatric('tenses')],
  [sindhEngMatric('tenses'), sindhEngMatric('parts-of-speech')],
  [sindhEngMatric('essay-writing'), sindhEngMatric('vocabulary-and-idioms')],
  [sindhEngMatric('essay-writing'), sindhEngMatric('punctuation')],
  [sindhEngMatric('letter-and-application-writing'), sindhEngMatric('punctuation')],
  [sindhEngMatric('precis-writing'), sindhEngMatric('reading-comprehension')],
  [sindhEngMatric('translation-urdu-to-english'), sindhEngMatric('vocabulary-and-idioms')],
  [sindhEngMatric('vocabulary-and-idioms'), sindhEngMatric('parts-of-speech')],
  [sindhEngFsc('sentence-structure-and-clauses'), sindhEngMatric('parts-of-speech')],
  [sindhEngFsc('modal-verbs'), sindhEngMatric('tenses')],
  [sindhEngFsc('advanced-reading-comprehension'), sindhEngMatric('reading-comprehension')],
  [sindhEngFsc('idiomatic-usage'), sindhEngMatric('vocabulary-and-idioms')],
  [sindhEngFsc('report-writing'), sindhEngFsc('sentence-structure-and-clauses')],
  [sindhEngFsc('dialogue-writing'), sindhEngFsc('sentence-structure-and-clauses')],
  [sindhEngFsc('story-writing'), sindhEngMatric('essay-writing')],
  [sindhEngFsc('prose-and-poems'), sindhEngFsc('advanced-reading-comprehension')],

  /* ---- Sindh Board Urdu ---- */
  [sindhUrduMatric('mazmoon-nawisi'), sindhUrduMatric('qawaid')],
  [sindhUrduMatric('khat-nawisi'), sindhUrduMatric('qawaid')],
  [sindhUrduMatric('darkhwast-nawisi'), sindhUrduMatric('khat-nawisi')],
  [sindhUrduMatric('khulasa-nawisi'), sindhUrduMatric('nasr')],
  [sindhUrduMatric('ghazal'), sindhUrduMatric('nazm')],
  [sindhUrduMatric('muhawarat'), sindhUrduMatric('qawaid')],
  [sindhUrduMatric('tarjuma-english-to-urdu'), sindhUrduMatric('muhawarat')],
  [sindhUrduFsc('aala-qawaid'), sindhUrduMatric('qawaid')],
  [sindhUrduFsc('nasr'), sindhUrduMatric('nasr')],
  [sindhUrduFsc('nazm'), sindhUrduMatric('nazm')],
  [sindhUrduFsc('ghazal-o-nazm-fahmi'), sindhUrduMatric('ghazal')],
  [sindhUrduFsc('adabi-istilahat'), sindhUrduFsc('ghazal-o-nazm-fahmi')],
  [sindhUrduFsc('balaghat-o-arooz'), sindhUrduFsc('adabi-istilahat')],
  [sindhUrduFsc('mazmoon-nawisi'), sindhUrduMatric('mazmoon-nawisi')],
  [sindhUrduFsc('talkhees'), sindhUrduMatric('khulasa-nawisi')],

  /* ---- Sindh Board Computer Science ---- */
  [sindhCsMatric('computer-components'), sindhCsMatric('fundamentals-of-computer')],
  [sindhCsMatric('number-systems-and-binary'), sindhCsMatric('fundamentals-of-computer')],
  [sindhCsMatric('operating-systems'), sindhCsMatric('computer-components')],
  [sindhCsMatric('word-processing'), sindhCsMatric('operating-systems')],
  [sindhCsMatric('spreadsheets'), sindhCsMatric('operating-systems')],
  [sindhCsMatric('programming-in-c'), sindhCsMatric('problem-solving-and-algorithms')],
  [sindhCsMatric('problem-solving-and-algorithms'), sindhCsMatric('number-systems-and-binary')],
  [sindhCsMatric('databases'), sindhCsMatric('spreadsheets')],
  [sindhCsMatric('networks-and-the-internet'), sindhCsMatric('computer-components')],
  [sindhCsFsc('data-communication'), sindhCsFsc('data-and-information')],
  [sindhCsFsc('computer-networks'), sindhCsFsc('data-communication')],
  [sindhCsFsc('database-management-systems'), sindhCsMatric('databases')],
  [sindhCsFsc('programming-fundamentals'), sindhCsMatric('programming-in-c')],
  [sindhCsFsc('loops-and-arrays'), sindhCsFsc('programming-fundamentals')],
  [sindhCsFsc('functions-and-pointers'), sindhCsFsc('loops-and-arrays')],
  [sindhCsFsc('object-oriented-programming'), sindhCsFsc('functions-and-pointers')],
  [sindhCsFsc('data-structures'), sindhCsFsc('loops-and-arrays')],
  [sindhCsFsc('data-and-information'), sindhCsMatric('fundamentals-of-computer')],
];

/* =========================================================================
 * 3. Service types — FR-3.7, §6.29
 * ====================================================================== */

export const SERVICE_TYPES = [
  { id: 'academic-tuition', name: 'Academic Tuition', nameUr: 'تعلیمی ٹیوشن', sortOrder: 1 },
  {
    id: 'home-tuition-mentoring',
    name: 'Home Tuition with Mentoring',
    nameUr: 'گھر پر ٹیوشن اور رہنمائی',
    sortOrder: 2,
  },
  { id: 'exam-prep', name: 'Exam Preparation', nameUr: 'امتحان کی تیاری', sortOrder: 3 },
  {
    id: 'concept-clarification',
    name: 'Concept Clarification',
    nameUr: 'تصورات کی وضاحت',
    sortOrder: 4,
  },
  {
    id: 'assessment-support',
    name: 'Assessment Support',
    nameUr: 'جانچ اور پرچے کی معاونت',
    sortOrder: 5,
  },
] as const;

/* =========================================================================
 * 4. Interface strings — §6.27
 *
 * Authored copy, both languages, keyed identically.  This is not translation
 * of user content; see CLAUDE.md §2.10.  The payment strings below carry the
 * FR-31.10 / SEC-23 disclosure and their wording is load-bearing.  The
 * verification strings carry FR-6.8 wording and must never be softened into
 * "trusted", "safe", "vetted" or "background checked".
 * ====================================================================== */

const COPY: Record<string, { en: string; ur: string }> = {
  'app.name': { en: 'Ustaad.com', ur: 'اُستاد ڈاٹ کام' },
  'app.tagline': {
    en: 'Verified tutors, found near you',
    ur: 'تصدیق شدہ اساتذہ، آپ کے قریب',
  },

  'nav.search': { en: 'Find a tutor', ur: 'استاد تلاش کریں' },
  'nav.home_tuition': { en: 'Female home tuition', ur: 'خواتین اساتذہ کی گھر پر ٹیوشن' },
  'nav.bookings': { en: 'Bookings', ur: 'بکنگ' },
  'nav.profile': { en: 'Profile', ur: 'پروفائل' },
  'nav.login': { en: 'Log in', ur: 'لاگ ان' },
  'nav.logout': { en: 'Log out', ur: 'لاگ آؤٹ' },
  'nav.register': { en: 'Register', ur: 'رجسٹر کریں' },
  'nav.volunteer': { en: 'Volunteer as a tutor', ur: 'رضاکار استاد بنیں' },
  'nav.feedback': { en: 'Report a problem', ur: 'مسئلہ رپورٹ کریں' },

  'search.subject': { en: 'Subject', ur: 'مضمون' },
  'search.topic': { en: 'Topic', ur: 'موضوع' },
  'search.level': { en: 'Level', ur: 'درجہ' },
  'search.board': { en: 'Board', ur: 'بورڈ' },
  'search.province': { en: 'Province', ur: 'صوبہ' },
  'search.city': { en: 'City', ur: 'شہر' },
  'search.area': { en: 'Area', ur: 'علاقہ' },
  'search.gender_preference': { en: 'Tutor gender', ur: 'استاد کی جنس' },
  'search.gender_any': { en: 'No preference', ur: 'کوئی ترجیح نہیں' },
  'search.gender_female_only': { en: 'Female tutors only', ur: 'صرف خواتین اساتذہ' },
  'search.gender_male_only': { en: 'Male tutors only', ur: 'صرف مرد اساتذہ' },
  'search.include_nearby': { en: 'Include nearby areas', ur: 'قریبی علاقے بھی شامل کریں' },
  'search.no_results': { en: 'No tutors match these filters', ur: 'ان شرائط پر کوئی استاد نہیں ملا' },
  'search.results_count': { en: 'tutors found', ur: 'اساتذہ ملے' },

  'verification.identity_track': { en: 'Identity verification', ur: 'شناخت کی تصدیق' },
  'verification.competency_track': { en: 'Competency assessment', ur: 'قابلیت کی جانچ' },
  'verification.cnic_verified': {
    en: 'CNIC verified by Ustaad.com',
    ur: 'شناختی کارڈ کی تصدیق اُستاد ڈاٹ کام نے کی',
  },
  'verification.documents_reviewed': {
    en: 'Academic documents reviewed',
    ur: 'تعلیمی دستاویزات کا جائزہ لیا گیا',
  },
  'verification.verified_on': { en: 'Verified on', ur: 'تصدیق کی تاریخ' },
  'verification.verified_by': { en: 'Verified by', ur: 'تصدیق کنندہ' },
  'verification.pending': { en: 'Verification pending', ur: 'تصدیق زیرِ التوا' },
  'verification.scope_note': {
    en: 'Ustaad.com checks the documents listed above. No police or background check is performed.',
    ur: 'اُستاد ڈاٹ کام صرف اوپر درج دستاویزات کی جانچ کرتا ہے۔ پولیس یا بیک گراؤنڈ چیک نہیں کیا جاتا۔',
  },

  'payment.agreed_rate': { en: 'Agreed rate', ur: 'طے شدہ فیس' },
  'payment.status_pending': { en: 'Payment pending', ur: 'ادائیگی باقی ہے' },
  'payment.status_family_marked': {
    en: 'Marked paid by the family — awaiting the tutor’s confirmation',
    ur: 'خاندان نے ادائیگی درج کی — استاد کی تصدیق کا انتظار ہے',
  },
  'payment.status_settled': { en: 'Confirmed by both parties', ur: 'دونوں فریقوں نے تصدیق کر دی' },
  'payment.status_disputed': { en: 'Disputed', ur: 'تنازع' },
  'payment.disclaimer': {
    en: 'Ustaad.com records what was agreed and what both parties confirm was paid. It does not process, hold or transfer money. Payment is made directly between the family and the tutor.',
    ur: 'اُستاد ڈاٹ کام صرف یہ ریکارڈ رکھتا ہے کہ کیا طے ہوا اور دونوں فریق کیا ادائیگی تسلیم کرتے ہیں۔ یہ رقم وصول، محفوظ یا منتقل نہیں کرتا۔ ادائیگی براہِ راست خاندان اور استاد کے درمیان ہوتی ہے۔',
  },

  'booking.request': { en: 'Request a booking', ur: 'بکنگ کی درخواست' },
  'booking.trial': { en: 'Book a trial session', ur: 'آزمائشی کلاس بک کریں' },
  'booking.single_session': { en: 'Single session', ur: 'ایک نشست' },
  'booking.monthly': { en: 'Monthly', ur: 'ماہانہ' },
  'booking.guardian_presence': {
    en: 'A guardian will be present during the session',
    ur: 'کلاس کے دوران سرپرست موجود ہوں گے',
  },

  'rate.per_hour_equivalent': { en: 'per hour equivalent', ur: 'فی گھنٹہ کے برابر' },
  'rate.negotiable': { en: 'Negotiable', ur: 'قابلِ گفتگو' },
  'rate.travel_charge': { en: 'Travel charge', ur: 'آمد و رفت کا خرچ' },

  'common.save': { en: 'Save', ur: 'محفوظ کریں' },
  'common.cancel': { en: 'Cancel', ur: 'منسوخ کریں' },
  'common.submit': { en: 'Submit', ur: 'جمع کرائیں' },
  'common.loading': { en: 'Loading…', ur: 'لوڈ ہو رہا ہے…' },
  'common.error': { en: 'Something went wrong', ur: 'کچھ غلط ہو گیا' },
  'common.required_field': { en: 'This field is required', ur: 'یہ خانہ لازمی ہے' },
};

export const I18N_STRINGS = Object.entries(COPY).flatMap(([key, values]) =>
  LANGS.map((lang) => ({ key, lang, value: values[lang] })),
);

/* =========================================================================
 * 5. Derived rows and the seed itself
 * ====================================================================== */

/** Undirected pairs expanded into the two rows the table stores. */
export const ADJACENCY_ROWS = ADJACENCY_PAIRS.flatMap(([a, b, minutes]) => [
  { areaId: a, adjacentAreaId: b, travelMinutes: minutes },
  { areaId: b, adjacentAreaId: a, travelMinutes: minutes },
]);

export const PREREQUISITE_ROWS = PREREQUISITES.map(([topic, prerequisite]) => ({
  topicId: topic,
  prerequisiteTopicId: prerequisite,
}));

/**
 * Validate everything before touching the database.
 *
 * Exported so it can be run on its own (and unit-tested) without a database
 * connection.  Throws `SeedValidationError` on the first failing category, with
 * the offending rows named.
 */
export function validateReferenceData(): void {
  assertUniqueIds('province', PROVINCES);
  assertUniqueIds('city', CITIES);
  assertUniqueIds('area', AREAS);
  assertUniqueIds('subject', SUBJECTS);
  assertUniqueIds('level', LEVELS);
  assertUniqueIds('board', BOARDS);
  assertUniqueIds('topic', TOPICS);
  assertUniqueIds('service type', SERVICE_TYPES);

  const provinceIds = new Set(PROVINCES.map((p) => p.id));
  const cityIds = new Set(CITIES.map((c) => c.id));
  const subjectIds = new Set(SUBJECTS.map((s) => s.id));
  const levelIds = new Set(LEVELS.map((l) => l.id));
  const boardIds = new Set(BOARDS.map((b) => b.id));

  assertReferencesExist('city', CITIES, 'provinceId', 'province', provinceIds);
  assertReferencesExist('area', AREAS, 'cityId', 'city', cityIds);
  assertReferencesExist('topic', TOPICS, 'subjectId', 'subject', subjectIds);
  assertReferencesExist('topic', TOPICS, 'levelId', 'level', levelIds);
  assertReferencesExist('topic', TOPICS, 'boardId', 'board', boardIds);

  const areaCityById = new Map(AREAS.map((a) => [a.id as string, a.cityId as string]));
  assertAdjacencyWellFormed(ADJACENCY_ROWS, areaCityById);

  const topicBoardById = new Map(TOPICS.map((t) => [t.id, t.boardId]));
  assertPrerequisiteGraphIsAcyclic(PREREQUISITE_ROWS);
  assertPrerequisitesShareBoard(PREREQUISITE_ROWS, topicBoardById);

  assertI18nComplete(I18N_STRINGS, LANGS);
}

/**
 * Seed the reference tables.
 *
 * Idempotent: existing reference rows are cleared first, in reverse dependency
 * order, then rewritten.  Intended for a fresh or reference-only database — it
 * does not attempt to reconcile rows that user data already points at.
 *
 * Statements are awaited sequentially rather than wrapped in
 * `db.transaction()`.  Drizzle's transaction callback is synchronous on
 * better-sqlite3 and asynchronous on postgres-js, so a transaction here would
 * be one of the few pieces of code that has to know which engine is running —
 * exactly what PORTABILITY.md exists to prevent.  The trade is acceptable
 * because the seed is idempotent: a partial failure is repaired by running it
 * again, not by a rollback.
 */
export async function seedReference(db: Db): Promise<void> {
  validateReferenceData();

  // Reverse dependency order.
  await db.delete(topicPrerequisites);
  await db.delete(topics);
  await db.delete(areaAdjacency);
  await db.delete(areas);
  await db.delete(cities);
  await db.delete(provinces);
  await db.delete(subjects);
  await db.delete(levels);
  await db.delete(boards);
  await db.delete(serviceTypes);
  await db.delete(i18nStrings);

  await db.insert(provinces).values([...PROVINCES]);
  await db.insert(cities).values([...CITIES]);
  await db.insert(areas).values([...AREAS]);
  await db.insert(areaAdjacency).values(ADJACENCY_ROWS);

  await db.insert(subjects).values([...SUBJECTS]);
  await db.insert(levels).values([...LEVELS]);
  await db.insert(boards).values([...BOARDS]);
  await db.insert(topics).values(TOPICS);
  await db.insert(topicPrerequisites).values(PREREQUISITE_ROWS);

  await db.insert(serviceTypes).values([...SERVICE_TYPES]);
  await db.insert(i18nStrings).values(I18N_STRINGS);
}

/** Row counts, for the seed runner's summary output. */
export const REFERENCE_COUNTS = () => ({
  provinces: PROVINCES.length,
  cities: CITIES.length,
  areas: AREAS.length,
  area_adjacency: ADJACENCY_ROWS.length,
  subjects: SUBJECTS.length,
  levels: LEVELS.length,
  boards: BOARDS.length,
  topics: TOPICS.length,
  topic_prerequisites: PREREQUISITE_ROWS.length,
  service_types: SERVICE_TYPES.length,
  i18n_strings: I18N_STRINGS.length,
});
