#!/usr/bin/env python3
import sys
import os
import re
import subprocess


def process_stylesheet(opacity_value):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    stylesheet_path = os.path.join(script_dir, "stylesheet.css")

    if not os.path.exists(stylesheet_path):
        return False

    try:
        formatted_value = str(opacity_value).strip()

        if not formatted_value.endswith(");"):
            formatted_value = f"{formatted_value});"

        with open(stylesheet_path, "r", encoding="utf-8") as f:
            content = f.read()

        pattern = r"(\s*).*?(/\*\s*opacity\s*\*/)"
        replacement = rf"\g<1>{formatted_value} \g<2>"

        updated_content = re.sub(
            pattern,
            replacement,
            content,
            flags=re.MULTILINE
        )

        with open(stylesheet_path, "w", encoding="utf-8") as f:
            f.write(updated_content)

        return True

    except Exception:
        return False


def reload_cinnamon_theme():
    try:
        subprocess.run(
            ["cinnamon-dbus-command", "ReloadTheme"],
            check=True
        )
    except Exception:
        pass


if __name__ == "__main__":
    if len(sys.argv) >= 2:
        val = sys.argv[1]

        success = process_stylesheet(val)

        if success:
            reload_cinnamon_theme()
