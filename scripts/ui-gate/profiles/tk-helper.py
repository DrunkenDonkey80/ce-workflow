"""ce-ui-gate tkinter introspection helper (plan-final.md 2.7 P4).

Debug-mode self-report: walks the widget tree and prints one JSON line
with normalized geometry. Apps embed `report(root)`; the fixture mode
below builds a two-button window for the gate's own tests.
"""

import json
import sys
import tkinter as tk


def report(root):
    elements = []

    def text_of(widget):
        try:
            value = widget.cget("text")
            return value if isinstance(value, str) else ""
        except tk.TclError:
            return ""

    def walk(widget, key):
        try:
            info = {
                "key": key,
                "class": widget.winfo_class(),
                "text": text_of(widget),
                "x": widget.winfo_rootx(),
                "y": widget.winfo_rooty(),
                "w": max(0, widget.winfo_width()),
                "h": max(0, widget.winfo_height()),
            }
            elements.append(info)
        except tk.TclError:
            return
        for index, child in enumerate(widget.winfo_children()):
            walk(child, key + "/" + str(index))

    walk(root, "0")
    return elements


def fixture():
    app = tk.Tk()
    app.title("ce-ui-gate fixture")
    app.geometry("320x160+40+40")
    tk.Button(app, text="Alpha").place(x=20, y=20, width=90, height=34)
    tk.Button(app, text="Beta").place(x=200, y=20, width=90, height=34)
    app.update_idletasks()
    app.update()
    payload = {
        "viewport": {"width": app.winfo_width(), "height": app.winfo_height()},
        "elements": report(app),
    }
    app.destroy()
    return payload


if __name__ == "__main__":
    print(json.dumps(fixture() if len(sys.argv) < 2 else "unsupported"))
