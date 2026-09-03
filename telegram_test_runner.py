#!/usr/bin/env python3
"""
telegram_test_runner.py — Real Telegram End-to-End Test Runner

Reads test cases from TEST_PLAN.md and sends them sequentially to a Telegram bot
using Telethon and a Telegram user account (NOT the Telegram Bot API).

Requirements:
- Read actual messages from TEST_PLAN.md (no invented messages).
- Preserve test order from TEST_PLAN.md.
- Send one message at a time.
- Default delay: 3 seconds between messages.
- Print TEST ID, message, and success/failure.
- Ask for confirmation before starting.
- Continue after a failed message, but report the error.
- Use environment variables:
    TG_API_ID
    TG_API_HASH
    TG_BOT
    TG_DELAY
- Save Telethon session as telegram_test_session.session.
- No hardcoded API credentials or bot tokens.
- Print summary of passed and failed tests.
- Support:
    python telegram_test_runner.py --level LEVEL_4
    python telegram_test_runner.py --test TEST-05
    python telegram_test_runner.py --all
"""

import argparse
import asyncio
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Terminal color constants
RESET = "\033[0m"
BOLD = "\033[1m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
GRAY = "\033[90m"


def load_env_file(filepath: Path) -> None:
    """Simple .env loader that does not require third-party dependencies."""
    if not filepath.is_file():
        return
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip("'\"")
                if key and key not in os.environ:
                    os.environ[key] = val


def clean_message(raw_msg: str) -> str:
    """
    Clean markdown formatting and annotations from test message:
    - Removes code backticks (e.g. `/start` -> /start)
    - Removes outer quotation marks (e.g. "Add a lead" -> Add a lead)
    - Removes trailing parenthetical explanation notes like (nonsense)
    """
    msg = raw_msg.strip()
    if msg.startswith("`") and msg.endswith("`") and len(msg) >= 2:
        msg = msg[1:-1].strip()
    if ((msg.startswith('"') and msg.endswith('"')) or
        (msg.startswith("'") and msg.endswith("'"))) and len(msg) >= 2:
        msg = msg[1:-1].strip()
    msg = re.sub(r"\s*\((?:nonsense)\)\s*$", "", msg, flags=re.IGNORECASE).strip()
    return msg


def parse_test_plan(file_path: Path) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Parses TEST_PLAN.md and extracts all test cases.
    Returns:
      (table1_tests, table2_tests)
    """
    if not file_path.is_file():
        raise FileNotFoundError(f"Test plan file not found at: {file_path}")

    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    lines = content.splitlines()
    table1_tests: List[Dict[str, Any]] = []
    table2_tests: List[Dict[str, Any]] = []

    current_table = 0

    for line in lines:
        stripped = line.strip()
        if "## Additional tests" in stripped:
            current_table = 2
            continue
        if stripped.startswith("|") and "Test ID" in stripped:
            if current_table == 0:
                current_table = 1
            continue
        if current_table > 0 and stripped.startswith("|---"):
            continue

        if current_table == 1 and stripped.startswith("|"):
            cols = [c.strip() for c in stripped.split("|")[1:-1]]
            if len(cols) >= 4 and cols[0].startswith("TEST-"):
                test_id = cols[0]
                raw_msg = cols[1]
                expected_cmd = cols[2] if len(cols) > 2 else ""
                workflow = cols[3] if len(cols) > 3 else ""
                expected_resp = cols[4] if len(cols) > 4 else ""
                expected_db = cols[5] if len(cols) > 5 else ""
                node = cols[6] if len(cols) > 6 else ""

                cleaned_msg = clean_message(raw_msg)
                table1_tests.append({
                    "id": test_id,
                    "message": cleaned_msg,
                    "raw_message": raw_msg,
                    "command": expected_cmd,
                    "workflow": workflow,
                    "expected_response": expected_resp,
                    "expected_db": expected_db,
                    "node": node,
                    "table": 1,
                })

        elif current_table == 2 and stripped.startswith("|"):
            cols = [c.strip() for c in stripped.split("|")[1:-1]]
            if len(cols) >= 3 and cols[0].startswith("TEST-"):
                test_id = cols[0]
                scenario = cols[1]
                trigger = cols[2]
                expected_resp = cols[3] if len(cols) > 3 else ""
                node = cols[4] if len(cols) > 4 else ""

                # Extract quoted message if present in trigger (e.g. "Add a lead")
                quoted = re.search(r'"([^"]+)"', trigger)
                msg = quoted.group(1).strip() if quoted else ""

                # Inferred level from node
                workflow = ""
                if "Pending Action" in node:
                    workflow = "LEVEL_3B"
                elif "Lead" in node:
                    workflow = "LEVEL_4"
                elif "Followup" in node or "Follow-up" in node:
                    workflow = "LEVEL_6"

                table2_tests.append({
                    "id": test_id,
                    "scenario": scenario,
                    "trigger": trigger,
                    "message": msg,
                    "command": "",
                    "workflow": workflow,
                    "expected_response": expected_resp,
                    "node": node,
                    "table": 2,
                })

    return table1_tests, table2_tests


def normalize_test_id(tid: str) -> str:
    """Normalizes TEST-5, test-05, 5, 05 into TEST-05."""
    tid = tid.strip().upper()
    m = re.match(r"^(?:TEST[-_]?)?(\d+)$", tid)
    if m:
        return f"TEST-{int(m.group(1)):02d}"
    return tid


def normalize_level(lvl: str) -> str:
    """Normalizes level_4, 4, LEVEL_4 into LEVEL_4."""
    lvl = lvl.strip().upper().replace("-", "_")
    if not lvl.startswith("LEVEL_"):
        if lvl.isdigit() or lvl in ("3B", "10", "11"):
            return f"LEVEL_{lvl}"
    return lvl


def filter_tests(
    table1: List[Dict[str, Any]],
    table2: List[Dict[str, Any]],
    level_filter: Optional[str] = None,
    test_filter: Optional[str] = None,
    all_flag: bool = False,
) -> List[Dict[str, Any]]:
    """Filters tests according to CLI arguments."""
    if test_filter:
        target_id = normalize_test_id(test_filter)
        matched = [t for t in table1 if t["id"].upper() == target_id]
        if not matched:
            matched = [t for t in table2 if t["id"].upper() == target_id and t["message"]]
        return matched

    if level_filter:
        target_lvl = normalize_level(level_filter)
        matched = [
            t for t in table1
            if target_lvl in t["workflow"].upper().replace("-", "_")
        ]
        if not matched:
            matched = [
                t for t in table2
                if t["message"] and target_lvl in t["workflow"].upper().replace("-", "_")
            ]
        return matched

    # Default / --all: Return Table 1 sequential Telegram test messages
    return list(table1)


def confirm_start(tests: List[Dict[str, Any]], tg_bot: str, delay: float) -> bool:
    """Prints execution preview and prompts for confirmation."""
    print(f"\n{BOLD}{CYAN}======================================================================{RESET}")
    print(f"{BOLD}{CYAN}         TELEGRAM BOT TEST RUNNER — EXECUTION PREVIEW{RESET}")
    print(f"{BOLD}{CYAN}======================================================================{RESET}")
    print(f"  {BOLD}Target Bot:{RESET}      {CYAN}{tg_bot}{RESET}")
    print(f"  {BOLD}Delay:{RESET}           {delay:.1f}s between messages")
    print(f"  {BOLD}Total Messages:{RESET}  {len(tests)}")
    print(f"{GRAY}----------------------------------------------------------------------{RESET}")
    print(f"  {'#':<3} {'Test ID':<10} {'Workflow':<25} {'Telegram Message'}")
    print(f"{GRAY}----------------------------------------------------------------------{RESET}")
    for i, t in enumerate(tests, 1):
        wf = t["workflow"]
        if len(wf) > 23:
            wf = wf[:22] + "…"
        print(f"  {i:<3} {BOLD}{t['id']:<10}{RESET} {wf:<25} {CYAN}{t['message']}{RESET}")
    print(f"{BOLD}{CYAN}======================================================================{RESET}\n")

    try:
        ans = input(f"{BOLD}Ready to send {len(tests)} test message(s) sequentially? [y/N]: {RESET}").strip().lower()
        return ans in ("y", "yes")
    except (KeyboardInterrupt, EOFError):
        print()
        return False


async def run_telethon_tests(
    tests: List[Dict[str, Any]],
    api_id: int,
    api_hash: str,
    tg_bot: str,
    delay: float,
    session_name: str,
    require_response: bool = False,
    timeout: Optional[float] = None,
) -> Tuple[List[Dict[str, Any]], float]:
    """
    Connects to Telegram using Telethon as a user account and sends
    each test message sequentially.
    """
    try:
        from telethon import TelegramClient, events
    except ImportError:
        print(f"{BOLD}{RED}Error: Telethon is not installed.{RESET}")
        print("Please install it with: pip install telethon")
        sys.exit(1)

    print(f"\n{BOLD}Connecting to Telegram using user account session...{RESET}")
    print(f"{GRAY}Session file: {session_name}.session{RESET}")

    client = TelegramClient(session_name, api_id, api_hash)

    phone_callback = lambda: (
        os.environ.get("TG_PHONE")
        or input("Please enter your phone number with country code (e.g. +1234567890): ")
    )

    # Start the client (interactive if first run, cached if session exists)
    await client.start(phone=phone_callback)

    me = await client.get_me()
    phone_display = f"+{me.phone}" if hasattr(me, "phone") and me.phone else "authenticated"
    user_handle = f"@{me.username}" if getattr(me, "username", None) else f"ID: {me.id}"
    print(f"{GREEN}✔ Connected as Telegram User:{RESET} {BOLD}{me.first_name}{RESET} ({user_handle}, {phone_display})")

    # Resolve target bot entity
    try:
        bot_entity = await client.get_entity(tg_bot)
        bot_handle = f"@{bot_entity.username}" if getattr(bot_entity, "username", None) else str(bot_entity.id)
        print(f"{GREEN}✔ Target Bot Verified:{RESET} {BOLD}{getattr(bot_entity, 'first_name', 'Bot')}{RESET} ({bot_handle})")
    except Exception as e:
        await client.disconnect()
        raise RuntimeError(f"Could not resolve Telegram entity for TG_BOT '{tg_bot}': {e}")

    # Listen for incoming responses from the target bot
    latest_reply: Optional[str] = None
    reply_event = asyncio.Event()

    @client.on(events.NewMessage(chats=bot_entity))
    async def on_bot_message(event):
        nonlocal latest_reply
        if not event.out and event.sender_id == bot_entity.id:
            latest_reply = event.message.text
            reply_event.set()

    results: List[Dict[str, Any]] = []
    total_start = time.time()
    wait_time = timeout if timeout is not None else delay

    print(f"\n{BOLD}{CYAN}======================================================================{RESET}")
    print(f"{BOLD}{CYAN}                     STARTING SEQUENTIAL TEST RUN{RESET}")
    print(f"{BOLD}{CYAN}======================================================================{RESET}\n")

    for idx, test in enumerate(tests, 1):
        test_id = test["id"]
        msg = test["message"]
        workflow = test["workflow"]

        print(f"{BOLD}[{test_id}]{RESET} ({idx}/{len(tests)}) Sending: {CYAN}\"{msg}\"{RESET}")
        if workflow:
            print(f"  {GRAY}Expected Workflow:{RESET} {workflow}")

        latest_reply = None
        reply_event.clear()

        send_start = time.time()
        send_success = False
        error_msg: Optional[str] = None

        try:
            await client.send_message(bot_entity, msg)
            send_success = True
        except Exception as e:
            send_success = False
            error_msg = f"{type(e).__name__}: {e}"

        if send_success:
            # Wait for bot response up to the delay interval
            try:
                await asyncio.wait_for(reply_event.wait(), timeout=wait_time)
            except asyncio.TimeoutError:
                pass

            elapsed = time.time() - send_start
            remaining_delay = max(0.0, delay - elapsed)

            if latest_reply:
                single_line_reply = latest_reply.replace("\n", " ")
                if len(single_line_reply) > 90:
                    single_line_reply = single_line_reply[:87] + "..."
                print(f"  {GREEN}✔ SUCCESS{RESET} (Sent)")
                print(f"  {GRAY}↳ Bot response:{RESET} \"{single_line_reply}\"")
            else:
                print(f"  {GREEN}✔ SUCCESS{RESET} (Sent - no response within {wait_time:.1f}s)")

            passed = True
            if require_response and not latest_reply:
                passed = False
                error_msg = f"No response received from bot within {wait_time:.1f}s"

            results.append({
                "id": test_id,
                "message": msg,
                "workflow": workflow,
                "status": "PASS" if passed else "FAIL",
                "response": latest_reply,
                "error": error_msg,
                "duration": elapsed,
            })

            # Ensure minimum delay between consecutive messages
            if idx < len(tests) and remaining_delay > 0:
                await asyncio.sleep(remaining_delay)

        else:
            print(f"  {RED}✖ FAILED{RESET}")
            print(f"  {RED}↳ Error:{RESET} {error_msg}")

            results.append({
                "id": test_id,
                "message": msg,
                "workflow": workflow,
                "status": "FAIL",
                "response": None,
                "error": error_msg,
                "duration": time.time() - send_start,
            })

            # Continue after a failed message, but maintain delay
            if idx < len(tests):
                await asyncio.sleep(delay)

        print()

    total_duration = time.time() - total_start
    await client.disconnect()
    return results, total_duration


def print_summary(results: List[Dict[str, Any]], total_duration: float) -> int:
    """Prints final summary of passed and failed tests."""
    total = len(results)
    passed = sum(1 for r in results if r["status"] == "PASS")
    failed = sum(1 for r in results if r["status"] == "FAIL")

    print(f"\n{BOLD}{CYAN}======================================================================{RESET}")
    print(f"{BOLD}{CYAN}                          TEST RUN SUMMARY{RESET}")
    print(f"{BOLD}{CYAN}======================================================================{RESET}")
    print(f"  {BOLD}Total Tests:{RESET}     {total}")
    print(f"  {BOLD}Passed:{RESET}          {GREEN}{passed}{RESET}")
    print(f"  {BOLD}Failed:{RESET}          {RED if failed > 0 else GREEN}{failed}{RESET}")
    print(f"  {BOLD}Execution Time:{RESET}  {total_duration:.2f}s")
    print(f"{GRAY}----------------------------------------------------------------------{RESET}")
    print(f"  {'Status':<8} {'Test ID':<10} {'Telegram Message'}")
    print(f"{GRAY}----------------------------------------------------------------------{RESET}")

    for r in results:
        status_badge = f"{GREEN}✔ PASS{RESET}" if r["status"] == "PASS" else f"{RED}✖ FAIL{RESET}"
        msg = r["message"]
        if len(msg) > 48:
            msg = msg[:45] + "…"
        print(f"  {status_badge:<17} {BOLD}{r['id']:<10}{RESET} {msg}")

    if failed > 0:
        print(f"\n{BOLD}{RED}Failures Breakdown ({failed}):{RESET}")
        for r in results:
            if r["status"] == "FAIL":
                print(f"  {RED}✖ [{r['id']}]{RESET} \"{r['message']}\"")
                print(f"    {RED}Error:{RESET} {r['error']}")

    print(f"{BOLD}{CYAN}======================================================================{RESET}")
    if failed == 0:
        print(f"  {BOLD}{GREEN}ALL {total} TEST(S) PASSED SUCCESSFULLY! ✔{RESET}")
    else:
        print(f"  {BOLD}{RED}{failed} TEST(S) FAILED. Please review the errors above. ✖{RESET}")
    print(f"{BOLD}{CYAN}======================================================================{RESET}\n")

    return 0 if failed == 0 else 1


def main() -> None:
    repo_dir = Path(__file__).resolve().parent
    env_file = repo_dir / ".env"
    load_env_file(env_file)

    parser = argparse.ArgumentParser(
        description="Telegram End-to-End Test Runner (Telethon User Account)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python telegram_test_runner.py --all
  python telegram_test_runner.py --level LEVEL_4
  python telegram_test_runner.py --test TEST-05
  python telegram_test_runner.py --list
  python telegram_test_runner.py --level LEVEL_4 --delay 5
  python telegram_test_runner.py --all -y
        """,
    )

    filter_group = parser.add_mutually_exclusive_group()
    filter_group.add_argument(
        "--all",
        action="store_true",
        help="Run all extracted tests sequentially from TEST_PLAN.md (default)",
    )
    filter_group.add_argument(
        "--level",
        type=str,
        default=None,
        metavar="LEVEL",
        help="Filter tests by workflow level (e.g. LEVEL_4, LEVEL_3, LEVEL_6)",
    )
    filter_group.add_argument(
        "--test",
        type=str,
        default=None,
        metavar="TEST_ID",
        help="Run a specific test by ID (e.g. TEST-05, TEST-01)",
    )

    parser.add_argument(
        "--delay",
        type=float,
        default=None,
        help="Delay in seconds between messages (overrides TG_DELAY, default: 3.0)",
    )
    parser.add_argument(
        "--yes",
        "-y",
        action="store_true",
        help="Skip confirmation prompt and proceed immediately",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List extracted tests and exit without sending",
    )
    parser.add_argument(
        "--plan",
        type=str,
        default="TEST_PLAN.md",
        help="Path to TEST_PLAN.md file (default: TEST_PLAN.md)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=None,
        help="Bot response timeout in seconds (default: same as delay)",
    )
    parser.add_argument(
        "--require-response",
        action="store_true",
        help="Require a bot response for a test to pass",
    )

    args = parser.parse_args()

    # Parse TEST_PLAN.md
    plan_path = Path(args.plan)
    if not plan_path.is_absolute():
        plan_path = repo_dir / plan_path

    try:
        table1_tests, table2_tests = parse_test_plan(plan_path)
    except Exception as e:
        print(f"{BOLD}{RED}Error reading test plan:{RESET} {e}")
        sys.exit(1)

    # Filter tests
    selected_tests = filter_tests(
        table1=table1_tests,
        table2=table2_tests,
        level_filter=args.level,
        test_filter=args.test,
        all_flag=args.all,
    )

    if not selected_tests:
        print(f"{BOLD}{RED}No tests found matching the specified filter!{RESET}")
        if args.level:
            print(f"  --level: '{args.level}' (Normalized: '{normalize_level(args.level)}')")
        elif args.test:
            print(f"  --test:  '{args.test}' (Normalized: '{normalize_test_id(args.test)}')")
        sys.exit(1)

    # If --list flag is passed, just display tests and exit
    if args.list:
        print(f"\n{BOLD}{CYAN}Extracted Tests from {plan_path.name}:{RESET}")
        print(f"{GRAY}----------------------------------------------------------------------{RESET}")
        print(f"  {'#':<3} {'Test ID':<10} {'Workflow':<25} {'Message'}")
        print(f"{GRAY}----------------------------------------------------------------------{RESET}")
        for i, t in enumerate(selected_tests, 1):
            wf = t["workflow"]
            if len(wf) > 23:
                wf = wf[:22] + "…"
            print(f"  {i:<3} {BOLD}{t['id']:<10}{RESET} {wf:<25} {CYAN}{t['message']}{RESET}")
        print(f"{GRAY}----------------------------------------------------------------------{RESET}")
        print(f"Total: {len(selected_tests)} test(s)\n")
        sys.exit(0)

    # Validate Environment Variables
    api_id_raw = os.environ.get("TG_API_ID")
    api_hash = os.environ.get("TG_API_HASH")
    tg_bot = os.environ.get("TG_BOT")

    missing = []
    if not api_id_raw:
        missing.append("TG_API_ID")
    if not api_hash:
        missing.append("TG_API_HASH")
    if not tg_bot:
        missing.append("TG_BOT")

    if missing:
        print(f"\n{BOLD}{RED}======================================================================{RESET}")
        print(f"{BOLD}{RED}CONFIG ERROR: Missing required environment variable(s):{RESET}")
        for var in missing:
            print(f"  {RED}✖ {var}{RESET}")
        print(f"{BOLD}{RED}======================================================================{RESET}")
        print("Please configure them via environment variables or in your .env file:\n")
        print("  export TG_API_ID=\"12345678\"               # from https://my.telegram.org")
        print("  export TG_API_HASH=\"0123456789abcdef...\"   # from https://my.telegram.org")
        print("  export TG_BOT=\"@YourBotUsername\"          # target bot username or ID")
        print("  export TG_DELAY=\"3\"                       # optional, default is 3 seconds\n")
        print("Or add them into .env in the project directory.")
        print(f"{BOLD}{RED}======================================================================{RESET}\n")
        sys.exit(1)

    try:
        api_id = int(api_id_raw.strip())
    except ValueError:
        print(f"{BOLD}{RED}Error: TG_API_ID must be a valid integer, got: '{api_id_raw}'{RESET}")
        sys.exit(1)

    # Determine delay
    if args.delay is not None:
        delay = args.delay
    else:
        try:
            delay = float(os.environ.get("TG_DELAY", 3.0))
        except ValueError:
            delay = 3.0

    # Session file: saved as telegram_test_session.session in repo_dir
    session_name = str(repo_dir / "telegram_test_session")

    # Ask for confirmation unless -y / --yes is passed
    if not args.yes:
        confirmed = confirm_start(selected_tests, tg_bot, delay)
        if not confirmed:
            print(f"{YELLOW}Test run cancelled by user.{RESET}")
            sys.exit(0)

    # Run tests with Telethon
    try:
        results, duration = asyncio.run(
            run_telethon_tests(
                tests=selected_tests,
                api_id=api_id,
                api_hash=api_hash,
                tg_bot=tg_bot,
                delay=delay,
                session_name=session_name,
                require_response=args.require_response,
                timeout=args.timeout,
            )
        )
    except KeyboardInterrupt:
        print(f"\n{YELLOW}Test run interrupted by user (Ctrl+C).{RESET}")
        sys.exit(130)
    except Exception as e:
        print(f"\n{BOLD}{RED}Fatal execution error:{RESET} {e}")
        sys.exit(1)

    # Print summary
    exit_code = print_summary(results, duration)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
