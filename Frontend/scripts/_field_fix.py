# -*- coding: utf-8 -*-
"""Convert the Field usages written as plain children into its render-prop form."""
import io, os, re

base = os.path.join(os.path.dirname(__file__), '..')

FIXES = {
 'src/components/booking/SafetyAndDisclosure.jsx': [
  ("""              <Field error={error} htmlFor="guardian-ack">
                <Checkbox
                  id="guardian-ack"
                  checked={acknowledged}
                  onChange={(event) => onAcknowledge?.(event.target.checked)}
                  label={t('safety.acknowledgeLabel')}
                  hint={t('safety.acknowledgeHint')}
                />
              </Field>""",
   """              {/*
                `Field` only for the error slot — the checkbox carries its own
                label and hint, and a second visible label above a checkbox
                reads as two separate questions.
              */}
              {error ? (
                <p role="alert" className="mb-1 text-caption font-medium text-flag">
                  {error}
                </p>
              ) : null}
              <Checkbox
                id="guardian-ack"
                checked={acknowledged}
                onChange={(event) => onAcknowledge?.(event.target.checked)}
                label={t('safety.acknowledgeLabel')}
                hint={t('safety.acknowledgeHint')}
              />"""),
 ],
}

for path, pairs in FIXES.items():
    full = os.path.join(base, path)
    s = io.open(full, encoding='utf-8').read()
    for old, new in pairs:
        assert old in s, path
        s = s.replace(old, new)
    io.open(full, 'w', encoding='utf-8').write(s)

# Field import is now unused in SafetyAndDisclosure.
p = os.path.join(base, 'src/components/booking/SafetyAndDisclosure.jsx')
s = io.open(p, encoding='utf-8').read()
s = s.replace("import { Checkbox, Field } from '../ui/Field';", "import { Checkbox } from '../ui/Field';")
io.open(p, 'w', encoding='utf-8').write(s)


def render_prop(source):
    """Rewrite `<Field ...>\\n  <X ... />\\n</Field>` into the render-prop form."""
    pattern = re.compile(
        r'(?P<indent>[ ]*)<Field\b(?P<attrs>[^>]*?)>\n'
        r'(?P<body>(?:[ ]*<(?P<tag>Input|Select|Textarea)\b[\s\S]*?(?:/>|</(?P=tag)>))\n)'
        r'(?P=indent)</Field>',
    )

    def replace(match):
        indent = match.group('indent')
        body = match.group('body').rstrip('\n')
        # Re-indent the control two levels deeper, inside the arrow function.
        shifted = '\n'.join(('  ' + line) if line.strip() else line for line in body.split('\n'))
        # Thread the accessibility props Field computes onto the control.
        shifted = re.sub(r'(<(?:Input|Select|Textarea)\b)', r'\1 {...props}', shifted, count=1)
        return (
            f"{indent}<Field{match.group('attrs')}>\n"
            f"{indent}  {{(props) => (\n"
            f"{shifted}\n"
            f"{indent}  )}}\n"
            f"{indent}</Field>"
        )

    return pattern.sub(replace, source)


for path in ('src/pages/book/BookTutor.jsx',
             'src/components/payments/DisputeForm.jsx',
             'src/components/booking/FitCheck.jsx',
             'src/components/booking/BookingActions.jsx'):
    full = os.path.join(base, path)
    s = io.open(full, encoding='utf-8').read()
    out = render_prop(s)
    io.open(full, 'w', encoding='utf-8').write(out)
    print(path, 'rewritten' if out != s else 'unchanged')
