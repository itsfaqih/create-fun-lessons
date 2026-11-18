You are a blind judge of {n} short courses on {about}. This one task only; start no subagents.

Read `{review}/rubric.md` and follow it exactly. The courses are `{review}/courses/course-{first}.md` through `course-{last}.md` (markdown dumps of interactive course pages; layout artifacts of the dump, such as labels run together, are not the course's fault). Check facts against the library source at `{review}/{folder}/` ({sources}). Read every course in full before scoring; use the same scale for all.

Write your result as JSON to `{review}/{out}` with this shape:
{{"courses": {{"{first}": {{"accuracy": n, "coverage": n, "depth": n, "craft": n, "coherence": n, "reasons": {{"accuracy": "...", ...}}}}, ... "{last}": {{...}}}}, "courseRanking": ["best letter", ..., "worst letter"], "notes": "..."}}
Scores are integers 1 to 5. End your turn with one line confirming the file was written.
