# How to contribute

Thank you for investing your time in contributing to RIPE-KG.

To get an overview of the knowledge graph, please read the [README](README.md).

## Issues

If you spot a problem or want to suggest a change to the data, mappings, GraphDB setup, or interface, please search the [issue tracker](https://github.com/RIPE-Observatory/RIPE-KG/issues) first. If a related issue does not exist, open a new issue on GitHub.

For data or mapping changes, include the motivation, the affected files, and the expected effect on the generated RDF.

## Proposing changes

RIPE-KG publishes research integrity assessment traces as RDF using RIPE-O. Contributions are welcome when they improve reproducibility, data quality, mappings, documentation, or the exploration interface.

When proposing a change, please check that:

- public assessment data remains pseudonymised;
- generated RDF changes are explained through the source data or mapping change that produced them;
- YARRRML and generated RML files stay aligned when mappings are updated;
- RIPE-O terms are used consistently with the ontology;
- documentation is updated when access, reproduction, or query behaviour changes.

Avoid manually editing generated RDF without also documenting the source or mapping change behind it.

## Make changes locally

1. Fork the repository.
2. Create a working branch.
3. Make the focused change.
4. Run the relevant checks for the files you changed.

Useful checks include:

```sh
make reproduce
```

For GraphDB loading or inference changes:

```sh
make graphdb-verify
```

For interface changes:

```sh
make ui-build
```

## Commit your update

Commit the changes once you are happy with them.

Always write a clear log message for your commits. One-line messages are fine for small changes.

## Pull request

When you are finished, create a pull request.

- Link the pull request to the issue it addresses.
- Describe the motivation for the change.
- Mention the checks you ran.
- Include notes on any data, mapping, or generated RDF files that changed.
- Target the `main` branch.
