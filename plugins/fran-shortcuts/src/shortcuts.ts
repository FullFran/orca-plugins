// Fran's Orca shortcuts. Mirrors the keybinding overrides applied to Orca
// (source of truth: dotfiles orca/orca-settings.json). The Ctrl+Shift layer copies his
// tmux bindings without a prefix; Ctrl+h/j/k/l stay with the terminal.

export type Shortcut = { keys: string; action: string; note?: string }
export type ShortcutGroup = { title: string; items: readonly Shortcut[] }

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Panes and tabs',
    items: [
      { keys: 'Ctrl+Shift+T', action: 'New terminal tab', note: 'tmux C-S-t' },
      { keys: 'Ctrl+Shift+W', action: 'Close pane or tab', note: 'tmux C-S-w' },
      { keys: 'Ctrl+Shift+R', action: 'Split right', note: 'tmux C-S-r' },
      { keys: 'Ctrl+Shift+F', action: 'Split down', note: 'tmux C-S-f' },
      { keys: 'Ctrl+Shift+H', action: 'Previous pane', note: 'tmux C-S-h' },
      { keys: 'Ctrl+Shift+L', action: 'Next pane', note: 'tmux C-S-l' },
      { keys: 'Ctrl+Shift+Z', action: 'Maximize or restore pane', note: 'tmux C-S-z' },
      { keys: 'Ctrl+Tab', action: 'Next tab' },
      { keys: 'Ctrl+Shift+Tab', action: 'Previous tab' },
      { keys: 'Alt+1…9', action: 'Go to tab 1–9' },
      { keys: 'Ctrl+Shift+A', action: 'New agent tab', note: 'tmux C-S-a' }
    ]
  },
  {
    title: 'Workspaces',
    items: [
      { keys: 'Ctrl+Shift+S', action: 'Switch view (workspace palette)', note: 'tmux C-S-s sessions' },
      { keys: 'Ctrl+Shift+B', action: 'Previous view', note: 'tmux C-S-b' },
      { keys: 'Ctrl+Shift+E', action: 'New workspace', note: 'tmux C-S-e' },
      { keys: 'Ctrl+Shift+N', action: 'Rename workspace', note: 'tmux C-S-n' },
      { keys: 'Ctrl+1…9', action: 'Go to workspace 1–9' }
    ]
  },
  {
    title: 'Panels',
    items: [
      { keys: 'Ctrl+Shift+G', action: 'Floating terminal', note: 'tmux C-S-g scratch' },
      { keys: 'Alt+M', action: 'Agent dashboard', note: 'tmux M-m' },
      { keys: 'Alt+B', action: 'Left sidebar' },
      { keys: 'Alt+E', action: 'File explorer' },
      { keys: 'Alt+F', action: 'Search in project' },
      { keys: 'Alt+G', action: 'Source control' },
      { keys: 'Ctrl+P', action: 'Go to file' },
      { keys: 'Ctrl+E', action: 'Dictation' }
    ]
  },
  {
    title: 'Terminal',
    items: [
      { keys: 'Ctrl+h/j/k/l', action: 'Move between nvim splits', note: 'left to the terminal' },
      { keys: 'Ctrl+W', action: 'Delete previous word', note: 'left to the terminal' },
      { keys: 'Ctrl+L', action: 'Clear screen', note: 'left to the terminal' },
      { keys: 'Ctrl+B', action: 'Claude Code: background task', note: 'left to the terminal' },
      { keys: 'tm', action: 'Attach the tmux "main" session', note: 'shell alias; agents there are invisible to Orca' }
    ]
  }
]

export function filterGroups(groups: readonly ShortcutGroup[], query: string): ShortcutGroup[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return groups.map((group) => ({ ...group, items: [...group.items] }))
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        [item.keys, item.action, item.note ?? ''].some((field) => field.toLowerCase().includes(needle))
      )
    }))
    .filter((group) => group.items.length > 0)
}
