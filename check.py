from pathlib import Path
text = Path('preload.js').read_text().splitlines()[0]
print(repr(text))
