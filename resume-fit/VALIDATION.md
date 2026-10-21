# Format-preserving export validation

- Original matcher tests: 4 passed.
- PDF layout regression tests: 3 passed.
- Production frontend build: passed.
- API smoke checks: PDF/DOCX/TXT export-import, history, validation and origin guard passed.
- Original-layout API: a real one-page source exported to one page with three reordered groups; manually altered draft rejected (409).
- Compared original and corrected source: all extracted words, character count and URI links retained; source fonts retained (Calibri, Calibri Bold, Inter Italic and Fira Sans).
- Corrected PDF rendered and visually inspected for font, spacing, headings and page layout.
- New dependency: project-local Python 3.10+ / PyMuPDF helper, invoked by Express. Setup is documented.

Demo uses sample requirements (React, Node.js, REST and CI/CD), not a company JD supplied by the user. Free-text rewriting does not preserve arbitrary PDF layout; rebuilt exports are explicitly separate.
