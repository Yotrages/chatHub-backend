// Load test processor - runs before each virtual user
// Set LOAD_TEST_JWT_TOKEN environment variable before running

export default {
  beforeScenario: async (context, events, done) => {
    // Get JWT token from environment variable
    // Set before running:
    //   $env:LOAD_TEST_JWT_TOKEN="your_token_here"  (PowerShell)
    //   export LOAD_TEST_JWT_TOKEN="your_token_here"  (Bash)
    const token = process.env.LOAD_TEST_JWT_TOKEN;

    if (!token) {
      throw new Error("LOAD_TEST_JWT_TOKEN environment variable not set. Get token from deployed app: login → DevTools → Cookies → auth-token");
    }

    context.vars.jwt_token = token;
    return done();
  }
};