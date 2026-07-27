/**
 * Demonstration people — tutors, families and staff (§6.15, FR-15.8).
 *
 * **Every person here is invented.** No name, phone number, email address or
 * biography belongs to a real person, and none of this may ever be confused
 * with production data. Against a live database `npm run db:seed:demo` refuses
 * the password published in the README and requires one the operator chooses,
 * for that reason — see `index.ts`.
 *
 * ── Why the cohort is shaped the way it is ─────────────────────────────────
 * FR-15.8 asks for at least 25 tutors across at least four cities with varied
 * genders, review histories, verification states, service categories,
 * engagement types, pricing models and group willingness. That is the letter of
 * it. The reason it matters is FR-15.6 and §11's note on SEC-19 to SEC-21: the
 * platform's primary case is a **female tutor travelling to a family home in a
 * specific Karachi area**, and a demonstration where that search returns an
 * empty list has disproved the product in front of the person assessing it.
 *
 * So the cohort is deliberately unbalanced: eight approved female tutors who
 * teach at home in Karachi, spread across six areas, so that
 * `female_only` + `home` + any of those areas returns several people. The rest
 * of the variety is layered on top of that guarantee rather than competing with
 * it.
 *
 * Biographies are in English, Urdu script and Roman Urdu, stored byte for byte
 * and never translated (§2.10) — which also makes the RTL work in §6.27
 * demonstrable against real stored data rather than a lorem-ipsum placeholder.
 */

import { SEARCHABLE_PROFILE_STATUS, type ProfileStatus } from '../../schema/tutor';

export interface DemoTutorSpec {
  /** Stable across re-seeds, so a demonstration link keeps working. */
  slug: string;
  displayName: string;
  gender: 'female' | 'male';
  cityId: string;
  areas: string[];
  bio: string;
  bioUr?: string;
  qualifications: string;
  experienceYears: number;
  teachesAtHome: boolean;
  teachesOnline: boolean;
  teachesAtOwnPlace: boolean;
  profileStatus: ProfileStatus;
  volunteer?: { weeklyHours: number };
  /** Identity verification, where one has been decided. */
  identity?: {
    decision: 'approved' | 'rejected' | 'more_info_needed';
    artefacts: ('cnic' | 'degree' | 'transcript')[];
    reason: string;
    /** Days before the seed moment. Keeps the trail chronological. */
    daysAgo: number;
    /** Files an appeal against the decision (SEC-18, FR-28.3). */
    appeals?: { reason: string; outcome: 'open' | 'upheld' };
  };
  claims: {
    subjectId: string;
    levelId: string;
    boardId: string;
    topicIds: string[];
    /** `verified` badges expire; `expiresInDays` may be negative (lapsed). */
    status: 'asserted' | 'verified' | 'failed' | 'expired' | 'under_assessment';
    expiresInDays?: number;
  }[];
  rates: {
    rateType: 'monthly' | 'hourly' | 'single_session' | 'group_monthly';
    /** **Integer paisa.** 1 PKR = 100 paisa (§2.1). */
    amount: number;
    mode: 'home' | 'online' | 'own_place';
    subjectId?: string;
    levelId?: string;
    sessionsPerWeek?: number;
    minutesPerSession?: number;
    groupSizeMax?: number;
    perHeadAmount?: number;
    negotiable?: boolean;
    travelCharge?: number;
  }[];
  safety?: {
    femaleStudentsOnly?: boolean;
    guardianPresenceRequired?: boolean;
    restrictedAreaIds?: string[];
  };
}

const MATRIC_MATH = 'math-matric-sindh-quadratic-equations';

/* -------------------------------------------------------------------------
 * The primary case — approved female home tutors in Karachi (FR-15.6)
 * ---------------------------------------------------------------------- */

const KARACHI_FEMALE_HOME: DemoTutorSpec[] = [
  {
    slug: 'ayesha-siddiqui',
    displayName: 'Ayesha Siddiqui',
    gender: 'female',
    cityId: 'karachi',
    areas: ['karachi-clifton', 'karachi-dha', 'karachi-pechs'],
    bio: 'I teach Mathematics to Matric and Intermediate students at their homes in Clifton, DHA and PECHS. I begin with a diagnostic — most students who say they cannot do algebra are actually missing something from three years earlier, and there is no point drilling quadratics until that is fixed.',
    bioUr: 'میں کلفٹن، ڈی ایچ اے اور پی ای سی ایچ ایس میں طالبات کے گھر پر ریاضی پڑھاتی ہوں۔',
    qualifications: 'MSc Mathematics, University of Karachi',
    experienceYears: 9,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: {
      decision: 'approved',
      artefacts: ['cnic', 'degree'],
      reason: 'CNIC checked against the submitted image. MSc degree certificate verified.',
      daysAgo: 240,
    },
    claims: [
      {
        subjectId: 'mathematics',
        levelId: 'matric',
        boardId: 'sindh-board',
        topicIds: [MATRIC_MATH],
        status: 'verified',
        expiresInDays: 120,
      },
      {
        subjectId: 'mathematics',
        levelId: 'intermediate',
        boardId: 'sindh-board',
        topicIds: [],
        status: 'asserted',
      },
    ],
    rates: [
      { rateType: 'monthly', amount: 1_800_000, mode: 'home', subjectId: 'mathematics', levelId: 'matric', sessionsPerWeek: 3, minutesPerSession: 90, travelCharge: 100_000 },
      { rateType: 'monthly', amount: 1_400_000, mode: 'online', sessionsPerWeek: 3, minutesPerSession: 90 },
      { rateType: 'monthly', amount: 2_400_000, mode: 'home', groupSizeMax: 4, perHeadAmount: 700_000, sessionsPerWeek: 3, minutesPerSession: 90 },
    ],
    safety: { femaleStudentsOnly: true, guardianPresenceRequired: true },
  },
  {
    slug: 'fatima-noor',
    displayName: 'Fatima Noor',
    gender: 'female',
    cityId: 'karachi',
    areas: ['karachi-gulshan-e-iqbal', 'karachi-gulistan-e-johar'],
    bio: 'Physics and Mathematics, Matric and O Level. Nine years of home tuition in Gulshan and Johar. I do not take on more students than I can prepare properly before board exams.',
    qualifications: 'BS Physics, NED University of Engineering and Technology',
    experienceYears: 7,
    teachesAtHome: true,
    teachesOnline: false,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: {
      decision: 'approved',
      artefacts: ['cnic', 'degree'],
      reason: 'CNIC and BS Physics degree both checked and consistent with the profile.',
      daysAgo: 180,
    },
    claims: [
      { subjectId: 'physics', levelId: 'matric', boardId: 'sindh-board', topicIds: [], status: 'verified', expiresInDays: 60 },
      { subjectId: 'mathematics', levelId: 'matric', boardId: 'sindh-board', topicIds: [MATRIC_MATH], status: 'verified', expiresInDays: 200 },
    ],
    rates: [
      { rateType: 'monthly', amount: 1_600_000, mode: 'home', subjectId: 'mathematics', levelId: 'matric', sessionsPerWeek: 3, minutesPerSession: 90 },
      { rateType: 'hourly', amount: 200_000, mode: 'home', minutesPerSession: 60, negotiable: true },
    ],
    safety: { femaleStudentsOnly: true, guardianPresenceRequired: true },
  },
  {
    slug: 'hina-rehman',
    displayName: 'Hina Rehman',
    gender: 'female',
    cityId: 'karachi',
    areas: ['karachi-north-nazimabad', 'karachi-nazimabad', 'karachi-federal-b-area'],
    bio: 'Chemistry aur Biology, Matric se Intermediate tak. Main North Nazimabad aur Nazimabad mein ghar par parhati hoon. Concept pehle, ratta baad mein — aur ratta zaroori ho to bhi samajh ke saath.',
    qualifications: 'MSc Chemistry, Federal Urdu University',
    experienceYears: 11,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: {
      decision: 'approved',
      artefacts: ['cnic', 'degree', 'transcript'],
      reason: 'CNIC, MSc certificate and full transcript checked. Eleven years of stated experience consistent with the transcript dates.',
      daysAgo: 300,
    },
    claims: [
      { subjectId: 'chemistry', levelId: 'intermediate', boardId: 'sindh-board', topicIds: [], status: 'verified', expiresInDays: 25 },
      { subjectId: 'biology', levelId: 'matric', boardId: 'sindh-board', topicIds: [], status: 'verified', expiresInDays: 340 },
      { subjectId: 'chemistry', levelId: 'intermediate', boardId: 'cambridge', topicIds: [], status: 'failed' },
    ],
    rates: [
      { rateType: 'monthly', amount: 2_000_000, mode: 'home', sessionsPerWeek: 3, minutesPerSession: 120 },
      { rateType: 'single_session', amount: 350_000, mode: 'home', minutesPerSession: 120 },
    ],
    safety: { femaleStudentsOnly: true },
  },
  {
    slug: 'sana-tariq',
    displayName: 'Sana Tariq',
    gender: 'female',
    cityId: 'karachi',
    areas: ['karachi-clifton', 'karachi-saddar'],
    bio: 'English language and literature, O and A Level. I work on writing rather than on past papers — a student who can build an argument does not need to memorise one.',
    qualifications: 'MA English Literature, University of Karachi; CELTA',
    experienceYears: 6,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: {
      decision: 'approved',
      artefacts: ['cnic', 'degree'],
      reason: 'CNIC and MA certificate checked. CELTA certificate noted but not independently verified.',
      daysAgo: 120,
    },
    claims: [
      { subjectId: 'english', levelId: 'o-level', boardId: 'cambridge', topicIds: [], status: 'verified', expiresInDays: 280 },
      { subjectId: 'english', levelId: 'a-level', boardId: 'cambridge', topicIds: [], status: 'under_assessment' },
    ],
    rates: [
      { rateType: 'hourly', amount: 300_000, mode: 'home', minutesPerSession: 60, travelCharge: 150_000 },
      { rateType: 'hourly', amount: 250_000, mode: 'online', minutesPerSession: 60 },
    ],
    safety: { guardianPresenceRequired: true },
  },
  {
    slug: 'maryam-javed',
    displayName: 'Maryam Javed',
    gender: 'female',
    cityId: 'karachi',
    areas: ['karachi-dha', 'karachi-clifton'],
    bio: 'Computer Science for O Level and Intermediate — Python, algorithms, and the parts of the syllabus that are actually examined. I have been teaching since finishing my degree.',
    qualifications: 'BS Computer Science, FAST-NUCES Karachi',
    experienceYears: 4,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: {
      decision: 'approved',
      artefacts: ['cnic', 'degree'],
      reason: 'CNIC and BS Computer Science degree checked.',
      daysAgo: 95,
    },
    claims: [
      { subjectId: 'computer-science', levelId: 'o-level', boardId: 'cambridge', topicIds: [], status: 'verified', expiresInDays: 150 },
    ],
    rates: [
      { rateType: 'monthly', amount: 2_200_000, mode: 'home', sessionsPerWeek: 2, minutesPerSession: 120, negotiable: true },
      { rateType: 'monthly', amount: 1_700_000, mode: 'online', sessionsPerWeek: 2, minutesPerSession: 120 },
    ],
    safety: { femaleStudentsOnly: true, restrictedAreaIds: ['karachi-korangi', 'karachi-malir'] },
  },
  {
    slug: 'zainab-ali',
    displayName: 'Zainab Ali',
    gender: 'female',
    cityId: 'karachi',
    areas: ['karachi-gulshan-e-iqbal', 'karachi-federal-b-area'],
    bio: 'اردو اور اسلامیات، پرائمری سے میٹرک تک۔ میں گلشن اقبال اور فیڈرل بی ایریا میں گھر پر پڑھاتی ہوں۔',
    bioUr: 'اردو اور اسلامیات، پرائمری سے میٹرک تک۔ میں گلشن اقبال اور فیڈرل بی ایریا میں گھر پر پڑھاتی ہوں۔',
    qualifications: 'MA Urdu, University of Karachi',
    experienceYears: 14,
    teachesAtHome: true,
    teachesOnline: false,
    teachesAtOwnPlace: true,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: {
      decision: 'approved',
      artefacts: ['cnic', 'degree'],
      reason: 'CNIC and MA Urdu certificate checked.',
      daysAgo: 400,
    },
    claims: [{ subjectId: 'urdu', levelId: 'matric', boardId: 'sindh-board', topicIds: [], status: 'verified', expiresInDays: 90 }],
    rates: [
      { rateType: 'monthly', amount: 1_200_000, mode: 'home', sessionsPerWeek: 3, minutesPerSession: 60 },
      { rateType: 'monthly', amount: 900_000, mode: 'own_place', sessionsPerWeek: 3, minutesPerSession: 60 },
    ],
    safety: { femaleStudentsOnly: true },
  },
  {
    slug: 'rabia-khan',
    displayName: 'Rabia Khan',
    gender: 'female',
    cityId: 'karachi',
    areas: ['karachi-pechs', 'karachi-shah-faisal-colony'],
    bio: 'Volunteer tutor. I teach Mathematics and Science to Matric students whose families cannot pay for tuition. Eight hours a week is what I can genuinely commit to, so that is what I have declared.',
    qualifications: 'BSc Mathematics, University of Karachi',
    experienceYears: 5,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    // A volunteer is verified on exactly the same basis as a paid tutor
    // (FR-33.10). The flag is never a substitute for verification.
    volunteer: { weeklyHours: 8 },
    identity: {
      decision: 'approved',
      artefacts: ['cnic', 'degree'],
      reason: 'CNIC and BSc degree checked. Volunteer status does not alter the verification standard (FR-33.10).',
      daysAgo: 60,
    },
    claims: [{ subjectId: 'mathematics', levelId: 'matric', boardId: 'sindh-board', topicIds: [MATRIC_MATH], status: 'verified', expiresInDays: 305 }],
    rates: [],
    safety: { femaleStudentsOnly: true, guardianPresenceRequired: true },
  },
  {
    slug: 'nadia-hussain',
    displayName: 'Nadia Hussain',
    gender: 'female',
    cityId: 'karachi',
    areas: ['karachi-malir', 'karachi-korangi', 'karachi-shah-faisal-colony'],
    bio: 'Primary and Middle, all subjects. I work in Malir, Korangi and Shah Faisal Colony — areas most tutors will not travel to, which is exactly why I do.',
    qualifications: 'BEd, Sindh Teachers Training College',
    experienceYears: 12,
    teachesAtHome: true,
    teachesOnline: false,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: {
      decision: 'approved',
      artefacts: ['cnic', 'degree'],
      reason: 'CNIC and BEd certificate checked.',
      daysAgo: 210,
    },
    claims: [{ subjectId: 'mathematics', levelId: 'primary', boardId: 'sindh-board', topicIds: [], status: 'asserted' }],
    rates: [
      { rateType: 'monthly', amount: 800_000, mode: 'home', sessionsPerWeek: 5, minutesPerSession: 60, negotiable: true },
    ],
    safety: { guardianPresenceRequired: true },
  },
];

/* -------------------------------------------------------------------------
 * The rest of Karachi, and three more cities
 * ---------------------------------------------------------------------- */

const OTHERS: DemoTutorSpec[] = [
  {
    slug: 'imran-shah',
    displayName: 'Imran Shah',
    gender: 'male',
    cityId: 'karachi',
    areas: ['karachi-gulshan-e-iqbal', 'karachi-gulistan-e-johar'],
    bio: 'Mathematics and Physics, Intermediate and A Level. Fifteen years, mostly with students who are retaking.',
    qualifications: 'MPhil Physics, University of Karachi',
    experienceYears: 15,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: true,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree', 'transcript'], reason: 'CNIC, MPhil certificate and transcript checked.', daysAgo: 330 },
    claims: [
      { subjectId: 'physics', levelId: 'intermediate', boardId: 'sindh-board', topicIds: [], status: 'verified', expiresInDays: 180 },
      { subjectId: 'mathematics', levelId: 'a-level', boardId: 'cambridge', topicIds: [], status: 'verified', expiresInDays: 15 },
    ],
    rates: [
      { rateType: 'monthly', amount: 2_800_000, mode: 'home', sessionsPerWeek: 3, minutesPerSession: 120 },
      // An intensive four-sessions-a-week arrangement, priced monthly. Not a
      // group rate — `group_monthly` requires a per-head amount, which is what
      // makes a group rate comparable at all (`shared/rates.ts`).
      { rateType: 'monthly', amount: 6_000_000, mode: 'own_place', sessionsPerWeek: 4, minutesPerSession: 120 },
      { rateType: 'monthly', amount: 3_600_000, mode: 'own_place', groupSizeMax: 6, perHeadAmount: 800_000, sessionsPerWeek: 3, minutesPerSession: 120 },
    ],
  },
  {
    slug: 'bilal-ahmed',
    displayName: 'Bilal Ahmed',
    gender: 'male',
    cityId: 'karachi',
    areas: ['karachi-dha', 'karachi-clifton'],
    bio: 'Chemistry, O and A Level. I teach at my own place in DHA and online.',
    qualifications: 'BS Chemistry, Habib University',
    experienceYears: 3,
    teachesAtHome: false,
    teachesOnline: true,
    teachesAtOwnPlace: true,
    // Submitted, awaiting a decision — this is what fills the admin queue.
    profileStatus: 'pending_verification',
    claims: [{ subjectId: 'chemistry', levelId: 'o-level', boardId: 'cambridge', topicIds: [], status: 'asserted' }],
    rates: [{ rateType: 'hourly', amount: 280_000, mode: 'own_place', minutesPerSession: 60 }],
  },
  {
    slug: 'usman-farooq',
    displayName: 'Usman Farooq',
    gender: 'male',
    cityId: 'karachi',
    areas: ['karachi-nazimabad'],
    bio: 'Computer Science and Mathematics.',
    qualifications: 'BS Software Engineering',
    experienceYears: 2,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    // Documents uploaded but not yet opened — the second FR-14.3 queue.
    profileStatus: 'documents_submitted',
    claims: [{ subjectId: 'computer-science', levelId: 'intermediate', boardId: 'sindh-board', topicIds: [], status: 'asserted' }],
    rates: [{ rateType: 'monthly', amount: 1_500_000, mode: 'online', sessionsPerWeek: 2, minutesPerSession: 90 }],
  },
  {
    slug: 'kamran-baig',
    displayName: 'Kamran Baig',
    gender: 'male',
    cityId: 'karachi',
    areas: ['karachi-saddar'],
    bio: 'Mathematics, Matric.',
    qualifications: 'BA',
    experienceYears: 1,
    teachesAtHome: true,
    teachesOnline: false,
    teachesAtOwnPlace: false,
    profileStatus: 'rejected',
    // Rejected, and appealing — SEC-18 and FR-28.6 in the demonstration data.
    identity: {
      decision: 'rejected',
      artefacts: ['cnic'],
      reason: 'The submitted degree certificate could not be matched to the awarding institution. CNIC was checked and is valid.',
      daysAgo: 30,
      appeals: {
        reason: 'The certificate is from a campus that changed its name in 2019. I have attached the notification and my transcript, which carries the old name.',
        outcome: 'open',
      },
    },
    claims: [{ subjectId: 'mathematics', levelId: 'matric', boardId: 'sindh-board', topicIds: [MATRIC_MATH], status: 'asserted' }],
    rates: [{ rateType: 'monthly', amount: 700_000, mode: 'home', sessionsPerWeek: 3, minutesPerSession: 60 }],
  },
  {
    slug: 'shazia-malik',
    displayName: 'Shazia Malik',
    gender: 'female',
    cityId: 'karachi',
    areas: ['karachi-gulistan-e-johar'],
    bio: 'Biology and Chemistry, Matric. My competency badge has lapsed and I am re-sitting the assessment.',
    qualifications: 'MSc Zoology, University of Karachi',
    experienceYears: 8,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC and MSc certificate checked.', daysAgo: 500 },
    // An expired competency badge leaves the tutor searchable and unbadged,
    // which is exactly what §6.28 describes (FR-28.1).
    claims: [{ subjectId: 'biology', levelId: 'matric', boardId: 'sindh-board', topicIds: [], status: 'expired', expiresInDays: -20 }],
    rates: [{ rateType: 'monthly', amount: 1_500_000, mode: 'home', sessionsPerWeek: 3, minutesPerSession: 90 }],
    safety: { femaleStudentsOnly: true },
  },
  {
    slug: 'amina-qureshi',
    displayName: 'Amina Qureshi',
    gender: 'female',
    cityId: 'lahore',
    areas: ['lahore-gulberg', 'lahore-model-town', 'lahore-garden-town'],
    bio: 'Mathematics and Physics for Punjab Board Matric and Intermediate. Home tuition across Gulberg and Model Town.',
    qualifications: 'MSc Mathematics, Punjab University',
    experienceYears: 10,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC and MSc certificate checked.', daysAgo: 260 },
    claims: [{ subjectId: 'mathematics', levelId: 'matric', boardId: 'punjab-board', topicIds: [], status: 'verified', expiresInDays: 210 }],
    rates: [
      { rateType: 'monthly', amount: 1_700_000, mode: 'home', sessionsPerWeek: 3, minutesPerSession: 90 },
      { rateType: 'monthly', amount: 2_100_000, mode: 'home', groupSizeMax: 3, perHeadAmount: 750_000, sessionsPerWeek: 3, minutesPerSession: 90 },
    ],
    safety: { femaleStudentsOnly: true, guardianPresenceRequired: true },
  },
  {
    slug: 'hassan-raza',
    displayName: 'Hassan Raza',
    gender: 'male',
    cityId: 'lahore',
    areas: ['lahore-johar-town', 'lahore-faisal-town'],
    bio: 'Chemistry, Intermediate and A Level. Fourteen years.',
    qualifications: 'MPhil Chemistry, GC University Lahore',
    experienceYears: 14,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: true,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree', 'transcript'], reason: 'CNIC, MPhil certificate and transcript checked.', daysAgo: 190 },
    claims: [{ subjectId: 'chemistry', levelId: 'intermediate', boardId: 'punjab-board', topicIds: [], status: 'verified', expiresInDays: 100 }],
    rates: [
      { rateType: 'monthly', amount: 2_500_000, mode: 'home', sessionsPerWeek: 3, minutesPerSession: 120, travelCharge: 200_000 },
      { rateType: 'hourly', amount: 320_000, mode: 'online', minutesPerSession: 60, negotiable: true },
    ],
  },
  {
    slug: 'sadia-anwar',
    displayName: 'Sadia Anwar',
    gender: 'female',
    cityId: 'lahore',
    areas: ['lahore-dha', 'lahore-cantt'],
    bio: 'English and Urdu, O Level and Matric. Main DHA aur Cantt mein parhati hoon.',
    qualifications: 'MA English, Kinnaird College',
    experienceYears: 6,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC and MA certificate checked.', daysAgo: 140 },
    claims: [{ subjectId: 'english', levelId: 'o-level', boardId: 'cambridge', topicIds: [], status: 'verified', expiresInDays: 260 }],
    rates: [{ rateType: 'hourly', amount: 260_000, mode: 'home', minutesPerSession: 60 }],
    safety: { femaleStudentsOnly: true },
  },
  {
    slug: 'tahir-mehmood',
    displayName: 'Tahir Mehmood',
    gender: 'male',
    cityId: 'lahore',
    areas: ['lahore-township', 'lahore-allama-iqbal-town'],
    bio: 'Volunteer. Mathematics and Urdu for Matric students in Township and Allama Iqbal Town.',
    qualifications: 'BSc, Punjab University',
    experienceYears: 7,
    teachesAtHome: true,
    teachesOnline: false,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    volunteer: { weeklyHours: 6 },
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC and BSc degree checked. Same standard as a paid tutor (FR-33.10).', daysAgo: 45 },
    claims: [{ subjectId: 'mathematics', levelId: 'matric', boardId: 'punjab-board', topicIds: [], status: 'asserted' }],
    rates: [],
  },
  {
    slug: 'nida-aslam',
    displayName: 'Nida Aslam',
    gender: 'female',
    cityId: 'lahore',
    areas: ['lahore-shadman'],
    bio: 'Biology, Matric and Intermediate.',
    qualifications: 'MSc Botany',
    experienceYears: 4,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: 'under_review',
    claims: [{ subjectId: 'biology', levelId: 'matric', boardId: 'punjab-board', topicIds: [], status: 'asserted' }],
    rates: [{ rateType: 'monthly', amount: 1_300_000, mode: 'home', sessionsPerWeek: 3, minutesPerSession: 90 }],
  },
  {
    slug: 'faisal-nadeem',
    displayName: 'Faisal Nadeem',
    gender: 'male',
    cityId: 'lahore',
    areas: ['lahore-bahria-town'],
    bio: 'Computer Science and Mathematics, A Level.',
    qualifications: 'BS Computer Science, LUMS',
    experienceYears: 5,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC and BS degree checked.', daysAgo: 80 },
    claims: [{ subjectId: 'computer-science', levelId: 'a-level', boardId: 'cambridge', topicIds: [], status: 'verified', expiresInDays: 285 }],
    rates: [
      { rateType: 'hourly', amount: 400_000, mode: 'online', minutesPerSession: 60 },
      { rateType: 'monthly', amount: 3_200_000, mode: 'home', sessionsPerWeek: 2, minutesPerSession: 120, negotiable: true },
    ],
  },
  {
    slug: 'saira-bashir',
    displayName: 'Saira Bashir',
    gender: 'female',
    cityId: 'islamabad',
    areas: ['islamabad-f-10', 'islamabad-f-11', 'islamabad-e-11'],
    bio: 'Mathematics and Physics, Federal Board Matric and Intermediate. Home tuition in F and E sectors.',
    qualifications: 'MSc Physics, Quaid-i-Azam University',
    experienceYears: 9,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC and MSc certificate checked.', daysAgo: 220 },
    claims: [
      { subjectId: 'physics', levelId: 'intermediate', boardId: 'federal-board', topicIds: [], status: 'verified', expiresInDays: 175 },
      { subjectId: 'mathematics', levelId: 'matric', boardId: 'federal-board', topicIds: [], status: 'verified', expiresInDays: 28 },
    ],
    rates: [
      { rateType: 'monthly', amount: 2_600_000, mode: 'home', sessionsPerWeek: 3, minutesPerSession: 120, travelCharge: 150_000 },
      { rateType: 'monthly', amount: 2_000_000, mode: 'online', sessionsPerWeek: 3, minutesPerSession: 120 },
    ],
    safety: { femaleStudentsOnly: true, guardianPresenceRequired: true },
  },
  {
    slug: 'adnan-yousaf',
    displayName: 'Adnan Yousaf',
    gender: 'male',
    cityId: 'islamabad',
    areas: ['islamabad-g-9', 'islamabad-g-10', 'islamabad-i-8'],
    bio: 'Chemistry and Biology, Federal Board. Twelve years.',
    qualifications: 'MSc Chemistry, Quaid-i-Azam University',
    experienceYears: 12,
    teachesAtHome: true,
    teachesOnline: false,
    teachesAtOwnPlace: true,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC and MSc certificate checked.', daysAgo: 310 },
    claims: [{ subjectId: 'chemistry', levelId: 'matric', boardId: 'federal-board', topicIds: [], status: 'verified', expiresInDays: 130 }],
    rates: [
      { rateType: 'monthly', amount: 2_200_000, mode: 'home', sessionsPerWeek: 3, minutesPerSession: 90 },
      { rateType: 'monthly', amount: 2_700_000, mode: 'own_place', groupSizeMax: 5, perHeadAmount: 650_000, sessionsPerWeek: 3, minutesPerSession: 90 },
    ],
  },
  {
    slug: 'komal-shahid',
    displayName: 'Komal Shahid',
    gender: 'female',
    cityId: 'islamabad',
    areas: ['islamabad-f-6', 'islamabad-f-7', 'islamabad-f-8'],
    bio: 'English literature and language, A Level and IB.',
    qualifications: 'MA English, NUML',
    experienceYears: 8,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC and MA certificate checked.', daysAgo: 160 },
    claims: [{ subjectId: 'english', levelId: 'a-level', boardId: 'ib', topicIds: [], status: 'verified', expiresInDays: 240 }],
    rates: [{ rateType: 'hourly', amount: 450_000, mode: 'home', minutesPerSession: 60, travelCharge: 200_000 }],
    safety: { femaleStudentsOnly: true },
  },
  {
    slug: 'waqar-abbasi',
    displayName: 'Waqar Abbasi',
    gender: 'male',
    cityId: 'islamabad',
    areas: ['islamabad-g-11', 'islamabad-g-6'],
    bio: 'Mathematics, Matric.',
    qualifications: 'BSc Mathematics',
    experienceYears: 3,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: 'more_info_needed',
    identity: {
      decision: 'more_info_needed',
      artefacts: ['cnic'],
      reason: 'CNIC checked and valid. The degree certificate image is too low in resolution to read the awarding body. Please re-upload at a higher resolution.',
      daysAgo: 12,
    },
    claims: [{ subjectId: 'mathematics', levelId: 'matric', boardId: 'federal-board', topicIds: [], status: 'asserted' }],
    rates: [{ rateType: 'monthly', amount: 1_100_000, mode: 'home', sessionsPerWeek: 3, minutesPerSession: 60 }],
  },
  {
    slug: 'rukhsana-parveen',
    displayName: 'Rukhsana Parveen',
    gender: 'female',
    cityId: 'rawalpindi',
    areas: ['rawalpindi-satellite-town', 'rawalpindi-chaklala'],
    bio: 'Urdu, Islamiat and Primary all-subject tuition. Twenty years in Satellite Town.',
    qualifications: 'MA Urdu, Punjab University; BEd',
    experienceYears: 20,
    teachesAtHome: true,
    teachesOnline: false,
    teachesAtOwnPlace: true,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC, MA Urdu and BEd certificates checked.', daysAgo: 420 },
    claims: [{ subjectId: 'urdu', levelId: 'matric', boardId: 'punjab-board', topicIds: [], status: 'verified', expiresInDays: 70 }],
    rates: [
      { rateType: 'monthly', amount: 1_000_000, mode: 'home', sessionsPerWeek: 4, minutesPerSession: 60, negotiable: true },
      { rateType: 'monthly', amount: 750_000, mode: 'own_place', sessionsPerWeek: 4, minutesPerSession: 60 },
    ],
    safety: { femaleStudentsOnly: true },
  },
  {
    slug: 'shoaib-akhtar-tutor',
    displayName: 'Shoaib Akhtar',
    gender: 'male',
    cityId: 'rawalpindi',
    areas: ['rawalpindi-satellite-town'],
    bio: 'Physics and Mathematics, Intermediate.',
    qualifications: 'MSc Physics',
    experienceYears: 6,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC and MSc certificate checked.', daysAgo: 100 },
    claims: [{ subjectId: 'physics', levelId: 'intermediate', boardId: 'punjab-board', topicIds: [], status: 'verified', expiresInDays: 265 }],
    rates: [{ rateType: 'monthly', amount: 1_900_000, mode: 'home', sessionsPerWeek: 3, minutesPerSession: 90 }],
  },
  {
    slug: 'iqra-mahmood',
    displayName: 'Iqra Mahmood',
    gender: 'female',
    cityId: 'faisalabad',
    areas: ['faisalabad-madina-town', 'faisalabad-peoples-colony'],
    bio: 'Mathematics and Chemistry, Matric. Home tuition in Madina Town and Peoples Colony.',
    qualifications: 'MSc Chemistry, GC University Faisalabad',
    experienceYears: 7,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC and MSc certificate checked.', daysAgo: 150 },
    claims: [{ subjectId: 'chemistry', levelId: 'matric', boardId: 'punjab-board', topicIds: [], status: 'verified', expiresInDays: 195 }],
    rates: [{ rateType: 'monthly', amount: 1_200_000, mode: 'home', sessionsPerWeek: 3, minutesPerSession: 90, negotiable: true }],
    safety: { femaleStudentsOnly: true, guardianPresenceRequired: true },
  },
  {
    slug: 'zeeshan-haider',
    displayName: 'Zeeshan Haider',
    gender: 'male',
    cityId: 'faisalabad',
    areas: ['faisalabad-d-ground', 'faisalabad-civil-lines'],
    bio: 'Computer Science and Mathematics, Intermediate.',
    qualifications: 'BS Computer Science, GCUF',
    experienceYears: 4,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC and BS degree checked.', daysAgo: 70 },
    claims: [{ subjectId: 'computer-science', levelId: 'intermediate', boardId: 'punjab-board', topicIds: [], status: 'verified', expiresInDays: 295 }],
    rates: [
      { rateType: 'monthly', amount: 1_400_000, mode: 'online', sessionsPerWeek: 2, minutesPerSession: 90 },
      { rateType: 'single_session', amount: 250_000, mode: 'home', minutesPerSession: 90 },
    ],
  },
  {
    slug: 'yasmin-akhtar',
    displayName: 'Yasmin Akhtar',
    gender: 'female',
    cityId: 'faisalabad',
    areas: ['faisalabad-susan-road', 'faisalabad-gulberg'],
    bio: 'Biology and English, Matric and Intermediate.',
    qualifications: 'MSc Botany, University of Agriculture Faisalabad',
    experienceYears: 11,
    teachesAtHome: true,
    teachesOnline: false,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC and MSc certificate checked.', daysAgo: 275 },
    claims: [{ subjectId: 'biology', levelId: 'intermediate', boardId: 'punjab-board', topicIds: [], status: 'verified', expiresInDays: 55 }],
    rates: [{ rateType: 'monthly', amount: 1_300_000, mode: 'home', sessionsPerWeek: 3, minutesPerSession: 90 }],
    safety: { femaleStudentsOnly: true },
  },
  {
    slug: 'arif-mehboob',
    displayName: 'Arif Mehboob',
    gender: 'male',
    cityId: 'hyderabad',
    areas: ['hyderabad-latifabad', 'hyderabad-hirabad'],
    bio: 'Mathematics and Physics, Sindh Board Matric.',
    qualifications: 'MSc Mathematics, University of Sindh',
    experienceYears: 13,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: true,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC and MSc certificate checked.', daysAgo: 350 },
    claims: [{ subjectId: 'mathematics', levelId: 'matric', boardId: 'sindh-board', topicIds: [MATRIC_MATH], status: 'verified', expiresInDays: 145 }],
    rates: [
      { rateType: 'monthly', amount: 900_000, mode: 'home', sessionsPerWeek: 3, minutesPerSession: 90 },
      { rateType: 'monthly', amount: 1_200_000, mode: 'own_place', groupSizeMax: 8, perHeadAmount: 400_000, sessionsPerWeek: 3, minutesPerSession: 90 },
    ],
  },
  {
    slug: 'benazir-solangi',
    displayName: 'Benazir Solangi',
    gender: 'female',
    cityId: 'hyderabad',
    areas: ['hyderabad-latifabad', 'hyderabad-citizen-colony'],
    bio: 'Sindhi, Urdu and Primary tuition. Volunteer for two students a week alongside paid work.',
    qualifications: 'BEd, University of Sindh',
    experienceYears: 9,
    teachesAtHome: true,
    teachesOnline: false,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    volunteer: { weeklyHours: 4 },
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC and BEd certificate checked.', daysAgo: 55 },
    claims: [{ subjectId: 'urdu', levelId: 'primary', boardId: 'sindh-board', topicIds: [], status: 'asserted' }],
    rates: [{ rateType: 'monthly', amount: 600_000, mode: 'home', sessionsPerWeek: 4, minutesPerSession: 60, negotiable: true }],
    safety: { femaleStudentsOnly: true, guardianPresenceRequired: true },
  },
  {
    slug: 'daniyal-memon',
    displayName: 'Daniyal Memon',
    gender: 'male',
    cityId: 'hyderabad',
    areas: ['hyderabad-cantonment'],
    bio: 'English, Matric and Intermediate.',
    qualifications: 'MA English',
    experienceYears: 5,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: 'draft',
    claims: [],
    rates: [],
  },
];

/**
 * Four more Matric Mathematics home tutors in Clifton and DHA.
 *
 * They exist for two reasons that turn out to be the same reason.
 *
 * **Rate benchmarking needs a market.** `rate_benchmarks` suppresses any cohort
 * below four (SEC-17, NFR-16), and a benchmark cell is
 * `subject | level | area | mode`. Without four tutors offering Matric
 * Mathematics at home in one area, the benchmark board is empty everywhere —
 * not because the job is broken but because the control is working. Seeding
 * three tutors and calling the empty board a bug would be the wrong lesson.
 *
 * **And the primary use case should look like a market.** A family in Clifton
 * searching for a female Matric Maths tutor who will come to the house should
 * get a list with a spread of rates in it, because that is what the rate
 * benchmark and the comparison tray are for.
 *
 * Their rates carry an explicit `subjectId` and `levelId`. A blanket rate with
 * neither belongs to no cell at all — see `computeBenchmarks`.
 */
const KARACHI_MATHS_MARKET: DemoTutorSpec[] = [
  {
    slug: 'humaira-siddiq',
    displayName: 'Humaira Siddiq',
    gender: 'female',
    cityId: 'karachi',
    areas: ['karachi-clifton', 'karachi-dha'],
    bio: 'Matric Mathematics, Sindh Board. I take four students at a time so that each one gets marked work back the same week.',
    qualifications: 'MSc Mathematics, University of Karachi',
    experienceYears: 8,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC and MSc certificate checked.', daysAgo: 170 },
    claims: [{ subjectId: 'mathematics', levelId: 'matric', boardId: 'sindh-board', topicIds: [MATRIC_MATH], status: 'verified', expiresInDays: 190 }],
    rates: [
      { rateType: 'monthly', amount: 2_100_000, mode: 'home', subjectId: 'mathematics', levelId: 'matric', sessionsPerWeek: 3, minutesPerSession: 90 },
    ],
    safety: { femaleStudentsOnly: true, guardianPresenceRequired: true },
  },
  {
    slug: 'anum-shaikh',
    displayName: 'Anum Shaikh',
    gender: 'female',
    cityId: 'karachi',
    areas: ['karachi-clifton', 'karachi-pechs'],
    bio: 'Mathematics for Matric and Intermediate. I charge less than most tutors in Clifton because I live here and there is no travel for me.',
    qualifications: 'BS Mathematics, Institute of Business Administration',
    experienceYears: 5,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC and BS Mathematics degree checked.', daysAgo: 130 },
    claims: [{ subjectId: 'mathematics', levelId: 'matric', boardId: 'sindh-board', topicIds: [MATRIC_MATH], status: 'verified', expiresInDays: 230 }],
    rates: [
      { rateType: 'monthly', amount: 1_300_000, mode: 'home', subjectId: 'mathematics', levelId: 'matric', sessionsPerWeek: 3, minutesPerSession: 90, negotiable: true },
    ],
    safety: { femaleStudentsOnly: true },
  },
  {
    slug: 'tehmina-arshad',
    displayName: 'Tehmina Arshad',
    gender: 'female',
    cityId: 'karachi',
    areas: ['karachi-clifton', 'karachi-dha', 'karachi-saddar'],
    bio: 'Sixteen years teaching Matric Mathematics. I am at the upper end of the Clifton range and I am open about why: I mark every piece of work and I do not take on a student in the last two months before boards.',
    qualifications: 'MPhil Mathematics, University of Karachi',
    experienceYears: 16,
    teachesAtHome: true,
    teachesOnline: false,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree', 'transcript'], reason: 'CNIC, MPhil certificate and transcript checked.', daysAgo: 380 },
    claims: [{ subjectId: 'mathematics', levelId: 'matric', boardId: 'sindh-board', topicIds: [MATRIC_MATH], status: 'verified', expiresInDays: 45 }],
    rates: [
      { rateType: 'monthly', amount: 3_000_000, mode: 'home', subjectId: 'mathematics', levelId: 'matric', sessionsPerWeek: 3, minutesPerSession: 120 },
    ],
    safety: { femaleStudentsOnly: true, guardianPresenceRequired: true },
  },
  {
    slug: 'kiran-abbas',
    displayName: 'Kiran Abbas',
    gender: 'female',
    cityId: 'karachi',
    areas: ['karachi-clifton', 'karachi-dha'],
    bio: 'Matric Mathematics and Physics. Evenings only.',
    qualifications: 'BSc Mathematics, University of Karachi',
    experienceYears: 6,
    teachesAtHome: true,
    teachesOnline: true,
    teachesAtOwnPlace: false,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    identity: { decision: 'approved', artefacts: ['cnic', 'degree'], reason: 'CNIC and BSc degree checked.', daysAgo: 110 },
    claims: [{ subjectId: 'mathematics', levelId: 'matric', boardId: 'sindh-board', topicIds: [MATRIC_MATH], status: 'verified', expiresInDays: 250 }],
    rates: [
      { rateType: 'monthly', amount: 1_900_000, mode: 'home', subjectId: 'mathematics', levelId: 'matric', sessionsPerWeek: 3, minutesPerSession: 90 },
    ],
    safety: { femaleStudentsOnly: true },
  },
];

/**
 * 35 tutors across five cities. FR-15.8 asks for at least 25 across at least
 * four.
 */
export const DEMO_TUTORS: DemoTutorSpec[] = [
  ...KARACHI_FEMALE_HOME,
  ...KARACHI_MATHS_MARKET,
  ...OTHERS,
];

/* -------------------------------------------------------------------------
 * Families — FR-15.9's guest accounts and the owners of every booking
 * ---------------------------------------------------------------------- */

export interface DemoStudentSpec {
  key: string;
  name: string;
  /** `YYYY-MM-DD`. Under 18 means a parent-owned profile and no account (SEC-1). */
  dateOfBirth: string;
  levelId: string;
  boardId: string;
  school?: string;
}

export interface DemoParentSpec {
  key: string;
  email: string;
  displayName: string;
  cityId: string;
  areaId: string;
  students: DemoStudentSpec[];
}

/**
 * Every student below is a **minor**, held as a `student_profiles` row owned by
 * a parent account. There is no `users` row for any of them, no credential, and
 * no path that would create one (SEC-1, §2.3). The one adult learner in the
 * cohort is `DEMO_ADULT_STUDENT`, who has an account precisely because they are
 * over eighteen.
 */
export const DEMO_PARENTS: DemoParentSpec[] = [
  {
    key: 'parent-karachi',
    email: 'parent@demo.ustaad.test',
    displayName: 'IQRA SHAHID',
    cityId: 'karachi',
    areaId: 'karachi-clifton',
    students: [
      { key: 'zara', name: 'Zara Khalid', dateOfBirth: '2010-03-14', levelId: 'matric', boardId: 'sindh-board', school: 'Beaconhouse Clifton' },
      { key: 'omar', name: 'Omar Khalid', dateOfBirth: '2013-09-02', levelId: 'middle', boardId: 'sindh-board', school: 'Beaconhouse Clifton' },
    ],
  },
  {
    key: 'parent-karachi-2',
    email: 'parent2@demo.ustaad.test',
    displayName: 'Nasreen Iqbal',
    cityId: 'karachi',
    areaId: 'karachi-gulshan-e-iqbal',
    students: [
      { key: 'hamza', name: 'Hamza Iqbal', dateOfBirth: '2009-11-21', levelId: 'intermediate', boardId: 'sindh-board', school: 'Adamjee Government Science College' },
    ],
  },
  {
    key: 'parent-karachi-3',
    email: 'parent3@demo.ustaad.test',
    displayName: 'Rukhsar Bano',
    cityId: 'karachi',
    areaId: 'karachi-dha',
    students: [
      { key: 'ali', name: 'Ali Raza', dateOfBirth: '2011-06-30', levelId: 'matric', boardId: 'sindh-board' },
    ],
  },
  {
    key: 'parent-lahore',
    email: 'parent-lahore@demo.ustaad.test',
    displayName: 'Shahid Mahmood',
    cityId: 'lahore',
    areaId: 'lahore-gulberg',
    students: [
      { key: 'ayesha-m', name: 'Ayesha Mahmood', dateOfBirth: '2010-01-08', levelId: 'matric', boardId: 'punjab-board' },
    ],
  },
  {
    key: 'parent-islamabad',
    email: 'parent-isb@demo.ustaad.test',
    displayName: 'Farhan Sheikh',
    cityId: 'islamabad',
    areaId: 'islamabad-f-10',
    students: [
      { key: 'bilal-s', name: 'Bilal Sheikh', dateOfBirth: '2008-04-19', levelId: 'intermediate', boardId: 'federal-board' },
      { key: 'maha-s', name: 'Maha Sheikh', dateOfBirth: '2012-12-01', levelId: 'middle', boardId: 'federal-board' },
    ],
  },
];

/**
 * The one learner who holds an account, because they are eighteen or over.
 *
 * Registering as `student` requires a date of birth and is checked in the schema
 * and again in the service against an injected clock (§2.3). This row exists so
 * a demonstration can show the adult-student path without anyone concluding
 * that minors have accounts.
 */
export const DEMO_ADULT_STUDENT = {
  email: 'student@demo.ustaad.test',
  displayName: 'Hira Yousuf',
  dateOfBirth: '2005-02-11',
  cityId: 'karachi',
  areaId: 'karachi-pechs',
  levelId: 'undergraduate',
  boardId: 'university',
};

export const DEMO_ADMIN = {
  email: 'admin@demo.ustaad.test',
  displayName: 'Platform Administrator',
};

export const DEMO_ORGANISATION = {
  email: 'academy@demo.ustaad.test',
  displayName: 'Al-Noor Academy',
  orgName: 'Al-Noor Academy',
  orgType: 'academy' as const,
  cityId: 'karachi',
  areaId: 'karachi-gulshan-e-iqbal',
  contactEmail: 'desk@alnoor.demo.test',
  contactPhone: '02134567890',
  description:
    'A tuition centre in Gulshan-e-Iqbal running Matric and Intermediate batches. We hire home tutors for students who cannot travel to us.',
};

/**
 * One password for every demonstration account, published in the README
 * (FR-15.9).
 *
 * This is safe only because every one of these accounts is synthetic and the
 * database they live in is a local SQLite file that never enters the repository
 * (§2.2). It must never be used for a real account, and the demo seed refuses
 * to run against a configured Supabase database.
 */
export const DEMO_PASSWORD = 'demo-ustaad-2026';
