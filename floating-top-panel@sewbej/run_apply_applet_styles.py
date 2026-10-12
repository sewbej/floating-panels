#!/usr/bin/env python3
import sys
import os
import re
import subprocess


def process_stylesheet(radius_val=None, padding_val=None, margin_val=None, vmargin_val=None):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    stylesheet_path = os.path.join(script_dir, "stylesheet.css")

    if not os.path.exists(stylesheet_path):
        return False

    try:
        with open(stylesheet_path, "r", encoding="utf-8") as f:
            content = f.read()

        updated_content = content

        styles_to_update = [
            ("border-radius", "border-radius-applet", radius_val),
            ("padding", "padding-applet", padding_val),
            ("margin", "margin-applet", margin_val),
            ("vmargin", "vertical-margin-applet", vmargin_val),
        ]

        for prop_name, comment_tag, val in styles_to_update:
            if val is None:
                continue

            formatted_val = str(val).strip()
            if not formatted_val.endswith("px"):
                formatted_val = f"{formatted_val}px"

            pattern_update = rf"([a-zA-Z\-]+:\s*)[^;/\n]+(;?\s*/\*\s*{comment_tag}\s*\*/)"
            
            if re.search(pattern_update, updated_content):
                updated_content = re.sub(
                    pattern_update,
                    rf"\g<1> {formatted_val}\g<2>",
                    updated_content
                )
            else:
                pattern_restore = rf"^([ \t]*)(/\*\s*{comment_tag}\s*\*/)"
                updated_content = re.sub(
                    pattern_restore,
                    rf"\g<1>{formatted_val}\g<2>",
                    updated_content,
                    flags=re.MULTILINE
                )

        if updated_content != content:
            with open(stylesheet_path, "w", encoding="utf-8") as f:
                f.write(updated_content)
            return True

        return False

    except Exception as e:
        print(f"CSS file editing error: {e}", file=sys.stderr)
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
    radius = sys.argv[1] if len(sys.argv) >= 2 else None
    padding = sys.argv[2] if len(sys.argv) >= 3 else None
    margin = sys.argv[3] if len(sys.argv) >= 4 else None
    vmargin = sys.argv[4] if len(sys.argv) >= 5 else None

    if radius or padding or margin or vmargin:
        success = process_stylesheet(radius, padding, margin, vmargin)
        if success:
            reload_cinnamon_theme()
