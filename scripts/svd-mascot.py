"""Reproduce the article's grayscale SVD experiment. Requires numpy and Pillow."""
import json
from pathlib import Path

import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / "public/img/resources/mascot/novel/phone.png"
target = root / "public/img/posts/math-svd"
image = Image.open(source).convert("RGBA")
image.thumbnail((192, 192), Image.Resampling.LANCZOS)
canvas = Image.new("RGBA", (192, 192))
canvas.paste(image, ((192 - image.width) // 2, (192 - image.height) // 2))
alpha = np.asarray(canvas.getchannel("A"))
gray = np.asarray(canvas.convert("L")).copy()
# Hidden RGB values must not contribute arbitrary information to the matrix.
gray[alpha == 0] = 0
matrix = gray.astype(np.float64)
u, s, vt = np.linalg.svd(matrix, full_matrices=False)


def save(values, name):
    rgba = Image.fromarray(values).convert("RGBA")
    rgba.putalpha(Image.fromarray(alpha))
    rgba.save(target / name)


save(gray, "mascot-original.png")
metrics = []
for k in (8, 32, 80):
    approximation = (u[:, :k] * s[:k]) @ vt[:k]
    pixels = np.rint(np.clip(approximation, 0, 255)).astype(np.uint8)
    save(pixels, f"mascot-k{k}.png")
    metrics.append({"k": k, "factorValues": 384 * k,
                    "rmse": float(np.sqrt(np.mean((pixels.astype(float) - matrix) ** 2)))})
report = {"source": str(source.relative_to(root)), "size": [192, 192],
          "alpha": "preserved separately, excluded from factor counts and RMSE",
          "background": "fully transparent pixels are zero in the grayscale matrix",
          "metrics": metrics}
(target / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
