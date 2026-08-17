// Build config only. Keeps ESM (modules: false) so bundlers can tree shake,
// and strips JSX so consumers whose bundler only treats .jsx as JSX can still
// build the package. Metro tolerates JSX in .js; Vite and others do not.
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: '18', esmodules: true }, modules: false }],
    ['@babel/preset-react', { runtime: 'automatic' }],
  ],
}
