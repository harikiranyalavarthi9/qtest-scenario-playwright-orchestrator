module.exports = {
  default: {
    // No `paths` here on purpose: paths are passed on the CLI so a run can be scoped to
    // specific feature files (e.g. only the one that changed). See package.json scripts
    // for the full run and the GitHub Actions workflow for the per-commit scope.
    require: ['tests/step-definitions/**/*.js'],
    tags: 'not @skip',
    format: ['progress-bar', 'json:reports/cucumber-report.json'],
    publishQuiet: true
  }
};
