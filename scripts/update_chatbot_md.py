"""
Regenerates the auto-maintained sections of CHATBOT.md from the codebase,
so the chatbot working doc never drifts from what the portal actually
exposes. Everything between a pair of markers

    <!-- AUTO:<name>:start -->  ...  <!-- AUTO:<name>:end -->

is overwritten; everything outside them is hand-written and left alone.

Sources scanned:
  - backend/app.py           FastAPI routes (path, params, docstring)
  - frontend/src/App.jsx     useState UI state + CHART_DEFS keys
  - backend/data/glaciers.geojson   dataset counts the bot can quote
  - backend/chat/, frontend/src/chat/, App.jsx's "Chatbot -> portal"
    block: which routes' data / which UI setters the chatbot can reach ->
    coverage columns
  - CHATBOT.md itself        roadmap checkbox progress

Stdlib only. The file is only rewritten when its content actually changes
(no timestamps), so the pre-commit hook doesn't churn diffs.

Usage:
    python scripts/update_chatbot_md.py            # regenerate
    python scripts/update_chatbot_md.py --check    # exit 1 if stale (CI)
    python scripts/update_chatbot_md.py --install-hook   # git pre-commit
"""

import ast
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC = ROOT / "CHATBOT.md"
APP_PY = ROOT / "backend" / "app.py"
APP_JSX = ROOT / "frontend" / "src" / "App.jsx"
GLACIERS = ROOT / "backend" / "data" / "glaciers.geojson"
CHAT_BACKEND = ROOT / "backend" / "chat"
CHAT_FRONTEND = ROOT / "frontend" / "src" / "chat"

TREND_LABELS = {-1: "retreating", 0: "no significant trend", 1: "balanced/advancing"}


def _read_tree(path):
    """Concatenated source of every file under path (empty if it doesn't exist yet)."""
    if not path.exists():
        return ""
    return "\n".join(p.read_text(encoding="utf-8", errors="ignore") for p in sorted(path.rglob("*")) if p.is_file() and p.suffix in {".py", ".js", ".jsx"})


def _covered(token, source):
    return "yes" if token and token in source else "--"


# ---------------------------------------------------------------- sections


def section_api():
    tree = ast.parse(APP_PY.read_text(encoding="utf-8"))
    chat_src = _read_tree(CHAT_BACKEND)
    modules = {a.asname or a.name for n in tree.body if isinstance(n, ast.Import) for a in n.names}
    module_constants = {
        t.id for n in tree.body if isinstance(n, ast.Assign) for t in n.targets if isinstance(t, ast.Name) and t.id.isupper()
    }
    rows = []
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        for dec in node.decorator_list:
            if not (isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) and dec.args):
                continue
            method = dec.func.attr.upper()
            path = dec.args[0].value if isinstance(dec.args[0], ast.Constant) else "?"
            args = node.args
            defaults = [None] * (len(args.args) - len(args.defaults)) + list(args.defaults)
            params = []
            for a, d in zip(args.args, defaults):
                ann = ast.unparse(a.annotation) if a.annotation else ""
                p = f"{a.arg}: {ann}" if ann else a.arg
                if d is not None:
                    p += f" = {ast.unparse(d)}"
                params.append(p)
            doc = (ast.get_docstring(node) or "").split("\n\n")[0].replace("\n", " ")
            doc = re.sub(r"\s+", " ", doc)
            if len(doc) > 140:
                doc = doc[:137].rstrip() + "..."
            # Covered = the chatbot reaches the same data: a module function
            # this handler calls (e.g. trends.get_trends) or a module-level
            # data constant it reads (e.g. SENSOR_FILES) also appears in
            # backend/chat/. Routes that are the chatbot itself are marked so.
            calls = {
                ast.unparse(c.func) for c in ast.walk(node)
                if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute)
                and isinstance(c.func.value, ast.Name) and c.func.value.id in modules
            }
            constants = {n.id for n in ast.walk(node) if isinstance(n, ast.Name) and n.id.isupper() and n.id in module_constants}
            if path.startswith("/api/chat"):
                covered = "(chatbot)"
            elif chat_src and (any(f"{c}(" in chat_src for c in calls) or any(c in chat_src for c in constants)):
                covered = "yes"
            else:
                covered = "--"
            rows.append(f"| `{method} {path}` | `{', '.join(params) or '-'}` | {doc or '-'} | {covered} |")
    head = "| Route | Params | What it does | Chat tool? |\n|---|---|---|---|"
    return f"{len(rows)} routes in `backend/app.py`.\n\n{head}\n" + "\n".join(rows)


def section_ui_state():
    src = APP_JSX.read_text(encoding="utf-8")
    # Setters are wired to the chatbot in App.jsx's "Chatbot -> portal"
    # block (layerSetters / opacitySetters / chatHandlers) plus chat/.
    wiring = src.split("// Chatbot -> portal", 1)[1].split("const chatUiState", 1)[0] if "// Chatbot -> portal" in src else ""
    chat_src = _read_tree(CHAT_FRONTEND) + wiring
    rows = []
    for m in re.finditer(r"const \[(\w+), (\w+)\] = useState\(([^\n]*)", src):
        name, setter, rest = m.groups()
        comment = ""
        if "//" in rest:
            rest, comment = rest.split("//", 1)
        init = rest.strip().rstrip(")").strip() or "-"
        if len(init) > 40:
            init = init[:37] + "..."
        rows.append(f"| `{name}` | `{setter}` | `{init}` | {comment.strip() or '-'} | {_covered(setter, chat_src)} |")
    charts = re.findall(r"key: '(\w+)'", src.split("const CHART_DEFS", 1)[1].split("]\n", 1)[0]) if "const CHART_DEFS" in src else []
    head = "| State | Setter | Initial | Note | Chat action? |\n|---|---|---|---|---|"
    out = f"{len(rows)} `useState` hooks in `frontend/src/App.jsx`.\n\n{head}\n" + "\n".join(rows)
    if charts:
        out += "\n\nChart keys (`CHART_DEFS`, opened via `openChart(key)`): " + ", ".join(f"`{c}`" for c in charts)
    return out


def section_dataset():
    if not GLACIERS.exists():
        return "_glaciers.geojson not found._"
    feats = json.loads(GLACIERS.read_text(encoding="utf-8"))["features"]
    props = [f["properties"] for f in feats]
    by_country = Counter(p.get("country") for p in props)
    by_trend = Counter(p.get("trend") for p in props)
    named = sum(1 for p in props if p.get("name"))
    with_rate = sum(1 for p in props if p.get("rate") is not None)
    with_recent = sum(1 for p in props if p.get("pRecent"))
    keys = sorted({k for p in props for k in p})
    lines = [
        f"- **{len(feats):,}** glacier points; **{named:,}** have a `name`, the rest only an RGI `ref`.",
        f"- **{with_rate:,}** have a `rate`; **{with_recent:,}** have a `pRecent` (2020-2026) period.",
        "- By trend: " + ", ".join(f"{TREND_LABELS.get(t, t)} **{n:,}**" for t, n in sorted(by_trend.items(), key=lambda kv: (kv[0] is None, kv[0]))),
        "- By country: " + ", ".join(f"{c} **{n:,}**" for c, n in by_country.most_common()),
        "- Property keys: " + ", ".join(f"`{k}`" for k in keys),
    ]
    return "\n".join(lines)


def section_progress(doc_text):
    # Only count the hand-written roadmap, not anything inside AUTO blocks.
    stripped = re.sub(r"<!-- AUTO:\w+:start -->.*?<!-- AUTO:\w+:end -->", "", doc_text, flags=re.S)
    roadmap = stripped.split("## Roadmap", 1)[1] if "## Roadmap" in stripped else ""
    roadmap = roadmap.split("\n## ", 1)[0]
    lines = []
    total_done = total_all = 0
    for phase in re.split(r"\n### ", roadmap)[1:]:
        title = phase.splitlines()[0].strip()
        done = len(re.findall(r"^- \[x\]", phase, flags=re.M | re.I))
        todo = len(re.findall(r"^- \[ \]", phase, flags=re.M))
        total_done += done
        total_all += done + todo
        bar = "#" * done + "." * todo
        lines.append(f"| {title} | {done}/{done + todo} | `{bar}` |")
    if not lines:
        return "_No roadmap found._"
    head = "| Phase | Done | |\n|---|---|---|"
    return f"**{total_done}/{total_all}** roadmap items done.\n\n{head}\n" + "\n".join(lines)


def section_activity():
    try:
        log = subprocess.run(
            ["git", "log", "-8", "--format=%h %ad %s", "--date=short", "--", "backend/chat", "frontend/src/chat", "CHATBOT.md"],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        log = ""
    if not log:
        return "_No chatbot commits yet._"
    return "\n".join(f"- `{line.split(' ', 1)[0]}` {line.split(' ', 1)[1]}" for line in log.splitlines())


# ---------------------------------------------------------------- driver


def render(doc_text):
    sections = {
        "progress": lambda: section_progress(doc_text),
        "api": section_api,
        "ui_state": section_ui_state,
        "dataset": section_dataset,
        "activity": section_activity,
    }

    def replace(m):
        name = m.group(1)
        if name not in sections:
            return m.group(0)
        return f"<!-- AUTO:{name}:start -->\n{sections[name]()}\n<!-- AUTO:{name}:end -->"

    return re.sub(r"<!-- AUTO:(\w+):start -->.*?<!-- AUTO:\1:end -->", replace, doc_text, flags=re.S)


HOOK = """#!/bin/sh
# Installed by scripts/update_chatbot_md.py --install-hook
python scripts/update_chatbot_md.py >/dev/null 2>&1 || py scripts/update_chatbot_md.py >/dev/null 2>&1
git add CHATBOT.md
exit 0
"""


def main():
    if "--install-hook" in sys.argv:
        hook = ROOT / ".git" / "hooks" / "pre-commit"
        if hook.exists() and "update_chatbot_md" not in hook.read_text(encoding="utf-8"):
            sys.exit(f"{hook} already exists and isn't ours -- add the update line to it by hand.")
        hook.write_text(HOOK, encoding="utf-8", newline="\n")
        print(f"Installed {hook}")
        return

    old = DOC.read_text(encoding="utf-8")
    new = render(old)
    if "--check" in sys.argv:
        sys.exit(0 if new == old else "CHATBOT.md is stale -- run scripts/update_chatbot_md.py")
    if new != old:
        DOC.write_text(new, encoding="utf-8", newline="\n")
        print("CHATBOT.md updated")
    else:
        print("CHATBOT.md already up to date")


if __name__ == "__main__":
    main()
