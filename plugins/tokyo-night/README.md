# Tokyo Night

Dark app theme for Orca that matches the built-in **Tokyo Night** terminal palette, so the
whole window (sidebars, tabs, chat, editor, diffs and git decorations) reads as one terminal.

- Palette: [tokyonight.nvim](https://github.com/folke/tokyonight.nvim) "night" style
  (`#1a1b26` background, `#c0caf5` text, `#7aa2f7` accent).
- Comments use `#7a82ad` instead of upstream `#565f89`: Orca drops code colors under 3:1
  contrast with the editor background.
- Only a dark theme is shipped; the light slot keeps Orca's default.

Select it in Settings → Appearance → Dark theme after installing.

## Chart tokens are a dark blue ramp

Orca paints Mermaid diagrams from the chart tokens: `--chart-5` fills nodes and actors,
`--chart-4` and `--chart-3` fill secondary and tertiary shapes, `--chart-1` draws borders, and
all text uses `--foreground`. So `--chart-3`..`--chart-5` stay dark (at least 4.5:1 against
`#c0caf5`), following Orca's own light-to-dark blue ramp. Bright accents there make diagram
labels unreadable.
