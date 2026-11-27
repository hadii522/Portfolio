# Aizaz Haider Goraya · Portfolio

[Live portfolio](https://hadii522.github.io/Portfolio/) · [Project case studies](https://hadii522.github.io/Portfolio/case-studies.html)

I am a BS Data Science graduate from FAST NUCES Lahore (August 2026), working across applied machine learning, data workflows and software engineering. This portfolio presents my project contributions, implementation decisions and the evidence behind reported results.

## Start here

- [Energy Market Intelligence: application source, setup, tests and evaluation](project-sources/energy-intelligence/README.md)
- [SellerMath: numerical commerce tools](https://github.com/hadii522/SellerMath)
- [Campus Mart](https://github.com/hadii522/Campus-Mart)
- [Sixteen detailed project case studies](https://hadii522.github.io/Portfolio/case-studies.html)

Three current CVs are available on the website: general/software, AI & ML, and data engineering. Professional and client projects are described with their sharing limits; employer code, personal data, credentials and private datasets are excluded.

## Local website preview

Node.js 24 is used for verification and deployment. No install step is needed for the static website.

```sh
node server.js
node --test tests/server.test.js tests/frontend.test.js
node scripts/build-static.mjs
```

The website preview opens at `http://127.0.0.1:3000`. GitHub Pages deploys the allowlisted `dist/` artifact after tests pass. Application source under `project-sources/` is available through GitHub and is excluded from the website artifact. Each application has its own setup instructions.

## Project selection

See [the public project index](PROJECT_INDEX.md) for the selected work and [the change log](docs/PORTFOLIO_CHANGELOG.md) for improvements and validation.
