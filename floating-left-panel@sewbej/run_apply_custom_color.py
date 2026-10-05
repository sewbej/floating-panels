#!/usr/bin/env python3
import sys
import os
import re
import subprocess


def update_css_line(content, comment_tag, new_color):
    pattern = rf"(\s*).*?(;\s*/\*\s*{comment_tag}\s*\*/)"
    replacement = rf"\g<1>{new_color}\g<2>"
    return re.sub(pattern, replacement, content, flags=re.MULTILINE)


def process_stylesheet(start_color, end_color, border_color):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    stylesheet_path = os.path.join(script_dir, "stylesheet.css")

    if not os.path.exists(stylesheet_path):
        return False

    try:
        with open(stylesheet_path, "r", encoding="utf-8") as f:
            content = f.read()

        content = update_css_line(content, "gradient-start-custom", start_color)
        content = update_css_line(content, "gradient-end-custom", end_color)
        content = update_css_line(content, "border-color-custom", border_color)

        with open(stylesheet_path, "w", encoding="utf-8") as f:
            f.write(content)

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
    if len(sys.argv) >= 4:
        c_start = sys.argv[1]
        c_end = sys.argv[2]
        c_border = sys.argv[3]

        success = process_stylesheet(c_start, c_end, c_border)

        if success:
            reload_cinnamon_theme()
