/**
 * Name formatting utility for responsive display
 *
 * Abbreviation levels (in order of decreasing length):
 * 1. Full names: "Arvid Wallentinsson, Elis Niemi"
 * 2. First + initial: "Arvid W., Elis"
 * 3. Compact: "ArvidW, Elis"
 * 4. Tight: "ArvidW,Elis"
 * 5. Initials: "AW, EN"
 * 6. Initials tight: "AW,EN"
 * 7. Extended initials for uniqueness: "AW, ENi"
 *
 * Port of Python's resolve_fornamn_dubletter() from rename_service.py
 */

/**
 * Split full name into first and last name
 * @param {string} fullName
 * @returns {{ firstName: string, lastName: string }}
 */
export function splitName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length < 2) {
    return { firstName: parts[0] || '', lastName: '' };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * Resolve first name collisions by determining required surname prefix length
 * @param {string[]} names - Array of full names
 * @returns {Map<string, { firstName: string, lastName: string, needsDisambig: boolean, prefixLen: number }>}
 */
export function resolveFirstNameCollisions(names) {
  const uniqueNames = [...new Set(names.filter(Boolean))];
  const result = new Map();

  // Build map: firstName -> set of lastNames
  const firstNameMap = new Map();
  const nameMap = new Map();

  for (const name of uniqueNames) {
    const { firstName, lastName } = splitName(name);
    if (!firstName) continue;

    if (!firstNameMap.has(firstName)) {
      firstNameMap.set(firstName, new Set());
    }
    firstNameMap.get(firstName).add(lastName);
    nameMap.set(name, { firstName, lastName });
  }

  // Determine disambiguation for each name
  for (const [name, { firstName, lastName }] of nameMap) {
    const lastNameSet = firstNameMap.get(firstName);
    // Filter out empty strings for collision detection
    const nonEmptyLastNames = [...lastNameSet].filter((ln) => ln);
    const hasCollision = nonEmptyLastNames.length > 1;

    let prefixLen = 1;
    if (hasCollision && lastName) {
      const otherLastNames = nonEmptyLastNames.filter((ln) => ln !== lastName);
      // Find minimum prefix length to disambiguate
      while (
        otherLastNames.some(
          (other) =>
            other &&
            lastName.slice(0, prefixLen).toLowerCase() ===
              other.slice(0, prefixLen).toLowerCase(),
        )
      ) {
        prefixLen++;
        if (prefixLen > lastName.length) break;
      }
    }

    result.set(name, {
      firstName,
      lastName,
      needsDisambig: hasCollision,
      prefixLen,
    });
  }

  return result;
}

/**
 * Measure text width using Canvas API (cached canvas for performance)
 * @param {string} text
 * @param {string} font - CSS font string (e.g., "11px Monaco")
 * @returns {number}
 */
function measureTextWidth(text, font) {
  const canvas =
    measureTextWidth._canvas ||
    (measureTextWidth._canvas = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  return ctx.measureText(text).width;
}

/**
 * Resolve initial collisions by adding characters from lastName
 * @param {string[]} names - Array of full names
 * @returns {string[]} - Array of disambiguated initials
 */
function resolveInitialCollisions(names) {
  const result = [];
  const initialsCount = new Map();

  // First pass: count initial occurrences
  for (const name of names) {
    const { firstName, lastName } = splitName(name);
    const initials =
      (firstName[0] || '').toUpperCase() +
      (lastName ? lastName[0].toUpperCase() : '');
    initialsCount.set(initials, (initialsCount.get(initials) || 0) + 1);
  }

  // Second pass: disambiguate if needed
  const seenInOutput = new Map();
  for (const name of names) {
    const { firstName, lastName } = splitName(name);
    let initials =
      (firstName[0] || '').toUpperCase() +
      (lastName ? lastName[0].toUpperCase() : '');

    // Check if this initials has collision
    if (initialsCount.get(initials) > 1 && lastName) {
      // Add more characters from lastName to disambiguate
      let prefixLen = 2;
      let extended = initials + lastName.slice(1, prefixLen).toLowerCase();

      while (seenInOutput.has(extended) && prefixLen <= lastName.length) {
        prefixLen++;
        extended = initials + lastName.slice(1, prefixLen).toLowerCase();
      }
      initials = extended;
    }

    seenInOutput.set(initials, true);
    result.push(initials);
  }

  return result;
}

/**
 * Format names array to fit within maxWidth pixels
 * @param {string[]} names - Array of full person names
 * @param {number} maxWidthPx - Maximum available width in pixels
 * @param {string} font - CSS font string (e.g., "11px Monaco")
 * @returns {{ text: string, level: number, fits: boolean }}
 */
export function formatNamesToFit(names, maxWidthPx, font) {
  if (!names?.length || maxWidthPx <= 0) {
    return { text: '', level: -1, fits: true };
  }

  const uniqueNames = [...new Set(names.filter(Boolean))];
  if (!uniqueNames.length) {
    return { text: '', level: -1, fits: true };
  }

  const collisions = resolveFirstNameCollisions(uniqueNames);

  // Level 1: Full names "Arvid Wallentinsson, Elis Niemi"
  const level1 = uniqueNames.join(', ');
  if (measureTextWidth(level1, font) <= maxWidthPx) {
    return { text: level1, level: 1, fits: true };
  }

  // Level 2: First + initial "Arvid W., Elis"
  const level2Parts = uniqueNames.map((name) => {
    const info = collisions.get(name);
    if (!info) return name;
    if (info.needsDisambig && info.lastName) {
      return `${info.firstName} ${info.lastName.slice(0, info.prefixLen)}.`;
    }
    return info.firstName;
  });
  const level2 = level2Parts.join(', ');
  if (measureTextWidth(level2, font) <= maxWidthPx) {
    return { text: level2, level: 2, fits: true };
  }

  // Level 3: Compact "ArvidW, Elis"
  const level3Parts = uniqueNames.map((name) => {
    const info = collisions.get(name);
    if (!info) return name;
    if (info.needsDisambig && info.lastName) {
      return `${info.firstName}${info.lastName.slice(0, info.prefixLen)}`;
    }
    return info.firstName;
  });
  const level3 = level3Parts.join(', ');
  if (measureTextWidth(level3, font) <= maxWidthPx) {
    return { text: level3, level: 3, fits: true };
  }

  // Level 4: Tight "ArvidW,Elis"
  const level4 = level3Parts.join(',');
  if (measureTextWidth(level4, font) <= maxWidthPx) {
    return { text: level4, level: 4, fits: true };
  }

  // Level 5: Initials "AW, EN"
  const initials = uniqueNames.map((name) => {
    const { firstName, lastName } = splitName(name);
    const fi = firstName ? firstName[0].toUpperCase() : '';
    const li = lastName ? lastName[0].toUpperCase() : '';
    return fi + li;
  });
  const level5 = initials.join(', ');
  if (measureTextWidth(level5, font) <= maxWidthPx) {
    return { text: level5, level: 5, fits: true };
  }

  // Level 6: Initials tight "AW,EN"
  const level6 = initials.join(',');
  if (measureTextWidth(level6, font) <= maxWidthPx) {
    return { text: level6, level: 6, fits: true };
  }

  // Level 7: Extended initials for uniqueness "AW, ENi"
  const extendedInitials = resolveInitialCollisions(uniqueNames);
  const level7 = extendedInitials.join(',');
  if (measureTextWidth(level7, font) <= maxWidthPx) {
    return { text: level7, level: 7, fits: true };
  }

  // Nothing fits - return shortest anyway with fits: false
  return { text: level7, level: 7, fits: false };
}

// Export measureTextWidth for use in components
export { measureTextWidth };
