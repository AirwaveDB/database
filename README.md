# AirwaveDB Database

Open metadata database for internet radio stations.

AirwaveDB keeps station metadata separate from playable stream URLs. Stream endpoints are maintained in [`AirwaveDB/streams`](https://github.com/AirwaveDB/streams), while generated consumer formats are published by [`AirwaveDB/api`](https://github.com/AirwaveDB/api).

## Data

All editable station data is stored as CSV under [`data/`](data/).

- `data/stations/<CC>.csv` — station metadata split by ISO 3166-1 alpha-2 country code
- `data/source_map.csv` — upstream source identifiers mapped to stable AirwaveDB station IDs
- `data/redirects.csv` — station ID redirects created when duplicate records are merged
- `data/countries.csv` — country index and station counts
- `data/languages.csv` — observed language codes and station counts
- `data/categories.csv` — normalized categories and station counts
- `data/index.json` — build metadata and country index

Unknown or unclassified countries use `ZZ`.

## Station schema

| Field | Description |
| --- | --- |
| `id` | Stable AirwaveDB station identifier |
| `name` | Station name |
| `country` | ISO 3166-1 alpha-2 country code |
| `subdivision` | Region or subdivision when supplied by a source |
| `language_codes` | Semicolon-separated language codes |
| `categories` | Semicolon-separated normalized categories |
| `tags` | Semicolon-separated source tags |
| `homepage` | Station website |
| `favicon` | Station logo or favicon URL |
| `type` | `public`, `community`, `college`, `internet`, or empty when unknown |
| `source_count` | Number of source records grouped into the station |
| `updated_at` | Most recent upstream change or verification timestamp |

A missing value means unknown. The database does not fill missing metadata with guessed values.

## Sources

The automated import currently uses:

- [Radio Browser](https://www.radio-browser.info/) — community-maintained public-domain radio directory
- [verified-radio-streams](https://github.com/eyalev/verified-radio-streams) — CC0 dataset of streams that returned audio during its verification run

Source records are normalized and de-duplicated before being written to `data/stations/`. Stream URLs are not stored in this repository.

## Updates

The database is rebuilt automatically every day. A build is rejected when the primary directory returns an unexpectedly small dataset, preventing a temporary upstream failure from replacing a healthy snapshot.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before submitting station corrections or schema changes.

## License

Database files are released under [CC0 1.0](LICENSE). Station names, logos, websites, and other third-party material remain subject to their respective owners' rights.