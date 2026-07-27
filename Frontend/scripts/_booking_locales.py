# -*- coding: utf-8 -*-
"""Locale keys for the booking and payment surfaces (§6.8, §6.20, §6.30, §6.31)."""
import io, json, os

base = os.path.join(os.path.dirname(__file__), '..')

def rj(p):
    return json.load(io.open(os.path.join(base, p), encoding='utf-8'))

def wj(p, d):
    with io.open(os.path.join(base, p), 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write('\n')

def deep_update(target, extra):
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            deep_update(target[key], value)
        else:
            target[key] = value

# ---------------------------------------------------------------- common
COMMON = {
    'en': {
        'mode': {'home': 'At your home', 'online': 'Online', 'own_place': "At the tutor's place"},
        'nav': {'tutorBookings': 'Bookings'},
    },
    'ur': {
        'mode': {'home': 'آپ کے گھر', 'online': 'آن لائن', 'own_place': 'استاد کی جگہ'},
        'nav': {'tutorBookings': 'بکنگز'},
    },
}

# ---------------------------------------------------------------- booking
BOOKING_EN = {
    'list': {
        'familyTitle': 'My bookings',
        'tutorTitle': 'Bookings',
        'open': 'Needs attention',
        'awaiting': 'Waiting for your answer',
        'live': 'Confirmed and running',
        'past': 'Finished',
        'tutor': 'Tutor',
        'student': 'Student',
        'emptyTitle': 'No bookings yet',
        'emptyBody': 'When you request a tutor, the engagement appears here with its state and what happens next.',
        'findTutor': 'Find a tutor',
        'tutorEmptyTitle': 'No requests yet',
        'tutorEmptyBody': 'Requests from families appear here. Answering quickly matters — a family that waits books somebody else.',
    },
    'card': {
        'untitled': 'Booking',
        'trial': 'Trial',
    },
    'request': {
        'title': 'Request a booking',
        'engagementLegend': 'What kind of arrangement',
        'studentLabel': 'Who is this for',
        'studentHint': 'Add your child here. Children do not have accounts on Ustaad.com — you hold the account and arrange everything through it.',
        'studentPlaceholder': 'Choose a student',
        'claimLabel': 'Subject, level and board',
        'modeLabel': 'Where the sessions happen',
        'modeAny': 'Any of the ways she teaches',
        'addressLabel': 'Where you are',
        'addressHint': 'House and street. Read what the tutor will and will not see, below.',
        'agreedHeading': 'What you are agreeing to',
        'travelCharge': 'Travel: {{amount}}, recorded separately',
        'submit': 'Send request',
        'sent': 'Request sent',
        'slotTaken': 'That time was booked by somebody else while you were filling this in. The times below have been refreshed — please choose another.',
    },
    'slots': {
        'legend': 'Choose a time',
        'chosen': 'Chosen: {{day}}, {{start}} to {{end}}',
        'onlyFreeNote': 'Only times the tutor is actually free are shown. A time already booked does not appear here at all, so nothing you can choose can be refused for being taken.',
        'emptyTitle': 'No free times in the next two weeks',
        'emptyBody': 'She may have no availability set, or everything may be booked. You can still ask on the unmet demand board.',
    },
    'single': {
        'heading': 'What this hour is for',
        'whyRequired': 'Both of these are required. They are what lets the tutor arrive prepared — it is the difference between a useful hour and an hour spent working out why you came.',
        'purposeLabel': 'Why this session',
        'purpose': {
            'concept_clarification': 'A concept that is not going in',
            'assessment_review': 'Going over a test or assignment',
            'doubt_solving': 'Specific questions to work through',
            'exam_revision': 'Revision before an exam',
        },
        'topicsLabel': 'Which topics',
        'topicsHint': 'Choose at least one. The tutor prepares from this.',
        'noTopics': 'This tutor has not listed topics for the chosen subject yet.',
    },
    'monthly': {
        'sessionsPerWeekLabel': 'Sessions each week',
        'cycleWeeksLabel': 'Weeks in this cycle',
        'cycleWeeksHint': 'Usually four. A payment record is raised per cycle.',
    },
    'package': {
        'sessionsLabel': 'How many sessions in total',
        'sessionsHint': 'Between 2 and 40, agreed in advance.',
    },
    'disclosure': {
        'heading': 'Who sees the address',
        'family': {
            'beforeConfirm': 'Before she confirms, the tutor sees only your area — not your street or house number.',
            'afterConfirm': 'After she confirms, she sees the full address, because she has to get there.',
            'nowVisible': 'She has confirmed, so she can now see the full address.',
        },
        'tutor': {
            'beforeConfirm': 'Until you confirm, you see the area only. That is enough to decide whether you are willing to travel there.',
            'afterConfirm': 'Once you confirm, you see the full address.',
            'nowVisible': 'You have confirmed, so the full address is available to you.',
        },
        'nobodyElse': 'Nobody else ever sees it. It is not on any public profile and not in any search result.',
    },
    'safety': {
        'heading': 'Conditions this tutor has set',
        'guardianRequired': 'She teaches only with a parent or guardian present in the home.',
        'femaleStudentsOnly': 'She teaches female students only.',
        'enforcedNote': 'Ustaad.com enforces these — a request that does not meet them is refused rather than passed on. Declines she makes under her own conditions do not count against her statistics.',
        'acknowledgeLabel': 'A parent or guardian will be present for every session',
        'acknowledgeHint': 'The request cannot be sent without this.',
        'refused': 'This tutor requires a guardian present. Tick the box above to continue, or choose a tutor who does not set this condition.',
    },
    'trial': {
        'flagLabel': 'Make this a trial session',
        'flagHint': 'One session to find out whether this tutor suits your child, before committing to a month. Afterwards you will be asked a few private questions about how it went.',
    },
    'fit': {
        'heading': 'How did the trial go?',
        'privateNotice': 'The tutor never sees this. Not the scores, not your comments, not whether you filled it in. It is not shown on her profile, does not affect her ranking, and is not included in any statistic about her. Please answer honestly — that is the only reason this is worth asking.',
        'dimension': {
            'communication': 'Communication',
            'punctuality': 'Punctuality',
            'engagement': 'Engagement',
            'pace': 'Pace',
        },
        'dimensionHint': {
            'communication': 'Could your child follow her explanations and ask questions?',
            'punctuality': 'Did she arrive when she said she would?',
            'engagement': 'Was your child involved, or sitting through it?',
            'pace': 'Too fast, too slow, or about right?',
        },
        'continueLegend': 'Would you continue with this tutor?',
        'continue': {'yes': 'Yes, continue', 'no': 'No, look for someone else'},
        'noteLabel': 'Anything else',
        'noteHint': 'Optional. Write in whatever language you like — it is stored exactly as you write it.',
        'submit': 'Send fit check',
        'sent': 'Fit check sent',
        'submittedHeading': 'Your fit check',
    },
    'lifecycle': {
        'heading': 'What happens next',
        'action': {
            'confirmed': 'Confirm booking',
            'declined': 'Decline',
            'in_progress': 'Start session',
            'completed': 'Mark completed',
            'cancelled': 'Cancel booking',
            'no_show': 'Record a no-show',
        },
        'done': {
            'confirmed': 'Booking confirmed',
            'declined': 'Request declined',
            'in_progress': 'Session started',
            'completed': 'Booking completed',
            'cancelled': 'Booking cancelled',
            'no_show': 'No-show recorded',
        },
        'noActions': 'This booking is finished. Nothing further can be changed on it.',
        'terminal': {
            'completed': 'This engagement is complete. Completed bookings are not reopened — reviews, payment records and the progress ledger all hang off them.',
            'cancelled': 'This booking was cancelled.',
            'declined': 'This request was declined.',
            'no_show': 'Recorded as a no-show.',
        },
        'reasonRequired': 'A reason is required, and the other party will see it. A booking that disappears without explanation is worse than one that is declined clearly.',
        'reasonLabel': 'Reason',
        'reasonGiven': 'Reason given: {{reason}}',
        'underSafetyConstraintLabel': 'I am declining because of a condition I declared',
        'underSafetyConstraintHint': 'Declines made under your own declared conditions are excluded from your confirmation rate. Tick this now — it cannot be added afterwards.',
    },
    'detail': {
        'back': 'All bookings',
        'summaryCaption': 'Booking details',
        'when': 'When',
        'mode': 'Where',
        'agreedRate': 'Agreed rate',
        'travelCharge': 'Travel charge',
        'guardianPresence': 'Guardian present',
        'guardianPresenceValue': 'Required for every session',
    },
}

BOOKING_UR = {
    'list': {
        'familyTitle': 'میری بکنگز',
        'tutorTitle': 'بکنگز',
        'open': 'توجہ درکار',
        'awaiting': 'آپ کے جواب کا انتظار',
        'live': 'تصدیق شدہ اور جاری',
        'past': 'مکمل شدہ',
        'tutor': 'استاد',
        'student': 'طالب علم',
        'emptyTitle': 'ابھی کوئی بکنگ نہیں',
        'emptyBody': 'جب آپ کسی استاد کی درخواست کریں گے، وہ یہاں اپنی حالت اور اگلے مرحلے کے ساتھ ظاہر ہوگی۔',
        'findTutor': 'استاد تلاش کریں',
        'tutorEmptyTitle': 'ابھی کوئی درخواست نہیں',
        'tutorEmptyBody': 'خاندانوں کی درخواستیں یہاں آئیں گی۔ جلد جواب دینا اہم ہے — انتظار کرنے والا خاندان کسی اور کو بک کر لیتا ہے۔',
    },
    'card': {'untitled': 'بکنگ', 'trial': 'آزمائشی'},
    'request': {
        'title': 'بکنگ کی درخواست',
        'engagementLegend': 'کس قسم کا انتظام',
        'studentLabel': 'یہ کس کے لیے ہے',
        'studentHint': 'اپنے بچے کی تفصیل یہاں شامل کریں۔ Ustaad.com پر بچوں کے اکاؤنٹ نہیں ہوتے — اکاؤنٹ آپ کا ہے اور سارا انتظام اسی کے ذریعے ہوتا ہے۔',
        'studentPlaceholder': 'طالب علم منتخب کریں',
        'claimLabel': 'مضمون، درجہ اور بورڈ',
        'modeLabel': 'نشستیں کہاں ہوں گی',
        'modeAny': 'جس بھی طریقے سے وہ پڑھاتی ہیں',
        'addressLabel': 'آپ کہاں ہیں',
        'addressHint': 'مکان اور گلی۔ نیچے پڑھیں کہ استاد کو کیا نظر آئے گا اور کیا نہیں۔',
        'agreedHeading': 'آپ کس بات پر متفق ہو رہے ہیں',
        'travelCharge': 'سفر: {{amount}}، الگ درج',
        'submit': 'درخواست بھیجیں',
        'sent': 'درخواست بھیج دی گئی',
        'slotTaken': 'یہ وقت آپ کے فارم بھرنے کے دوران کسی اور نے بک کر لیا۔ نیچے کے اوقات تازہ کر دیے گئے ہیں — براہِ کرم کوئی اور وقت منتخب کریں۔',
    },
    'slots': {
        'legend': 'وقت منتخب کریں',
        'chosen': 'منتخب: {{day}}، {{start}} سے {{end}}',
        'onlyFreeNote': 'صرف وہی اوقات دکھائے جاتے ہیں جن میں استاد واقعی فارغ ہیں۔ پہلے سے بک شدہ وقت یہاں بالکل ظاہر نہیں ہوتا، اس لیے جو آپ منتخب کر سکتے ہیں وہ بک ہونے کی وجہ سے رد نہیں ہو سکتا۔',
        'emptyTitle': 'اگلے دو ہفتوں میں کوئی وقت خالی نہیں',
        'emptyBody': 'ہو سکتا ہے انہوں نے اوقات مقرر نہ کیے ہوں، یا سب بک ہو چکے ہوں۔ آپ پھر بھی طلب کے بورڈ پر درخواست دے سکتے ہیں۔',
    },
    'single': {
        'heading': 'یہ گھنٹہ کس کام کے لیے ہے',
        'whyRequired': 'یہ دونوں ضروری ہیں۔ انہی سے استاد تیاری کے ساتھ آتی ہیں — یہی فرق ہے ایک کارآمد گھنٹے اور ایسے گھنٹے میں جو یہ سمجھنے میں گزر جائے کہ آپ آئے کیوں تھے۔',
        'purposeLabel': 'یہ نشست کیوں',
        'purpose': {
            'concept_clarification': 'کوئی تصور جو سمجھ نہیں آ رہا',
            'assessment_review': 'کسی ٹیسٹ یا اسائنمنٹ پر نظرِ ثانی',
            'doubt_solving': 'مخصوص سوالات حل کرنے ہیں',
            'exam_revision': 'امتحان سے پہلے دہرائی',
        },
        'topicsLabel': 'کون سے موضوعات',
        'topicsHint': 'کم از کم ایک منتخب کریں۔ استاد اسی سے تیاری کریں گی۔',
        'noTopics': 'اس استاد نے منتخب مضمون کے لیے ابھی موضوعات درج نہیں کیے۔',
    },
    'monthly': {
        'sessionsPerWeekLabel': 'ہفتے میں کتنی نشستیں',
        'cycleWeeksLabel': 'اس دور میں کتنے ہفتے',
        'cycleWeeksHint': 'عام طور پر چار۔ ہر دور کے لیے ایک ادائیگی کا اندراج بنتا ہے۔',
    },
    'package': {
        'sessionsLabel': 'کل کتنی نشستیں',
        'sessionsHint': '2 سے 40 کے درمیان، پہلے سے طے شدہ۔',
    },
    'disclosure': {
        'heading': 'پتہ کون دیکھتا ہے',
        'family': {
            'beforeConfirm': 'تصدیق سے پہلے استاد کو صرف آپ کا علاقہ نظر آتا ہے — گلی یا مکان نمبر نہیں۔',
            'afterConfirm': 'تصدیق کے بعد انہیں مکمل پتہ نظر آتا ہے، کیونکہ انہیں وہاں پہنچنا ہے۔',
            'nowVisible': 'انہوں نے تصدیق کر دی ہے، اس لیے اب انہیں مکمل پتہ نظر آتا ہے۔',
        },
        'tutor': {
            'beforeConfirm': 'آپ کی تصدیق سے پہلے آپ کو صرف علاقہ نظر آتا ہے۔ یہ فیصلہ کرنے کے لیے کافی ہے کہ آپ وہاں جانا چاہیں گی یا نہیں۔',
            'afterConfirm': 'تصدیق کے بعد آپ کو مکمل پتہ نظر آ جاتا ہے۔',
            'nowVisible': 'آپ نے تصدیق کر دی ہے، اس لیے مکمل پتہ آپ کے لیے دستیاب ہے۔',
        },
        'nobodyElse': 'اسے کوئی اور کبھی نہیں دیکھتا۔ نہ کسی عوامی پروفائل پر، نہ کسی تلاش کے نتیجے میں۔',
    },
    'safety': {
        'heading': 'اس استاد کی مقرر کردہ شرائط',
        'guardianRequired': 'وہ صرف اسی صورت پڑھاتی ہیں جب گھر میں والدین یا سرپرست موجود ہوں۔',
        'femaleStudentsOnly': 'وہ صرف طالبات کو پڑھاتی ہیں۔',
        'enforcedNote': 'Ustaad.com ان پر عمل کراتا ہے — ان کے خلاف درخواست آگے بھیجنے کے بجائے رد کر دی جاتی ہے۔ اپنی شرائط کی بنیاد پر ان کے انکار ان کے اعداد و شمار پر اثر نہیں ڈالتے۔',
        'acknowledgeLabel': 'ہر نشست کے دوران والدین یا سرپرست موجود ہوں گے',
        'acknowledgeHint': 'اس کے بغیر درخواست نہیں بھیجی جا سکتی۔',
        'refused': 'اس استاد کے لیے سرپرست کی موجودگی ضروری ہے۔ جاری رکھنے کے لیے اوپر والا خانہ منتخب کریں، یا کوئی ایسی استاد چنیں جو یہ شرط نہ رکھتی ہوں۔',
    },
    'trial': {
        'flagLabel': 'اسے آزمائشی نشست بنائیں',
        'flagHint': 'ایک نشست یہ جاننے کے لیے کہ یہ استاد آپ کے بچے کے لیے مناسب ہیں یا نہیں، مہینے کا وعدہ کرنے سے پہلے۔ بعد میں آپ سے چند نجی سوالات پوچھے جائیں گے۔',
    },
    'fit': {
        'heading': 'آزمائشی نشست کیسی رہی؟',
        'privateNotice': 'استاد یہ کبھی نہیں دیکھتیں۔ نہ نمبر، نہ آپ کے تبصرے، نہ یہ کہ آپ نے بھرا بھی یا نہیں۔ یہ ان کے پروفائل پر نہیں دکھایا جاتا، ان کی درجہ بندی پر اثر نہیں ڈالتا، اور ان کے کسی اعداد و شمار میں شامل نہیں ہوتا۔ براہِ کرم سچ لکھیں — یہی واحد وجہ ہے کہ یہ پوچھنا فائدہ مند ہے۔',
        'dimension': {
            'communication': 'رابطہ',
            'punctuality': 'وقت کی پابندی',
            'engagement': 'دلچسپی',
            'pace': 'رفتار',
        },
        'dimensionHint': {
            'communication': 'کیا آپ کا بچہ ان کی وضاحت سمجھ سکا اور سوال پوچھ سکا؟',
            'punctuality': 'کیا وہ طے شدہ وقت پر پہنچیں؟',
            'engagement': 'کیا آپ کا بچہ شریک تھا، یا صرف بیٹھا رہا؟',
            'pace': 'بہت تیز، بہت سست، یا مناسب؟',
        },
        'continueLegend': 'کیا آپ اس استاد کے ساتھ جاری رکھیں گے؟',
        'continue': {'yes': 'جی ہاں، جاری رکھیں', 'no': 'نہیں، کسی اور کو دیکھیں'},
        'noteLabel': 'کچھ اور',
        'noteHint': 'اختیاری۔ جس زبان میں چاہیں لکھیں — یہ بالکل ویسا ہی محفوظ ہوتا ہے جیسا آپ لکھتے ہیں۔',
        'submit': 'جائزہ بھیجیں',
        'sent': 'جائزہ بھیج دیا گیا',
        'submittedHeading': 'آپ کا جائزہ',
    },
    'lifecycle': {
        'heading': 'اب کیا ہوگا',
        'action': {
            'confirmed': 'بکنگ کی تصدیق کریں',
            'declined': 'انکار کریں',
            'in_progress': 'نشست شروع کریں',
            'completed': 'مکمل درج کریں',
            'cancelled': 'بکنگ منسوخ کریں',
            'no_show': 'غیر حاضری درج کریں',
        },
        'done': {
            'confirmed': 'بکنگ کی تصدیق ہو گئی',
            'declined': 'درخواست رد کر دی گئی',
            'in_progress': 'نشست شروع ہو گئی',
            'completed': 'بکنگ مکمل ہو گئی',
            'cancelled': 'بکنگ منسوخ ہو گئی',
            'no_show': 'غیر حاضری درج ہو گئی',
        },
        'noActions': 'یہ بکنگ مکمل ہو چکی ہے۔ اس پر مزید کوئی تبدیلی نہیں ہو سکتی۔',
        'terminal': {
            'completed': 'یہ معاہدہ مکمل ہو چکا ہے۔ مکمل شدہ بکنگ دوبارہ نہیں کھولی جاتی — تبصرے، ادائیگی کے اندراج اور پیش رفت کا ریکارڈ سب اسی سے جڑے ہیں۔',
            'cancelled': 'یہ بکنگ منسوخ کر دی گئی تھی۔',
            'declined': 'یہ درخواست رد کر دی گئی تھی۔',
            'no_show': 'غیر حاضری کے طور پر درج۔',
        },
        'reasonRequired': 'وجہ لکھنا ضروری ہے، اور دوسرا فریق اسے دیکھے گا۔ بغیر وضاحت غائب ہو جانے والی بکنگ صاف انکار سے بدتر ہے۔',
        'reasonLabel': 'وجہ',
        'reasonGiven': 'دی گئی وجہ: {{reason}}',
        'underSafetyConstraintLabel': 'میں اپنی مقرر کردہ شرط کی وجہ سے انکار کر رہی ہوں',
        'underSafetyConstraintHint': 'اپنی مقرر کردہ شرائط کے تحت کیے گئے انکار آپ کی تصدیق کی شرح سے خارج رہتے ہیں۔ ابھی منتخب کریں — یہ بعد میں شامل نہیں کیا جا سکتا۔',
    },
    'detail': {
        'back': 'تمام بکنگز',
        'summaryCaption': 'بکنگ کی تفصیل',
        'when': 'کب',
        'mode': 'کہاں',
        'agreedRate': 'طے شدہ فیس',
        'travelCharge': 'سفری خرچ',
        'guardianPresence': 'سرپرست کی موجودگی',
        'guardianPresenceValue': 'ہر نشست کے لیے لازمی',
    },
}

# ---------------------------------------------------------------- payments
PAYMENTS_EN = {
    'boundary': {
        'heading': 'How payment works here',
        'body': 'Ustaad.com records what was agreed and what both parties confirm was paid. It does not process, hold or transfer money. Payment is made directly between the family and the tutor.',
    },
    'ledger': {
        'title': 'Payment record',
        'emptyTitle': 'No payment records yet',
        'emptyBody': 'A record is raised when the booking is confirmed, with the rate frozen as it stood at that moment.',
        'totalsCaption': 'Totals across this engagement',
        'totalSettled': 'Confirmed by both parties',
        'totalOutstanding': 'Not yet confirmed by both',
        'totalsNote': 'Only records both parties have acknowledged count as confirmed. A single-party claim stays in the second row until the other side agrees.',
    },
    'status': {
        'pending': 'Not yet acknowledged',
        'family_marked': 'Marked paid by the family',
        'settled': 'Confirmed by both',
        'disputed': 'Disputed',
    },
    'line': {
        'caption': 'Cycle {{cycle}}',
        'agreedAmount': 'Agreed amount',
        'travelCharge': 'Travel charge',
        'total': 'Total agreed',
        'amountLocked': 'The agreed amount can no longer be changed on this record. Correct it by raising a dispute, which leaves a trail, rather than by editing a figure both people already agreed to.',
    },
    'ack': {
        'family': {
            'done': 'The family has marked this paid.',
            'pending': 'The family has not marked this paid yet.',
        },
        'tutor': {
            'done': 'The tutor has confirmed receiving it.',
            'pending': 'The tutor has not confirmed receiving it yet.',
        },
    },
    'action': {
        'markPaid': 'I have paid this',
        'markedPaid': 'Marked as paid',
        'confirmReceived': 'I received this',
        'confirmedReceived': 'Confirmed as received',
    },
    'dispute': {
        'open': 'Raise a dispute',
        'heading': 'Raise a dispute',
        'notARefund': 'This is not a refund request. Ustaad.com never held the money, so there is nothing here for it to return. A dispute is a written disagreement that an administrator reads and resolves in writing.',
        'reasonLabel': 'What is the disagreement',
        'reasonHint': 'One line. This is what an administrator sees first.',
        'detailLabel': 'Details',
        'detailHint': 'Optional. Write as much as you need, in whichever language you prefer.',
        'submit': 'Raise dispute',
        'raised': 'Dispute raised',
        'status': {
            'open': 'Dispute open',
            'under_review': 'Under review by an administrator',
            'resolved': 'Dispute resolved',
            'withdrawn': 'Dispute withdrawn',
        },
    },
}

PAYMENTS_UR = {
    'boundary': {
        'heading': 'یہاں ادائیگی کیسے ہوتی ہے',
        'body': 'Ustaad.com صرف یہ ریکارڈ رکھتا ہے کہ کیا طے ہوا اور دونوں فریق کس ادائیگی کی تصدیق کرتے ہیں۔ یہ رقم وصول، محفوظ یا منتقل نہیں کرتا۔ ادائیگی براہِ راست خاندان اور استاد کے درمیان ہوتی ہے۔',
    },
    'ledger': {
        'title': 'ادائیگی کا اندراج',
        'emptyTitle': 'ابھی کوئی اندراج نہیں',
        'emptyBody': 'بکنگ کی تصدیق پر اندراج بنتا ہے، اور فیس اسی وقت کی حالت پر محفوظ ہو جاتی ہے۔',
        'totalsCaption': 'اس معاہدے کے کل اعداد',
        'totalSettled': 'دونوں فریقوں کی تصدیق شدہ',
        'totalOutstanding': 'ابھی دونوں کی تصدیق باقی',
        'totalsNote': 'صرف وہی اندراج تصدیق شدہ شمار ہوتے ہیں جنہیں دونوں فریقوں نے تسلیم کیا ہو۔ ایک طرفہ دعویٰ دوسری قطار میں رہتا ہے جب تک دوسرا فریق متفق نہ ہو۔',
    },
    'status': {
        'pending': 'ابھی تسلیم نہیں',
        'family_marked': 'خاندان نے ادا شدہ درج کیا',
        'settled': 'دونوں کی تصدیق شدہ',
        'disputed': 'اختلاف',
    },
    'line': {
        'caption': 'دور {{cycle}}',
        'agreedAmount': 'طے شدہ رقم',
        'travelCharge': 'سفری خرچ',
        'total': 'کل طے شدہ',
        'amountLocked': 'اس اندراج پر طے شدہ رقم اب تبدیل نہیں ہو سکتی۔ اسے درست کرنے کے لیے اختلاف درج کریں، جس کا ریکارڈ رہتا ہے، نہ کہ ایسی رقم بدل کر جس پر دونوں پہلے متفق ہو چکے۔',
    },
    'ack': {
        'family': {
            'done': 'خاندان نے اسے ادا شدہ درج کیا ہے۔',
            'pending': 'خاندان نے ابھی اسے ادا شدہ درج نہیں کیا۔',
        },
        'tutor': {
            'done': 'استاد نے وصولی کی تصدیق کر دی ہے۔',
            'pending': 'استاد نے ابھی وصولی کی تصدیق نہیں کی۔',
        },
    },
    'action': {
        'markPaid': 'میں نے یہ ادا کر دی ہے',
        'markedPaid': 'ادا شدہ درج ہو گیا',
        'confirmReceived': 'مجھے یہ موصول ہوئی',
        'confirmedReceived': 'وصولی کی تصدیق ہو گئی',
    },
    'dispute': {
        'open': 'اختلاف درج کریں',
        'heading': 'اختلاف درج کریں',
        'notARefund': 'یہ رقم واپسی کی درخواست نہیں ہے۔ Ustaad.com نے کبھی رقم رکھی ہی نہیں، اس لیے واپس کرنے کو کچھ ہے نہیں۔ اختلاف ایک تحریری اعتراض ہے جسے منتظم پڑھ کر تحریری فیصلہ کرتا ہے۔',
        'reasonLabel': 'اختلاف کیا ہے',
        'reasonHint': 'ایک سطر۔ منتظم سب سے پہلے یہی دیکھتا ہے۔',
        'detailLabel': 'تفصیل',
        'detailHint': 'اختیاری۔ جتنا چاہیں لکھیں، جس زبان میں چاہیں۔',
        'submit': 'اختلاف درج کریں',
        'raised': 'اختلاف درج ہو گیا',
        'status': {
            'open': 'اختلاف کھلا ہے',
            'under_review': 'منتظم زیرِ غور',
            'resolved': 'اختلاف طے ہو گیا',
            'withdrawn': 'اختلاف واپس لے لیا گیا',
        },
    },
}

for lang, extra in (('en', COMMON['en']), ('ur', COMMON['ur'])):
    path = 'src/locales/%s/common.json' % lang
    data = rj(path)
    deep_update(data, extra)
    wj(path, data)

for lang, extra in (('en', BOOKING_EN), ('ur', BOOKING_UR)):
    path = 'src/locales/%s/booking.json' % lang
    data = rj(path)
    deep_update(data, extra)
    wj(path, data)

for lang, extra in (('en', PAYMENTS_EN), ('ur', PAYMENTS_UR)):
    path = 'src/locales/%s/payments.json' % lang
    data = {}
    deep_update(data, extra)
    wj(path, data)

print('booking + payments locale keys written')
