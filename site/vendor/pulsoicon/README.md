PulsoIcon 6.1.0, from the `pulsoicon-core` npm package: the runtime modules
(`icon.js`, `frame.js`, `recipes.js`, `solid.js`, `geometry.js`, `dom.js`) and
only the icons Lingtype uses, in `icons/`. `dom.js` plays an icon on hover or
focus with Motion (`../motion`). The package archive SHA-1 is
`5cf9b793a1e09bb00a2b7a58adcff3fc699e6e28`.

To add an icon, copy `dist/icons/<name>.js` from the same package version and
list it in `site/icons.mjs`.

PulsoIcon is distributed under the ISC License, and some icon shapes are based
on Lucide (ISC); see `LICENSE`, which must be kept with these files.
