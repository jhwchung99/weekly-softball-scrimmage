import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

// `coverage/` holds istanbul's own bundled reporter scripts, which carry
// eslint-disable comments for rules this config does not enable — three
// warnings on every run, from generated files nobody edits. It is gitignored;
// eslint needs telling separately.
const config = [{ ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'out/**'] }, ...nextCoreWebVitals];

export default config;
