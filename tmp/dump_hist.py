import os
import re
import sys
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
for line in (BASE / '.env').read_text(encoding='utf-8').splitlines():
    m = re.match(r'^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$', line)
    if m and m.group(1) not in os.environ:
        os.environ[m.group(1)] = m.group(2).strip('"\'')

from scripts.sync_tratativas import fetch_pipe, fetch_all_cards

pipe = fetch_pipe(os.getenv('PIPEFY_PIPE_ID'))
cards = fetch_all_cards(os.getenv('PIPEFY_PIPE_ID'))
for c in cards:
    print(f'CARD "{c["title"]}" | atual: {(c.get("current_phase") or {}).get("name")}')
    for h in (c.get('phases_history') or []):
        print(f'   {h["phase"]["name"]:28s} firstIn={h.get("firstTimeIn")} lastIn={h.get("lastTimeIn")} lastOut={h.get("lastTimeOut")}')
