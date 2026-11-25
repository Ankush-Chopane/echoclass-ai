#!/usr/bin/env python3
"""TEST STUB that speaks the same JSON-lines protocol as scripts/vosk_worker.py.
It does NOT recognise speech: it answers every 3rd audio chunk with a fixed sentence.
It exists only to test the Node <-> worker <-> WebSocket <-> SQLite plumbing without the real model."""
import sys, json, base64
print(json.dumps({"ready": True, "model": "stub"}), flush=True)
n = 0
for line in sys.stdin:
    try: req = json.loads(line)
    except Exception: continue
    a = req.get("action")
    if a == "audio":
        base64.b64decode(req.get("data", ""))
        n += 1
        if n % 3 == 0: print(json.dumps({"type": "final", "text": "stub recognised sentence"}), flush=True)
        else: print(json.dumps({"type": "interim", "text": "stub partial"}), flush=True)
    elif a == "flush":
        print(json.dumps({"type": "final", "text": "stub flushed"}), flush=True)
