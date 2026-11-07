// Load test processor - runs before each virtual user
// Replace YOUR_JWT_TOKEN_HERE with actual token from deployed app

module.exports = {
  beforeScenario: async (context, events, done) => {
    // Get JWT token from your deployed app:
    // 1. Login at https://your-render-url.onrender.com
    // 2. DevTools → Application → Cookies → auth-token
    // 3. Paste token below
    context.vars.jwt_token = "YOUR_JWT_TOKEN_HERE";

    return done();
  }
};