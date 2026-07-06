# Contributing & Development

Feel free to create an issue if you want to report a bug.

If you tested this library with some other bank it would be great to hear from you and update the information in the README.

As this is a free-time project, a lot of things are still remaining which could be added to this library, especially other kinds of transactions. If you want to contribute with pull-requests this would be highly appreciated.

## Development

This project uses [npm](https://www.npmjs.com/) as its package manager. After cloning, install the dependencies and use the provided scripts:

```
npm install        # install dependencies
npm run build      # compile TypeScript to ./dist
npm run lint       # check formatting and lint rules (Biome)
npm run lint:fix   # apply safe lint/format fixes
npm run format     # apply formatting only
npm test           # run the test suite (Vitest)
npm run test:watch # run the test suite in watch mode
```

The same steps (build, lint, test) run automatically via GitHub Actions on every push and pull request to `main`.

## Built With

- [Typescript](https://www.typescriptlang.org/) - Programming Language
- [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) - XML parsing for CAMT statements
- [Vitest](https://vitest.dev/) - Testing Framework
- [Biome](https://biomejs.dev/) - Linter and formatter
- [npm](https://www.npmjs.com/) - Package manager
