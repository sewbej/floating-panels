#!/usr/bin/env python3
import sys
import re
import subprocess
from pathlib import Path

def main():
    extension_dir = Path(__file__).parent.resolve()
    css_path = extension_dir / "stylesheet.css"

    if not css_path.exists():
        sys.exit(1)

    try:
        content = css_path.read_text(encoding="utf-8")

        def clear_before_comment(match):
            indentation = match.group(1)
            comment = match.group(2)
            return f"{indentation}{comment}"

        pattern = r'^(\s*).*(/\*(?:border-radius-applet|padding-applet|margin-applet|vertical-margin-applet)\*/)'

        updated_content = re.sub(pattern, clear_before_comment, content, flags=re.MULTILINE)

        if updated_content != content:
            css_path.write_text(updated_content, encoding="utf-8")

            subprocess.run(
                ["cinnamon-dbus-command", "ReloadTheme"],
                check=True
            )

    except Exception as e:
        print(f"CSS file editing error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
