# nef2jpg.py Improvements TODO

## Prioritet 1 - Kritiskt ✅ COMPLETED

### Felhantering
- [x] Lägg till try/except runt `rawpy.imread()` för att hantera korrupta NEF-filer
- [x] Lägg till try/except runt `img.save()` för att hantera disk full/permissions
- [x] Lägg till try/except runt `json.dump()` för att hantera write failures
- [x] Lägg till lämpliga felmeddelanden för varje exception-typ

### Bugfixar
- [x] Fixa rad 44: Ändra `"exported": "true"` till `"exported": true` (boolean)

### Kodstil
- [x] Översätt rad 11: "Installera rawpy och pillow!" → English
- [x] Översätt rad 23: "Filen finns ej" → English
- [x] Översätt rad 26 kommentar: "Läs NEF, konvertera till RGB" → English
- [x] Översätt alla andra svenska kommentarer/strängar → English

### Improvements Made
- Added comprehensive error handling with specific exit codes (4-7)
- Fixed boolean value bug (line 64)
- Translated all Swedish text to English
- Added helpful error messages for each failure scenario
- Status file write failures are now warnings (conversion still succeeds)

## Prioritet 2 - Rekommenderat ✅ COMPLETED

### Validering
- [x] Validera att input-fil har .NEF eller .nef extension
- [x] Validera att output-path är säker (inte systemfiler)
- [x] Lägg till check för min/max filstorlek

### Dokumentation
- [x] Lägg till module-level docstring
- [x] Lägg till docstring för `main()` funktion
- [x] Dokumentera exit codes (0=success, 1=import error, 2=usage error, 3=file not found, etc.)
- [x] Lägg till kommentarer för varje större kodblock

### Logging
- [x] Lägg till optional verbose mode (`--verbose` flag)
- [x] Logga conversion start/end timestamps
- [x] Logga filstorlekar (input NEF, output JPG)

### Improvements Made
- **Validation**: Added `validate_nef_file()` and `validate_output_path()` functions
- **File extension**: Validates .NEF/.nef extensions (exit code 8)
- **File size**: Min 100KB, Max 100MB validation (exit code 9)
- **Path safety**: Output must be under /tmp or user home directory
- **Documentation**: Comprehensive module docstring with exit codes
- **Function docstrings**: All functions documented with Args/Returns/Raises
- **Verbose mode**: `--verbose` flag enables detailed logging
- **Logging**: Timestamps, file sizes, conversion time, image dimensions
- **Constants**: Configuration moved to top-level constants (MIN_FILE_SIZE, etc.)

## Prioritet 3 - Nice to have ✅ PARTIALLY COMPLETED

### Konfigurabilitet
- [x] Gör quality konfigurerbar via argument (default: 98)
- [x] Lägg till `--quality` argument/flag
- [ ] ~~Överväg config-fil för standardinställningar~~ (Not needed - CLI args sufficient)

### Performance & UX
- [ ] ~~Lägg till progress feedback för stora filer (>10MB)~~ (Would require threading - overkill)
- [ ] ~~Överväg att visa estimerad tid kvar~~ (Same as above)
- [x] Optimera för snabbare konvertering (Already using rawpy efficiently)

### Code Quality
- [x] Lägg till type hints (Python 3.5+)
- [x] Överväg att bryta ut konverteringslogik till separat funktion
- [x] Överväg att bryta ut status-writing till separat funktion
- [ ] ~~Lägg till unit tests~~ (Would require test framework - out of scope)

### Improvements Made
- **Type hints**: Added comprehensive type annotations throughout (Path, Dict, Any, etc.)
- **argparse**: Replaced manual arg parsing with proper argparse module
- **--quality flag**: Configurable JPEG quality (1-100) with validation
- **Refactoring**: Separated concerns into dedicated functions:
  - `convert_nef_to_jpeg()`: Pure conversion logic with metadata return
  - `write_status_file()`: Status file writing isolated
  - `parse_arguments()`: Clean argument parsing with validation
- **Better API**: Functions now return metadata (conversion time, file sizes, etc.)
- **Code organization**: Clean separation of validation, conversion, and I/O
- **Modern Python**: Using argparse, type hints, proper return types

## Testing Checklist

Efter ändringar, testa:
- [ ] Normal konvertering: NEF → JPG fungerar
- [ ] Felhantering: Korrupt NEF-fil ger användbart felmeddelande
- [ ] Felhantering: Icke-existerande fil ger rätt exit code
- [ ] Felhantering: Ogiltigt output path hanteras
- [ ] Status-fil skrivs korrekt med boolean (inte sträng)
- [ ] Integration: Bildvisare kan använda konverterad fil
- [ ] Integration: 'O'-tangent triggar konvertering korrekt

## Notes

- Scriptet anropas från `main.js` rad 42-46
- Python interpreter: hardcoded till hitta_ansikten conda env
- Output status fil: `~/Library/Application Support/bildvisare/original_status.json`
- Används av bildvisare för att trigga slave viewer
