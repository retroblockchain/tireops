"""Drives multi-turn chat tests against the running tireops dev server.

Reads a list of user turns from the CLI, sends them in order to /api/chat,
preserving the messages array between turns. For each turn, prints:
  - what the AI said as text
  - any tool calls (name + input)
  - any tool results (parsed JSON)
This shows the full catalog flow end-to-end.

Usage:
  python scripts/test-catalog-chat.py "user turn 1" "user turn 2" ...
"""

import json
import sys
import urllib.request

# Force stdout to UTF-8 so arrows etc. don't crash on Windows cp1252.
sys.stdout.reconfigure(encoding="utf-8")

ENDPOINT = "http://localhost:3001/api/chat"


def stream_chat(messages, shop="Mission", email="catalog-test@tireops.local"):
    body = json.dumps({
        "messages": messages,
        "currentShop": shop,
        "currentUserEmail": email,
    }).encode()
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    text_buf = []
    final_messages = None
    with urllib.request.urlopen(req, timeout=60) as resp:
        for line in resp:
            line = line.decode().strip()
            if not line:
                continue
            evt = json.loads(line)
            if evt.get("type") == "delta":
                text_buf.append(evt.get("text", ""))
            elif evt.get("type") == "end":
                final_messages = evt.get("messages", [])
            elif evt.get("type") == "error":
                print(f"  [STREAM ERROR] {evt.get('error')}")
    return "".join(text_buf), final_messages


def describe_turn(label, ai_text, messages):
    """Show what happened in the most recent assistant turn + any tool round-trips."""
    print(f"--- {label} ---")
    print(f"AI text (streamed): {ai_text.strip() if ai_text.strip() else '(no text — tool calls only)'}")

    # Walk backwards through messages to find the new assistant+tool_result pairs
    # from this turn. Easier: just print every assistant content block and
    # every tool_result block from the LAST few messages.
    new_msgs = messages[-6:]  # the last few — enough to capture a tool loop
    for m in new_msgs:
        if m.get("role") == "assistant" and isinstance(m.get("content"), list):
            for b in m["content"]:
                if b.get("type") == "tool_use":
                    print(f"  -> tool call: {b['name']}({json.dumps(b.get('input',{}))})")
        if m.get("role") == "user" and isinstance(m.get("content"), list):
            for b in m["content"]:
                if b.get("type") == "tool_result":
                    try:
                        parsed = json.loads(b.get("content", "{}"))
                        print(f"  <- tool result: {json.dumps(parsed, indent=2)}")
                    except Exception:
                        print(f"  <- tool result (raw): {b.get('content', '')[:200]}")
    print()


def main():
    if len(sys.argv) < 2:
        print("usage: python scripts/test-catalog-chat.py 'turn 1' 'turn 2' ...")
        sys.exit(1)

    user_turns = sys.argv[1:]
    messages = []
    for i, turn in enumerate(user_turns, start=1):
        messages.append({"role": "user", "content": turn})
        print(f"\n========= TURN {i} (user): {turn!r} =========")
        ai_text, new_messages = stream_chat(messages)
        if new_messages is None:
            print("  [no end event — abort]")
            return
        messages = new_messages
        describe_turn(f"after turn {i}", ai_text, messages)


if __name__ == "__main__":
    main()
