# Project workflow

- This is the public source repository: https://github.com/xingnengmao666/shien-thank-you.
- After each authorized project update, run the relevant local checks, commit the project changes, and push to `origin` on the current branch. Report a push as successful only after it succeeds.
- Once local tests pass, do not run production tests unless the user explicitly requests them. Never create production test students, claims, or messages for release verification.
- Never commit real student or teacher names, class rosters, invitation codes (including hashes or ciphertext), database data, credentials, cookies, screenshots, or deployment identifiers. Keep private data and reports in ignored `.local/` and use `wrangler.example.toml` for the public configuration.
- Stage specific paths. Run `npm run check:publish` against the staged contents before every commit and push; never bypass the publication check or force-add private files.
- For a fresh checkout, copy `wrangler.example.toml` to ignored `wrangler.toml` and fill in an independent D1 database ID. Run `git config core.hooksPath .githooks` to enable the local commit check.
- Keep the homepage GitHub link, MIT license, and public documentation consistent with the repository. Publish source code only; the license does not include private school or student data.
