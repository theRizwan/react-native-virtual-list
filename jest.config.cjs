module.exports = {
  preset: 'react-native',
  testMatch: ['**/tests/**/*.rn.test.jsx'],
  moduleFileExtensions: ['js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.(js|jsx)$': ['babel-jest', { configFile: require.resolve('./babel.config.cjs') }],
  },
  transformIgnorePatterns: ['node_modules/(?!(react-native|@react-native)/)'],
}
