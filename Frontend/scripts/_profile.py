# -*- coding: utf-8 -*-
import io, json, os

base = os.path.join(os.path.dirname(__file__), '..')
def rd(p): return io.open(os.path.join(base, p), encoding='utf-8').read()
def wr(p, s): io.open(os.path.join(base, p), 'w', encoding='utf-8').write(s)
def rj(p): return json.load(io.open(os.path.join(base, p), encoding='utf-8'))
def wj(p, d):
    with io.open(os.path.join(base, p), 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2); f.write('\n')

# ---------------------------------------------------------------- routes
p = 'src/routes/index.jsx'
s = rd(p)
s = s.replace(
    "      { path: 'tutors/:slug', ...page(() => import('../pages/public/TutorProfile')) },",
    "      /*\n"
    "       * `/t/:slug` is canonical — it is what the QR code encodes and what a\n"
    "       * tutor prints (§6.21). Short enough to read aloud and to fit a small\n"
    "       * code at high error correction. `/tutors/:slug` still resolves so\n"
    "       * anything already linking there keeps working.\n"
    "       */\n"
    "      { path: 't/:slug', ...page(() => import('../pages/public/TutorProfile')) },\n"
    "      { path: 'tutors/:slug', ...page(() => import('../pages/public/TutorProfile')) },")
wr(p, s)

EN = {
 'reliability': {
  'title': 'Reliability', 'basedOn_one': 'From {{count}} completed engagement',
  'basedOn_other': 'From {{count}} completed engagements',
  'confirmation': 'Confirms bookings', 'onTime': 'Arrives on time', 'completion': 'Completes engagements',
  'confirmationExplain': 'How often she accepts a booking request that matches what she offers.',
  'onTimeExplain': 'How often sessions started at the agreed time, from family reports.',
  'completionExplain': 'How often an arrangement ran to its agreed end rather than stopping early.',
  'measure': 'Measure', 'value': 'Value',
  'tooFewSessions': 'Not enough completed engagements yet to show reliable figures. Below {{count}} the percentages say more about the small number than about the tutor.',
  'safetyExclusion': 'Declines she makes under her own declared safety conditions are excluded from these figures. A tutor is never penalised for holding to the conditions she set.',
 },
 'reviews': {
  'title_one': '{{count}} review', 'title_other': '{{count}} reviews',
  'starsLabel': '{{rating}} out of 5',
  'sessionsWith_one': '{{count}} session with this tutor', 'sessionsWith_other': '{{count}} sessions with this tutor',
  'lowSignal': 'Little detail',
  'lowSignalExplain': 'This review says little about what actually happened, so it counts for less in ranking. It is shown in full because the person meant it.',
  'lowSignalNote_one': 'One review carries little detail and is marked. It is shown, not hidden.',
  'lowSignalNote_other': '{{count}} reviews carry little detail and are marked. They are shown, not hidden.',
  'contradiction': 'Rating and words differ',
  'contradictionExplain': 'The star rating and the written review point in different directions. Both are shown exactly as the reviewer left them — we have not changed the rating.',
  'basisNote': 'Every review here comes from a family that completed a booking with this tutor.',
  'showBreakdown': 'Show what the review says, dimension by dimension',
  'hideBreakdown': 'Hide the breakdown',
  'notAnalysed': 'This review has not been analysed. It is shown as written.',
  'emptyTitle': 'No reviews yet',
  'emptyBody': 'A review can only be left by a family that completed a booking, so a new tutor has none.',
  'noCompetencyYet': 'No topic assessments have been taken yet.',
  'dimension': {
    'punctuality': 'Punctuality', 'teaching_quality': 'Teaching quality',
    'syllabus_command': 'Command of the syllabus', 'confidence_change': 'Change in confidence',
    'communication': 'Communication', 'pace': 'Pace', 'consistency': 'Consistency',
    'value_for_money': 'Value for money',
  },
 },
 'ranking': {
  'title': 'How this position was calculated',
  'deterministicNote': 'This explains a calculation, not an opinion. The same search always produces the same order, and every figure below comes from stored data.',
  'narrationUnavailable': 'The written explanation is unavailable at the moment. The calculation itself is below and is unaffected.',
  'showBreakdown': 'Show the figures', 'hideBreakdown': 'Hide the figures',
  'breakdownCaption': 'What contributed to this position',
  'contribution': 'Contribution',
  'breakdownNote': 'Ustaad.com never introduces a number into the explanation that is not in this table.',
  'factor': {
    'heading': 'Factor', 'topicCoverage': 'Assessed on the topics you searched for',
    'reviewCredibility': 'Detail and credibility of reviews', 'reliability': 'Reliability record',
    'verificationRecency': 'How recently verification was checked',
    'ratePosition': 'Rate against the local median', 'proximity': 'Distance from your area',
    'other': 'Other factor',
  },
 },
 'share': {
  'title': 'Share this profile',
  'whatsapp': 'Send on WhatsApp', 'copyLink': 'Copy the link', 'copied': 'Link copied',
  'print': 'Print this code',
  'message': 'Have a look at {{name}} on Ustaad.com — her identity has been verified by the platform.',
  'note': 'Anyone with this link can see the profile. Nothing private is shared.',
  'qrFailed': 'The code could not be drawn. The link below still works.',
 },
 'booking': {
  'title': 'Book a session',
  'from': 'from {{amount}}',
  'paymentNote': 'Ustaad.com records what you agree. It does not take the payment — that is between you and the tutor.',
  'single': {
    'title': 'One session',
    'body': 'One hour on a specific topic, at a time you both agree.',
    'for': 'For a chapter that is not going in, or the week before an exam.',
  },
  'package': {
    'title': 'A short package',
    'body': 'A set number of sessions over a few weeks, agreed in advance.',
    'for': 'For exam preparation, or a term that has gone off track.',
  },
  'monthly': {
    'title': 'Monthly',
    'body': 'A regular weekly arrangement, billed by the month.',
    'for': 'For steady work through a school year.',
  },
  'action': {
    'single_session': 'Book one session', 'short_term_package': 'Book a package',
    'monthly': 'Start monthly',
  },
 },
 'profile': {
  'areaOnlyNote': 'Public profiles show the area only. A tutor sees an exact address after she confirms a booking, and nobody else ever does.',
  'backToSearch': 'Back to search',
 },
}

UR = {
 'reliability': {
  'title': 'بھروسہ مندی', 'basedOn_one': '{{count}} مکمل معاہدے سے',
  'basedOn_other': '{{count}} مکمل معاہدوں سے',
  'confirmation': 'بکنگ قبول کرتی ہیں', 'onTime': 'وقت پر پہنچتی ہیں', 'completion': 'معاہدے مکمل کرتی ہیں',
  'confirmationExplain': 'وہ کتنی بار ایسی درخواست قبول کرتی ہیں جو ان کی پیشکش سے میل کھاتی ہو۔',
  'onTimeExplain': 'خاندانوں کی اطلاع کے مطابق نشستیں کتنی بار طے شدہ وقت پر شروع ہوئیں۔',
  'completionExplain': 'انتظام کتنی بار اپنے طے شدہ اختتام تک چلا، جلد ختم ہونے کے بجائے۔',
  'measure': 'پیمانہ', 'value': 'قدر',
  'tooFewSessions': 'قابلِ بھروسہ اعداد دکھانے کے لیے ابھی کافی مکمل معاہدے نہیں۔ {{count}} سے کم پر فیصد استاد کے بارے میں کم اور کم تعداد کے بارے میں زیادہ بتاتے ہیں۔',
  'safetyExclusion': 'اپنی مقرر کردہ حفاظتی شرائط کی بنیاد پر ان کے انکار ان اعداد میں شامل نہیں۔ اپنی مقرر کردہ شرائط پر قائم رہنے پر استاد کو کبھی نقصان نہیں ہوتا۔',
 },
 'reviews': {
  'title_one': '{{count}} تبصرہ', 'title_other': '{{count}} تبصرے',
  'starsLabel': '5 میں سے {{rating}}',
  'sessionsWith_one': 'اس استاد کے ساتھ {{count}} نشست', 'sessionsWith_other': 'اس استاد کے ساتھ {{count}} نشستیں',
  'lowSignal': 'کم تفصیل',
  'lowSignalExplain': 'یہ تبصرہ اس بارے میں کم بتاتا ہے کہ اصل میں کیا ہوا، اس لیے درجہ بندی میں اس کا وزن کم ہے۔ یہ پورا دکھایا جا رہا ہے کیونکہ لکھنے والے نے یہ سچ مچ لکھا ہے۔',
  'lowSignalNote_one': 'ایک تبصرے میں کم تفصیل ہے اور اسے نشان زد کیا گیا ہے۔ یہ دکھایا جا رہا ہے، چھپایا نہیں گیا۔',
  'lowSignalNote_other': '{{count}} تبصروں میں کم تفصیل ہے اور انہیں نشان زد کیا گیا ہے۔ یہ دکھائے جا رہے ہیں، چھپائے نہیں گئے۔',
  'contradiction': 'درجہ بندی اور الفاظ مختلف ہیں',
  'contradictionExplain': 'ستاروں کی درجہ بندی اور لکھا ہوا تبصرہ الگ سمت میں اشارہ کرتے ہیں۔ دونوں بالکل ویسے ہی دکھائے جا رہے ہیں جیسے لکھنے والے نے چھوڑے — ہم نے درجہ بندی تبدیل نہیں کی۔',
  'basisNote': 'یہاں ہر تبصرہ ایسے خاندان کا ہے جس نے اس استاد کے ساتھ بکنگ مکمل کی۔',
  'showBreakdown': 'تبصرہ پہلو بہ پہلو دیکھیں',
  'hideBreakdown': 'تفصیل چھپائیں',
  'notAnalysed': 'اس تبصرے کا تجزیہ نہیں ہوا۔ یہ جیسا لکھا گیا ویسا دکھایا جا رہا ہے۔',
  'emptyTitle': 'ابھی کوئی تبصرہ نہیں',
  'emptyBody': 'تبصرہ صرف وہی خاندان چھوڑ سکتا ہے جس نے بکنگ مکمل کی ہو، اس لیے نئے استاد کے پاس کوئی نہیں ہوتا۔',
  'noCompetencyYet': 'ابھی کسی موضوع کی جانچ نہیں دی گئی۔',
  'dimension': {
    'punctuality': 'وقت کی پابندی', 'teaching_quality': 'پڑھانے کا معیار',
    'syllabus_command': 'نصاب پر عبور', 'confidence_change': 'اعتماد میں تبدیلی',
    'communication': 'رابطہ', 'pace': 'رفتار', 'consistency': 'تسلسل',
    'value_for_money': 'پیسے کی قدر',
  },
 },
 'ranking': {
  'title': 'یہ درجہ کیسے نکالا گیا',
  'deterministicNote': 'یہ ایک حساب کی وضاحت ہے، رائے کی نہیں۔ ایک ہی تلاش ہمیشہ ایک ہی ترتیب دیتی ہے، اور نیچے کا ہر عدد محفوظ شدہ معلومات سے آتا ہے۔',
  'narrationUnavailable': 'تحریری وضاحت اس وقت دستیاب نہیں۔ حساب خود نیچے موجود ہے اور اس پر کوئی اثر نہیں پڑا۔',
  'showBreakdown': 'اعداد دیکھیں', 'hideBreakdown': 'اعداد چھپائیں',
  'breakdownCaption': 'اس درجے میں کس چیز کا حصہ ہے',
  'contribution': 'حصہ',
  'breakdownNote': 'Ustaad.com وضاحت میں کبھی ایسا عدد شامل نہیں کرتا جو اس جدول میں موجود نہ ہو۔',
  'factor': {
    'heading': 'عنصر', 'topicCoverage': 'آپ کے تلاش کردہ موضوعات پر جانچ',
    'reviewCredibility': 'تبصروں کی تفصیل اور اعتبار', 'reliability': 'بھروسہ مندی کا ریکارڈ',
    'verificationRecency': 'تصدیق کتنی حال ہی میں ہوئی',
    'ratePosition': 'مقامی اوسط کے مقابلے میں فیس', 'proximity': 'آپ کے علاقے سے فاصلہ',
    'other': 'دیگر عنصر',
  },
 },
 'share': {
  'title': 'یہ پروفائل شیئر کریں',
  'whatsapp': 'واٹس ایپ پر بھیجیں', 'copyLink': 'لنک کاپی کریں', 'copied': 'لنک کاپی ہو گیا',
  'print': 'یہ کوڈ پرنٹ کریں',
  'message': 'Ustaad.com پر {{name}} کو دیکھیں — پلیٹ فارم نے ان کی شناخت کی تصدیق کی ہے۔',
  'note': 'یہ لنک رکھنے والا کوئی بھی پروفائل دیکھ سکتا ہے۔ کوئی نجی معلومات شیئر نہیں ہوتی۔',
  'qrFailed': 'کوڈ نہیں بن سکا۔ نیچے دیا گیا لنک اب بھی کام کرتا ہے۔',
 },
 'booking': {
  'title': 'نشست بک کریں',
  'from': '{{amount}} سے',
  'paymentNote': 'Ustaad.com صرف یہ ریکارڈ رکھتا ہے کہ آپ نے کیا طے کیا۔ یہ رقم وصول نہیں کرتا — وہ آپ کے اور استاد کے درمیان ہے۔',
  'single': {
    'title': 'ایک نشست',
    'body': 'کسی مخصوص موضوع پر ایک گھنٹہ، ایسے وقت پر جس پر آپ دونوں متفق ہوں۔',
    'for': 'ایسے باب کے لیے جو سمجھ نہیں آ رہا، یا امتحان سے ایک ہفتہ پہلے۔',
  },
  'package': {
    'title': 'مختصر پیکج',
    'body': 'چند ہفتوں میں مقررہ تعداد میں نشستیں، پہلے سے طے شدہ۔',
    'for': 'امتحان کی تیاری کے لیے، یا ایسے ٹرم کے لیے جو پٹری سے اتر گیا ہو۔',
  },
  'monthly': {
    'title': 'ماہانہ',
    'body': 'باقاعدہ ہفتہ وار انتظام، ماہانہ فیس پر۔',
    'for': 'پورے تعلیمی سال میں مستقل کام کے لیے۔',
  },
  'action': {
    'single_session': 'ایک نشست بک کریں', 'short_term_package': 'پیکج بک کریں',
    'monthly': 'ماہانہ شروع کریں',
  },
 },
 'profile': {
  'areaOnlyNote': 'عوامی پروفائل صرف علاقہ دکھاتے ہیں۔ استاد کو بکنگ کی تصدیق کے بعد مکمل پتہ ملتا ہے، اور کسی اور کو کبھی نہیں۔',
  'backToSearch': 'تلاش پر واپس',
 },
}

def deep_update(target, extra):
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            deep_update(target[key], value)
        else:
            target[key] = value

for lang, extra in (('en', EN), ('ur', UR)):
    path = 'src/locales/%s/search.json' % lang
    data = rj(path)
    deep_update(data, extra)
    wj(path, data)

print('profile locale keys and route written')
