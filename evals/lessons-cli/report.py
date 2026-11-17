"""Write the eval report as one HTML page from summary.json, metrics.json, grades.json and judges/.

  python3 report.py <out.html>
"""
import html, json, statistics, sys
from pathlib import Path

STATE = Path.home() / '.agents/state/pstack/create-fun-lessons/lessons-cli-eval'
HERE = Path(__file__).resolve().parent

LABEL = {
    'tokens_in_total': ('Input tokens, cache included', 'tokens'),
    'cache_read': ('Cache reads', 'tokens'),
    'cache_write': ('Cache writes', 'tokens'),
    'output_tokens': ('Output tokens', 'tokens'),
    'tool_calls': ('Tool calls', 'calls'),
    'assistant_messages': ('Round trips (assistant messages)', 'messages'),
    'wall_min': ('Wall time', 'minutes'),
    'checker_runs': ('Checker runs', 'runs'),
    'checker_failed': ('Failed checker runs', 'runs'),
    'cost_list_usd': ('Size at API list price', 'list $'),
    'final_common_ok': ('Final page passes the current checker', '1 = yes'),
    'final_ok_ignoring_width': ('Passes, ignoring the width rule', '1 = yes'),
    'final_width_problems': ('Code lines wider than a phone', 'lines'),
    'garbled_spans': ('Strings with a garbled code span', 'strings'),
    'leaked_markers': ('Strings with raw « » highlight markers', 'strings'),
    'cards': ('Cards', 'cards'),
    'lessons': ('Lessons', 'lessons'),
    'helpers_written': ('Helper scripts written', 'scripts'),
    'revise_all_done': ('All three requested changes done', '1 = yes'),
    'collateral_lessons': ('Lessons changed outside the request', 'lessons'),
    'quality_mean': ('Blind quality, mean of both judges', '1 to 5'),
}

LIMITS = {
    'tokens_in_total': 'Almost all cache reads. Each turn re-reads the whole context, so this grows with turns times context size, not with work done. A fixed system prompt of about 43k tokens sits under every turn in both arms.',
    'cache_read': 'Scales with round trips. The new flow writes one lesson file per call and checks once per unit, so it takes more turns, and every turn re-reads the cache.',
    'cache_write': 'New context entering the cache: files read and written once. Closest to the real reading and writing work.',
    'output_tokens': 'What the model wrote: the course text, plus reasoning. Both arms write about the same course, so this stays level.',
    'tool_calls': 'Includes browser click-through. The prompt says the user will click through the course themselves, yet every CLI build opened a browser (23 to 42 calls) and old-flow builds made 0 to 30. Without browser calls, CLI builds made 40 to 51 calls and old-flow builds 23 to 32.',
    'assistant_messages': 'One per model turn. Tracks tool calls, since most turns make one call.',
    'wall_min': 'Run 5 at a time on a shared Mac with other apps under load. API latency varies by the minute, so read differences under about 30% as noise.',
    'checker_runs': 'The new flow checks per unit by design. A higher count here is the workflow, not a sign of trouble.',
    'checker_failed': 'Not comparable across arms on builds. 21 of the new arm\'s 25 build failures are the 41-column width rule, which the old checker does not have. On revise every run\'s first check fails on the planted defects, by design.',
    'cost_list_usd': 'total_cost_usd from the headless result: API list price, a size measure. The user is on a subscription, so no money was spent per run.',
    'final_common_ok': 'Graded by the current checker for both arms. The old arm\'s checker has no width rule, so its builds cannot pass this. Read it with the next row.',
    'final_ok_ignoring_width': 'The fair cross-arm reliability measure: every other rule both checkers share.',
    'final_width_problems': 'Lines over 41 columns, which scroll sideways on a 400px phone. Only the new checker flags them.',
    'garbled_spans': 'A bug in lessons.mjs: a one-character inline code span such as `/` pairs with the wrong backtick, so code and prose swap. The checker passes these pages. The old arm writes HTML by hand and never goes through this parser; its one build hit is an error message that really contains backticks.',
    'leaked_markers': 'A second lessons.mjs gap: a «…» highlight is only applied within one line. When an agent wraps a highlighted line to meet the width rule, the raw markers reach the page. The checker does not flag them. The old arm has no markers.',
    'cards': 'Set by the skill\'s own sizing guidance, which both arms share.',
    'lessons': 'As for cards.',
    'helpers_written': 'Old-arm builds wrote a content.js and spliced it in with Python. New-arm builds needed no helper.',
    'revise_all_done': 'Insert at the right place, fix the fill card, wrap the named line, keep every lesson id and the storage key, and add the new lesson to the syllabus.',
    'collateral_lessons': 'Most collateral edits are agents fixing the garbled code spans in u2l1 that the seed inherited from the bug. These are fixes, not damage.',
    'quality_mean': 'Two blind judges from two model families, one pass each, scoring dumps without arm names. A judge pass is one sample; read differences under about 0.3 as noise.',
}

ORDER = ['quality_mean', 'final_ok_ignoring_width', 'final_common_ok', 'final_width_problems', 'garbled_spans', 'leaked_markers', 'revise_all_done', 'collateral_lessons',
         'tokens_in_total', 'cache_read', 'cache_write', 'output_tokens', 'tool_calls', 'assistant_messages', 'wall_min',
         'checker_runs', 'checker_failed', 'cost_list_usd', 'helpers_written', 'cards', 'lessons']


def fmt(v):
    if isinstance(v, float) and not v.is_integer():
        return f'{v:,.2f}'.rstrip('0').rstrip('.') if abs(v) < 100 else f'{v:,.0f}'
    v = int(v)
    if abs(v) >= 1_000_000:
        return f'{v / 1e6:.2f}M'
    if abs(v) >= 10_000:
        return f'{v / 1e3:.0f}k'
    return f'{v:,}'


def strip(old, new):
    lo, hi = min(old + new), max(old + new)
    span = (hi - lo) or 1
    x = lambda v: 8 + (v - lo) / span * 204
    dots = []
    for row, (arm, vals) in enumerate((('old', old), ('new', new))):
        y = 10 + row * 16
        seen = {}
        for v in vals:
            k = round(x(v))
            seen[k] = seen.get(k, 0) + 1
            dots.append(f'<circle class="d {arm}" cx="{x(v):.1f}" cy="{y + (seen[k] - 1) * 3 - (1.5 if seen[k] > 1 else 0):.1f}" r="4"/>')
    return (f'<svg class="strip" viewBox="0 0 220 36" role="img" aria-label="old {", ".join(map(fmt, old))}; new {", ".join(map(fmt, new))}">'
            f'<line x1="8" x2="212" y1="10" y2="10"/><line x1="8" x2="212" y1="26" y2="26"/>{"".join(dots)}</svg>')


def verdict(name, s):
    p, o, n = s['p'], s['old']['median'], s['new']['median']
    if p > 0.1 or o == n:
        return '<span class="tag even">no clear difference</span>'
    lower_better = name not in ('quality_mean', 'final_common_ok', 'final_ok_ignoring_width', 'revise_all_done', 'cards', 'lessons')
    new_wins = (n < o) == lower_better
    word = ('CLI better' if new_wins else 'CLI worse') if p <= 0.05 else ('leans CLI' if new_wins else 'leans old')
    return f'<span class="tag {"win" if new_wins else "loss"}">{word}</span>'


def table(task, summ):
    rows = []
    for name in ORDER:
        if name not in summ:
            continue
        s = summ[name]
        label, unit = LABEL[name]
        ratio = f'{s["ratio_new_over_old"]}×' if s.get('ratio_new_over_old') else ''
        rows.append(f'''<tr><th scope="row">{label}<small>{unit}</small></th>
<td class="num">{fmt(s["old"]["median"])}<small>{fmt(s["old"]["min"])} to {fmt(s["old"]["max"])}</small></td>
<td class="num">{fmt(s["new"]["median"])}<small>{fmt(s["new"]["min"])} to {fmt(s["new"]["max"])}</small></td>
<td class="num">{ratio}</td><td class="num">{s["p"]}</td><td>{verdict(name, s)}</td><td>{strip(s["old"]["values"], s["new"]["values"])}</td></tr>
<tr class="lim"><td colspan="7">{html.escape(LIMITS[name])}</td></tr>''')
    return f'''<div class="scroll"><table><thead><tr><th>Metric</th><th class="num">Without CLI<small>median, range</small></th><th class="num">With CLI<small>median, range</small></th>
<th class="num">new / old</th><th class="num">p</th><th>Read</th><th>Each run<small><span class="key old"></span>old <span class="key new"></span>new</small></th></tr></thead>
<tbody>{"".join(rows)}</tbody></table></div>'''


def runs_table(task, ms, gs):
    rows = []
    for m in sorted((m for m in ms if m['task'] == task), key=lambda m: (m['arm'] != 'old', m['slug'])):
        g = gs.get(m['slug'], {})
        checks = ''.join('·' if c['ok'] else '✕' for c in m['checks'])
        extra = ''
        if task == 'revise':
            r = g.get('revise', {})
            extra = f'<td>{"yes" if r.get("allDone") else "no"}</td><td>{", ".join(r.get("collateralLessons", [])) or "none"}</td>'
        q = g.get('qualityByJudge', {})
        rows.append(f'<tr><td>{m["slug"]}</td><td>{"with" if m["arm"] == "new" else "without"}</td><td class="num">{fmt(m["tokens_in_total"])}</td>'
                    f'<td class="num">{fmt(m["tokens"]["outputTokens"])}</td><td class="num">{m["tool_calls"]}</td><td class="num">{m["wall_s"] / 60:.1f}</td>'
                    f'<td class="mono">{checks}</td><td class="num">{g.get("common", {}).get("problems", "")}</td><td class="num">{g.get("garbledSpans", "")}</td><td class="num">{g.get("leakedMarkers", "")}</td>{extra}'
                    f'<td class="num">{" / ".join(f"{v:.1f}" for _, v in sorted(q.items())) or ""}</td></tr>')
    head_extra = '<th>All done</th><th>Collateral</th>' if task == 'revise' else ''
    return f'''<div class="scroll"><table class="runs"><thead><tr><th>Run</th><th>CLI</th><th class="num">Input</th><th class="num">Output</th><th class="num">Tools</th>
<th class="num">Min</th><th>Checks (· pass, ✕ fail)</th><th class="num">Final problems</th><th class="num">Garbled</th><th class="num">« »</th>{head_extra}<th class="num">Quality<small>judge 1 / 2</small></th></tr></thead>
<tbody>{"".join(rows)}</tbody></table></div>'''


def main(out):
    summary = json.loads((STATE / 'summary.json').read_text())
    ms = json.loads((STATE / 'metrics.json').read_text())
    gs = {g['slug']: g for g in json.loads((STATE / 'grades.json').read_text())}
    prose = json.loads((HERE / 'report_prose.json').read_text())
    total = sum(m['cost_list_usd'] for m in ms)
    page = (HERE / 'report.template.html').read_text()
    fill = {
        'BUILD_TABLE': table('build', summary['build']), 'REVISE_TABLE': table('revise', summary['revise']),
        'BUILD_RUNS': runs_table('build', ms, gs), 'REVISE_RUNS': runs_table('revise', ms, gs),
        'TOTAL_LIST': f'{total:.2f}', 'N_RUNS': str(len(ms)), **prose,
    }
    for k, v in fill.items():
        page = page.replace('{{' + k + '}}', v)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(page)
    embed = ('<style>:root{--bg:transparent;--fg:var(--foreground);--muted:var(--muted-foreground);--line:var(--border);'
             '--panel:var(--card);--code-bg:var(--code-background)}body{background:transparent;font-family:var(--font-sans)}'
             'main{padding:0 0 24px}</style></head>')
    Path(out).with_name('render.html').write_text(page.replace('</head>', embed, 1))
    print(out)


if __name__ == '__main__':
    main(sys.argv[1])
