# Hamlet Press Releases

This directory is the canonical archive for Hamlet and Impact in Business Recruitment Group press releases.

## Archive structure

Store every new press release in a year and month directory based on its publication date:

```text
press/
  {year}/
    {Month}/
      YYYY-MM-DD-short-release-title.md
```

For example, a release published in October 2026 belongs in `press/2026/October/`. A release published in November 2026 belongs in `press/2026/November/`.

## Publishing rules

1. Create the year directory if it does not already exist.
2. Create the full English month-name directory if it does not already exist.
3. Add the complete release as a Markdown (`.md`) file in that month directory.
4. Use the publication date in `YYYY-MM-DD` format at the start of the filename, followed by a concise, lowercase, hyphen-separated title.
5. Keep previously published releases in their original folders; do not overwrite or silently replace an earlier release. Corrections should be clearly identified in the release or published as a dated update.
6. Update this archive whenever a new press release is created so the repository remains the source of record.

The month directory is based on the release's publication date, not the date on which a draft was first prepared.
