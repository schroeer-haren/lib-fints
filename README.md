# Lib-FinTS

[![CI](https://github.com/schroeer-haren/lib-fints/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/schroeer-haren/lib-fints/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-LGPL--2.1--or--later-blue.svg)](LICENSE)

A Typescript/Javascript client library for Online-Banking via the FinTS 3.0 protocol with PIN/TAN, supporting PSD2 and decoupled TAN methods.

> This is a fork. The original project is available at [robocode13/lib-fints](https://github.com/robocode13/lib-fints).

## Installation

This fork is published to **GitHub Packages** as `@schroeer-haren/lib-fints`. Add an `.npmrc` next to your `package.json` telling npm where to find the scope:

```
@schroeer-haren:registry=https://npm.pkg.github.com
```

GitHub Packages requires authentication even for reads, so log in once with a GitHub token that has the `read:packages` scope:

```
npm login --scope=@schroeer-haren --registry=https://npm.pkg.github.com
```

Then install:

```
npm i @schroeer-haren/lib-fints
```

Requires Node.js >= 18. The only runtime dependency is `fast-xml-parser` (used for CAMT statement parsing).

## Quick Start

```typescript
const config = FinTSConfig.forFirstTimeUse(productId, productVersion, bankUrl, bankId, userId, pin);
const client = new FinTSClient(config);

const syncResponse = await client.synchronize();
```

Note that most banks require a TAN method to be selected before account data is returned, and most transactions need a TAN challenge to be completed. See the [Getting Started guide](docs/getting-started.md) for the full walkthrough.

## Documentation

- [Getting Started](docs/getting-started.md) – prerequisites, product registration, installation and a complete usage example
- [API Guide](docs/api.md) – handling TAN challenges, restoring sessions from saved banking information, TAN media and debugging
- [Supported Transactions](docs/transactions.md) – transaction methods, capability checks, parameters and TAN continuation
- [Contributing & Development](docs/contributing.md) – how to build, lint and test the project

The `docs/` folder also contains the official FinTS 3.0 specification PDFs.

## Limitations

- Only FinTS 3.0 is supported (older versions may not work)
- Only PIN/TAN security is supported (including decoupled TAN methods)
- No support for payment transactions or transfers yet

Implementing further transactions should be straight forward and contributions are highly appreciated.

## Tested Banks

Successfully tested with **DKB**, **ING-DiBa** and **Renault Bank Direkt**. If you have tested it with another bank, feedback is welcome.

## License

This project is licensed under the LGPL 2.1 (or later) License – see the [LICENSE](LICENSE) file for details.

## References

- [Product Registration](https://www.hbci-zka.de/register/prod_register.htm)
- [FinTS 3.0 Specification](https://www.hbci-zka.de/spec/3_0.htm)
