#!/usr/bin/env python3
"""Labeled study chart for v12 (replaces v11-study-papers).
Portrait 9:16 so it fills the video frame (the engine letterboxes
landscape into a small band; portrait keeps the text legible).
Hunger stays high, fullness stays low over 12 months after a diet.
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

months = [0, 1, 2, 3, 6, 9, 12]
hunger = [100, 108, 112, 110, 108, 106, 105]      # rises, stays high
fullness = [100, 82, 74, 71, 73, 75, 76]          # drops, stays low

fig, ax = plt.subplots(figsize=(9, 16), dpi=120)
fig.patch.set_facecolor("white")
ax.set_facecolor("white")
ax.plot(months, hunger, color="#1f3864", linewidth=7, marker="o",
        markersize=14, label="Hunger")
ax.plot(months, fullness, color="#7ba05b", linewidth=7, marker="o",
        markersize=14, label="Fullness")
ax.axhline(100, color="#999999", linewidth=2, linestyle="--")
ax.set_title("Hunger stayed high.\nFullness stayed low.",
             fontsize=40, fontweight="bold", color="#1a1a1a", pad=28)
ax.set_xlabel("Months after the diet ended", fontsize=30, color="#333333")
ax.set_ylabel("Relative to before the diet", fontsize=30, color="#333333")
ax.set_xlim(0, 12)
ax.set_ylim(60, 120)
ax.set_xticks([0, 3, 6, 9, 12])
ax.set_xticklabels(["0", "3", "6", "9", "12"], fontsize=28)
ax.set_yticks([60, 80, 100, 120])
ax.set_yticklabels(["60%", "80%", "100%", "120%"], fontsize=28)
ax.legend(loc="lower right", fontsize=30, frameon=True, facecolor="white",
          edgecolor="#cccccc")
ax.grid(True, color="#e0e0e0", linewidth=1)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
for s in ("left", "bottom"):
    ax.spines[s].set_color("#888888")
    ax.spines[s].set_linewidth(2)
plt.tight_layout()
plt.savefig("images-v12/v12-chart-labeled.jpg", dpi=120)
print("saved images-v12/v12-chart-labeled.jpg")
