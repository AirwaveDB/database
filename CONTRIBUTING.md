# Contributing

## Station data

Station metadata belongs in `data/stations/<CC>.csv`, where `<CC>` is an ISO 3166-1 alpha-2 country code. Use `ZZ` only when a country cannot be established from a reliable source.

Do not add stream URLs to this repository. Playable endpoints belong in [`AirwaveDB/streams`](https://github.com/AirwaveDB/streams).

## Data rules

- Keep station names in the form used by the broadcaster.
- Do not translate names unless the translated name is an official alternative name.
- Leave unknown fields empty instead of guessing.
- Use ISO country and language codes where available.
- Do not classify a station as public, community, college, or internet-only without source evidence.
- Prefer the station's own website for corrections when available.
- Do not add tracking URLs, short-lived signed URLs, credentials, or private endpoints.

## Automated imports

Most rows are produced from upstream public datasets. `data/source_map.csv` records the source identifier associated with each AirwaveDB station ID.

Corrections to source-derived fields should normally be made at the upstream source when possible. AirwaveDB may keep local overrides when upstream data cannot represent a correction.

## Pull requests

Keep unrelated data changes in separate pull requests. Large automated rewrites should include the source and reason for the change in the pull request description.