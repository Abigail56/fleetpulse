# ADR 0014: Reports

Status: Accepted (Phase 18)

## Decisions

- **Reports read the source records directly,** with no summary tables that could drift from them. That's enough at this scale, and can be revisited if reports get slow.
- **One shape for every report:** columns with a kind, rows, headline figures and notes. One screen and both exports handle all nine.
- **Each report states its limits in notes,** such as uncounted unapproved expenses or missing costs. A figure with no data behind it is blank, never zero.
- **Periods are whole days in the organisation's time zone,** defaulting to the last 30 days.
- **Currencies are never added together or converted.**
- **The driver report is not a ranking of people.** Its note says so, because late arrivals can have causes outside a driver's control.
- **The compliance report only knows what's recorded.** A vehicle with no insurance document isn't reported as uninsured.
- **Exports:** `fpdf2` for PDF, a small pure-Python library, and the standard library for CSV. CSV cells that could run as spreadsheet formulas are neutralised. PDFs embed DejaVu, installed in the API image, because the built-in PDF fonts stop at Latin-1 and would mangle many names. Without the font, they fall back to replacing those characters.
- **Exports are audited,** because a copy has left the system. Viewing a report isn't.

## Consequences

- Screens show up to 5,000 rows and say so if there are more. PDFs show up to 1,000, and say so too.
- Reports run within the request, so a very long period over a very large fleet could be slow. Phase 21 measures this.
- There are no charts yet: reports are figures and tables.
