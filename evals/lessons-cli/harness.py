"""Set up, run, and measure candidate runs for the lessons.mjs eval (see PLAN.md).

  python3 harness.py setup <old|new> <build|revise>   prints the new run's slug
  python3 harness.py run <slug> [<slug> ...]          runs them in parallel, waits
  python3 harness.py metrics                          writes metrics.json for every finished run
"""
import json, os, random, re, shutil, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
STATE = Path.home() / '.agents/state/pstack/create-fun-lessons/lessons-cli-eval'
WORK = Path.home() / 'work-ky'
KY_SRC = WORK / 'ky-src'
KY_COMMIT = '3541888878c4d303a8bc2ad61815f4e048f55a5d'
SKILL_COMMIT = {'old': 'c4f17c3', 'new': '566c86e'}
MODEL, EFFORT = 'claude-opus-5-5', 'high'
LIMIT_S = {'build': 90 * 60, 'revise': 40 * 60}
RUNS = STATE / 'runs.tsv'
WORDS = 'ash birch cedar elm fern hazel ivy juniper larch maple oak pine rowan sage teak willow'.split()


def sh(*args, **kw):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kw).stdout


def registry():
    if not RUNS.exists():
        return {}
    rows = [l.split('\t') for l in RUNS.read_text().splitlines() if l.strip()]
    return {r[0]: {'arm': r[1], 'task': r[2]} for r in rows}


def skill_copy(arm, dest):
    p =subprocess.run(['git', '-C', str(REPO), 'archive', SKILL_COMMIT[arm], 'skills/create-fun-lessons'], check=True, capture_output=True)
    dest.mkdir(parents=True, exist_ok=True)
    subprocess.run(['tar', '-x', '-C', str(dest)], input=p.stdout, check=True)


def setup(arm, task):
    taken = registry()
    while True:
        slug = f'{random.choice(WORDS)}-{random.randint(10, 99)}'
        if slug not in taken and not (WORK / slug).exists():
            break
    ws = WORK / slug
    ws.mkdir(parents=True)
    sh('git', 'clone', '-q', str(KY_SRC), str(ws / 'ky'))
    sh('git', '-C', str(ws / 'ky'), 'checkout', '-q', KY_COMMIT)
    skill_copy(arm, ws)
    if task == 'revise':
        seed = STATE / 'seed' / arm / 'ky-course'
        shutil.copytree(seed, ws / 'ky-course')
    (STATE / 'runs' / slug).mkdir(parents=True, exist_ok=True)
    with RUNS.open('a') as f:
        f.write(f'{slug}\t{arm}\t{task}\n')
    print(slug)


def run(slugs):
    reg = registry()
    procs = []
    for slug in slugs:
        task = reg[slug]['task']
        out = STATE / 'runs' / slug
        prompt = (HERE / 'prompts' / f'{task}.md').read_text()
        cmd = ['timeout', str(LIMIT_S[task]), 'claude', '-p', prompt, '--model', MODEL, '--effort', EFFORT,
               '--permission-mode', 'auto', '--disallowedTools', 'Skill', '--strict-mcp-config',
               '--max-budget-usd', '60', '--output-format', 'stream-json', '--verbose']
        (out / 'started').write_text(str(time.time()))
        procs.append((slug, subprocess.Popen(cmd, cwd=WORK / slug, stdout=(out / 'log.jsonl').open('w'),
                                             stderr=(out / 'stderr.txt').open('w'), stdin=subprocess.DEVNULL)))
        time.sleep(5)
    for slug, p in procs:
        code = p.wait()
        (STATE / 'runs' / slug / 'exit').write_text(str(code))
        print(slug, 'exit', code, flush=True)


CHECKER = re.compile(r'check\.mjs|lessons\.mjs\s+(check|build)\b')
SCRIPT_EXT = re.compile(r'\.(mjs|js|cjs|py|sh)$')


def result_text(block):
    c = block.get('content')
    if isinstance(c, list):
        return '\n'.join(x.get('text', '') for x in c if isinstance(x, dict))
    return c or ''


def failure_kinds(text):
    kinds = set()
    for line in text.splitlines():
        l = line.lower()
        if not l.strip().startswith(('-', 'lessons/', 'syllabus', 'lesson ', 'unit ', 'course', 'script', 'content')) and ':' not in l:
            continue
        if 'syllabus' in l or 'in no row' in l or '--repo' in l:
            kinds.add('syllabus')
        elif 'does not parse' in l or 'throws' in l or 'unexpected token' in l or 'never closed' in l:
            kinds.add('parse')
        elif 'column' in l or 'too wide' in l or 'wide' in l:
            kinds.add('width')
        elif re.search(r'(card|lesson|unit|course|glossary|lang|storagekey)', l):
            kinds.add('field')
    return sorted(kinds)


def measure(slug, arm, task):
    out = STATE / 'runs' / slug
    events = [json.loads(l) for l in (out / 'log.jsonl').read_text().splitlines() if l.startswith('{')]
    result = next((e for e in reversed(events) if e.get('type') == 'result'), None)
    uses, results = {}, {}
    turns = set()
    for e in events:
        msg = e.get('message') or {}
        if e.get('type') == 'assistant':
            turns.add(msg.get('id'))
            for b in msg.get('content') or []:
                if b.get('type') == 'tool_use':
                    uses[b['id']] = {'name': b['name'], 'input': b.get('input', {}), 'sub': bool(e.get('parent_tool_use_id'))}
        if e.get('type') == 'user':
            for b in msg.get('content') or [] if isinstance(msg.get('content'), list) else []:
                if b.get('type') == 'tool_result':
                    results[b['tool_use_id']] = {'text': result_text(b), 'error': bool(b.get('is_error'))}
    checks = []
    for uid, u in uses.items():
        cmd = u['input'].get('command', '') if u['name'] in ('Bash', 'Monitor') else ''
        if not CHECKER.search(cmd) or re.match(r'\s*(cat|sed|head|grep|less|rg)\b', cmd):
            continue
        r = results.get(uid, {'text': '', 'error': True})
        ok = bool(re.search(r'^\s*OK:', r['text'], re.M)) and not re.search(r'problem\(s\)', r['text'])
        checks.append({'ok': ok, 'kinds': [] if ok else failure_kinds(r['text']), 'cmd': cmd[:200], 'background': bool(u['input'].get('run_in_background'))})
    written = sorted({u['input'].get('file_path', '') for u in uses.values() if u['name'] == 'Write'})
    helpers = [p for p in written if SCRIPT_EXT.search(p)]
    bash_scripts = [u['input'].get('command', '')[:120] for u in uses.values()
                    if u['name'] == 'Bash' and re.search(r"cat\s*>\s*\S+\.(mjs|js|py|sh)|<<\s*'?\w+'?\s*>\s*\S+\.(mjs|js|py|sh)", u['input'].get('command', ''))]
    reads = [u['input'].get('file_path', '') for u in uses.values() if u['name'] == 'Read']
    outside = [p for p in reads if p and not p.startswith(str(WORK / slug))]
    mu = (result or {}).get('modelUsage', {})
    tok = {k: sum(m.get(k, 0) for m in mu.values()) for k in ('inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens')}
    names = {}
    for u in uses.values():
        names[u['name']] = names.get(u['name'], 0) + 1
    m = {
        'slug': slug, 'arm': arm, 'task': task,
        'exit': (out / 'exit').read_text().strip() if (out / 'exit').exists() else None,
        'subtype': (result or {}).get('subtype'), 'is_error': (result or {}).get('is_error'),
        'wall_s': round((result or {}).get('duration_ms', 0) / 1000),
        'cost_list_usd': round((result or {}).get('total_cost_usd', 0), 2),
        'num_turns': (result or {}).get('num_turns'), 'assistant_messages': len(turns),
        'subagents': ((result or {}).get('subagent_stats') or {}).get('spawned', 0),
        'tokens': tok, 'tokens_in_total': tok['inputTokens'] + tok['cacheReadInputTokens'] + tok['cacheCreationInputTokens'],
        'tool_calls': len(uses), 'tool_calls_sub': sum(u['sub'] for u in uses.values()), 'tools': names,
        'checker_runs': len(checks), 'checker_failed': sum(not c['ok'] for c in checks),
        'failure_kinds': sorted({k for c in checks for k in c['kinds']}), 'checks': checks,
        'helpers_written': helpers + bash_scripts, 'reads_outside_workspace': outside,
        'permission_denials': len((result or {}).get('permission_denials') or []),
    }
    (out / 'metrics.json').write_text(json.dumps(m, indent=1))
    return m


def metrics():
    allm = []
    for slug, r in registry().items():
        if (STATE / 'runs' / slug / 'exit').exists():
            allm.append(measure(slug, r['arm'], r['task']))
    (STATE / 'metrics.json').write_text(json.dumps(allm, indent=1))
    for m in allm:
        print(m['slug'], m['arm'], m['task'], m['subtype'], 'wall', m['wall_s'], 'tools', m['tool_calls'],
              'checks', m['checker_runs'], 'failed', m['checker_failed'], 'out', m['tokens']['outputTokens'], 'list$', m['cost_list_usd'])


if __name__ == '__main__':
    cmd, *rest = sys.argv[1:]
    {'setup': lambda: setup(*rest), 'run': lambda: run(rest), 'metrics': metrics}[cmd]()
