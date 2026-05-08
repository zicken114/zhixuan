# AI Research Assistant — Frontend Layout Documentation

> **Target audience**: Frontend engineers who need to modify UI components, adjust styles, or add new windows.
> This document describes every window, component, button, background, and style used in the application.

---

## Table of Contents

1. [Global Design System](#1-global-design-system)
2. [Window Overview](#2-window-overview)
3. [Widget Window (Floating Orb)](#3-widget-window-floating-orb)
4. [Main Window (Chat Interface)](#4-main-window-chat-interface)
5. [Popup Window (Clipboard Menu)](#5-popup-window-clipboard-menu)
6. [Capture Window (Screenshot Selection)](#6-capture-window-screenshot-selection)
7. [Result Window (OCR/Extraction Display)](#7-result-window-ocrextraction-display)
8. [Knowledge Panel (Sidebar)](#8-knowledge-panel-sidebar)
9. [Settings Panel](#9-settings-panel)
10. [Review Wizard Window](#10-review-wizard-window)
11. [Sentinel Brief Window](#11-sentinel-brief-window)
12. [Experiment Snapshot Window](#12-experiment-snapshot-window)
13. [Shared Component Patterns](#13-shared-component-patterns)
14. [Dark Theme vs Light Theme](#14-dark-theme-vs-light-theme)

---

## 1. Global Design System

### 1.1 Color Palette

The app uses a **dark-first** design with one accent color (teal/cyan). CSS variables are defined in `src/style.css`:

| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#00e5cc` | Primary accent: buttons, borders, active states, progress bars |
| `--accent-dim` | `#00b8a3` | Gradient end, darker accent variant |
| `--accent-glow` | `rgba(0,229,204,0.3)` | Glow effects, scrollbar, selection |
| `--bg-base` | `#07070d` | Deepest background layer |
| `--bg-panel` | `rgba(13,13,20,0.95)` | Panel/card backgrounds |
| `--bg-card` | `rgba(13,13,20,0.98)` | Card surfaces |
| `--bg-input` | `rgba(255,255,255,0.04)` | Input field backgrounds |
| `--text-primary` | `#f0f0f5` | Headings, primary text |
| `--text-secondary` | `rgba(240,240,245,0.8)` | Body text |
| `--text-muted` | `rgba(240,240,245,0.5)` | Labels, hints |
| `--text-dim` | `rgba(240,240,245,0.4)` | Disabled, placeholders |
| `--border-subtle` | `rgba(255,255,255,0.06)` | Dividers, borders |
| `--border-light` | `rgba(255,255,255,0.08)` | Card borders, input borders |
| `--error` | `#ef4444` | Error text, destructive actions |
| `--error-bg` | `rgba(239,68,68,0.15)` | Error button backgrounds |

**Secondary colors used in specific contexts:**
- Blue (`#3d74e7`): Knowledge base actions, copy buttons, secondary accents
- Purple (`#8b5cf6`): "Generate Review" button in Knowledge Panel
- Zotero orange (`#cd5a28`): Zotero sync button
- Green (`#10b981`, `#22c55e`): Success states, saved indicators

### 1.2 Typography

| Font | Usage | Weight |
|------|-------|--------|
| `'Syne', sans-serif` | Display headings, window titles, brand text | 400–800 |
| `'DM Sans', sans-serif` | Body text, UI labels, inputs | 300–600 |
| `'JetBrains Mono', monospace` | Code, progress numbers, metadata tags | 400–500 |

**Type scale:**
- Window title: `0.85rem – 0.9rem`, weight 600
- Section heading (`h3`): `0.9rem`, weight 600
- Card title: `0.8rem`, weight 700, uppercase, letter-spacing `0.12em`
- Body text: `0.82rem – 0.875rem`
- Small/meta: `0.7rem – 0.78rem`
- Tiny: `0.65rem – 0.72rem`

### 1.3 Spacing & Radius

| Token | Value |
|-------|-------|
| `--space-xs` | `0.25rem` (4px) |
| `--space-sm` | `0.5rem` (8px) |
| `--space-md` | `0.75rem` (12px) |
| `--space-lg` | `1rem` (16px) |
| `--space-xl` | `1.25rem` (20px) |
| `--radius-sm` | `6px` |
| `--radius-md` | `8px` |
| `--radius-lg` | `10px` |
| `--radius-xl` | `12px` |
| `--radius-full` | `999px` (pills) |

### 1.4 Transitions

| Token | Value | Usage |
|-------|-------|-------|
| `--transition-fast` | `0.15s ease` | Hover states, small UI |
| `--transition-base` | `0.2s ease` | Buttons, cards, general |
| `--transition-slow` | `0.24s ease` | Larger state changes |
| `--transition-widget` | `0.28s ease` | Widget window animations |

### 1.5 Scrollbar Styling

```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
::-webkit-scrollbar-thumb { background: var(--accent-glow); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--accent-glow-strong); }
```

---

## 2. Window Overview

The app has **8 distinct windows**, each implemented as a separate Vue component in `src/windows/`:

| Window | File | Role | Size (typical) | Theme |
|--------|------|------|----------------|-------|
| Widget | `WidgetWindow.vue` | Floating desktop orb | 72×72px (collapsed), 280×360px (expanded) | Dark |
| Main | `MainWindow.vue` | Primary chat interface | 420×680px | Dark |
| Popup | `PopupWindow.vue` | Clipboard action menu | 200×280px (menu), 520×420px (panels) | Dark |
| Capture | `CaptureWindow.vue` | Full-screen screenshot overlay | Fullscreen | Dark overlay |
| Result | `ResultWindow.vue` | Extraction result display | 400×320px | Dark |
| Knowledge Panel | `KnowledgePanel.vue` | KB + Zotero sidebar | 380×100% | Dark |
| Settings | `SettingsPanel.vue` | Configuration panel | 480×100% | **Light** |
| Review Wizard | `ReviewWizardWindow.vue` | Literature review generator | 520×600px | Dark |
| Sentinel Brief | `SentinelBriefWindow.vue` | New paper notifications | 400×500px | Dark |
| Experiment Snapshot | `ExperimentSnapshotWindow.vue` | Quick experiment record | 320×420px | Dark |

> **Note**: SettingsPanel is the **only light-theme window**. All others use the dark neural theme.

---

## 3. Widget Window (Floating Orb)

**File**: `src/windows/WidgetWindow.vue`

### Layout Structure

```
.widget-window
├── .widget-shell (the visible orb)
│   ├── .core (inner circle with gradient)
│   └── .badge (notification dot, absolute)
├── .expanded-panel (shown on hover/click)
│   ├── .panel-header
│   │   ├── .header-title
│   │   └── .header-actions (minimize, close)
│   ├── .action-grid (6 action buttons)
│   └── .panel-footer (status text)
└── .breathing-ring (CSS animation, absolute behind orb)
```

### Orb (Collapsed State)

| Element | Style |
|---------|-------|
| `.widget-shell` | `width: 72px; height: 72px; border-radius: 50%` |
| `.core` | Gradient `linear-gradient(135deg, #00e5cc, #00b8a3)`, `box-shadow: 0 8px 32px rgba(0,229,204,0.25)` |
| `.breathing-ring` | Absolute, `inset: -6px`, animated scale pulse `0.85→1.05→0.85`, `opacity: 0.2→0` |
| `.badge` | `8px` circle, red `#ef4444`, absolute top-right |

**Hover**: `.tooltip` appears — `backdrop-filter: blur(12px)`, semi-transparent black background.

### Expanded Panel

| Element | Style |
|---------|-------|
| `.expanded-panel` | `width: 280px; height: 360px; border-radius: 18px; background: rgba(13,13,20,0.95)` |
| `.panel-header` | `padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.06)` |
| `.action-grid` | `display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 12px` |
| `.action-btn` | `border-radius: 12px; padding: 10px; background: rgba(255,255,255,0.04)` |

**Action buttons** (6 items): Chat, Capture, Read, Settings, Projects, Exit — each with an emoji icon and label.

---

## 4. Main Window (Chat Interface)

**File**: `src/windows/MainWindow.vue`

### Layout Structure

```
.main-window
├── .main-header (drag handle + title)
├── .chat-container
│   ├── ChatHeader (toolbar)
│   ├── ChatMessageList (scrollable message area)
│   └── ChatInputArea (input + send button)
└── .knowledge-panel-wrapper (slide-in sidebar)
```

### Header

| Element | Style |
|---------|-------|
| `.main-header` | `height: 40px; -webkit-app-region: drag; border-bottom: 1px solid rgba(255,255,255,0.06)` |
| Title | `'Syne'`, `0.85rem`, weight 600 |

### Chat Area

| Element | Style |
|---------|-------|
| `.chat-container` | `flex: 1; display: flex; flex-direction: column; overflow: hidden` |
| Message list | `flex: 1; overflow-y: auto; padding: 1rem` |
| Input area | `border-top: 1px solid rgba(255,255,255,0.06); padding: 0.75rem 1rem` |

### ChatHeader Component (`src/components/ChatHeader.vue`)

```
.chat-header
├── .header-left
│   ├── .back-btn (svg arrow + "Back")
│   └── .header-title
└── .header-right
    ├── .icon-btn (pin icon)
    ├── .icon-btn (trash icon)
    └── .icon-btn (settings icon)
```

| Element | Style |
|---------|-------|
| `.chat-header` | `display: flex; justify-content: space-between; padding: 0.75rem 1rem` |
| `.back-btn` | `display: flex; gap: 0.35rem; padding: 0.4rem 0.7rem; border-radius: 8px` |
| `.icon-btn` | `width: 32px; height: 32px; border-radius: 8px; background: rgba(255,255,255,0.04)` |

### ChatMessageList Component (`src/components/ChatMessageList.vue`)

```
.message-list
└── .message (per message)
    ├── .message-avatar
    ├── .message-content
    │   ├── .message-header (role + time)
    │   ├── .message-text
    │   ├── .citation-badges (if citations)
    │   ├── .todo-list (if todos)
    │   └── .message-footer (tokens, model)
    └── .message-actions (copy, retry)
```

| Element | Style |
|---------|-------|
| `.message` | `margin-bottom: 1rem; display: flex; gap: 0.75rem` |
| `.message-avatar` | `32×32px` circle, gradient background |
| `.message-content` | `flex: 1; border-radius: 12px; padding: 0.75rem 1rem; background: rgba(255,255,255,0.03)` |
| `.message.user` | User messages aligned right |
| `.citation-badge` | `display: inline-flex; gap: 0.25rem; padding: 0.2rem 0.5rem; border-radius: 6px; background: rgba(0,229,204,0.1); color: #00e5cc; font-size: 0.7rem` |
| `.todo-item` | `padding: 0.5rem 0.75rem; border-radius: 8px; background: rgba(61,116,231,0.08); border-left: 3px solid #3d74e7` |
| `.message-footer` | `font-size: 0.7rem; color: rgba(240,240,245,0.35); margin-top: 0.5rem` |

### ChatInputArea Component (`src/components/ChatInputArea.vue`)

```
.chat-input-area
├── .input-wrapper
│   ├── textarea (auto-resizing)
│   └── .input-actions
│       ├── .attach-btn (paperclip)
│       └── .send-btn (arrow)
└── .input-hints (optional context pills)
```

| Element | Style |
|---------|-------|
| `.chat-input-area` | `display: flex; flex-direction: column; gap: 0.5rem` |
| `textarea` | `flex: 1; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 0.75rem 1rem; color: #f0f0f5; resize: none; max-height: 120px` |
| `.send-btn` | `width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #00e5cc, #00b8a3)` |
| `.attach-btn` | Same size, `background: rgba(255,255,255,0.06)` |

---

## 5. Popup Window (Clipboard Menu)

**File**: `src/windows/PopupWindow.vue`

### Layout Structure

```
.popup-window
├── [Conditional Panels — only one visible at a time]
│   ├── .polish-panel
│   ├── .reading-note-panel
│   ├── .citation-panel
│   ├── .citation-fix-panel
│   └── .menu-item (×N) + .processing-overlay
└── ::before (subtle top glow line)
```

### Default Menu State

| Element | Style |
|---------|-------|
| `.popup-window` | `width: 100%; height: 100%; background: rgba(13,13,20,0.95); border-radius: 12px; padding: 0.5rem; box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)` |
| `::before` | Top glow line: `width: 60%; height: 1px; background: linear-gradient(90deg, transparent, rgba(0,229,204,0.5), transparent)` |
| `.menu-item` | `display: flex; gap: 0.875rem; padding: 0.875rem 1rem; border-radius: 8px; color: rgba(240,240,245,0.8)` |
| `.menu-item::before` | Left accent bar: `width: 3px; background: #00e5cc; transform: scaleY(0); transition: transform 0.2s` |
| `.menu-item:hover` | `background: rgba(0,229,204,0.08); color: #f0f0f5` + left bar scales to full height |
| `.icon` | `font-size: 1.25rem; width: 28px; text-align: center` |
| `.label` | `font-size: 0.875rem; font-weight: 500` |

**Menu items dynamically adapt** based on the active foreground app (writing app, PDF reader, etc.).

### Processing Overlay

```
.processing-overlay (absolute, covers entire popup)
└── .progress-container
    ├── .progress-label
    ├── .progress-bar-track (6px height)
    │   └── .progress-bar-fill (gradient #00e5cc → #00b8a3)
    ├── .progress-percent
    └── .cancel-btn (red outline)
```

### Polish Panel

| Element | Style |
|---------|-------|
| `.polish-panel` | `width: 100%; height: 100%; display: flex; flex-direction: column; padding: 0.75rem` |
| `.polish-diff` | `flex: 1; overflow-y: auto; background: rgba(0,0,0,0.2); padding: 0.75rem; border-radius: 8px; font-size: 0.8rem` |
| `.diff-add` | `background: rgba(34,197,94,0.25); color: #4ade80` |
| `.diff-del` | `background: rgba(239,68,68,0.25); color: #f87171; text-decoration: line-through` |
| `.polish-btn.accept` | `background: linear-gradient(135deg, #00e5cc, #00b8a3); color: #06211f` |
| `.polish-btn.reject` | `background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1)` |

### Citation Recommendation Panel

| Element | Style |
|---------|-------|
| `.citation-card` | `padding: 0.6rem 0.75rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px` |
| `.citation-card.selected` | `border-color: rgba(0,229,204,0.3); background: rgba(0,229,204,0.05)` |
| `.citation-reason` | `font-size: 0.72rem; color: rgba(0,229,204,0.7); font-style: italic` |
| `.format-btn` | `padding: 0.25rem 0.5rem; background: rgba(0,229,204,0.1); border: 1px solid rgba(0,229,204,0.2); border-radius: 5px; color: #00e5cc; font-size: 0.65rem` |
| `.format-btn.preferred` | `background: rgba(0,229,204,0.25); border-color: rgba(0,229,204,0.5); box-shadow: 0 0 8px rgba(0,229,204,0.15)` |
| `.citation-insert-bar` | `display: flex; justify-content: space-between; padding: 0.6rem 0.75rem; border-top: 1px solid rgba(255,255,255,0.06); background: rgba(0,229,204,0.05)` |
| `.insert-btn` | `background: linear-gradient(135deg, #00e5cc, #00b8a3); color: #06211f; border-radius: 6px` |

---

## 6. Capture Window (Screenshot Selection)

**File**: `src/windows/CaptureWindow.vue`

### Layout Structure

```
.capture-window (fullscreen, cursor: crosshair)
├── img.background-image (screenshot, z-index: 0)
├── .overlay (semi-transparent mask, z-index: 1)
├── .selection-box (draggable selection, z-index: 10)
│   └── .selection-info (dimensions, bottom center)
├── .instructions (top center, before selection)
├── ExtractPromptMenu (after selection)
├── ExtractProcessingOverlay (during OCR)
└── ExtractResultOverlay (result display)
```

### Selection Box

| Element | Style |
|---------|-------|
| `.selection-box` | `position: absolute; border: 2px solid #00e5cc; background: rgba(0,229,204,0.1); box-shadow: 0 0 0 9999px rgba(7,7,13,0.5)` |
| `.selection-box::before` | `inset: -4px; border: 1px solid rgba(0,229,204,0.3)` (outer glow ring) |
| `.selection-info` | `position: absolute; bottom: -28px; left: 50%; transform: translateX(-50%); background: rgba(13,13,20,0.95); color: #00e5cc; font-family: 'JetBrains Mono'; font-size: 11px; padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(0,229,204,0.2)` |

### Instructions Banner

| Element | Style |
|---------|-------|
| `.instructions` | `position: absolute; top: 24px; left: 50%; transform: translateX(-50%); background: rgba(13,13,20,0.9); backdrop-filter: blur(12px); padding: 12px 24px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.06); box-shadow: 0 4px 20px rgba(0,0,0,0.3); pointer-events: none; z-index: 20` |

---

## 7. Result Window (OCR/Extraction Display)

**File**: `src/windows/ResultWindow.vue`

### Layout Structure

```
.result-window
├── .processing-state (or)
│   └── .progress-container
│       ├── .progress-icon (🔍)
│       ├── .progress-label
│       ├── .progress-bar-track
│       │   └── .progress-bar-fill
│       ├── .progress-percent
│       ├── .cancel-btn
│       └── .streaming-preview
└── .result-state
    ├── .result-header (icon + label)
    ├── .result-content (preformatted text)
    └── .result-footer
        ├── "✓ 已复制到剪贴板"
        └── .result-actions
            ├── .note-btn (加入阅读笔记)
            └── .close-btn
```

### Processing State

| Element | Style |
|---------|-------|
| `.progress-container` | `width: 80%; max-width: 320px; text-align: center` |
| `.progress-icon` | `font-size: 2.5rem; margin-bottom: 16px` |
| `.progress-bar-track` | `width: 100%; height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px` |
| `.progress-bar-fill` | `background: linear-gradient(90deg, #00e5cc, #00b8a3); box-shadow: 0 0 10px rgba(0,229,204,0.4)` |
| `.progress-percent` | `color: #00e5cc; font-family: 'JetBrains Mono'; font-size: 12px; font-weight: 600` |
| `.cancel-btn` | `background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #ef4444` |
| `.streaming-preview` | `font-family: 'JetBrains Mono'; font-size: 12px; color: rgba(240,240,245,0.5); background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; max-height: 60px` |

### Result State

| Element | Style |
|---------|-------|
| `.result-header` | `display: flex; gap: 10px; padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(0,229,204,0.03)` |
| `.result-content pre` | `font-family: 'JetBrains Mono'; font-size: 13px; color: #e2e8f0; background: rgba(0,0,0,0.2); padding: 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.04)` |
| `.result-footer` | `display: flex; justify-content: space-between; padding: 12px 20px; border-top: 1px solid rgba(255,255,255,0.06); color: rgba(240,240,245,0.45); font-size: 12px; background: rgba(0,229,204,0.05)` |
| `.note-btn` | `background: rgba(61,116,231,0.15); border: 1px solid rgba(61,116,231,0.25); color: #3d74e7` |
| `.note-btn.saved` | `background: rgba(34,197,94,0.15); border-color: rgba(34,197,94,0.3); color: #22c55e` |

---

## 8. Knowledge Panel (Sidebar)

**File**: `src/components/KnowledgePanel.vue`

### Layout Structure

```
.knowledge-panel
├── .drag-handle (32px, draggable)
├── .panel-header
│   ├── .header-left (back btn + title)
│   └── .close-btn
├── .search-section
│   └── .search-input-wrapper (input + search btn)
├── .actions-section
│   ├── .tab-bar (Local Docs / Zotero)
│   ├── .review-btn (📚 生成综述)
│   └── .tab-actions (Add Folder / Sync Zotero / Select Folders)
│       └── .collection-selector (dropdown, conditional)
├── .modal-overlay (download model, conditional)
├── .progress-bar (indexing, conditional)
├── .error-message (conditional)
├── .results-section (search results, conditional)
└── .documents-section
    ├── .section-title + .doc-count
    ├── .empty-state
    └── .doc-list
        └── .doc-item (×N)
```

### Panel Header

| Element | Style |
|---------|-------|
| `.knowledge-panel` | `width: 100%; height: 100%; background: rgba(7,7,13,0.96); backdrop-filter: blur(20px); border-left: 1px solid rgba(255,255,255,0.06)` |
| `.knowledge-panel::before` | Subtle radial gradient glow at top-left: `radial-gradient(ellipse at 30% 20%, rgba(0,229,204,0.03), transparent 50%)` |
| `.panel-header` | `padding: 0.875rem 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em` |
| `.back-btn` | `display: flex; gap: 0.35rem; padding: 0.4rem 0.7rem; border-radius: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08)` |
| `.back-btn:hover` | `background: rgba(0,229,204,0.1); border-color: rgba(0,229,204,0.3); color: #00e5cc` |

### Search Input

| Element | Style |
|---------|-------|
| `.search-input` | `flex: 1; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.5rem 0.75rem; color: rgba(240,240,245,0.85); font-size: 0.82rem` |
| `.search-input:focus` | `border-color: rgba(0,229,204,0.4)` |
| `.search-btn` | `background: rgba(0,229,204,0.12); border: 1px solid rgba(0,229,204,0.2); border-radius: 8px; color: #00e5cc; font-size: 0.78rem; font-weight: 600` |

### Tab Bar

| Element | Style |
|---------|-------|
| `.tab-bar` | `display: flex; gap: 0.3rem` |
| `.tab-btn` | `flex: 1; padding: 0.4rem 0.6rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.02); color: rgba(240,240,245,0.5); font-size: 0.78rem; font-weight: 600` |
| `.tab-btn.active` | `background: rgba(0,229,204,0.12); border-color: rgba(0,229,204,0.25); color: #00e5cc` |

### Review Button

| Element | Style |
|---------|-------|
| `.review-btn` | `width: 100%; padding: 0.5rem; background: rgba(139,92,246,0.12); border: 1px solid rgba(139,92,246,0.25); border-radius: 8px; color: #8b5cf6; font-size: 0.8rem; font-weight: 600` |

### Document Item

| Element | Style |
|---------|-------|
| `.doc-item` | `padding: 0.6rem 0.75rem; border-radius: 8px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); transition: all 0.15s ease` |
| `.doc-item:hover` | `background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.08)` |
| `.doc-name` | `font-size: 0.82rem; color: rgba(240,240,245,0.75); white-space: nowrap; overflow: hidden; text-overflow: ellipsis` |
| `.doc-status` | `font-size: 0.65rem; font-weight: 600; padding: 0.15rem 0.4rem; border-radius: 4px; text-transform: uppercase` |
| `.status-completed` | `background: rgba(16,185,129,0.12); color: #10b981` |
| `.status-indexing` | `background: rgba(0,229,204,0.12); color: #00e5cc` |
| `.status-pending` | `background: rgba(245,158,11,0.12); color: #f59e0b` |
| `.status-error` | `background: rgba(239,68,68,0.12); color: #ef4444` |

### Collection Selector Dropdown

| Element | Style |
|---------|-------|
| `.collection-selector` | `margin-top: 0.5rem; background: rgba(13,13,20,0.95); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 0.75rem; max-height: 260px` |
| `.breadcrumb` | `display: flex; flex-wrap: wrap; gap: 0.25rem; font-size: 0.7rem; color: rgba(240,240,245,0.35)` |
| `.breadcrumb-item.active` | `color: #00e5cc; font-weight: 600` |
| `.collection-item` | `display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.5rem; border-radius: 6px; cursor: pointer` |
| `.collection-item:hover` | `background: rgba(255,255,255,0.04)` |
| `.enter-folder-btn` | `background: rgba(0,229,204,0.1); border: none; border-radius: 4px; padding: 0.2rem 0.5rem; color: #00e5cc; font-size: 0.65rem` |

---

## 9. Settings Panel

**File**: `src/components/SettingsPanel.vue`

> **This is the only light-theme window.** All other windows are dark.

### Layout Structure

```
.settings-panel
├── .drag-handle (32px, draggable)
├── .header
│   ├── div (h2 "Settings" + subtitle)
│   └── .close-btn
└── .content (scrollable)
    ├── .card (×8: Text Model, Vision Model, Translation, Shortcuts, Privacy, Routing, Knowledge Base, External Tools)
    │   ├── .card-header (clickable toggle)
    │   │   ├── div (title + subtitle)
    │   │   └── .card-toggle ("Hide" / "Show")
    │   └── .card-body (collapsible)
    │       └── .form-group (inputs, toggles, grids)
    ├── .save-btn
    └── .reset-btn
```

### Background & Header

| Element | Style |
|---------|-------|
| `.settings-panel` | `background: radial-gradient(circle at top right, rgba(0,229,204,0.08), transparent 32%), linear-gradient(180deg, #fbfcfe 0%, #f4f7fb 100%)` |
| `.header` | `padding: 1.25rem 1.5rem; border-bottom: 1px solid rgba(15,23,42,0.08); background: rgba(255,255,255,0.85); backdrop-filter: blur(10px)` |
| `.header h2` | `font-family: 'Syne', sans-serif; font-size: 1.15rem; font-weight: 700; color: #111827` |
| `.header-subtitle` | `color: #6b7280; font-size: 0.82rem` |
| `.close-btn` | `color: #6b7280; font-size: 1.2rem; width: 34px; height: 34px; border-radius: 8px` |
| `.close-btn:hover` | `background: rgba(239,68,68,0.08); color: #ef4444` |

### Cards

| Element | Style |
|---------|-------|
| `.card` | `margin-bottom: 1rem; background: rgba(255,255,255,0.9); border: 1px solid rgba(15,23,42,0.06); border-radius: 18px; box-shadow: 0 14px 30px rgba(15,23,42,0.05)` |
| `.card-header` | `width: 100%; display: flex; justify-content: space-between; padding: 1.2rem 1.25rem; cursor: pointer; background: transparent; border: none` |
| `.card-title` | `font-family: 'Syne', sans-serif; font-size: 0.8rem; font-weight: 700; color: #00a896; text-transform: uppercase; letter-spacing: 0.12em` |
| `.card-subtitle` | `color: #6b7280; font-size: 0.82rem` |
| `.card-toggle` | `color: #3d74e7; font-size: 0.8rem; font-weight: 700` |

### Form Elements (Light Theme)

| Element | Style |
|---------|-------|
| `.input` | `width: 100%; background: #ffffff; border: 1px solid rgba(15,23,42,0.1); border-radius: 12px; padding: 0.82rem 1rem; color: #111827; font-size: 0.9rem; font-family: 'DM Sans', sans-serif` |
| `.input:focus` | `border-color: #00d1bb; box-shadow: 0 0 0 4px rgba(0,209,187,0.12)` |
| `.provider-chip` | `border-radius: 999px; padding: 0.75rem 0.95rem; background: #eef2f7; color: #6b7280; font-weight: 700; font-size: 0.88rem` |
| `.provider-chip.active` | `background: linear-gradient(135deg, #4f8cff, #3d74e7); color: #ffffff; box-shadow: 0 10px 22px rgba(61,116,231,0.22)` |
| `.provider-grid` | `display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 0.65rem` |

### Toggle Switch

| Element | Style |
|---------|-------|
| `.toggle-switch` | `width: 48px; height: 26px; border-radius: 999px; background: #d1d5db; border: none; cursor: pointer; position: relative` |
| `.toggle-switch.active` | `background: linear-gradient(135deg, #00e5cc, #00b8a3)` |
| `.toggle-knob` | `width: 20px; height: 20px; border-radius: 50%; background: #ffffff; position: absolute; top: 3px; left: 3px; box-shadow: 0 1px 3px rgba(0,0,0,0.15)` |
| `.toggle-switch.active .toggle-knob` | `transform: translateX(22px)` |

### Buttons

| Element | Style |
|---------|-------|
| `.save-btn` | `width: 100%; background: linear-gradient(135deg, #00e5cc, #00b8a3); border-radius: 12px; padding: 0.95rem; color: #06211f; font-family: 'Syne', sans-serif; font-weight: 700; box-shadow: 0 8px 20px rgba(0,184,163,0.22)` |
| `.save-btn.saved` | `background: linear-gradient(135deg, #10b981, #059669)` |
| `.reset-btn` | `width: 100%; background: transparent; border: 1px solid rgba(15,23,42,0.12); border-radius: 12px; padding: 0.9rem; color: #6b7280; font-family: 'DM Sans', sans-serif` |

---

## 10. Review Wizard Window

**File**: `src/windows/ReviewWizardWindow.vue`

A 4-step wizard for generating literature reviews.

### Layout Structure

```
.review-wizard
├── .wizard-header (@mousedown drag)
│   ├── .header-title ("📚 文献综述生成")
│   └── .close-btn
├── .step-indicator
│   └── .step-dot (×4, 1→4)
├── .wizard-content (scrollable)
│   └── [step 1–4 content]
└── .wizard-footer
    ├── .footer-btn ("上一步")
    └── .footer-btn.primary ("下一步")
```

### Header & Step Indicator

| Element | Style |
|---------|-------|
| `.review-wizard` | `width: 100%; height: 100%; background: rgba(7,7,13,0.98); display: flex; flex-direction: column; color: rgba(240,240,245,0.85)` |
| `.wizard-header` | `display: flex; justify-content: space-between; padding: 0.75rem 1rem; border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(13,13,20,0.5); cursor: move; -webkit-app-region: drag` |
| `.close-btn` | `background: none; border: none; color: rgba(240,240,245,0.4); font-size: 1.25rem; width: 28px; height: 28px; border-radius: 6px; -webkit-app-region: no-drag` |
| `.close-btn:hover` | `background: rgba(255,255,255,0.08); color: rgba(240,240,245,0.8)` |
| `.step-indicator` | `display: flex; justify-content: center; gap: 0.5rem; padding: 0.6rem; border-bottom: 1px solid rgba(255,255,255,0.04)` |
| `.step-dot` | `width: 24px; height: 24px; border-radius: 50%; background: rgba(255,255,255,0.06); color: rgba(240,240,245,0.4); border: 1px solid rgba(255,255,255,0.1); font-size: 0.72rem; font-weight: 700` |
| `.step-dot.active` | `background: rgba(0,229,204,0.15); border-color: rgba(0,229,204,0.3); color: #00e5cc` |
| `.step-dot.current` | `box-shadow: 0 0 8px rgba(0,229,204,0.2)` |

### Step 1: Source Selection

Three large cards in a vertical stack:

| Element | Style |
|---------|-------|
| `.source-options` | `display: flex; flex-direction: column; gap: 0.5rem` |
| `.source-card` | `display: flex; align-items: center; gap: 0.6rem; padding: 0.75rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; cursor: pointer; color: rgba(240,240,245,0.7)` |
| `.source-card.active` | `background: rgba(0,229,204,0.1); border-color: rgba(0,229,204,0.25)` |
| `.source-icon` | `font-size: 1.25rem` |
| `.source-label` | `font-size: 0.85rem; font-weight: 600` |

**Cards**: 📑 Zotero 收藏夹, 📄 知识库文献, 🔗 粘贴 DOI

### Step 2: Paper Selection

| Element | Style |
|---------|-------|
| `.paper-list` | `display: flex; flex-direction: column; gap: 0.35rem; max-height: 300px; overflow-y: auto` |
| `.paper-select-item` | `display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.6rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; cursor: pointer` |
| `.paper-select-item.selected` | `border-color: rgba(0,229,204,0.3)` |
| `.paper-title` | `font-size: 0.78rem; font-weight: 600; color: rgba(240,240,245,0.8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap` |
| `.paper-meta` | `font-size: 0.68rem; color: rgba(240,240,245,0.35)` |
| `.selection-count` | `margin-top: 0.5rem; font-size: 0.78rem; color: rgba(0,229,204,0.6); text-align: center` |

### Step 3: Style Selection

| Element | Style |
|---------|-------|
| `.style-options` | Same layout as `.source-options` |
| `.style-card` | Same as `.source-card` |
| `.style-name` | `font-size: 0.85rem; font-weight: 600` |
| `.style-desc` | `font-size: 0.72rem; color: rgba(240,240,245,0.4)` |

**Styles**: 学术综述 (academic), 调研简报 (brief), 简要概述 (summary)

| Element | Style |
|---------|-------|
| `.form-group` | `margin-top: 0.75rem` |
| `.form-group label` | `display: block; font-size: 0.75rem; color: rgba(240,240,245,0.5); font-weight: 600; margin-bottom: 0.3rem` |
| `.form-group input` | `width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0.5rem 0.6rem; color: #f0f0f5; font-size: 0.82rem` |

### Step 4: Generation

**Confirm step:**

| Element | Style |
|---------|-------|
| `.confirm-step` | `display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 1rem 0` |
| `.confirm-info` | `background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 1rem; width: 100%` |
| `.info-row` | `display: flex; justify-content: space-between; padding: 0.3rem 0; font-size: 0.82rem` |
| `.info-label` | `color: rgba(240,240,245,0.5)` |
| `.generate-btn` | `padding: 0.6rem 2rem; background: linear-gradient(135deg, #00e5cc, #00b8a3); border: none; border-radius: 10px; color: #06211f; font-size: 0.9rem; font-weight: 700` |

**Generating state:**

| Element | Style |
|---------|-------|
| `.progress-bar` | `width: 80%; height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden` |
| `.progress-fill` | `height: 100%; background: linear-gradient(90deg, #00e5cc, #3d74e7); border-radius: 2px; transition: width 0.3s ease` |
| `.progress-stage` | `font-size: 0.85rem; color: rgba(240,240,245,0.7)` |
| `.progress-detail` | `font-size: 0.72rem; color: rgba(240,240,245,0.35); font-family: 'JetBrains Mono', monospace` |

**Result preview:**

| Element | Style |
|---------|-------|
| `.result-header` | `display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem` |
| `.copy-btn` | `padding: 0.35rem 0.7rem; background: rgba(0,229,204,0.1); border: 1px solid rgba(0,229,204,0.2); border-radius: 6px; color: #00e5cc; font-size: 0.75rem` |
| `.section h4` | `margin: 0 0 0.4rem; font-size: 0.85rem; color: #00e5cc` |
| `.section-content` | `font-size: 0.82rem; line-height: 1.6; color: rgba(240,240,245,0.7); white-space: pre-wrap` |

### Footer Buttons

| Element | Style |
|---------|-------|
| `.wizard-footer` | `display: flex; justify-content: space-between; padding: 0.6rem 1rem; border-top: 1px solid rgba(255,255,255,0.06)` |
| `.footer-btn` | `padding: 0.4rem 1rem; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: rgba(240,240,245,0.7); font-size: 0.8rem` |
| `.footer-btn:disabled` | `opacity: 0.4; cursor: not-allowed` |
| `.footer-btn.primary` | `background: linear-gradient(135deg, #00e5cc, #00b8a3); border: none; color: #06211f; font-weight: 700` |

---

## 11. Sentinel Brief Window

**File**: `src/windows/SentinelBriefWindow.vue`

Displays newly discovered papers grouped by topic.

### Layout Structure

```
.sentinel-brief
├── .brief-header (draggable)
│   ├── .header-title
│   │   ├── .bell (📡)
│   │   ├── "文献简报"
│   │   └── .header-badge (unread count)
│   └── .close-btn
└── .brief-content
    ├── .loading
    ├── .empty
    └── .topic-groups
        └── .topic-group (×N)
            ├── .group-header
            │   ├── .group-name
            │   └── .group-count
            └── .paper-card (×N)
                ├── .paper-title
                ├── .paper-authors
                ├── .paper-abstract
                ├── .paper-meta
                │   ├── .paper-date
                │   └── .paper-source
                └── .paper-actions
                    ├── .action-btn.view
                    ├── .action-btn.read
                    └── .action-btn.ignore
```

### Header

| Element | Style |
|---------|-------|
| `.sentinel-brief` | `width: 100%; height: 100%; background: rgba(7,7,13,0.98); display: flex; flex-direction: column; overflow: hidden` |
| `.brief-header` | `display: flex; justify-content: space-between; padding: 0.75rem 1rem; border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(13,13,20,0.5); cursor: move; -webkit-app-region: drag` |
| `.header-title` | `display: flex; align-items: center; gap: 0.4rem; font-size: 0.9rem; font-weight: 600` |
| `.header-badge` | `background: #ef4444; color: white; font-size: 0.65rem; font-weight: 700; padding: 1px 6px; border-radius: 8px; min-width: 16px; text-align: center` |

### Paper Card

| Element | Style |
|---------|-------|
| `.paper-card` | `background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 0.75rem; margin-bottom: 0.5rem; transition: all 0.15s ease` |
| `.paper-card:hover` | `background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1)` |
| `.paper-title` | `font-size: 0.8rem; font-weight: 600; color: rgba(240,240,245,0.85); line-height: 1.4; margin-bottom: 0.3rem` |
| `.paper-authors` | `font-size: 0.72rem; color: rgba(240,240,245,0.45); margin-bottom: 0.4rem` |
| `.paper-abstract` | `font-size: 0.72rem; color: rgba(240,240,245,0.5); line-height: 1.4; margin-bottom: 0.4rem` |
| `.paper-date` | `font-size: 0.65rem; color: rgba(240,240,245,0.3); font-family: 'JetBrains Mono', monospace` |
| `.paper-source` | `font-size: 0.65rem; color: rgba(61,116,231,0.6); text-transform: uppercase` |
| `.action-btn` | `padding: 0.3rem 0.6rem; border-radius: 5px; font-size: 0.7rem; cursor: pointer; border: none; transition: all 0.15s ease` |
| `.action-btn.view` | `background: rgba(0,229,204,0.1); color: #00e5cc` |
| `.action-btn.read` | `background: rgba(255,255,255,0.06); color: rgba(240,240,245,0.6)` |
| `.action-btn.ignore` | `background: transparent; color: rgba(240,240,245,0.3)` |
| `.action-btn.ignore:hover` | `color: #ef4444` |

---

## 12. Experiment Snapshot Window

**File**: `src/windows/ExperimentSnapshotWindow.vue`

Quick form for recording experiment observations.

### Layout Structure

```
.experiment-snapshot-window
├── .snapshot-header (draggable)
│   ├── .header-title ("⚡ 实验快照")
│   └── .close-btn
├── .snapshot-content
│   ├── .type-selector (4 buttons in grid)
│   ├── .form-group (×3: title, parameters, notes)
│   └── .save-btn
└── .toast (conditional)
```

### Type Selector

| Element | Style |
|---------|-------|
| `.type-selector` | `display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.4rem` |
| `.type-btn` | `display: flex; flex-direction: column; align-items: center; gap: 0.2rem; padding: 0.5rem 0.25rem; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; color: rgba(240,240,245,0.6)` |
| `.type-btn.active` | `background: rgba(0,229,204,0.12); border-color: rgba(0,229,204,0.25); color: #00e5cc` |
| `.type-icon` | `font-size: 1.1rem` |
| `.type-label` | `font-size: 0.65rem` |

**Types**: 📸 截屏, 💻 终端, 📝 代码, 🎙️ 语音

### Form & Save Button

| Element | Style |
|---------|-------|
| `.form-group` | `display: flex; flex-direction: column; gap: 0.25rem` |
| `.form-group label` | `font-size: 0.7rem; color: rgba(240,240,245,0.5); font-weight: 600` |
| `.form-group input, textarea` | `background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0.5rem 0.6rem; color: #f0f0f5; font-size: 0.8rem` |
| `.form-group input:focus` | `border-color: #00d1bb` |
| `.save-btn` | `margin-top: auto; padding: 0.55rem; background: linear-gradient(135deg, #00e5cc, #00b8a3); border: none; border-radius: 8px; color: #06211f; font-size: 0.82rem; font-weight: 700` |
| `.save-btn:disabled` | `opacity: 0.5; cursor: not-allowed` |

### Toast

| Element | Style |
|---------|-------|
| `.toast` | `position: absolute; bottom: 1rem; right: 1rem; padding: 0.5rem 0.9rem; background: rgba(0,229,204,0.15); border: 1px solid rgba(0,229,204,0.3); border-radius: 8px; color: #00e5cc; font-size: 0.8rem; font-weight: 600; animation: toast-in 0.3s ease` |

---

## 13. Shared Component Patterns

### 13.1 Drag Handle Pattern

Most secondary windows (not fullscreen Capture) have a draggable header:

```css
.header {
  cursor: move;
  user-select: none;
  -webkit-app-region: drag;
}
.close-btn, .back-btn, .action-btn {
  -webkit-app-region: no-drag; /* Interactive elements must opt out */
}
```

### 13.2 Modal/Overlay Pattern

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
  backdrop-filter: blur(4px);
}
.modal-content {
  background: rgba(18, 18, 28, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 1.5rem;
  width: 360px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}
```

### 13.3 Progress Bar Pattern

Used in KnowledgePanel, ReviewWizard, PopupWindow, ResultWindow:

```css
.progress-track {
  height: 4px; /* or 6px */
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #00e5cc, #3d74e7);
  border-radius: 2px;
  transition: width 0.3s ease;
}
```

### 13.4 Card/Item Hover Pattern

```css
.item {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  transition: all 0.15s ease;
}
.item:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}
```

### 13.5 Primary Action Button Pattern

```css
.btn-primary {
  background: linear-gradient(135deg, #00e5cc, #00b8a3);
  border: none;
  border-radius: 8px; /* or 10px, 12px */
  color: #06211f; /* dark text on bright gradient */
  font-weight: 700;
  cursor: pointer;
}
```

### 13.6 Secondary/Outline Button Pattern

```css
.btn-secondary {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: rgba(240, 240, 245, 0.7);
  cursor: pointer;
}
.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.1);
}
```

---

## 14. Dark Theme vs Light Theme

### Dark Theme (9 of 10 windows)

| Property | Value |
|----------|-------|
| Background | `rgba(7,7,13,0.96–0.98)` or `#07070d` |
| Text | `rgba(240,240,245,0.85)` primary, `0.5` muted |
| Borders | `rgba(255,255,255,0.06)` subtle |
| Inputs | `rgba(255,255,255,0.04–0.05)` background |
| Accent button text | `#06211f` (dark on bright teal) |

### Light Theme (SettingsPanel only)

| Property | Value |
|----------|-------|
| Background | `linear-gradient(180deg, #fbfcfe, #f4f7fb)` with radial teal glow |
| Text | `#111827` primary, `#6b7280` muted |
| Borders | `rgba(15,23,42,0.06–0.1)` |
| Inputs | `#ffffff` background |
| Accent button text | `#06211f` (same dark text) |

### Font Families by Theme

| Theme | Display | Body | Mono |
|-------|---------|------|------|
| Dark | Syne | DM Sans | JetBrains Mono |
| Light | Syne | DM Sans | JetBrains Mono |

---

## Appendix: Key Files Reference

| File | Purpose |
|------|---------|
| `src/style.css` | Global CSS variables, scrollbar, selection, Tailwind directives |
| `src/App.vue` | Root router view, mounts the correct window per route |
| `src/windows/*.vue` | One file per Tauri window |
| `src/components/*.vue` | Shared components (ChatHeader, ChatMessageList, ChatInputArea, KnowledgePanel, SettingsPanel) |
| `src/composables/useWindow.ts` | Window show/hide/resize utilities |
| `src/composables/useProgress.ts` | Progress bar state management |
