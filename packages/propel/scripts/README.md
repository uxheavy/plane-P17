# Identity exports

The three `CompanyRunner*` components in `../src/icons/brand/` own the fan,
wordmark typography/font input, and lockup. `SITE_NAME` in `@plane/constants`
owns product text. The exporter reads their current source, without a prior
package build. SVG glyph outlines, rasters, and animated frames are derivatives.

From the Plane checkout:

```sh
pnpm install --frozen-lockfile
pnpm brand:generate
pnpm brand:check
```

For an isolated export tree, append `--root /absolute/path` to either command.
Check is read-only, includes the producer type check, and rejects missing or
changed declared outputs. Generation renders everything before replacing the
allowlisted files. Do not edit generated artwork. The app manifests retain
policy fields; the generator updates only product identity fields.

`brand-artwork.ts` composes the runtime components and encodes files using
locked workspace dependencies. `brand.ts` owns paths, required formats and
canvases. Static lettering uses the font input declared beside the wordmark;
no machine font or external image tool is used. Encoded-byte equivalence across
operating systems is not guaranteed; regenerate with the locked dependencies.
Functional illustrations and genuine upstream/provider marks are outside this
exporter.
