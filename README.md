# AirwaveDB Database

Canonical station metadata for the AirwaveDB internet radio directory.

AirwaveDB is a directory of internet radio stations and their playable stream endpoints. This repository stores station identity, normalized metadata, source mappings, and indexes. Consumer applications should use [`AirwaveDB/api`](https://github.com/AirwaveDB/api).

## Data

Canonical data is stored as JSON under [`data/`](data/).

- `data/stations/<CC>.json` — station metadata split by ISO 3166-1 alpha-2 country code
- `data/source_map.json` — upstream source identifiers mapped to stable AirwaveDB station IDs
- `data/redirects.json` — station ID redirects created when duplicate records are merged
- `data/countries.json` — country index and station counts
- `data/languages.json` — observed language codes and station counts
- `data/categories.json` — normalized categories and station counts
- `data/index.json` — build metadata and source counts

Unknown or unclassified countries use `ZZ`.

## Station schema

The canonical machine-readable schema is [`schema/station.schema.json`](schema/station.schema.json), using JSON Schema 2020-12.

```json
{
  "id": "awb_c89923852f31a58c4a4c",
  "name": "Example Radio",
  "country": "JP",
  "subdivision": null,
  "languages": ["ja"],
  "categories": ["news"],
  "tags": ["news", "talk"],
  "homepage": "https://example.com/",
  "favicon": "https://example.com/logo.png",
  "type": "public",
  "sourceCount": 2,
  "updatedAt": "2026-10-13T00:00:00Z"
}
```

`type` may be `public`, `community`, `college`, `internet`, or `null`. Missing metadata is kept as `null` or an empty array rather than guessed.

## Public API

The consumer-facing JSON API is maintained in [`AirwaveDB/api`](https://github.com/AirwaveDB/api).

Routes include:

```text
/v1/stations/:id
/v1/countries/:code
/v1/categories/:id
/v1/languages/:code
```

## Sources

The automated import currently uses:

- [Radio Browser](https://www.radio-browser.info/)
- [verified-radio-streams](https://github.com/eyalev/verified-radio-streams)

Source records are normalized and de-duplicated before they are written to `data/stations/`. Stream endpoints are maintained separately in [`AirwaveDB/streams`](https://github.com/AirwaveDB/streams).

## Updates

The database is rebuilt automatically every day. A large unexpected reduction in the upstream dataset is rejected instead of replacing a healthy snapshot.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before submitting station corrections or schema changes.

## License

Database files are released under [CC0 1.0](LICENSE). Station names, logos, websites, and other third-party material remain subject to their respective owners' rights.
