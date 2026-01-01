# Styling Guide: Light/Dark Mode för hitta_ansikten

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
Inspirerad av gamla terminaler och pappersbaserade gränssnitt.

```css
:root[data-theme="light"] {
  /* Bakgrunder */
  --bg-primary: #f5f1e8;        /* Ljus beige/papper */
  --bg-secondary: #e8e3d8;      /* Mörkare beige för sections */
  --bg-tertiary: #ddd8cc;       /* Toolbar/headers */
  --bg-elevated: #ffffff;       /* Kort/modaler */
  --bg-hover: #e0dbd0;          /* Hover-state */
  --bg-active: #d5cfc3;         /* Aktivt element */
  
  /* Förgrundstext */
  --text-primary: #2c2820;      /* Huvudtext - mörkbrun */
  --text-secondary: #5a5248;    /* Sekundärtext */
  --text-tertiary: #7a7268;     /* Disabled/subtle */
  --text-inverse: #f5f1e8;      /* Text på mörka bakgrunder */
  
  /* Borders & Dividers */
  --border-subtle: #d0c8b8;     /* Subtila avgränsningar */
  --border-medium: #b8b0a0;     /* Tydligare borders */
  --border-strong: #a09888;     /* Starka avgränsningar */
  
  /* Accent Colors - Retro */
  --accent-primary: #6b8e23;    /* Olivgrön - primär action */
  --accent-primary-hover: #557018;
  --accent-primary-alpha-20: rgba(107, 142, 35, 0.2);  /* För focus rings */
  --accent-secondary: #8b7355;  /* Brun - sekundär action */
  --accent-secondary-hover: #6f5d45;
  
  /* Semantic Colors */
  --color-success: #6b8e23;     /* Olivgrön */
  --color-success-bg: #e8f0d8;
  --color-warning: #d2691e;     /* Choklad/orange */
  --color-warning-bg: #fef3e8;
  --color-error: #a0522d;       /* Sienna/rödbrun */
  --color-error-bg: #fde8e0;
  --color-info: #4682b4;        /* Steel blue */
  --color-info-bg: #e8f2f8;
  
  /* Special */
  --shadow-sm: 0 1px 3px rgba(44, 40, 32, 0.12);
  --shadow-md: 0 2px 6px rgba(44, 40, 32, 0.16);
  --shadow-lg: 0 4px 12px rgba(44, 40, 32, 0.20);
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
  
  /* Alternativ med color-mix() för modern browsers (ger mer flexibilitet): */
  /* box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 20%, transparent); */
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
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    this.currentTheme = theme;
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
function getContrastRatio(color1, color2) {
  // Implementation av WCAG contrast calculation
  // https://www.w3.org/TR/WCAG20-TECHS/G17.html
}

// Testa alla färgkombinationer
const tests = [
  ['--text-primary', '--bg-primary'],
  ['--text-secondary', '--bg-primary'],
  ['--accent-primary', '--bg-elevated'],
  // ... alla viktiga kombinationer
];

tests.forEach(([fg, bg]) => {
  const ratio = getContrastRatio(
    getComputedStyle(document.documentElement).getPropertyValue(fg),
    getComputedStyle(document.documentElement).getPropertyValue(bg)
  );
  console.log(`${fg} / ${bg}: ${ratio.toFixed(2)}:1 ${ratio >= 4.5 ? '✓' : '✗'}`);
});
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
**Datum:** 2026-01-01  
**Status:** Klar för implementation
