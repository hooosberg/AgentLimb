#!/usr/bin/env python3
"""
AgentLimb HTTP RPC Client (agentlimb_client.py)
Directly calls http://127.0.0.1:8765/api/tool with dynamic port discovery and multi-profile routing.

Features:
  - Dynamic discovery of bridge port (8765-8770)
  - Universal call_tool(tool, arguments, timeout)
  - Profile-aware routing via "browser" argument
  - Convenience wrappers: eval_js(), get_tabs(), get_status()
"""

import json
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_PORTS: Tuple[int, ...] = tuple(range(8765, 8781))


def get_bridge_url(host: str = "127.0.0.1", ports: Tuple[int, ...] = DEFAULT_PORTS) -> str:
    """Probe the health endpoints of candidate bridge ports and return the active /api/tool URL."""
    for port in ports:
        try:
            req = urllib.request.Request(f"http://{host}:{port}/health")
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                if resp.status == 200:
                    return f"http://{host}:{port}/api/tool"
        except Exception:
            continue
    return f"http://{host}:{ports[0]}/api/tool"


def get_status(host: str = "127.0.0.1", ports: Tuple[int, ...] = DEFAULT_PORTS) -> Optional[Dict[str, Any]]:
    """Return the health and connected browser info from the active bridge."""
    for port in ports:
        try:
            req = urllib.request.Request(f"http://{host}:{port}/health")
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                if resp.status == 200:
                    return json.loads(resp.read().decode("utf-8"))
        except Exception:
            continue
    return None


def call_tool(
    tool: str,
    arguments: Optional[Dict[str, Any]] = None,
    timeout: float = 60.0,
    host: str = "127.0.0.1",
    ports: Tuple[int, ...] = DEFAULT_PORTS,
) -> Any:
    """Invoke an AgentLimb browser tool over HTTP POST /api/tool."""
    payload = {
        "tool": tool,
        "arguments": arguments or {},
        "timeoutMs": int(timeout * 1000),
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    url = get_bridge_url(host=host, ports=ports)
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout + 5) as resp:
            res = json.loads(resp.read().decode("utf-8"))
            if not res.get("ok"):
                raise RuntimeError(f"AgentLimb tool execution failed: {res.get('error')}")
            return res.get("result")
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8") if err.fp else ""
        raise RuntimeError(f"HTTP {err.code}: {body}") from err


def eval_js(
    expression: str,
    browser: Optional[str] = None,
    tab_id: Optional[int] = None,
    timeout: float = 60.0,
) -> Any:
    """Evaluate JavaScript in a tab (optionally targeting a specific browser profile/tab)."""
    args: Dict[str, Any] = {"expression": expression}
    if browser:
        args["browser"] = browser
    if tab_id is not None:
        args["tabId"] = int(tab_id)
    return call_tool("javascript_eval", args, timeout=timeout)


def get_tabs(browser: Optional[str] = None) -> List[Dict[str, Any]]:
    """List open tabs (optionally for a specific browser profile)."""
    args: Dict[str, Any] = {}
    if browser:
        args["browser"] = browser
    res = call_tool("tabs_context", args)
    if isinstance(res, dict) and "result" in res:
        res = res["result"]
    if isinstance(res, dict) and "tabs" in res:
        return res["tabs"]
    return []


if __name__ == "__main__":
    print("Testing AgentLimb RPC Client...")
    status = get_status()
    if not status:
        print("❌ No running AgentLimb bridge server found on ports 8765-8770.")
    else:
        print(f"✅ Bridge found on port {status.get('port')}: version {status.get('version')}")
        browsers = status.get("browserList", [])
        print(f"Connected browsers: {len(browsers)}")
        for b in browsers:
            print(f"  - {b.get('label')} (id: {b.get('id')}, active: {b.get('active')})")
        tabs = get_tabs()
        print(f"Active browser open tabs: {len(tabs)}")
