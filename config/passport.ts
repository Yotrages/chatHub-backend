import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      authData?: {
        provider: string;
        profile: {
          id: string;
          name: string;
          email: string;
        };
      };
    }
  }
}

const configurePassport = (): void => {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_ID!,
    clientSecret: process.env.GOOGLE_SECRET!,
    callbackURL: "/api/auth/google/callback",
    passReqToCallback: true
  }, (req: Request, accessToken: string, refreshToken: string, profile: any, done: (error: any, user?: any) => void) => {
    req.authData = {
      provider: 'google',
      profile: {
        id: profile.id,
        name: profile.displayName,
        email: profile.emails?.[0]?.value || '',
      }
    };
    done(null, req.authData);
  }));

  passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_ID!,
    clientSecret: process.env.GITHUB_SECRET!,
    callbackURL: "/api/auth/github/callback",
    passReqToCallback: true
  }, (req: Request, accessToken: string, refreshToken: string, profile: any, done: (error: any, user?: any) => void) => {
    req.authData = {
      provider: 'github',
      profile: {
        id: profile.id,
        name: profile.displayName || profile.username,
        email: profile.emails?.[0]?.value || '',
      }
    };
    done(null, req.authData);
  }));
};

export default configurePassport;