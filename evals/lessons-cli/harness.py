"""Set up, run, measure, and judge candidate runs for the lessons.mjs eval (see PLAN.md).

  python3 harness.py setup <arm> <build|revise> [--subject <name>]   prints the new run's slug
  python3 harness.py run <slug> [<slug> ...]          runs them in parallel, waits
  python3 harness.py restore <slug> [<slug> ...]      rebuilds deleted workspaces by replaying their logs
  python3 harness.py metrics                          writes metrics.json for every finished run
  python3 harness.py grade                            writes grades.json for every finished run
  python3 harness.py arm <name> <commit> [<model>]    registers a hill-climb arm (see HILLCLIMB.md)
  python3 harness.py judge <packet> <armA> <armB> [--subject <name>]   blind packet of both arms' 5 builds, then both judges
  python3 harness.py judge <packet> --labels-from <earlier packet>   the same courses, dumped again
  python3 harness.py gap <packet>                     each course's mean score, each arm's, and the p
  python3 harness.py cards <arm> [<arm> ...]          card-defect counts per build run from grades.json
"""
import argparse, json, os, random, re, shlex, shutil, signal, statistics, subprocess, sys, time
from dataclasses import dataclass
from pathlib import Path

from stats import mann_whitney_p

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
STATE = Path(os.environ.get('LESSONS_EVAL_STATE', Path.home() / '.local/state/create-fun-lessons/lessons-cli-eval'))


@dataclass(frozen=True)
class Subject:
    name: str
    repo_url: str
    src: Path
    commit: str
    folder: str
    course: str
    prompts: dict
    rubric: str
    about: str
    sources: str

    @property
    def work(self):
        return self.src.parent


SUBJECTS = {s.name: s for s in (
    Subject('ky', 'https://github.com/sindresorhus/ky', Path.home() / 'work-ky/ky-src',
            '3541888878c4d303a8bc2ad61815f4e048f55a5d', 'ky', 'ky-course',
            {'build': 'build.md', 'revise': 'revise.md'}, 'rubric.md', 'the ky HTTP client', '`source/`, `readme.md`'),
    Subject('commander', 'https://github.com/tj/commander.js', Path.home() / 'work-commander/commander-src',
            'a5a7dc084d4d2b7932e85ca049c5204e50a2c721', 'commander', 'commander-course',
            {'build': 'build-commander.md'}, 'rubric-commander.md', 'the commander.js command-line parser',
            '`lib/`, `index.js`, `Readme.md`'),
)}
DEFAULT_SUBJECT = 'ky'
JUDGES = {'opus': 'claude-opus-5-5', 'sonnet': 'claude-sonnet-5-5'}
CRITERIA = ('accuracy', 'coverage', 'depth', 'craft', 'coherence')
GRADER = STATE / 'grader/skills/create-fun-lessons'
SKILL_COMMIT = {'old': 'c4f17c3', 'new': '566c86e'}
ARMS = STATE / 'arms.json'


def arm_spec(arm):
    """old and new are the eval's arms; a hill-climb arm maps to its candidate commit in arms.json, as
    "commit" or "commit model" when the arm also changes the builder's model."""
    extra = json.loads(ARMS.read_text()) if ARMS.exists() else {}
    commit, *model = {**SKILL_COMMIT, **extra}[arm].split()
    return commit, (model[0] if model else MODEL)


def commit_of(arm):
    return arm_spec(arm)[0]


def flow(arm):
    return 'old' if arm == 'old' else 'new'
MODEL, EFFORT = 'claude-opus-5-5', 'high'
LIMIT_S = {'build': 90 * 60, 'revise': 40 * 60, 'judge': 90 * 60}
CLAUDE_FLAGS = ['--effort', EFFORT, '--permission-mode', 'auto', '--disallowedTools', 'Skill', '--strict-mcp-config',
                '--max-budget-usd', '60', '--output-format', 'stream-json', '--verbose']
RUNS = STATE / 'runs.tsv'
WORDS = 'ash birch cedar elm fern hazel ivy juniper larch maple oak pine rowan sage teak willow'.split()


def sh(*args, **kw):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kw).stdout


def registry():
    if not RUNS.exists():
        return {}
    rows = [l.split('\t') for l in RUNS.read_text().splitlines() if l.strip()]
    # Rows written before the second subject have no subject column.
    return {r[0]: {'arm': r[1], 'task': r[2], 'subject': SUBJECTS[r[3] if len(r) > 3 else DEFAULT_SUBJECT]} for r in rows}


def workspace(slug, reg=None):
    return (reg or registry())[slug]['subject'].work / slug


def ensure_src(subject):
    if not subject.src.exists():
        subject.src.parent.mkdir(parents=True, exist_ok=True)
        sh('git', 'clone', '-q', subject.repo_url, str(subject.src))
    if subprocess.run(['git', '-C', str(subject.src), 'cat-file', '-e', f'{subject.commit}^{{commit}}'], capture_output=True).returncode:
        sh('git', '-C', str(subject.src), 'fetch', '-q', 'origin')


def checkout(subject, dest):
    ensure_src(subject)
    sh('git', 'clone', '-q', str(subject.src), str(dest))
    sh('git', '-C', str(dest), 'checkout', '-q', subject.commit)
    # Without this, git ls-files quotes non-ASCII paths ("docs/zh-CN/...), and the checkers' trackedDirs
    # reads a top-level directory named "docs that no Sources cell can name. A no-op for ky.
    sh('git', '-C', str(dest), 'config', 'core.quotePath', 'false')


def skill_copy(arm, dest):
    p =subprocess.run(['git', '-C', str(REPO), 'archive', commit_of(arm), 'skills/create-fun-lessons'], check=True, capture_output=True)
    dest.mkdir(parents=True, exist_ok=True)
    subprocess.run(['tar', '-x', '-C', str(dest)], input=p.stdout, check=True)


def populate(ws, arm, task, subj):
    ws.mkdir(parents=True)
    checkout(subj, ws / subj.folder)
    skill_copy(arm, ws)
    if task == 'revise':
        shutil.copytree(STATE / 'seed' / flow(arm) / subj.course, ws / subj.course)


def setup(arm, task, subject=DEFAULT_SUBJECT):
    subj = SUBJECTS[subject]
    if task not in subj.prompts:
        sys.exit(f'{subject} has no {task} prompt')
    commit_of(arm)
    taken = registry()
    while True:
        slug = f'{random.choice(WORDS)}-{random.randint(10, 99)}'
        if slug not in taken and not (subj.work / slug).exists():
            break
    populate(subj.work / slug, arm, task, subj)
    (STATE / 'runs' / slug).mkdir(parents=True, exist_ok=True)
    with RUNS.open('a') as f:
        f.write(f'{slug}\t{arm}\t{task}\t{subject}\n')
    print(slug)


def restore(slugs):
    reg = registry()
    for slug in slugs:
        r, ws = reg[slug], workspace(slug, reg)
        if ws.exists():
            sys.exit(f'{ws} exists')
        populate(ws, r['arm'], r['task'], r['subject'])
        cwd, cwd_file, n = ws, ws / '.restore-cwd', 0
        for line in (STATE / 'runs' / slug / 'log.jsonl').open():
            o = json.loads(line)
            for b in o.get('message', {}).get('content', []) if o.get('type') == 'assistant' else []:
                i = b.get('input', {}) if b.get('type') == 'tool_use' else None
                if i is None:
                    continue
                if b['name'] == 'Write':
                    Path(i['file_path']).parent.mkdir(parents=True, exist_ok=True)
                    Path(i['file_path']).write_text(i['content'])
                elif b['name'] in ('Edit', 'MultiEdit'):
                    f = Path(i['file_path'])
                    text = f.read_text() if f.exists() else ''
                    for e in i.get('edits', [i]):
                        if e['old_string'] in text:
                            text = text.replace(e['old_string'], e['new_string'], -1 if e.get('replace_all') else 1)
                    f.write_text(text)
                elif b['name'] == 'Bash':
                    cwd_file.unlink(missing_ok=True)
                    script = f'cd {shlex.quote(str(cwd))}\n{i["command"]}\nstatus=$?; pwd > {shlex.quote(str(cwd_file))}; exit $status'
                    p = subprocess.Popen(['bash', '-c', script], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                         stderr=subprocess.DEVNULL, start_new_session=True)
                    try:
                        ok = p.wait(timeout=300) == 0
                    except subprocess.TimeoutExpired:
                        os.killpg(p.pid, signal.SIGKILL)
                        p.wait()
                        ok = False
                    # Claude Code keeps a cd only from a command that succeeded and only inside the working
                    # directory; otherwise the next command starts where this one did, or back in the workspace.
                    if ok and cwd_file.exists():
                        moved = Path(cwd_file.read_text().strip())
                        cwd = moved if moved.is_relative_to(ws) else ws
                else:
                    continue
                n += 1
        cwd_file.unlink(missing_ok=True)
        print(slug, 'replayed', n, 'calls into', ws)


def run(slugs):
    reg = registry()
    procs = []
    for slug in slugs:
        task = reg[slug]['task']
        out = STATE / 'runs' / slug
        prompt = (HERE / 'prompts' / reg[slug]['subject'].prompts[task]).read_text()
        cmd = ['timeout', str(LIMIT_S[task]), 'claude', '-p', prompt, '--model', arm_spec(reg[slug]['arm'])[1], *CLAUDE_FLAGS]
        (out / 'started').write_text(str(time.time()))
        procs.append((slug, subprocess.Popen(cmd, cwd=workspace(slug, reg), stdout=(out / 'log.jsonl').open('w'),
                                             stderr=(out / 'stderr.txt').open('w'), stdin=subprocess.DEVNULL)))
        time.sleep(5)
    for slug, p in procs:
        code = p.wait()
        (STATE / 'runs' / slug / 'exit').write_text(str(code))
        print(slug, 'exit', code, flush=True)


CHECKER = re.compile(r'\bnode\s+(--\S+\s+)*\S*(?<![\w-])(check\.mjs|lessons\.mjs\s+(check|build)\b)')
SCRIPT_EXT = re.compile(r'\.(mjs|js|cjs|py|sh)$')
SCRIPT_REDIRECT = re.compile(r"(cat\s*>|>)\s*\S+\.(mjs|js|cjs|py|sh)\b(?!on)")


def result_text(block):
    c = block.get('content')
    if isinstance(c, list):
        return '\n'.join(x.get('text', '') for x in c if isinstance(x, dict))
    return c or ''


def failure_kinds(text):
    kinds, in_block = set(), False
    for line in text.splitlines():
        l = line.lower()
        if re.search(r'\d+ problem\(s\):', l):
            in_block = True
            continue
        problem = re.match(r'\s*(- |\S*lessons/\S+\.md:\d+:|\S*course\.json|\S*syllabus\.md)', l)
        fatal = re.match(r'\s*(\S+: )?(script does not parse|content block|course content|no inline)', l)
        if in_block and not problem:
            in_block = False
        if not (in_block or fatal):
            continue
        if 'syllabus' in l or 'in no row' in l or '--repo' in l:
            kinds.add('syllabus')
        elif 'does not parse' in l or 'throws' in l or 'unexpected token' in l or 'never closed' in l:
            kinds.add('parse')
        elif re.search(r' columns; \d+ fit ', l):
            kinds.add('width')
        elif re.search(r'(card|lesson|unit|course|glossary|lang|storagekey)', l):
            kinds.add('field')
    return sorted(kinds)


def measure(slug, arm, task, subject):
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
        if not CHECKER.search(cmd):
            continue
        r = results.get(uid, {'text': '', 'error': True})
        ok = bool(re.search(r'^\s*OK:', r['text'], re.M)) and not re.search(r'problem\(s\)', r['text'])
        checks.append({'ok': ok, 'kinds': [] if ok else failure_kinds(r['text']), 'cmd': cmd[:200], 'out': r['text'][:400], 'background': bool(u['input'].get('run_in_background'))})
    written = sorted({u['input'].get('file_path', '') for u in uses.values() if u['name'] == 'Write'})
    helpers = [p for p in written if SCRIPT_EXT.search(p)]
    bash_scripts = [u['input'].get('command', '')[:120] for u in uses.values()
                    if u['name'] == 'Bash' and SCRIPT_REDIRECT.search(u['input'].get('command', ''))]
    reads = [u['input'].get('file_path', '') for u in uses.values() if u['name'] == 'Read']
    outside = [p for p in reads if p and not p.startswith(str(subject.work / slug))]
    mu = (result or {}).get('modelUsage', {})
    tok = {k: sum(m.get(k, 0) for m in mu.values()) for k in ('inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens')}
    names = {}
    for u in uses.values():
        names[u['name']] = names.get(u['name'], 0) + 1
    m = {
        'slug': slug, 'arm': arm, 'task': task, 'subject': subject.name,
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
            allm.append(measure(slug, r['arm'], r['task'], r['subject']))
    (STATE / 'metrics.json').write_text(json.dumps(allm, indent=1))
    for m in allm:
        print(m['slug'], m['arm'], m['task'], m['subtype'], 'wall', m['wall_s'], 'tools', m['tool_calls'],
              'checks', m['checker_runs'], 'failed', m['checker_failed'], 'out', m['tokens']['outputTokens'], 'list$', m['cost_list_usd'])


def judge_quality():
    """Mean rubric score per run slug, averaged over every judge file in judges/."""
    per = {}
    for task, section in (('build', 'courses'), ('revise', 'lessons')):
        if not labels_file(task).exists():
            continue
        labels = read_labels(task)
        for jf in sorted((STATE / 'judges').glob('*.json')):
            scores = json.loads(jf.read_text())[section]
            for label, s in scores.items():
                slug = labels[label]
                vals = [v for k, v in s.items() if k != 'reasons']
                per.setdefault(slug, {})[jf.stem] = sum(vals) / len(vals)
    return per


def grade():
    quality = judge_quality()
    gs, kept = [], []
    reg = registry()
    for slug, r in reg.items():
        if not (STATE / 'runs' / slug / 'exit').exists():
            continue
        subj, ws = r['subject'], workspace(slug, reg)
        if not ws.exists():
            kept.append(slug)
            if (STATE / 'runs' / slug / 'grade.json').exists():
                gs.append(json.loads((STATE / 'runs' / slug / 'grade.json').read_text()))
            continue
        args = ['vp', 'node', str(HERE / 'grade.mjs'), str(ws), flow(r['arm']), r['task']]
        if r['task'] == 'revise':
            args.append(str(STATE / 'seed' / 'clean.html'))
        g = json.loads(sh(*args, env={**os.environ, 'GRADER_SKILL': str(GRADER), 'SUBJECT_FOLDER': subj.folder, 'SUBJECT_COURSE': subj.course}))
        g['slug'] = slug
        if slug in quality:
            g['qualityByJudge'] = quality[slug]
            g['quality'] = round(sum(quality[slug].values()) / len(quality[slug]), 2)
        (STATE / 'runs' / slug / 'grade.json').write_text(json.dumps(g, indent=1))
        gs.append(g)
    (STATE / 'grades.json').write_text(json.dumps(gs, indent=1))
    print(len(gs) - len(kept), 'graded,', sum('quality' in g for g in gs), 'with judge scores')
    if kept:
        print(len(kept), 'workspaces missing, last grade kept:', ' '.join(kept))


def find_page(course_dir):
    pages = [p for p in sorted(course_dir.glob('*.html')) if '===== COURSE CONTENT' in p.read_text()] if course_dir.exists() else []
    return next((p for p in pages if p.name == 'index.html'), pages[0] if pages else None)


def labels_file(packet):
    return STATE / f'judge_labels_{packet}.json'


def read_labels(packet):
    raw = json.loads(labels_file(packet).read_text())
    return {k: v['slug'] if isinstance(v, dict) else v for k, v in raw.items()}


def unscored(path, letters):
    try:
        scores = json.loads(path.read_text())['courses']
        return [l for l in letters if l not in scores or any(not isinstance(scores[l].get(c), int) for c in CRITERIA)]
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as e:
        return [f'unreadable: {e}']


def judge_files(packet, subject, letters):
    out = {}
    for j in JUDGES:
        for f in (STATE / 'hillclimb' / f'judge-{packet}-{j}.json', subject.work / f'{packet}-review' / f'judge-{j}.json'):
            if f.exists() and not unscored(f, letters):
                out[j] = f
                break
    return out


def panel(arm, subject, reg):
    slugs = [s for s, r in reg.items() if r['arm'] == arm and r['task'] == 'build' and r['subject'] == subject
             and (STATE / 'runs' / s / 'exit').exists()][:5]
    if len(slugs) < 5:
        sys.exit(f'{arm} has {len(slugs)} finished {subject.name} builds; a packet needs 5')
    return slugs


def pinned(subject):
    dest = subject.work / f'{subject.folder}-pinned'
    if not dest.exists():
        checkout(subject, dest)
    return dest


def judge(packet, arms, subject=DEFAULT_SUBJECT, labels_from=None, run_judges=True, unmarked=False):
    reg = registry()
    if labels_file(packet).exists() or labels_from:
        labels = read_labels(packet if labels_file(packet).exists() else labels_from)
        subjects = {reg[s]['subject'].name for s in labels.values()}
        if len(subjects) != 1:
            sys.exit(f'a packet holds one subject; these labels span {sorted(subjects)}')
        subj = SUBJECTS[subjects.pop()]
    else:
        if len(arms) != 2:
            sys.exit('name two arms, or --labels-from an earlier packet')
        subj = SUBJECTS[subject]
        slugs = [s for a in arms for s in panel(a, subj, reg)]
        random.SystemRandom().shuffle(slugs)
        labels = {chr(ord('A') + i): s for i, s in enumerate(slugs)}
    labels_file(packet).write_text(json.dumps(labels, indent=1))

    review = subj.work / f'{packet}-review'
    (review / 'courses').mkdir(parents=True, exist_ok=True)
    for letter, slug in labels.items():
        page = find_page(workspace(slug, reg) / subj.course)
        if not page:
            sys.exit(f'{slug}: no course page in {workspace(slug, reg) / subj.course}')
        md = sh('vp', 'node', str(HERE / 'dump.mjs'), str(page), env={**os.environ, 'GRADER_SKILL': str(GRADER), 'WIDE_MARKS': 'off' if unmarked else 'on'})
        (review / 'courses' / f'course-{letter}.md').write_text(md)
    rubric = (HERE / subj.rubric).read_text()
    (review / 'rubric.md').write_text(re.sub(r' A code line marked .*? counts against craft\.', '', rubric) if unmarked else rubric)
    link = review / subj.folder
    if not link.is_symlink():
        link.symlink_to(pinned(subj))
    print(f'{review}: {len(labels)} courses, labels in {labels_file(packet)}')
    if not run_judges:
        return

    template = (HERE / 'prompts' / 'judge.md').read_text()
    letters = sorted(labels)
    have = judge_files(packet, subj, letters)
    procs = []
    for j, model in JUDGES.items():
        if j in have:
            print(j, 'already scored', have[j])
            continue
        prompt = template.format(n=len(letters), about=subj.about, review=review, first=letters[0], last=letters[-1],
                                 folder=subj.folder, sources=subj.sources, out=f'judge-{j}.json')
        cmd = ['timeout', str(LIMIT_S['judge']), 'claude', '-p', prompt, '--model', model, *CLAUDE_FLAGS]
        procs.append((j, subprocess.Popen(cmd, cwd=review, stdout=(review / f'judge-{j}.log.jsonl').open('w'),
                                          stderr=(review / f'judge-{j}.stderr.txt').open('w'), stdin=subprocess.DEVNULL)))
    for j, p in procs:
        code = p.wait()
        out = review / f'judge-{j}.json'
        missing = unscored(out, letters)
        if missing:
            print(j, 'exit', code, 'incomplete:', missing, flush=True)
            continue
        (STATE / 'hillclimb').mkdir(exist_ok=True)
        shutil.copy(out, STATE / 'hillclimb' / f'judge-{packet}-{j}.json')
        print(j, 'exit', code, 'scored', len(letters), 'courses', flush=True)
    gap(packet)


def gap(packet):
    reg = registry()
    labels = read_labels(packet)
    subj = reg[next(iter(labels.values()))]['subject']
    files = judge_files(packet, subj, sorted(labels))
    if not files:
        sys.exit(f'no complete judge files for {packet}')
    scores = {j: json.loads(f.read_text())['courses'] for j, f in files.items()}
    per_arm = {}
    print(f'{packet}: judges {", ".join(f"{j} {f}" for j, f in files.items())}')
    print('course  arm     slug         ' + '  '.join(f'{j:>6}' for j in files) + '    mean')
    for letter, slug in sorted(labels.items()):
        by = {j: statistics.mean([s[letter][c] for c in CRITERIA]) for j, s in scores.items()}
        m = statistics.mean(list(by.values()))
        arm = reg[slug]['arm']
        per_arm.setdefault(arm, []).append(m)
        print(f'{letter:6}  {arm:6}  {slug:11}  ' + '  '.join(f'{by[j]:6.2f}' for j in files) + f'  {m:6.2f}')
    for arm, xs in per_arm.items():
        print(f'{arm:6} n {len(xs)}  mean {statistics.mean(xs):.2f}  median {statistics.median(xs):.2f}')
    if len(per_arm) == 2:
        a, b = per_arm.values()
        print(f'Mann-Whitney exact two-sided p = {mann_whitney_p(a, b):.3f}')


def cards(arms):
    reg = registry()
    gs = [g for g in json.loads((STATE / 'grades.json').read_text()) if g['slug'] in reg and reg[g['slug']]['task'] == 'build']
    keys = ('typeCards', 'expectLeaks', 'lessonsOutside3to6', 'maxLearnRun', 'lessonsEndingOnLearn', 'hintRate', 'wideLines')
    print(f'{"arm":6} {"slug":11} ' + ' '.join(f'{k:>20}' for k in keys))
    for arm in arms:
        rows = [g for g in gs if reg[g['slug']]['arm'] == arm]
        for g in rows:
            c = g.get('cards') or {}
            print(f'{arm:6} {g["slug"]:11} ' + ' '.join(f'{str(c.get(k, "-")):>20}' for k in keys))
        cs = [g['cards'] for g in rows if g.get('cards')]
        if cs:
            print(f'{arm:6} {"total":11} {sum(c["typeCards"] for c in cs):>20} {sum(c["expectLeaks"] for c in cs):>20} '
                  f'{sum(c["lessonsOutside3to6"] for c in cs):>20} {max(c["maxLearnRun"] for c in cs):>20} '
                  f'{sum(c["lessonsEndingOnLearn"] for c in cs):>20} '
                  f'{round(sum(c["hinted"] for c in cs) / max(1, sum(c["quizCards"] for c in cs)), 2):>20} '
                  f'{"%d-%d" % (min(c["wideLines"] or 0 for c in cs), max(c["wideLines"] or 0 for c in cs)):>20}')


def add_arm(name, commit, *model):
    extra = json.loads(ARMS.read_text()) if ARMS.exists() else {}
    extra[name] = ' '.join([sh('git', '-C', str(REPO), 'rev-parse', '--short', commit).strip(), *model])
    ARMS.write_text(json.dumps(extra, indent=1))
    print(name, extra[name])


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('setup'); p.add_argument('arm'); p.add_argument('task', choices=['build', 'revise'])
    p.add_argument('--subject', default=DEFAULT_SUBJECT, choices=sorted(SUBJECTS))
    p = sub.add_parser('run'); p.add_argument('slugs', nargs='+')
    p = sub.add_parser('restore'); p.add_argument('slugs', nargs='+')
    sub.add_parser('metrics'); sub.add_parser('grade')
    p = sub.add_parser('arm'); p.add_argument('name'); p.add_argument('commit'); p.add_argument('model', nargs='?')
    p = sub.add_parser('judge'); p.add_argument('packet'); p.add_argument('arms', nargs='*')
    p.add_argument('--labels-from', help="reuse an earlier packet's letters and courses, dumped again")
    p.add_argument('--subject', default=DEFAULT_SUBJECT, choices=sorted(SUBJECTS))
    p.add_argument('--no-judge', action='store_true', help='write the packet only')
    p.add_argument('--unmarked', action='store_true', help='leave wide code lines unmarked and drop the rubric sentence about them')
    p = sub.add_parser('gap'); p.add_argument('packet')
    p = sub.add_parser('cards'); p.add_argument('arms', nargs='+')
    a = ap.parse_args()
    {'setup': lambda: setup(a.arm, a.task, a.subject), 'run': lambda: run(a.slugs), 'restore': lambda: restore(a.slugs), 'metrics': metrics, 'grade': grade,
     'arm': lambda: add_arm(a.name, a.commit, *([a.model] if a.model else [])),
     'judge': lambda: judge(a.packet, a.arms, a.subject, a.labels_from, not a.no_judge, a.unmarked), 'gap': lambda: gap(a.packet), 'cards': lambda: cards(a.arms)}[a.cmd]()
