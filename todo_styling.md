# Styling Guide: Light/Dark Mode för hitta_ansikten

## 📺 Live Preview

**Se alla komponenter i aktion:** Öppna [`theme-examples.html`](./theme-examples.html) i din webbläsare för att se interaktiva exempel på alla komponenter i både light och dark mode. Filen innehåller:
- Komplett färgpalett med alla variabler
- Alla knapp-varianter (primary, secondary, ghost, icon)
- Formulärelement (inputs, selects, checkboxes)
- Badges och alerts i alla semantiska färger
- Listor och tabeller
- Fullständiga modul-exempel (Statistics Dashboard, Log Viewer)
- Face cards (Review Module)

**Klicka på "Växla till Dark Mode"-knappen för att se teman i realtid!**

## Översikt

Detta dokument beskriver det nya enhetliga styling-systemet för hitta_ansikten workspace. Målet är att skapa två koherenta teman (ljust och mörkt) med retro-estetik inspirerad av terminaler och klassiska desktop-miljöer.

## 🎨 Designfilosofi

### Retro Terminal Aesthetic
Inspirerat av klassiska terminal-emulators och retro-datorgränssnitt:
- **Tydliga kontraster** men ändå mjuka för ögonen
- **Monospace-typsnitt** för teknisk känsla där det passar
- **Subtila skuggor** och diskreta övergångar
- **Konsekvent spacing** för att skapa ordning
- **Färgschema** med begränsad palett som känns nostalgisk

### Tillgänglighet
- Alla färgkombinationer ska uppfylla WCAG 2.1 AA standard (4.5:1 kontrast för normal text)
- Knappar och interaktiva element ska vara tydligt avskiljda
- Hover-states ska vara uppenbara utan att vara för flashiga

## 🌈 Färgpaletter

### Light Mode - "Terminal Beige"
Inspirerad av klassiska datorer (Commodore 64, Amiga, Apple II) med djupt mättade, färgstarka toner.

```css
:root[data-theme="light"] {
  /* Bakgrunder - KRAFTIGT färgade retro (Commodore/Amiga/Arcade) */
  --bg-primary: #c8b088;        /* Djup varm guld/brons (inte vit!) */
  --bg-secondary: #b09060;      /* Mörk karamell */
  --bg-tertiary: #987840;       /* Brons/koppar toolbar */
  --bg-elevated: #d8c8a0;       /* Ljus persika för kort */
  --bg-hover: #a08050;          /* Djup brons hover */
  --bg-active: #886830;         /* Mörk guld aktiv */
  
  /* Förgrundstext - Mycket mörk för kontrast */
  --text-primary: #1a1008;      /* Nästan svart */
  --text-secondary: #2d1810;    /* Mörkbrun */
  --text-tertiary: #483020;     /* Brun */
  --text-inverse: #f8f0e0;      /* Ljusgul text */
  
  /* Borders & Dividers - Tydliga färger */
  --border-subtle: #a08858;     /* Guld */
  --border-medium: #886830;     /* Djup guld */
  --border-strong: #684818;     /* Mörkbrun */
  
  /* Accent Colors - MYCKET kraftiga retro-färger */
  --accent-primary: #38a818;    /* Klargrön (Apple II/Arcade) */
  --accent-primary-hover: #2a8010;
  --accent-primary-alpha-20: rgba(56, 168, 24, 0.2);
  --accent-secondary: #e85820;  /* Brännande orange (Arcade) */
  --accent-secondary-hover: #c03810;
  
  /* Semantic Colors - INTENSIVA färger (retro gaming/computers) */
  --color-success: #38a818;     /* Klargrön */
  --color-success-bg: #b0e898;  /* Ljusgrön med ordentlig färg */
  --color-warning: #f87820;     /* Intensiv orange */
  --color-warning-bg: #ffc898;  /* Persika med färg */
  --color-error: #e83020;       /* Klarröd */
  --color-error-bg: #ffb0a8;    /* Ljusrosa med färg */
  --color-info: #1888d8;        /* Klarblå (Commodore) */
  --color-info-bg: #a0d0f8;     /* Ljusblå med färg */
  
  /* Special */
  --shadow-sm: 0 1px 3px rgba(26, 16, 8, 0.25);
  --shadow-md: 0 2px 6px rgba(26, 16, 8, 0.30);
  --shadow-lg: 0 4px 12px rgba(26, 16, 8, 0.35);
}
```

### Dark Mode - "CRT Phosphor"
Inspirerad av gamla CRT-monitorer med grön/amber fosfor.

```css
:root[data-theme="dark"] {
  /* Bakgrunder */
  --bg-primary: #1a1914;        /* Mörkbrun/svart */
  --bg-secondary: #252520;      /* Ljusare för sections */
  --bg-tertiary: #2f2f28;       /* Toolbar/headers */
  --bg-elevated: #353530;       /* Kort/modaler */
  --bg-hover: #3a3a32;          /* Hover-state */
  --bg-active: #424238;         /* Aktivt element */
  
  /* Förgrundstext - Amber/Green CRT */
  --text-primary: #d4d2c0;      /* Ljus beige/gul - CRT amber */
  --text-secondary: #a8a698;    /* Dämpad amber */
  --text-tertiary: #7a7870;     /* Mycket dämpad */
  --text-inverse: #1a1914;      /* Text på ljusa bakgrunder */
  
  /* Borders & Dividers */
  --border-subtle: #3a3830;     /* Subtila avgränsningar */
  --border-medium: #4a4840;     /* Tydligare borders */
  --border-strong: #5a5848;     /* Starka avgränsningar */
  
  /* Accent Colors - Retro CRT */
  --accent-primary: #9acd32;    /* Gul-grön (klassisk terminal) */
  --accent-primary-hover: #b8e856;
  --accent-primary-alpha-20: rgba(154, 205, 50, 0.2);  /* För focus rings */
  --accent-secondary: #daa520;  /* Goldenrod/amber */
  --accent-secondary-hover: #eebb30;
  
  /* Semantic Colors */
  --color-success: #9acd32;     /* Gul-grön */
  --color-success-bg: #2a3320;
  --color-warning: #ffa500;     /* Orange */
  --color-warning-bg: #332a18;
  --color-error: #ff6347;       /* Tomat-röd */
  --color-error-bg: #331e1a;
  --color-info: #87ceeb;        /* Sky blue */
  --color-info-bg: #1a2a33;
  
  /* Special */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 2px 6px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 4px 12px rgba(0, 0, 0, 0.5);
  
  /* CRT-effekt (optional glow) */
  --glow-text: 0 0 2px currentColor;
  --glow-accent: 0 0 8px var(--accent-primary);
}
```

## 📐 Spacing & Layout System

Enhetligt spacing-system baserat på 4px grid:

```css
:root {
  /* Spacing Scale */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;
  --space-2xl: 32px;
  
  /* Border Radius */
  --radius-sm: 3px;
  --radius-md: 4px;
  --radius-lg: 6px;
  --radius-full: 999px;
  
  /* Font Sizes */
  --font-xs: 10px;
  --font-sm: 11px;
  --font-base: 13px;
  --font-md: 14px;
  --font-lg: 16px;
  --font-xl: 18px;
  --font-2xl: 22px;
  
  /* Font Families */
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: 'Monaco', 'Menlo', 'Consolas', 'Courier New', monospace;
  
  /* Transitions */
  --transition-fast: 0.1s ease;
  --transition-base: 0.15s ease;
  --transition-slow: 0.3s ease;
  
  /* Z-index Scale */
  --z-base: 1;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-modal: 1000;
  --z-tooltip: 2000;
}
```

## 🎯 Komponentmallar

### Grundläggande Layout

```css
/* Modul container */
.module {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: var(--font-base);
  overflow: hidden;
}

/* Header */
.module-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-medium);
  flex-shrink: 0;
}

.module-title {
  margin: 0;
  font-size: var(--font-md);
  font-weight: 600;
  color: var(--text-primary);
}

/* Body */
.module-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-md);
}

/* Section */
.module-section {
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  margin-bottom: var(--space-lg);
}

.section-title {
  margin: 0 0 var(--space-sm) 0;
  font-size: var(--font-md);
  font-weight: 600;
  color: var(--accent-primary);
}
```

### Knappar

```css
/* Base button */
.btn {
  padding: var(--space-sm) var(--space-md);
  font-size: var(--font-sm);
  font-family: var(--font-sans);
  font-weight: 500;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-base), 
              transform var(--transition-fast);
  user-select: none;
}

.btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.btn:active:not(:disabled) {
  transform: translateY(0);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Primary button */
.btn-primary {
  background: var(--accent-primary);
  color: var(--text-inverse);
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-primary-hover);
}

/* Secondary button */
.btn-secondary {
  background: var(--accent-secondary);
  color: var(--text-inverse);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--accent-secondary-hover);
}

/* Ghost button */
.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-medium);
}

.btn-ghost:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

/* Icon button */
.btn-icon {
  width: 28px;
  height: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
}

.btn-icon:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}
```

### Formulärelement

```css
/* Input fields */
.input {
  padding: var(--space-sm);
  font-size: var(--font-sm);
  font-family: var(--font-sans);
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-sm);
  transition: border-color var(--transition-base),
              box-shadow var(--transition-base);
}

.input:focus {
  outline: none;
  border-color: var(--accent-primary);
  /* Focus ring med semi-transparent accent färg */
  box-shadow: 0 0 0 2px var(--accent-primary-alpha-20);
  
  /* Alternativ med color-mix() för modern browsers:
   * Kräver Firefox 113+, Chrome 111+, Safari 16.2+ (April 2023+)
   * Ger mer flexibilitet genom dynamisk färgblandning
   * box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 20%, transparent);
   */
}

.input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Select dropdown */
.select {
  padding: var(--space-sm);
  font-size: var(--font-sm);
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.select:focus {
  outline: none;
  border-color: var(--accent-primary);
}

/* Checkbox */
.checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--accent-primary);
}
```

### Listor och Tabeller

```css
/* List items */
.list-item {
  padding: var(--space-sm);
  margin-bottom: var(--space-xs);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-base),
              border-color var(--transition-base);
}

.list-item:hover {
  background: var(--bg-hover);
  border-color: var(--border-medium);
}

.list-item.active {
  background: var(--bg-active);
  border-color: var(--accent-primary);
}

/* Table */
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-sm);
}

.table th {
  padding: var(--space-sm);
  text-align: left;
  font-weight: 600;
  background: var(--accent-primary);
  color: var(--text-inverse);
  border-bottom: 2px solid var(--border-strong);
}

.table td {
  padding: var(--space-sm);
  border-bottom: 1px solid var(--border-subtle);
}

.table tr:hover {
  background: var(--bg-hover);
}
```

### Status och Feedback

```css
/* Status badges */
.badge {
  display: inline-block;
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--font-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-radius: var(--radius-full);
}

.badge-success {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.badge-warning {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}

.badge-error {
  background: var(--color-error-bg);
  color: var(--color-error);
}

.badge-info {
  background: var(--color-info-bg);
  color: var(--color-info);
}

/* Alert boxes */
.alert {
  padding: var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid;
  margin-bottom: var(--space-md);
}

.alert-success {
  background: var(--color-success-bg);
  border-color: var(--color-success);
  color: var(--color-success);
}

.alert-warning {
  background: var(--color-warning-bg);
  border-color: var(--color-warning);
  color: var(--color-warning);
}

.alert-error {
  background: var(--color-error-bg);
  border-color: var(--color-error);
  color: var(--color-error);
}

.alert-info {
  background: var(--color-info-bg);
  border-color: var(--color-info);
  color: var(--color-info);
}
```

### Special: Dark Mode CRT-effekt (Optional)

```css
/* Applicera på dark mode för retro CRT-känsla */
[data-theme="dark"] .text-glow {
  text-shadow: var(--glow-text);
}

[data-theme="dark"] .accent-glow {
  box-shadow: var(--glow-accent);
}

/* Scanline effect (mycket subtil) */
[data-theme="dark"] .crt-scanlines {
  position: relative;
}

[data-theme="dark"] .crt-scanlines::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    to bottom,
    transparent 50%,
    rgba(0, 0, 0, 0.05) 50%
  );
  background-size: 100% 4px;
  pointer-events: none;
  opacity: 0.3;
}
```

## 📝 Implementationsinstruktioner

### 1. Skapa Central Tema-fil

Skapa `/frontend/src/renderer/theme.css` med alla CSS-variabler definierade ovan.

```css
/* theme.css */
/* Importera denna fil FÖRST i alla modul-css filer */

/* Default theme: Light mode variabler först, sedan dark mode override */
/* HTML element får data-theme attribut via JavaScript */

/* Lägg alla variabler här från Färgpaletter-sektionen ovan */
:root[data-theme="light"] { ... }
:root[data-theme="dark"] { ... }

/* Spacing, typography, transitions från Layout System-sektionen */
:root { ... }
```

### 2. Skapa Tema-växlare

Skapa en enkel tema-växlare som uppdaterar `data-theme` attributet:

```javascript
// theme-manager.js
class ThemeManager {
  constructor() {
    // Ladda sparad preferens eller använd system
    this.currentTheme = localStorage.getItem('theme') || 
                        this.getSystemTheme();
    this.applyTheme(this.currentTheme);
  }

  getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches 
      ? 'dark' 
      : 'light';
  }

  applyTheme(theme) {
    if (document.documentElement) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
      this.currentTheme = theme;
      
      // Dispatch event för moduler som behöver reagera på tema-byte
      window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
    }
  }

  toggle() {
    const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.applyTheme(newTheme);
  }
}

// Exportera singleton
export const themeManager = new ThemeManager();
```

### 3. Uppdatera Befintliga Moduler

För varje modul (t.ex. `StatisticsDashboard.css`):

**FÖRE:**
```css
.stats-dashboard {
  background: #2a2a2a;
  color: #d4d4d4;
}
```

**EFTER:**
```css
@import '../theme.css'; /* Lägg överst */

.stats-dashboard {
  background: var(--bg-primary);
  color: var(--text-primary);
}
```

**Systematisk ersättning:**
- Hårdkodade färger → CSS-variabler
- Hårdkodade spacing (12px) → `var(--space-md)`
- Hårdkodade font-sizes (13px) → `var(--font-base)`

### 4. Migrationsordning

Börja med moduler i denna ordning (enklast till svårast):

1. **LogViewer** - redan mörk, enkel struktur
2. **DatabaseManagement** - liknande struktur som LogViewer
3. **StatisticsDashboard** - fler komponenter men tydlig hierarki
4. **ReviewModule** - mer komplex med flera states
5. **FileQueueModule** - mest komplex, blandad styling

### 5. Testprocedur

Efter varje modul-uppdatering:

1. **Testa light mode**: Verifiera att alla element är läsbara
2. **Testa dark mode**: Verifiera CRT-estetiken
3. **Testa övergångar**: Växla mellan teman - ska vara smooth
4. **Testa hover/active states**: Alla interaktiva element
5. **Testa kontrast**: Använd browser devtools accessibility checker

### 6. Lägg till Tema-växlare i UI

Förslag: Lägg till en knapp i header/toolbar:

```javascript
// I huvudapplikationen
import { themeManager } from './theme-manager.js';

// Skapa toggle-knapp
const themeToggle = document.createElement('button');
themeToggle.className = 'btn-icon theme-toggle';
themeToggle.innerHTML = '🌓'; // eller använd ikon-bibliotek
themeToggle.title = 'Toggle Light/Dark Mode';
themeToggle.onclick = () => themeManager.toggle();

// Lägg till i toolbar
document.querySelector('.toolbar').appendChild(themeToggle);
```

## 🎨 Designriktlinjer per Modul

### FileQueueModule
- **Light mode**: Beige papper-känsla, som en lista
- **Dark mode**: Terminal-känsla, gröna accenter för aktiv fil
- **Special**: Använd `--font-mono` för filnamn

### StatisticsDashboard
- **Light mode**: Tabelllayout med olivgröna headers
- **Dark mode**: CRT-terminal, amber text med gul-grön accent
- **Special**: Tabellheaders använder `--accent-primary` som bakgrund

### DatabaseManagement
- **Light mode**: Formulär med beige bakgrund, tydliga knappar
- **Dark mode**: Terminal-forms, gul-grön för success-operationer
- **Special**: Error/warning/success alerts använder semantiska färger

### ReviewModule
- **Light mode**: Kort-layout med diskreta skuggor
- **Dark mode**: Grid med svag glow på aktiv face-card
- **Special**: Använd `accent-glow` på aktiv card i dark mode

### LogViewer
- **Light mode**: Minimal, fokus på läsbarhet
- **Dark mode**: Ren terminal-känsla med färgkodade log-levels
- **Special**: Använd `--font-mono` för all text

## 🔧 Verktyg och Helpers

### Färgkontrast-checker

Använd detta för att verifiera kontrast:

```javascript
// contrast-checker.js
// Baserad på WCAG 2.1 relative luminance formula
// https://www.w3.org/TR/WCAG21/#dfn-relative-luminance

function getLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrastRatio(color1, color2) {
  // Parse hex color to RGB
  const hex1 = color1.replace('#', '');
  const hex2 = color2.replace('#', '');
  
  const r1 = parseInt(hex1.substr(0, 2), 16);
  const g1 = parseInt(hex1.substr(2, 2), 16);
  const b1 = parseInt(hex1.substr(4, 2), 16);
  
  const r2 = parseInt(hex2.substr(0, 2), 16);
  const g2 = parseInt(hex2.substr(2, 2), 16);
  const b2 = parseInt(hex2.substr(4, 2), 16);
  
  const lum1 = getLuminance(r1, g1, b1);
  const lum2 = getLuminance(r2, g2, b2);
  
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  
  return (lighter + 0.05) / (darker + 0.05);
}

// Testa alla färgkombinationer
const tests = [
  ['--text-primary', '--bg-primary'],
  ['--text-secondary', '--bg-primary'],
  ['--accent-primary', '--bg-elevated'],
  // ... alla viktiga kombinationer
];

// Hämta CSS-variabler och kör tester
const root = document.documentElement;
const styles = getComputedStyle(root);

tests.forEach(([fg, bg]) => {
  const fgColor = styles.getPropertyValue(fg).trim();
  const bgColor = styles.getPropertyValue(bg).trim();
  const ratio = getContrastRatio(fgColor, bgColor);
  
  const passAA = ratio >= 4.5;
  const passAAA = ratio >= 7.0;
  
  console.log(
    `${fg} / ${bg}: ${ratio.toFixed(2)}:1 ` +
    `${passAA ? '✓ AA' : '✗ AA'} ${passAAA ? '✓ AAA' : ''}`
  );
});

// Alternativ: Använd befintligt library som 'wcag-contrast'
// npm install wcag-contrast
// import { hex } from 'wcag-contrast';
// const ratio = hex('#6b8e23', '#f5f1e8');
```

### CSS Variable Preview Tool

För att visuellt se alla färger:

```html
<!-- theme-preview.html -->
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="theme.css">
  <style>
    .color-swatch {
      display: inline-block;
      width: 60px;
      height: 60px;
      border: 1px solid #ccc;
      margin: 4px;
    }
    .color-label {
      font-size: 10px;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <h2>Light Theme</h2>
  <div data-theme="light">
    <div class="color-swatch" style="background: var(--bg-primary)"></div>
    <div class="color-label">--bg-primary</div>
    <!-- Repeat för alla färger -->
  </div>
  
  <h2>Dark Theme</h2>
  <div data-theme="dark">
    <div class="color-swatch" style="background: var(--bg-primary)"></div>
    <div class="color-label">--bg-primary</div>
    <!-- Repeat för alla färger -->
  </div>
</body>
</html>
```

## 📚 Best Practices

### DRY Principles
1. **Aldrig** hårdkoda färger direkt i komponenter
2. **Alltid** använd CSS-variabler från temat
3. **Dela** gemensamma komponentklasser (`.btn`, `.input`, etc.)
4. **Centralisera** alla tema-modifikationer i `theme.css`

### Naming Conventions
- Använd semantiska namn: `--text-primary` istället för `--color-gray-900`
- Gruppera variabler logiskt: bakgrunder tillsammans, text tillsammans
- Använd konsekvent namngivning: `[element]-[variant]-[state]`
  - Exempel: `btn-primary-hover`, `input-focus-border`

### Performance
- Använd CSS-variabler istället för preprocessor-variabler (SASS/LESS)
- Detta möjliggör runtime tema-byte utan ny CSS-generering
- CSS-variabler är nativa och snabba i moderna browsers

### Accessibility
- Testa med screen readers
- Säkerställ keyboard navigation funkar med alla teman
- Använd `prefers-color-scheme` som default
- Respektera användarens OS-inställning

## 🚀 Implementation Roadmap

### Fas 1: Grundläggande Setup (1-2 timmar)
1. Skapa `theme.css` med alla CSS-variabler
2. Skapa `theme-manager.js` för tema-byte
3. Lägg till tema-toggle i UI
4. Testa tema-byte fungerar

### Fas 2: Migrering Enklare Moduler (2-3 timmar)
1. LogViewer → CSS-variabler
2. DatabaseManagement → CSS-variabler
3. Testa båda modulerna i båda teman

### Fas 3: Migrering Komplexa Moduler (3-4 timmar)
1. StatisticsDashboard → CSS-variabler
2. ReviewModule → CSS-variabler
3. FileQueueModule → CSS-variabler
4. Testa alla moduler tillsammans

### Fas 4: Polish och Detaljer (2-3 timmar)
1. Lägg till CRT-effekter för dark mode (optional)
2. Finjustera färger baserat på användartest
3. Säkerställ konsistens över alla moduler
4. Accessibility audit
5. Performance check

### Fas 5: Dokumentation och Cleanup (1 timme)
1. Uppdatera README med tema-info
2. Skapa developer guide för nya moduler
3. Ta bort gammal CSS-kod
4. Commit och PR

**Total uppskattad tid: 9-13 timmar**

---

## 🎨 Fas 6: Utveckling av Dedikerad Temamodul (Projektplan)

### Översikt & Motivering

**Varför en dedikerad temamodul?**

Istället för att begränsa tema-hanteringen till grundläggande preferences, utvecklas en fullfjädrad temamodul som ger användarna:
- Utförlig kontroll över alla aspekter av applikationens utseende
- Möjlighet att skapa, spara och dela custom teman
- Export/import av tema-presets för att enkelt byta mellan olika stilar
- Live preview av ändringar innan de appliceras
- Bibliotek med fördefinierade teman att välja mellan

Detta gör applikationen mer flexibel och anpassningsbar efter olika arbetsflöden och preferenser.

### Projektmål

1. **Skapande av en självständig workspace-modul för tema-hantering**
2. **Implementera komplett tema-redigerare med live preview**
3. **Bygga export/import-system för tema-presets**
4. **Skapa bibliotek med fördefinierade teman**
5. **Integrera med befintlig workspace-arkitektur**

### Teknisk Arkitektur

#### Modul-struktur

```
frontend/src/renderer/components/
└── ThemeEditor/
    ├── ThemeEditor.js           # Huvudkomponent
    ├── ThemeEditor.css          # Modul-specifik styling
    ├── ColorPicker.js           # Färgväljare för variabler
    ├── PresetLibrary.js         # Bibliotek med fördefinierade teman
    ├── ThemePreview.js          # Live preview av tema
    ├── ExportImport.js          # Export/import funktionalitet
    └── utils/
        ├── themeValidator.js    # Validera tema-format
        ├── themeConverter.js    # Konvertera mellan format
        └── contrastChecker.js   # WCAG-kontrast validering
```

#### Datamodell för Tema-Presets

```javascript
// Theme Preset Format (JSON)
{
  "name": "Retro Terminal Green",
  "version": "1.0",
  "author": "User Name",
  "created": "2025-01-01T12:00:00Z",
  "description": "Classic green phosphor terminal aesthetic",
  "baseTheme": "dark", // eller "light"
  "variables": {
    // Alla CSS-variabler från theme.css
    "--bg-primary": "#1a1914",
    "--text-primary": "#d4d2c0",
    "--accent-primary": "#9acd32",
    // ... alla andra variabler
  },
  "metadata": {
    "tags": ["retro", "dark", "green", "terminal"],
    "accessibility": {
      "wcagAA": true,
      "wcagAAA": false,
      "contrastRatios": {
        "textOnBackground": 7.2,
        "accentOnBackground": 4.8
      }
    }
  }
}
```

### Funktionella Krav

#### 1. Tema-Redigerare (Core Feature)

**UI-komponenter:**
- **Kategori-navigering**: Tabs/sidebar för olika variabel-grupper
  - Bakgrunder (Backgrounds)
  - Text & Typografi (Text & Typography)
  - Accent-färger (Accent Colors)
  - Semantiska färger (Semantic Colors)
  - Borders & Shadows
  - Spacing & Layout

- **Färgväljare per variabel**:
  - Standard color picker för varje CSS-variabel
  - Hex, RGB, HSL input
  - Opacity/alpha slider
  - Förslag på relaterade färger
  - "Kopiera från annan variabel"-funktion

- **Live Preview**:
  - Mini-versioner av alla moduler som uppdateras i realtid
  - Toggle mellan olika moduler (FileQueue, Stats, Review, etc.)
  - Före/efter-jämförelse

- **Kontrast-validering**:
  - Automatisk WCAG-kontroll för alla text/bakgrund-kombinationer
  - Varningar vid för låg kontrast
  - Förslag på bättre färgval

**Implementering:**

```javascript
// ThemeEditor.js
class ThemeEditor extends React.Component {
  state = {
    currentTheme: { ...defaultTheme },
    activeCategory: 'backgrounds',
    previewModule: 'all',
    isDirty: false,
    contrastWarnings: []
  };

  handleColorChange = (variable, newColor) => {
    const updatedTheme = {
      ...this.state.currentTheme,
      variables: {
        ...this.state.currentTheme.variables,
        [variable]: newColor
      }
    };
    
    // Validera kontrast
    const warnings = this.validateContrast(updatedTheme);
    
    this.setState({
      currentTheme: updatedTheme,
      isDirty: true,
      contrastWarnings: warnings
    });
    
    // Applicera tema direkt för live preview
    this.applyThemePreview(updatedTheme);
  };

  validateContrast = (theme) => {
    // Kör kontrast-checker på kritiska kombinationer
    const checks = [
      ['--text-primary', '--bg-primary'],
      ['--text-secondary', '--bg-primary'],
      ['--accent-primary', '--bg-elevated'],
      // ...fler kombinationer
    ];
    
    return checks
      .map(([fg, bg]) => contrastChecker.check(
        theme.variables[fg], 
        theme.variables[bg]
      ))
      .filter(result => !result.passAA);
  };

  // ...mer funktionalitet
}
```

#### 2. Preset-bibliotek

**Funktioner:**
- Visa lista med tillgängliga presets
  - Fördefinierade teman (inkluderade med applikationen)
  - Importerade teman (från användare eller community)
  - Användarens egna sparade teman
  
- Preview av varje preset
  - Thumbnail/screenshot av temat
  - Metadata (namn, författare, tags, beskrivning)
  - Accessibility-status (WCAG AA/AAA badge)

- Hantering:
  - Applicera preset direkt
  - Redigera kopia av preset
  - Radera importerade/egna teman
  - Duplicera och modifiera befintligt tema

**Implementering:**

```javascript
// PresetLibrary.js
const PresetLibrary = () => {
  const [presets, setPresets] = useState([]);
  const [filter, setFilter] = useState({ tags: [], accessibility: 'all' });

  useEffect(() => {
    // Ladda fördefinierade teman
    const bundledThemes = loadBundledThemes();
    // Ladda användarens importerade teman
    const importedThemes = loadImportedThemes();
    // Ladda användarens egna teman
    const customThemes = loadCustomThemes();
    
    setPresets([...bundledThemes, ...importedThemes, ...customThemes]);
  }, []);

  const applyPreset = (preset) => {
    themeManager.applyTheme(preset);
    // Dispatcha event för att informera andra komponenter
    window.dispatchEvent(new CustomEvent('theme-applied', { 
      detail: { theme: preset } 
    }));
  };

  return (
    <div className="preset-library">
      <FilterBar filter={filter} onFilterChange={setFilter} />
      <PresetGrid 
        presets={filterPresets(presets, filter)}
        onApply={applyPreset}
        onEdit={(preset) => openEditor(preset)}
        onDelete={(preset) => deletePreset(preset)}
      />
    </div>
  );
};
```

#### 3. Export/Import System

**Export-funktioner:**
- **Format**:
  - JSON (standard, full kontroll)
  - CSS fil (endast variabler, för manuell integration)
  - Komprimerad package (.hitheme fil med metadata + preview-bild)

- **Export-options**:
  - Inkludera metadata (författare, beskrivning, tags)
  - Generera preview-screenshot automatiskt
  - Validera innan export (kontrast, komplettering)

**Import-funktioner:**
- Läs JSON, CSS, eller .hitheme-filer
- Validera format och version
- Kontrollera för konflikter med befintliga teman
- Preview innan import
- Batch-import (flera teman samtidigt)

**Implementering:**

```javascript
// ExportImport.js
class ThemeExporter {
  async exportTheme(theme, format = 'json') {
    // Validera tema
    const validation = themeValidator.validate(theme);
    if (!validation.valid) {
      throw new Error(`Invalid theme: ${validation.errors.join(', ')}`);
    }

    switch(format) {
      case 'json':
        return this.exportAsJSON(theme);
      case 'css':
        return this.exportAsCSS(theme);
      case 'package':
        return await this.exportAsPackage(theme);
      default:
        throw new Error(`Unknown format: ${format}`);
    }
  }

  exportAsJSON(theme) {
    const json = JSON.stringify(theme, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const filename = `${theme.name.replace(/\s+/g, '-')}.json`;
    this.downloadFile(blob, filename);
  }

  exportAsCSS(theme) {
    // Konvertera till CSS-format
    const css = themeConverter.toCSSVariables(theme);
    const blob = new Blob([css], { type: 'text/css' });
    const filename = `${theme.name.replace(/\s+/g, '-')}.css`;
    this.downloadFile(blob, filename);
  }

  async exportAsPackage(theme) {
    // Skapa ett komplett package med preview-bild
    const preview = await this.generatePreview(theme);
    const package = {
      theme: theme,
      preview: preview, // Base64 encoded image
      version: '1.0',
      format: 'hitheme'
    };
    
    const json = JSON.stringify(package);
    const blob = new Blob([json], { type: 'application/json' });
    const filename = `${theme.name.replace(/\s+/g, '-')}.hitheme`;
    this.downloadFile(blob, filename);
  }

  generatePreview(theme) {
    // Applicera tema temporärt och ta screenshot
    // Använd html2canvas eller liknande
    return new Promise((resolve) => {
      // Implementation...
      resolve(previewDataURL);
    });
  }

  downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}

class ThemeImporter {
  async importTheme(file) {
    const content = await this.readFile(file);
    const extension = file.name.split('.').pop().toLowerCase();

    let theme;
    switch(extension) {
      case 'json':
        theme = JSON.parse(content);
        break;
      case 'css':
        theme = themeConverter.fromCSSVariables(content);
        break;
      case 'hitheme':
        const package = JSON.parse(content);
        theme = package.theme;
        break;
      default:
        throw new Error(`Unsupported file format: ${extension}`);
    }

    // Validera
    const validation = themeValidator.validate(theme);
    if (!validation.valid) {
      throw new Error(`Invalid theme file: ${validation.errors.join(', ')}`);
    }

    // Spara till lokalt tema-bibliotek
    await this.saveToLibrary(theme);
    
    return theme;
  }

  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  async saveToLibrary(theme) {
    const existingThemes = await this.loadLibrary();
    
    // Kolla efter konflikt (samma namn)
    if (existingThemes.find(t => t.name === theme.name)) {
      // Lägg till timestamp för att göra unik
      theme.name = `${theme.name} (${new Date().toISOString()})`;
    }

    existingThemes.push(theme);
    await this.saveLibrary(existingThemes);
  }

  // LocalStorage eller IndexedDB för persistent lagring
  async loadLibrary() {
    const stored = localStorage.getItem('customThemes');
    return stored ? JSON.parse(stored) : [];
  }

  async saveLibrary(themes) {
    localStorage.setItem('customThemes', JSON.stringify(themes));
  }
}
```

#### 4. Fördefinierade Tema-Presets (Bundled)

**Inkluderade teman vid release:**

1. **Terminal Beige** (Light) - Standard light mode
2. **CRT Phosphor** (Dark) - Standard dark mode
3. **Commodore 64** - Blå bakgrund med ljusblå text (klassisk)
4. **Apple II** - Grön på svart terminal
5. **Amber Monitor** - Orange/amber fosfor på svart
6. **Solarized Light** - Populärt developer-tema
7. **Solarized Dark** - Populärt developer-tema
8. **Nord** - Arktisk, kall färgpalett
9. **Dracula** - Populärt dark theme
10. **High Contrast** - Tillgänglighet (svart/vit, WCAG AAA)

**Implementering:**

```javascript
// bundled-themes.js
export const BUNDLED_THEMES = [
  {
    name: "Terminal Beige",
    version: "1.0",
    author: "hitta_ansikten",
    baseTheme: "light",
    description: "Warm retro terminal aesthetic with colorful accents",
    variables: {
      "--bg-primary": "#e8dfc5",
      // ... alla variabler från theme-examples.html
    },
    metadata: {
      tags: ["light", "retro", "warm", "default"],
      accessibility: { wcagAA: true, wcagAAA: false }
    }
  },
  {
    name: "CRT Phosphor",
    version: "1.0",
    author: "hitta_ansikten",
    baseTheme: "dark",
    description: "Classic CRT monitor with green/amber phosphor",
    variables: {
      "--bg-primary": "#1a1914",
      // ... alla variabler
    },
    metadata: {
      tags: ["dark", "retro", "crt", "default"],
      accessibility: { wcagAA: true, wcagAAA: false }
    }
  },
  // ... fler bundled themes
];
```

### UI/UX Design

#### Layout i Workspace

Temamodulen ska vara en fullfjädrad panel i workspace:

```
+--------------------------------------------------+
|  Theme Editor                              [x]   |
+--------------------------------------------------+
|  [Backgrounds] [Text] [Accents] [Semantic]      |
|  [Borders] [Spacing] [Preview] [Presets]        |
+--------------------------------------------------+
|                                                  |
|  Backgrounds                         Preview    |
|  +-------------------+               +--------+  |
|  | bg-primary    [■] |               |        |  |
|  | #e8dfc5       ... |               | Module |  |
|  +-------------------+               | Preview|  |
|  | bg-secondary  [■] |               |        |  |
|  | #d4c5a0       ... |               +--------+  |
|  +-------------------+                           |
|  | bg-tertiary   [■] |               Contrast   |
|  | #b8a67d       ... |               +--------+  |
|  +-------------------+               | ✓ AA   |  |
|                                      | ✗ AAA  |  |
|  [Save] [Export] [Import] [Reset]   +--------+  |
+--------------------------------------------------+
```

#### Workflow

1. **Öppna temamodulen** från workspace-menyn
2. **Välj startpunkt**:
   - Börja från befintligt tema/preset
   - Börja från scratch (tom mall)
3. **Redigera variabler** kategori för kategori
4. **Se live preview** av ändringar
5. **Validera accessibility** (automatiskt)
6. **Spara tema** med namn och metadata
7. **Exportera eller dela** med andra

### Testplan

#### Enhetstester
- Validering av tema-format
- Kontrast-beräkningar
- Export/import-konvertering
- CSS-variabel-parsing

#### Integrationstester
- Theme manager integration med workspace
- Persistent lagring av teman
- Live preview-uppdateringar
- Export/import av olika format

#### Användartest
- Skapa custom tema från scratch
- Importera befintligt tema
- Modifiera bundled tema
- Exportera och dela tema
- Accessibility-validering

### Tidsuppskattning

| Fas | Uppgift | Tid |
|-----|---------|-----|
| **6.1** | Grundläggande modul-skelett & routing | 4h |
| **6.2** | Färgväljare-komponenter | 6h |
| **6.3** | Live preview-system | 8h |
| **6.4** | Kontrast-validering | 4h |
| **6.5** | Preset-bibliotek UI | 6h |
| **6.6** | Export-funktionalitet | 6h |
| **6.7** | Import-funktionalitet | 6h |
| **6.8** | Bundled themes creation | 8h |
| **6.9** | Persistent storage (LocalStorage/IndexedDB) | 4h |
| **6.10** | Testing & bug fixes | 8h |
| **6.11** | Dokumentation & guide | 4h |
| **6.12** | Polish & UX-förbättringar | 6h |
| | **Total uppskattad tid** | **70 timmar** |

### Milestolpar

1. **M1**: Basic theme editor med färgväljare (10h)
2. **M2**: Live preview fungerar (18h)
3. **M3**: Export/Import implementerat (30h)
4. **M4**: Preset-bibliotek klart (36h)
5. **M5**: Bundled themes skapade (44h)
6. **M6**: Testing & polish (60h)
7. **M7**: Production-ready (70h)

### Success Criteria

✅ Användare kan skapa custom teman från scratch
✅ Användare kan modifiera befintliga teman
✅ Användare kan exportera teman till JSON/CSS/.hitheme
✅ Användare kan importera teman från fil
✅ Live preview visar ändringar i realtid
✅ WCAG-validering fungerar och varnar vid problem
✅ Minst 10 bundled themes inkluderade
✅ Persistent lagring av custom themes fungerar
✅ Integration med workspace är sömlös
✅ Dokumentation finns för alla funktioner

### Riskanalys

| Risk | Sannolikhet | Impact | Mitigering |
|------|-------------|--------|------------|
| Performance-problem vid live preview | Medel | Hög | Debounce color changes, optimize render |
| Kontrast-beräkning fel | Låg | Hög | Använd beprövat library (wcag-contrast) |
| Import av felaktiga filer | Hög | Medel | Robust validering, error handling |
| LocalStorage gräns överskridas | Medel | Medel | Använd IndexedDB istället, cleanup gamla teman |
| UI-komplexitet överväldigande | Medel | Medel | Progressive disclosure, guided tour |

### Framtida Utökningar (Post-MVP)

1. **Community theme marketplace**
   - Upload teman till central server
   - Browse och ladda ner community themes
   - Rating & comments

2. **AI-assisterad tema-skapning**
   - "Generate theme from image" - extrahera färgpalett från bild
   - "Suggest complementary colors" - AI-förslag baserat på valda färger
   - "Auto-fix contrast" - automatiskt justera färger för WCAG

3. **Per-modul tema-override**
   - Olika teman för olika workspace-moduler
   - Spara layout + tema som "workspaces"

4. **Animation & transition-inställningar**
   - Kontrollera hastighet på transitions
   - Aktivera/inaktivera animationer
   - Motion-sensitivity mode

5. **Font management**
   - Custom typsnitt
   - Per-kategori font settings
   - Font size scaling

---

## 📖 Referenser

### Färginspiration
- **Terminal Beige Light**: Inspirerad av DEC VT terminals och klassiska Unix-workstations
- **CRT Phosphor Dark**: Inspirerad av amber/green monochrome CRT monitors
- **kaffe_over_tid**: Se https://github.com/krissen/kaffe_over_tid/ för retro-estetik referens

### Typografi
- Monospace för teknisk data (filnamn, loggar, kod)
- Sans-serif för UI-text (knappar, labels, headers)
- Konsekvent line-height för läsbarhet

### Accessibility Resources
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [A11y Color Palette](https://color.adobe.com/create/color-accessibility)

## 🎯 Framtida Förbättringar

### Efter Initial Implementation
1. **Fler teman**: Möjlighet att lägga till custom teman
2. **Per-modul tema**: Låt användare välja tema per workspace-modul
3. **Accent color picker**: Låt användare välja accent-färg
4. **High contrast mode**: För tillgänglighet
5. **Animations toggle**: Reducera animationer för motion-sensitivity

### Advanced Features
1. **Theme editor**: UI för att skapa egna teman
2. **Theme export/import**: Dela teman mellan installationer
3. **Automatic theme**: Växla baserat på tid på dygnet
4. **Module presets**: Fördefinierade tema-kombinationer för olika arbetsflöden

---

**Författare:** Styling dokumentation för hitta_ansikten workspace  
**Version:** 1.0  
**Datum:** 2025-01-01  
**Status:** Klar för implementation
