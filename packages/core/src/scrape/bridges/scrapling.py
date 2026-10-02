"""fork: scrapling bridge for the ultimate scraper.

Reads JSON {"url","timeout_ms","proxy"} from argv[1], fetches with
scrapling Fetcher.get (curl-cffi impersonation, robots-aware), and prints
JSON {"ok","url","final_url","html","status"} or {"ok":false,"error"}.
Runs under `uvx --from scrapling[fetchers]` so no repo dependency changes.
"""

import json
import sys


def main() -> None:
    try:
        payload = json.loads(sys.argv[1])
    except Exception as error:
        print(json.dumps({"ok": False, "error": f"bad input: {error}"}))
        raise SystemExit(1)
    url = payload.get("url", "")
    timeout = int(payload.get("timeout_ms", 30000) or 30000) / 1000
    # fork: uvx --from resolves the bridge file's directory first, so make
    # sure `import scrapling` hits site-packages, never this file's name.
    # (The bridge file is named scrapling.py; without this, `import scrapling`
    # imports the bridge itself.)
    import os

    sys.path = [p for p in sys.path if os.path.abspath(p) not in (os.path.dirname(os.path.abspath(__file__)), "")]
    for module in [m for m in list(sys.modules) if m == "scrapling" or m.startswith("scrapling.")]:
        del sys.modules[module]
    try:
        from scrapling import Fetcher

        kwargs: dict = {"timeout": timeout}
        if payload.get("proxy"):
            kwargs["proxy"] = payload["proxy"]
        page = Fetcher.get(url, **kwargs)
        if page.status >= 400:
            print(json.dumps({"ok": False, "error": f"HTTP {page.status}", "status": page.status}))
            raise SystemExit(2)
        print(json.dumps({"ok": True, "url": url, "final_url": page.url, "html": page.html_content, "status": page.status}))
    except SystemExit:
        raise
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)[:2000]}))
        raise SystemExit(3)


if __name__ == "__main__":
    main()
