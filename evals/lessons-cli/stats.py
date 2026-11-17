"""Summarize metrics.json and grades.json per task and arm: median, range, exact Mann-Whitney p.

  python3 stats.py   writes summary.json beside the run state and prints a table
"""
import itertools, json, statistics
from pathlib import Path

STATE = Path.home() / '.agents/state/pstack/create-fun-lessons/lessons-cli-eval'


def mann_whitney_p(a, b):
    """Exact two-sided p for the U statistic, ties counted as half."""
    def u(x, y):
        return sum((xi > yi) + 0.5 * (xi == yi) for xi in x for yi in y)
    pooled, n = a + b, len(a)
    obs = abs(u(a, b) - len(a) * len(b) / 2)
    combos = list(itertools.combinations(range(len(pooled)), n))
    hits = 0
    for idx in combos:
        x = [pooled[i] for i in idx]
        y = [pooled[i] for i in range(len(pooled)) if i not in idx]
        hits += abs(u(x, y) - len(x) * len(y) / 2) >= obs - 1e-9
    return hits / len(combos)


METRICS = {
    'tokens_in_total': lambda m, g: m['tokens_in_total'],
    'cache_read': lambda m, g: m['tokens']['cacheReadInputTokens'],
    'cache_write': lambda m, g: m['tokens']['cacheCreationInputTokens'],
    'output_tokens': lambda m, g: m['tokens']['outputTokens'],
    'tool_calls': lambda m, g: m['tool_calls'],
    'assistant_messages': lambda m, g: m['assistant_messages'],
    'wall_min': lambda m, g: round(m['wall_s'] / 60, 1),
    'checker_runs': lambda m, g: m['checker_runs'],
    'checker_failed': lambda m, g: m['checker_failed'],
    'cost_list_usd': lambda m, g: m['cost_list_usd'],
    'final_common_ok': lambda m, g: int(bool(g.get('common', {}).get('ok'))),
    'final_ok_ignoring_width': lambda m, g: int(bool(g.get('common', {}).get('okIgnoringWidth'))),
    'final_problems': lambda m, g: g.get('common', {}).get('problems', 0),
    'final_width_problems': lambda m, g: g.get('common', {}).get('width', 0),
    'cards': lambda m, g: g.get('shape', {}).get('cards', 0),
    'lessons': lambda m, g: g.get('shape', {}).get('lessons', 0),
    'helpers_written': lambda m, g: len(m['helpers_written']),
    'revise_all_done': lambda m, g: int(bool(g.get('revise', {}).get('allDone'))) if 'revise' in g else None,
    'collateral_lessons': lambda m, g: len(g.get('revise', {}).get('collateralLessons', [])) if 'revise' in g else None,
    'quality_mean': lambda m, g: g.get('quality'),
}


def main():
    ms = json.loads((STATE / 'metrics.json').read_text())
    gs = {g['slug']: g for g in json.loads((STATE / 'grades.json').read_text())}
    out = {}
    for task in ('build', 'revise'):
        rows = [m for m in ms if m['task'] == task]
        if not rows:
            continue
        out[task] = {}
        for name, f in METRICS.items():
            per = {arm: [f(m, gs.get(m['slug'], {})) for m in rows if m['arm'] == arm] for arm in ('old', 'new')}
            per = {k: [x for x in v if x is not None] for k, v in per.items()}
            if not per['old'] or not per['new']:
                continue
            out[task][name] = {
                arm: {'values': v, 'median': statistics.median(v), 'min': min(v), 'max': max(v)} for arm, v in per.items()
            }
            out[task][name]['p'] = round(mann_whitney_p(per['old'], per['new']), 3)
            o, n = out[task][name]['old']['median'], out[task][name]['new']['median']
            out[task][name]['ratio_new_over_old'] = round(n / o, 2) if o else None
    (STATE / 'summary.json').write_text(json.dumps(out, indent=1))
    for task, t in out.items():
        print(f'== {task}')
        for name, s in t.items():
            print(f"{name:26} old {s['old']['median']:>10} [{s['old']['min']}–{s['old']['max']}]  new {s['new']['median']:>10} [{s['new']['min']}–{s['new']['max']}]  p={s['p']}  new/old={s['ratio_new_over_old']}")


if __name__ == '__main__':
    main()
