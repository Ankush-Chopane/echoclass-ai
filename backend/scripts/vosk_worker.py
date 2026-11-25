#!/usr/bin/env python3
"""
Offline Vosk Speech Recognition Worker.
Runs locally and communicates with Node.js over stdin/stdout using JSON Lines.
Requires: Python 3 and the `vosk` package.
"""

import sys
import os
import json
import base64
import argparse

try:
    from vosk import Model, KaldiRecognizer, SetLogLevel
    SetLogLevel(-1)  # Quiet Kaldi logs during continuous streaming
except ImportError:
    print(json.dumps({"error": "Vosk python package is not installed. Run: pip install vosk"}), flush=True)
    sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="EchoClass Offline Vosk Worker")
    parser.add_argument("--model", default="models/vosk", help="Path to Vosk model directory")
    parser.add_argument("--sample-rate", type=int, default=16000, help="Audio sample rate (Hz)")
    args = parser.parse_args()

    model_path = os.path.abspath(args.model)
    if not os.path.exists(model_path):
        print(json.dumps({
            "error": f"Model directory not found at {model_path}. Run 'npm run fetch-speech-model' first."
        }), flush=True)
        sys.exit(2)

    try:
        model = Model(model_path)
        recognizer = KaldiRecognizer(model, args.sample_rate)
        recognizer.SetWords(False)
    except Exception as e:
        print(json.dumps({"error": f"Failed to load Vosk model: {str(e)}"}), flush=True)
        sys.exit(3)

    # Signal ready to Node.js
    print(json.dumps({"ready": True, "model": model_path, "sampleRate": args.sample_rate}), flush=True)

    last_partial = ""

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue

        action = req.get("action", "")

        if action == "audio":
            b64_data = req.get("data", "")
            if not b64_data:
                continue
            chunk = base64.b64decode(b64_data)
            if recognizer.AcceptWaveform(chunk):
                res = json.loads(recognizer.Result())
                text = (res.get("text") or "").strip()
                last_partial = ""
                if text:
                    print(json.dumps({"type": "final", "text": text}), flush=True)
            else:
                pres = json.loads(recognizer.PartialResult())
                partial = (pres.get("partial") or "").strip()
                if partial and partial != last_partial:
                    last_partial = partial
                    print(json.dumps({"type": "interim", "text": partial}), flush=True)

        elif action == "flush":
            res = json.loads(recognizer.FinalResult())
            text = (res.get("text") or "").strip()
            last_partial = ""
            if text:
                print(json.dumps({"type": "final", "text": text}), flush=True)

        elif action == "reset":
            recognizer = KaldiRecognizer(model, args.sample_rate)
            last_partial = ""
            print(json.dumps({"type": "reset_ack"}), flush=True)

        elif action == "ping":
            print(json.dumps({"type": "pong"}), flush=True)

if __name__ == "__main__":
    main()
