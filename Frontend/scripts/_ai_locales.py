# -*- coding: utf-8 -*-
"""Locale keys for the AI surfaces (§6.10, §6.11, §6.25, §6.26, §6.15)."""
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


COMMON = {
    'en': {'nav': {'intake': 'Find the gap', 'competency': 'Topic assessments'}},
    'ur': {'nav': {'intake': 'کمی معلوم کریں', 'competency': 'موضوعات کی جانچ'}},
}

EN = {
    'intake': {
        'pageTitle': 'Tell us what is going wrong',
        'pageBody': 'Describe the difficulty in your own words. Three or four questions is usually enough to find the topic underneath it — which is often not the one you would have named.',
        'constraintsTitle': 'Your requirements',
        'constraintsBody': 'Set these first. They are applied by the system when tutors are shortlisted, not by the assistant.',
        'signInTitle': 'You will need an account for this',
        'signInBody': 'The conversation is saved against your account so a dropped connection resumes rather than starting again. Searching for tutors yourself needs no account at all.',
        'openingTitle': 'What is the difficulty?',
        'openingBody': 'For example: “My daughter is in Matric, Sindh Board, and she is weak in Maths.” Write in whichever language you prefer — English, Urdu, or a mix.',
        'placeholder': 'Describe what is going wrong…',
        'composerLabel': 'Describe the difficulty',
        'transcriptLabel': 'Conversation',
        'thinking': 'Thinking',
        'begin': 'Start',
        'send': 'Send',
        'turnsLeft_one': '{{count}} question left',
        'turnsLeft_other': '{{count}} questions left',
        'startOver': 'Start over',
        'resumedNote': 'This conversation was saved on this device and picked up where you left it.',
    },
    'gapMap': {
        'title': 'What we found',
        'subtitle': 'The topic named first is the one to teach. The others follow from it.',
        'rootGap': 'The root gap',
        'chainHeading': 'Why this topic',
        'chainNote': 'This chain comes from the curriculum itself, not from the assistant. Each topic depends on the one before it.',
        'unresolvedHeading': 'Not worked out',
        'unresolvedNote': 'These could not be settled from what was described. Answering about them would narrow it further.',
    },
    'constraints': {
        'heading': 'Applied by the system',
        'gender': {
            'female_only': 'Female tutors only',
            'male_only': 'Male tutors only',
        },
        'area': 'In {{area}}',
        'budget': 'Up to {{amount}} per hour',
        'enforcedByCode': 'These were applied by the search itself, in the database query, after the assistant had finished. The assistant has no way to set or relax them — the request it makes carries only the subject, level, board and topics.',
        'notRanking': 'A tutor who does not meet one is not in the list at all. They are not ranked lower or shown further down.',
    },
    'shortlist': {
        'title': 'Tutors who match',
        'subtitle': 'At most three, ordered by the same score every search uses. Every figure comes from the platform’s records.',
        'verified': 'Identity verified',
        'viewProfile': 'See the full profile',
    },
    'fallback': {
        'manualSearch': 'Search for tutors yourself',
        'busy': {
            'title': 'The assistant is busy',
            'body': 'It is handling more than it can right now. Nothing you have written is lost, and searching directly works as normal.',
        },
        'unclear': {
            'title': 'That did not come back usable',
            'body': 'The assistant’s answer could not be read. Rather than guess at what it meant, here is the direct route.',
        },
        'insufficient': {
            'title': 'We could not pin it down',
            'body': 'From what was described, the gap could not be located confidently. Saying so is better than naming a topic on a hunch — the search below is a good place to start instead.',
        },
    },
    'exam': {
        'pageTitle': 'Topic assessments',
        'pageBody': 'Each topic you have claimed can be assessed on its own. Passing one adds a badge naming that topic and the date it was assessed.',
        'perTopicNote': 'Assessed per topic, never per subject. A topic you do not pass leaves every other claim exactly as it was.',
        'emptyTitle': 'No claims to assess yet',
        'emptyBody': 'Add the subjects, levels and boards you teach on your profile first.',
        'backToClaims': 'All claims',
        'startAssessment': 'Take the assessment',
        'assessedOn': 'Assessed {{date}}',
        'expiresOn': 'expires {{date}}',
        'startTitle': 'Assessment: {{topic}}',
        'startBody': 'Read the rules before you begin. They do not change once you start.',
        'rulesHeading': 'The rules',
        'rules': {
            'items': 'Three or four written questions, on this topic only, at the level and board you claimed.',
            'graded': 'Your answers are read for whether they are correct, whether you explain your reasoning, and whether you pitch the explanation at a student. The mark itself is calculated by a fixed rule, not decided by the assistant.',
            'onPass': 'Passing adds a badge naming this topic and the date. It is valid for twelve months.',
            'onFail': 'Not passing changes nothing else. Your identity verification, your other topics, your profile and your bookings are untouched.',
            'override': 'An administrator can overturn an automated result. That is a real route, not a formality.',
            'appealOnly': 'This is your appeal attempt for this topic.',
        },
        'maxExchanges': 'At most {{count}} exchanges in one session.',
        'begin': 'Begin the assessment',
        'itemLabel': 'Question {{index}} of {{total}}',
        'answerPlaceholder': 'Answer as you would explain it to a student…',
        'explainHint': 'Explain your reasoning rather than giving only the answer, and pitch it at the student rather than at another teacher. Both are part of what is being assessed.',
        'submit': 'Submit answers',
        'appealBadge': 'Appeal attempt',
        'reasoningHeading': 'Why this result',
        'markedInCode': 'The result was calculated by a fixed rule from how your answers were read. The same answers always produce the same result.',
        'verdict': {
            'passed': {
                'title': 'Passed: {{topic}}',
                'body': 'A badge naming this topic and today’s date now appears on your profile. It is valid for twelve months.',
            },
            'notPassed': {
                'title': 'Not passed: {{topic}}',
                'body': 'This result applies to this topic only. Nothing else about your profile has changed.',
            },
        },
        'appeal': {
            'overrideNote': 'You can appeal this. An administrator reviews the questions, your answers and the reasoning, and can overturn the automated result. Their decision is recorded with the reason.',
            'oncePerClaim': 'One appeal per topic.',
            'action': 'Appeal this result',
            'restOfProfile': 'Your identity verification and every other topic you have claimed are unaffected.',
        },
        'toast': {
            'passed': 'Assessment passed',
            'notPassed': 'Assessment not passed',
        },
        'unavailableClaimSafe': 'Your claim is unchanged. Nothing was recorded against it, and you can take the assessment later.',
    },
    'plan': {
        'pageTitle': 'Study plan',
        'title': 'The plan',
        'validated': 'Order checked',
        'notValidated': 'Order not confirmed',
        'validatedNote': 'The order was checked against the curriculum’s own prerequisites after the plan was written, and rewritten where it did not hold. A topic never appears before something it depends on.',
        'notValidatedNote': 'This plan’s order has not been confirmed against the prerequisite graph. Read it as a suggestion rather than a sequence.',
        'weekLabel': 'Week {{number}}',
        'next': 'Next',
        'orderingHeading': 'What depends on what',
        'orderingNote': 'From the curriculum, not from the plan. This is what the order above was checked against.',
        'datesInCode': 'The dates were calculated from your start date and the exam date. The assistant ordered the topics; it did not choose any date.',
        'emptyTitle': 'No study plan yet',
        'emptyBody': 'A plan is generated from a completed diagnostic and a target exam date.',
    },
    'countdown': {
        'heading': 'Until the exam',
        'headingFor': 'Until {{name}}’s exam',
        'daysUnit_one': 'day',
        'daysUnit_other': 'days',
        'daysLeft_one': '{{count}} day until the exam',
        'daysLeft_other': '{{count}} days until the exam',
        'passed': 'The exam date has passed',
        'examOn': 'Exam on {{date}}',
        'progressHeading': 'Plan progress',
        'progressCount': '{{done}} of {{total}}',
        'progressNote': 'Counted from what the tutor recorded in session notes, not from ticking topics off.',
        'nextHeading': 'Next topic',
        'allDone': 'Plan complete',
        'allDoneBody': 'Every topic in the plan has been covered and rated. Revision from here is repetition rather than new ground.',
        'seeFullPlan': 'See the whole plan',
    },
    'replay': {
        'badge': 'Recorded session',
        'liveCalls': 'Live model calls: {{count}}',
        'body': 'This is a stored conversation being replayed. It is not happening now, and no AI provider is contacted when you open it.',
        'why': 'Built this way on purpose: a demonstration that depends on a live service is one that a rate limit can take away at the wrong moment.',
        'provenance': 'Model {{model}} · prompt {{version}}',
        'transcriptLabel': 'Recorded conversation',
        'role': {'parent': 'Parent', 'agent': 'Assistant', 'tutor': 'Tutor', 'system': 'System'},
        'nextTurn': 'Next turn',
        'restart': 'Start again',
        'finished': 'End of the recording',
        'position': 'Turn {{shown}} of {{total}}',
        'exhibitHeading': 'What this shows',
        'verdict': {'passed': 'Passed', 'failed': 'Not passed'},
    },
    'demo': {
        'title': 'See it work',
        'body': 'Five recorded scenarios, each showing one thing the platform does. No account needed.',
        'replay': 'Replay this',
        'backToList': 'All scenarios',
    },
}

UR = {
    'intake': {
        'pageTitle': 'بتائیے کیا مشکل ہے',
        'pageBody': 'اپنے الفاظ میں مشکل بیان کریں۔ عام طور پر تین یا چار سوالات کافی ہوتے ہیں تاکہ اس کے نیچے چھپا اصل موضوع سامنے آ جائے — جو اکثر وہ نہیں ہوتا جس کا آپ نام لیتے۔',
        'constraintsTitle': 'آپ کی شرائط',
        'constraintsBody': 'یہ پہلے مقرر کریں۔ اساتذہ کی فہرست بناتے وقت ان پر نظام عمل کرتا ہے، معاون نہیں۔',
        'signInTitle': 'اس کے لیے اکاؤنٹ درکار ہے',
        'signInBody': 'گفتگو آپ کے اکاؤنٹ کے ساتھ محفوظ ہوتی ہے تاکہ رابطہ ٹوٹنے پر دوبارہ شروع کرنے کے بجائے وہیں سے جاری رہے۔ خود اساتذہ تلاش کرنے کے لیے کوئی اکاؤنٹ درکار نہیں۔',
        'openingTitle': 'مشکل کیا ہے؟',
        'openingBody': 'مثلاً: ”میری بیٹی میٹرک، سندھ بورڈ میں ہے اور ریاضی میں کمزور ہے۔“ جس زبان میں چاہیں لکھیں — انگریزی، اردو، یا دونوں۔',
        'placeholder': 'بتائیے کیا مشکل پیش آ رہی ہے…',
        'composerLabel': 'مشکل بیان کریں',
        'transcriptLabel': 'گفتگو',
        'thinking': 'سوچ رہا ہے',
        'begin': 'شروع کریں',
        'send': 'بھیجیں',
        'turnsLeft_one': '{{count}} سوال باقی',
        'turnsLeft_other': '{{count}} سوالات باقی',
        'startOver': 'دوبارہ شروع کریں',
        'resumedNote': 'یہ گفتگو اس آلے پر محفوظ تھی اور وہیں سے جاری کی گئی جہاں آپ نے چھوڑی تھی۔',
    },
    'gapMap': {
        'title': 'ہمیں کیا ملا',
        'subtitle': 'سب سے پہلے دیا گیا موضوع وہی ہے جو پڑھانا ہے۔ باقی اسی سے نکلتے ہیں۔',
        'rootGap': 'بنیادی کمی',
        'chainHeading': 'یہ موضوع کیوں',
        'chainNote': 'یہ سلسلہ خود نصاب سے آتا ہے، معاون سے نہیں۔ ہر موضوع اپنے سے پہلے والے پر منحصر ہے۔',
        'unresolvedHeading': 'طے نہیں ہو سکا',
        'unresolvedNote': 'جو بتایا گیا اس سے یہ طے نہیں ہو سکے۔ ان کے بارے میں بتانے سے بات مزید واضح ہوگی۔',
    },
    'constraints': {
        'heading': 'نظام نے لاگو کیا',
        'gender': {'female_only': 'صرف خواتین اساتذہ', 'male_only': 'صرف مرد اساتذہ'},
        'area': '{{area}} میں',
        'budget': '{{amount}} فی گھنٹہ تک',
        'enforcedByCode': 'یہ خود تلاش نے، ڈیٹابیس کی کوئری میں، معاون کے فارغ ہونے کے بعد لاگو کیے۔ معاون کے پاس انہیں مقرر کرنے یا نرم کرنے کا کوئی راستہ نہیں — اس کی درخواست میں صرف مضمون، درجہ، بورڈ اور موضوعات ہوتے ہیں۔',
        'notRanking': 'جو استاد ان پر پورا نہ اترے وہ فہرست میں سرے سے نہیں ہوتے۔ انہیں نیچے یا بعد میں نہیں دکھایا جاتا۔',
    },
    'shortlist': {
        'title': 'موزوں اساتذہ',
        'subtitle': 'زیادہ سے زیادہ تین، اسی درجہ بندی کے مطابق جو ہر تلاش استعمال کرتی ہے۔ ہر عدد پلیٹ فارم کے ریکارڈ سے آتا ہے۔',
        'verified': 'شناخت تصدیق شدہ',
        'viewProfile': 'مکمل پروفائل دیکھیں',
    },
    'fallback': {
        'manualSearch': 'خود اساتذہ تلاش کریں',
        'busy': {
            'title': 'معاون مصروف ہے',
            'body': 'اس وقت اس پر گنجائش سے زیادہ بوجھ ہے۔ آپ کا لکھا ہوا کچھ ضائع نہیں ہوا، اور براہِ راست تلاش معمول کے مطابق کام کرتی ہے۔',
        },
        'unclear': {
            'title': 'جواب قابلِ استعمال نہیں آیا',
            'body': 'معاون کا جواب پڑھا نہیں جا سکا۔ اس کا مطلب اندازے سے نکالنے کے بجائے، یہ رہا براہِ راست راستہ۔',
        },
        'insufficient': {
            'title': 'ہم یقین سے طے نہیں کر سکے',
            'body': 'جو بتایا گیا اس سے کمی یقین کے ساتھ معلوم نہیں ہو سکی۔ اندازے پر کوئی موضوع بتانے سے یہ کہہ دینا بہتر ہے — نیچے دی گئی تلاش شروع کرنے کی اچھی جگہ ہے۔',
        },
    },
    'exam': {
        'pageTitle': 'موضوعات کی جانچ',
        'pageBody': 'آپ کے دعوے کے ہر موضوع کی الگ جانچ ہو سکتی ہے۔ کامیابی پر اس موضوع اور تاریخ کے ساتھ ایک نشان آپ کے پروفائل پر آتا ہے۔',
        'perTopicNote': 'جانچ ہر موضوع کی الگ ہوتی ہے، پورے مضمون کی نہیں۔ جس موضوع میں کامیابی نہ ہو، باقی تمام دعوے جوں کے توں رہتے ہیں۔',
        'emptyTitle': 'ابھی جانچنے کو کوئی دعویٰ نہیں',
        'emptyBody': 'پہلے اپنے پروفائل پر وہ مضامین، درجے اور بورڈ شامل کریں جو آپ پڑھاتی ہیں۔',
        'backToClaims': 'تمام دعوے',
        'startAssessment': 'جانچ دیں',
        'assessedOn': 'جانچ {{date}}',
        'expiresOn': 'میعاد {{date}}',
        'startTitle': 'جانچ: {{topic}}',
        'startBody': 'شروع کرنے سے پہلے قواعد پڑھ لیں۔ شروع ہونے کے بعد یہ تبدیل نہیں ہوتے۔',
        'rulesHeading': 'قواعد',
        'rules': {
            'items': 'تین یا چار تحریری سوالات، صرف اسی موضوع پر، اسی درجے اور بورڈ کے مطابق جس کا آپ نے دعویٰ کیا۔',
            'graded': 'آپ کے جوابات اس لحاظ سے پڑھے جاتے ہیں کہ درست ہیں یا نہیں، آپ اپنی دلیل بیان کرتی ہیں یا نہیں، اور وضاحت طالب علم کے مطابق ہے یا نہیں۔ نمبر خود ایک مقررہ اصول سے نکلتا ہے، معاون کے فیصلے سے نہیں۔',
            'onPass': 'کامیابی پر اس موضوع اور تاریخ کے نام سے نشان ملتا ہے، جو بارہ ماہ کے لیے مؤثر ہے۔',
            'onFail': 'ناکامی سے اور کچھ تبدیل نہیں ہوتا۔ آپ کی شناختی تصدیق، باقی موضوعات، پروفائل اور بکنگز جوں کی توں رہتی ہیں۔',
            'override': 'منتظم خودکار نتیجے کو تبدیل کر سکتا ہے۔ یہ حقیقی راستہ ہے، رسمی کارروائی نہیں۔',
            'appealOnly': 'یہ اس موضوع کے لیے آپ کی اپیل کی کوشش ہے۔',
        },
        'maxExchanges': 'ایک نشست میں زیادہ سے زیادہ {{count}} مرتبہ تبادلہ۔',
        'begin': 'جانچ شروع کریں',
        'itemLabel': 'سوال {{index}} از {{total}}',
        'answerPlaceholder': 'ایسے جواب دیں جیسے کسی طالب علم کو سمجھا رہی ہوں…',
        'explainHint': 'صرف جواب دینے کے بجائے اپنی دلیل بیان کریں، اور اسے کسی دوسرے استاد کے بجائے طالب علم کے مطابق رکھیں۔ دونوں باتیں جانچی جاتی ہیں۔',
        'submit': 'جوابات جمع کرائیں',
        'appealBadge': 'اپیل کی کوشش',
        'reasoningHeading': 'یہ نتیجہ کیوں',
        'markedInCode': 'نتیجہ ایک مقررہ اصول سے نکلا، اس بنیاد پر کہ آپ کے جوابات کیسے پڑھے گئے۔ ایک ہی جوابات ہمیشہ ایک ہی نتیجہ دیتے ہیں۔',
        'verdict': {
            'passed': {
                'title': 'کامیاب: {{topic}}',
                'body': 'اس موضوع اور آج کی تاریخ کے نام سے ایک نشان اب آپ کے پروفائل پر ہے، جو بارہ ماہ کے لیے مؤثر ہے۔',
            },
            'notPassed': {
                'title': 'کامیابی نہیں: {{topic}}',
                'body': 'یہ نتیجہ صرف اسی موضوع پر لاگو ہے۔ آپ کے پروفائل میں اور کچھ تبدیل نہیں ہوا۔',
            },
        },
        'appeal': {
            'overrideNote': 'آپ اس پر اپیل کر سکتی ہیں۔ منتظم سوالات، آپ کے جوابات اور دی گئی وجہ کا جائزہ لیتا ہے اور خودکار نتیجہ تبدیل کر سکتا ہے۔ اس کا فیصلہ وجہ کے ساتھ محفوظ ہوتا ہے۔',
            'oncePerClaim': 'ہر موضوع پر ایک اپیل۔',
            'action': 'اس نتیجے پر اپیل کریں',
            'restOfProfile': 'آپ کی شناختی تصدیق اور باقی تمام دعوے متاثر نہیں ہوتے۔',
        },
        'toast': {'passed': 'جانچ کامیاب', 'notPassed': 'جانچ کامیاب نہیں'},
        'unavailableClaimSafe': 'آپ کا دعویٰ جوں کا توں ہے۔ اس کے خلاف کچھ درج نہیں ہوا، اور آپ بعد میں جانچ دے سکتی ہیں۔',
    },
    'plan': {
        'pageTitle': 'مطالعے کا منصوبہ',
        'title': 'منصوبہ',
        'validated': 'ترتیب جانچی گئی',
        'notValidated': 'ترتیب کی تصدیق نہیں',
        'validatedNote': 'منصوبہ بننے کے بعد ترتیب کو خود نصاب کی شرائط کے خلاف جانچا گیا اور جہاں پوری نہ اتری وہاں دوبارہ لکھا گیا۔ کوئی موضوع اپنی بنیاد سے پہلے نہیں آتا۔',
        'notValidatedNote': 'اس منصوبے کی ترتیب کی تصدیق نصاب کے سلسلے کے خلاف نہیں ہوئی۔ اسے ترتیب کے بجائے تجویز سمجھیں۔',
        'weekLabel': 'ہفتہ {{number}}',
        'next': 'اگلا',
        'orderingHeading': 'کیا کس پر منحصر ہے',
        'orderingNote': 'نصاب سے، منصوبے سے نہیں۔ اوپر کی ترتیب اسی کے خلاف جانچی گئی۔',
        'datesInCode': 'تاریخیں آپ کی ابتدائی تاریخ اور امتحان کی تاریخ سے نکالی گئیں۔ معاون نے صرف موضوعات کی ترتیب دی؛ کوئی تاریخ منتخب نہیں کی۔',
        'emptyTitle': 'ابھی کوئی منصوبہ نہیں',
        'emptyBody': 'منصوبہ مکمل تشخیص اور امتحان کی مقررہ تاریخ سے بنتا ہے۔',
    },
    'countdown': {
        'heading': 'امتحان تک',
        'headingFor': '{{name}} کے امتحان تک',
        'daysUnit_one': 'دن',
        'daysUnit_other': 'دن',
        'daysLeft_one': 'امتحان میں {{count}} دن باقی',
        'daysLeft_other': 'امتحان میں {{count}} دن باقی',
        'passed': 'امتحان کی تاریخ گزر چکی',
        'examOn': 'امتحان {{date}} کو',
        'progressHeading': 'منصوبے کی پیش رفت',
        'progressCount': '{{total}} میں سے {{done}}',
        'progressNote': 'اس سے شمار کیا گیا جو استاد نے نشستوں کے نوٹ میں درج کیا، موضوعات پر نشان لگانے سے نہیں۔',
        'nextHeading': 'اگلا موضوع',
        'allDone': 'منصوبہ مکمل',
        'allDoneBody': 'منصوبے کا ہر موضوع پڑھایا اور جانچا جا چکا ہے۔ اب دہرائی نئی چیز نہیں، تکرار ہے۔',
        'seeFullPlan': 'پورا منصوبہ دیکھیں',
    },
    'replay': {
        'badge': 'محفوظ شدہ نشست',
        'liveCalls': 'براہِ راست ماڈل کالز: {{count}}',
        'body': 'یہ ایک محفوظ شدہ گفتگو دوبارہ دکھائی جا رہی ہے۔ یہ ابھی نہیں ہو رہی، اور اسے کھولنے پر کسی AI فراہم کنندہ سے رابطہ نہیں ہوتا۔',
        'why': 'یہ جان بوجھ کر ایسے بنایا گیا: جو مظاہرہ کسی زندہ سروس پر منحصر ہو، اسے غلط وقت پر ایک حد بندی چھین سکتی ہے۔',
        'provenance': 'ماڈل {{model}} · پرامپٹ {{version}}',
        'transcriptLabel': 'محفوظ شدہ گفتگو',
        'role': {'parent': 'والدین', 'agent': 'معاون', 'tutor': 'استاد', 'system': 'نظام'},
        'nextTurn': 'اگلی باری',
        'restart': 'دوبارہ شروع کریں',
        'finished': 'ریکارڈنگ ختم',
        'position': '{{total}} میں سے باری {{shown}}',
        'exhibitHeading': 'یہ کیا دکھاتا ہے',
        'verdict': {'passed': 'کامیاب', 'failed': 'کامیاب نہیں'},
    },
    'demo': {
        'title': 'کام کرتے دیکھیں',
        'body': 'پانچ محفوظ شدہ منظرنامے، ہر ایک پلیٹ فارم کی ایک بات دکھاتا ہے۔ اکاؤنٹ کی ضرورت نہیں۔',
        'replay': 'یہ دوبارہ چلائیں',
        'backToList': 'تمام منظرنامے',
    },
}

for lang, extra in (('en', COMMON['en']), ('ur', COMMON['ur'])):
    path = 'src/locales/%s/common.json' % lang
    data = rj(path)
    deep_update(data, extra)
    wj(path, data)

for lang, extra in (('en', EN), ('ur', UR)):
    data = {}
    deep_update(data, extra)
    wj('src/locales/%s/ai.json' % lang, data)

print('ai locale keys written')
